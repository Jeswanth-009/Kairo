//! Backup & restore (Phase 14 · hardening). Backups are consistent snapshots
//! of the live database taken through SQLite's online backup API (safe under
//! WAL), stored under `AppData/backups/`. Restore copies a backup back into
//! the live connection — after validating the file really is a Kairo database
//! — and re-runs migrations so older backups upgrade transparently.

use super::{vault::sql_err, MIGRATIONS};
use rusqlite::Connection;
use serde::Serialize;
use std::path::{Path, PathBuf};

/// Older backups beyond this count are pruned after each successful backup.
pub const KEEP_BACKUPS: usize = 10;

/// Backup file names are generated here and restore resolves them strictly
/// against this pattern — anything else is rejected before touching disk.
const NAME_PATTERN: &str = "kairo-backup-";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupInfo {
    pub file_name: String,
    pub path: String,
    pub bytes: u64,
    /// "YYYYMMDD-HHMMSS" parsed out of the file name (UTC at creation).
    pub created_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreReport {
    pub restored_from: String,
    pub applied_migrations: usize,
}

pub fn backups_dir(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("backups")
}

/// Create a consistent backup of `conn` in `dir` and prune old ones.
pub fn create_backup(conn: &Connection, dir: &Path) -> Result<BackupInfo, String> {
    std::fs::create_dir_all(dir).map_err(|e| format!("cannot create backups dir: {e}"))?;
    let stamp: String = sql_err(
        conn.query_row("SELECT strftime('%Y%m%d-%H%M%S', 'now')", [], |r| r.get(0)),
    )?;
    let file_name = format!("{NAME_PATTERN}{stamp}.db");
    let path = dir.join(&file_name);

    let mut dst = Connection::open(&path).map_err(|e| format!("cannot open backup file: {e}"))?;
    {
        let backup = rusqlite::backup::Backup::new(conn, &mut dst)
            .map_err(|e| format!("backup init failed: {e}"))?;
        backup
            .run_to_completion(64, std::time::Duration::from_millis(0), None)
            .map_err(|e| format!("backup failed: {e}"))?;
    } // borrow of dst ends here — the integrity check needs it back.
    // Hardening: never keep a corrupt snapshot on disk.
    let check: String = sql_err(dst.query_row("PRAGMA quick_check", [], |r| r.get(0)))?;
    if check != "ok" {
        let _ = std::fs::remove_file(&path);
        return Err(format!("backup failed integrity check: {check}"));
    }
    drop(dst);

    prune_old_backups(dir)?;
    let bytes = file_size(&path)?;
    Ok(BackupInfo {
        file_name,
        path: path.to_string_lossy().to_string(),
        bytes,
        created_at: stamp,
    })
}

pub fn list_backups(dir: &Path) -> Result<Vec<BackupInfo>, String> {
    let mut backups: Vec<BackupInfo> = Vec::new();
    let entries = match std::fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(backups),
        Err(e) => return Err(format!("cannot read backups dir: {e}")),
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if !is_backup_name(&name) {
            continue;
        }
        let created_at = name
            .trim_start_matches(NAME_PATTERN)
            .trim_end_matches(".db")
            .to_string();
        backups.push(BackupInfo {
            bytes: file_size(&entry.path())?,
            path: entry.path().to_string_lossy().to_string(),
            file_name: name,
            created_at,
        });
    }
    // Names embed UTC timestamps, so lexicographic sort is chronological.
    backups.sort_by(|a, b| b.file_name.cmp(&a.file_name));
    Ok(backups)
}

/// Restore `file_name` from `dir` into the live connection. The file must be
/// a valid SQLite database carrying the Kairo schema (core tables present),
/// or the restore is refused and the live data is left untouched. Migrations
/// are re-applied afterwards so an older backup upgrades transparently.
pub fn restore_backup(live: &mut Connection, dir: &Path, file_name: &str) -> Result<RestoreReport, String> {
    if !is_backup_name(file_name) {
        return Err(format!(
            "'{file_name}' is not a Kairo backup file name (expected {NAME_PATTERN}<stamp>.db)"
        ));
    }
    let path = dir.join(file_name);
    if !path.is_file() {
        return Err("Backup file not found".to_string());
    }
    let src = Connection::open(&path).map_err(|e| format!("cannot open backup: {e}"))?;
    validate_kairo_db(&src)?;

    {
        let backup = rusqlite::backup::Backup::new(&src, live)
            .map_err(|e| format!("restore init failed: {e}"))?;
        backup
            .run_to_completion(64, std::time::Duration::from_millis(0), None)
            .map_err(|e| format!("restore failed: {e}"))?;
    } // mutable borrow of live ends here.

    // A backup may predate the latest schema; migrations are idempotent, so
    // re-applying upgrades the restored data in place.
    super::apply_migrations(live).map_err(|e| format!("restored, but migration failed: {e}"))?;
    let applied: i64 = sql_err(
        live.query_row("SELECT COUNT(*) FROM _migrations", [], |r| r.get(0)),
    )?;
    Ok(RestoreReport {
        restored_from: file_name.to_string(),
        applied_migrations: applied as usize,
    })
}

/// Hardening gate: the source must be a healthy SQLite file that actually
/// carries the Kairo schema — never a random or hostile file.
fn validate_kairo_db(conn: &Connection) -> Result<(), String> {
    let check: String = sql_err(conn.query_row("PRAGMA quick_check", [], |r| r.get(0)))?;
    if check != "ok" {
        return Err(format!("backup file failed integrity check: {check}"));
    }
    // Tables present since the phase-2 schema — every restorable backup has
    // them; a random SQLite file will not. Later tables (jobs, applications,
    // …) must NOT be required: older-schema backups are upgrade-restorable.
    const CORE_TABLES: &[&str] = &[
        "meta",
        "projects",
        "experiences",
        "evidence",
        "canonical_bullets",
        "claim_rules",
    ];
    for table in CORE_TABLES {
        let present: i64 = sql_err(
            conn.query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
                [table],
                |r| r.get(0),
            ),
        )?;
        if present == 0 {
            return Err(format!("file is not a Kairo backup (missing table '{table}')"));
        }
    }
    let migrations: i64 = sql_err(
        conn.query_row("SELECT COUNT(*) FROM _migrations", [], |r| r.get(0)),
    )?;
    if migrations == 0 || migrations as usize > MIGRATIONS.len() {
        return Err(format!(
            "backup has an incompatible migration count ({migrations})"
        ));
    }
    Ok(())
}

fn is_backup_name(name: &str) -> bool {
    let stem = match name.strip_suffix(".db") {
        Some(stem) => stem,
        None => return false,
    };
    let stamp = match stem.strip_prefix(NAME_PATTERN) {
        Some(stamp) => stamp,
        None => return false,
    };
    stamp.len() == 15
        && stamp.as_bytes()[8] == b'-'
        && stamp.chars().enumerate().all(|(i, c)| {
            if i == 8 {
                true
            } else {
                c.is_ascii_digit()
            }
        })
}

/// Keep only the newest `KEEP_BACKUPS` files (names sort chronologically).
fn prune_old_backups(dir: &Path) -> Result<(), String> {
    let backups = list_backups(dir)?;
    for old in backups.iter().skip(KEEP_BACKUPS) {
        let _ = std::fs::remove_file(&old.path);
    }
    Ok(())
}

fn file_size(path: &Path) -> Result<u64, String> {
    Ok(std::fs::metadata(path)
        .map_err(|e| format!("cannot stat {}: {e}", path.display()))?
        .len())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::apply_migrations;

    fn db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        apply_migrations(&conn).unwrap();
        conn
    }

    fn dir(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("kairo-backup-test-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        d
    }

    fn project_count(conn: &Connection) -> i64 {
        conn.query_row("SELECT COUNT(*) FROM projects", [], |r| r.get(0))
            .unwrap()
    }

    #[test]
    fn backup_captures_data_and_passes_integrity() {
        let conn = db();
        conn.execute("INSERT INTO projects (title) VALUES ('Payments API')", [])
            .unwrap();
        let dir = dir("create");
        let info = create_backup(&conn, &dir).unwrap();
        assert!(info.file_name.starts_with(NAME_PATTERN) && info.file_name.ends_with(".db"));
        assert!(info.bytes > 0);

        let restored = Connection::open(&info.path).unwrap();
        assert_eq!(project_count(&restored), 1);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn restore_swaps_live_data_and_prunes_garbage() {
        let conn = db();
        conn.execute("INSERT INTO projects (title) VALUES ('V1')", []).unwrap();
        let dir = dir("restore");
        let info = create_backup(&conn, &dir).unwrap();

        // Live data drifts after the backup.
        conn.execute("DELETE FROM projects", []).unwrap();
        conn.execute("INSERT INTO projects (title) VALUES ('V2')", []).unwrap();
        assert_eq!(project_count(&conn), 1);

        let mut live = conn;
        let report = restore_backup(&mut live, &dir, &info.file_name).unwrap();
        assert_eq!(report.restored_from, info.file_name);
        assert_eq!(report.applied_migrations, super::MIGRATIONS.len());
        assert_eq!(project_count(&live), 1);
        let title: String = live
            .query_row("SELECT title FROM projects LIMIT 1", [], |r| r.get(0))
            .unwrap();
        assert_eq!(title, "V1");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn restore_rejects_non_kairo_files_and_leaves_live_data_intact() {
        let conn = db();
        conn.execute("INSERT INTO projects (title) VALUES ('Precious')", [])
            .unwrap();
        let dir = dir("reject");

        // 1. A garbage file with a plausible name.
        let fake = dir.join(format!("{NAME_PATTERN}20990101-000000.db"));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(&fake, b"this is definitely not sqlite").unwrap();
        let mut live = conn;
        assert!(restore_backup(&mut live, &dir, fake.file_name().unwrap().to_str().unwrap()).is_err());
        assert_eq!(project_count(&live), 1);

        // 2. A valid SQLite file that is not a Kairo database.
        let other = dir.join(format!("{NAME_PATTERN}20990101-000001.db"));
        let foreign = Connection::open(&other).unwrap();
        foreign.execute("CREATE TABLE stuff (x INTEGER)", []).unwrap();
        let name = other.file_name().unwrap().to_str().unwrap().to_string();
        assert!(restore_backup(&mut live, &dir, &name).is_err());
        assert_eq!(project_count(&live), 1);

        // 3. Path traversal via the file name is rejected by the pattern.
        assert!(restore_backup(&mut live, &dir, "..\\secrets.db").is_err());
        assert!(restore_backup(&mut live, &dir, "sub/dir/kairo-backup-20990101-000000.db").is_err());
    }

    #[test]
    fn restore_of_older_schema_upgrades_migrations() {
        /// Database carrying only the first `count` migrations.
        fn partial_schema_db(count: usize) -> Connection {
            let conn = Connection::open_in_memory().unwrap();
            conn.execute_batch(
                "CREATE TABLE _migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')));",
            )
            .unwrap();
            for (name, sql) in super::MIGRATIONS.iter().take(count) {
                conn.execute_batch(sql).unwrap();
                conn.execute("INSERT INTO _migrations (name) VALUES (?1)", [name])
                    .unwrap();
            }
            conn
        }

        // A database at migration 9 only (pre-Phase-11 schema) with data.
        let old = partial_schema_db(super::MIGRATIONS.len() - 1);
        old.execute("INSERT INTO projects (title) VALUES ('Legacy')", [])
            .unwrap();

        let dir = dir("upgrade");
        let info = create_backup(&old, &dir).unwrap();
        drop(old);

        // The live database is the same old schema; restoring upgrades to 10.
        let mut live = partial_schema_db(super::MIGRATIONS.len() - 1);
        let report = restore_backup(&mut live, &dir, &info.file_name).unwrap();
        assert_eq!(report.applied_migrations, super::MIGRATIONS.len());
        let title: String = live
            .query_row("SELECT title FROM projects LIMIT 1", [], |r| r.get(0))
            .unwrap();
        assert_eq!(title, "Legacy");
        let has_applications: i64 = live
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='applications'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(has_applications, 1);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn list_is_newest_first_and_backup_prunes_to_keep_limit() {
        let dir = dir("prune");
        std::fs::create_dir_all(&dir).unwrap();
        for i in 0..(KEEP_BACKUPS + 3) {
            let name = format!("{NAME_PATTERN}20260913-{:06}.db", i);
            std::fs::write(dir.join(&name), b"x").unwrap();
        }
        // Non-matching files are ignored by listing and pruning alike.
        std::fs::write(dir.join("unrelated.db"), b"x").unwrap();
        std::fs::write(dir.join(format!("{NAME_PATTERN}bogus.db")), b"x").unwrap();

        let list = list_backups(&dir).unwrap();
        assert_eq!(list.len(), KEEP_BACKUPS + 3);
        assert!(list[0].file_name > list[list.len() - 1].file_name);

        prune_old_backups(&dir).unwrap();
        let remaining = list_backups(&dir).unwrap();
        assert_eq!(remaining.len(), KEEP_BACKUPS);
        assert_eq!(remaining[0].file_name, format!("{NAME_PATTERN}20260913-{:06}.db", KEEP_BACKUPS + 2));
        assert!(dir.join("unrelated.db").is_file());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn backup_names_must_match_pattern() {
        assert!(is_backup_name("kairo-backup-20260913-101500.db"));
        assert!(!is_backup_name("kairo-backup-20260913-101500.txt"));
        assert!(!is_backup_name("kairo-backup-notastamp.db"));
        assert!(!is_backup_name("other-20260913-101500.db"));
        assert!(!is_backup_name("kairo-backup-20260913_101500.db"));
    }
}
