//! Backup & restore (Phase 14 · hardening; Phase "data safety" overhaul).
//!
//! A user backup is one portable zip archive under `AppData/backups/`
//! containing the SQLite database (taken through the online backup API, safe
//! under WAL), the whole `pdf/` tree (compiled PDFs and every version copy),
//! and a `manifest.json` that lists every file with its SHA-256. Both backup
//! and restore verify every file hash — a truncated or tampered archive is
//! refused before anything live is touched.
//!
//! Legacy bare-`.db` backups (pre-archive releases) remain listable and
//! restorable; the automatic pre-restore safety snapshot is still a bare
//! `.db`, since it is a local-only undo copy, not something to carry around.

use super::{vault::sql_err, MIGRATIONS};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::io::Read;
use std::path::{Path, PathBuf};

/// Older backups beyond this count are pruned after each successful backup.
pub const KEEP_BACKUPS: usize = 10;

/// Backup file names are generated here and restore resolves them strictly
/// against this pattern — anything else is rejected before touching disk.
const NAME_PATTERN: &str = "kairo-backup-";
/// Suffix marking automatic pre-restore safety snapshots — always restorable,
/// never pruned by the rolling window.
const PRE_RESTORE_SUFFIX: &str = "-pre-restore";
const ARCHIVE_EXT: &str = ".zip";
const LEGACY_DB_EXT: &str = ".db";
const DB_ENTRY: &str = "kairo.db";
const MANIFEST_ENTRY: &str = "manifest.json";
const FORMAT_ID: &str = "kairo-backup";
const FORMAT_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestFile {
    /// Zip-relative path: `kairo.db`, `manifest.json`, `pdf/job_3/resume.pdf`.
    pub path: String,
    pub sha256: String,
    pub bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupManifest {
    pub format: String,
    pub format_version: u32,
    pub app_version: String,
    /// "YYYYMMDD-HHMMSS" (UTC at creation).
    pub created_at: String,
    pub migrations: usize,
    pub job_count: i64,
    pub version_count: i64,
    pub files: Vec<ManifestFile>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum BackupKind {
    Archive,
    Database,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupInfo {
    pub file_name: String,
    pub path: String,
    pub bytes: u64,
    /// "YYYYMMDD-HHMMSS" parsed out of the file name (UTC at creation).
    pub created_at: String,
    pub kind: BackupKind,
    /// Present for archives: counts read from the manifest, so the Settings
    /// list can show what a backup carries without extracting it.
    pub job_count: Option<i64>,
    pub version_count: Option<i64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreReport {
    pub restored_from: String,
    pub applied_migrations: usize,
    pub files_restored: usize,
}

pub fn backups_dir(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("backups")
}

/// Create a portable backup archive of `conn` plus the `pdf/` tree, then
/// prune old ones.
pub fn create_backup(
    conn: &Connection,
    dir: &Path,
    pdf_root: &Path,
) -> Result<BackupInfo, String> {
    std::fs::create_dir_all(dir).map_err(|e| format!("cannot create backups dir: {e}"))?;
    let stamp: String =
        sql_err(conn.query_row("SELECT strftime('%Y%m%d-%H%M%S', 'now')", [], |r| r.get(0)))?;

    // 1. Snapshot the DB into a staging file (never zip the live file).
    let staging_db = dir.join(format!(".staging-{stamp}-{DB_ENTRY}"));
    write_db_snapshot(conn, &staging_db)?;
    let counts = table_counts(conn);

    // 2. Collect the manifest: the db + every file under pdf/.
    //    The staging snapshot is removed on every path out of this function.
    let build = || -> Result<(BackupManifest, String, BackupInfo), String> {
        let mut files: Vec<ManifestFile> = Vec::new();
        files.push(ManifestFile {
            path: DB_ENTRY.to_string(),
            sha256: file_sha256(&staging_db)?,
            bytes: file_size(&staging_db)?,
        });
        collect_pdf_files(pdf_root, String::new(), &mut files)?;
        let manifest = BackupManifest {
            format: FORMAT_ID.to_string(),
            format_version: FORMAT_VERSION,
            app_version: env!("CARGO_PKG_VERSION").to_string(),
            created_at: stamp.clone(),
            migrations: MIGRATIONS.len(),
            job_count: counts.0,
            version_count: counts.1,
            files,
        };

        // 3. Zip to a .part file, then verify every written entry against the
        //    manifest before the archive earns its final name.
        let file_name = unique_name(dir, &stamp);
        let part_path = dir.join(format!("{file_name}.part"));
        write_archive(&part_path, &manifest, &staging_db, pdf_root).map_err(|e| {
            let _ = std::fs::remove_file(&part_path);
            format!("backup zip failed: {e}")
        })?;
        verify_archive(&part_path, &manifest).map_err(|e| {
            let _ = std::fs::remove_file(&part_path);
            format!("backup failed its own hash verification: {e}")
        })?;
        let final_path = dir.join(&file_name);
        std::fs::rename(&part_path, &final_path).map_err(|e| {
            let _ = std::fs::remove_file(&part_path);
            format!("could not finalize backup: {e}")
        })?;
        let job_count = manifest.job_count;
        let version_count = manifest.version_count;
        Ok((
            manifest,
            file_name.clone(),
            BackupInfo {
                bytes: file_size(&final_path)?,
                path: final_path.to_string_lossy().to_string(),
                file_name,
                created_at: stamp.clone(),
                kind: BackupKind::Archive,
                job_count: Some(job_count),
                version_count: Some(version_count),
            },
        ))
    };
    let result = build();
    let _ = std::fs::remove_file(&staging_db);
    let (_manifest, _file_name, info) = result?;

    prune_old_backups(dir)?;
    Ok(info)
}

/// Shared DB-only snapshot writer; `suffix` distinguishes user backups (no
/// longer produced this way) from the automatic pre-restore safety snapshot
/// (which pruning must never delete).
fn create_db_backup_inner(
    conn: &Connection,
    dir: &Path,
    suffix: Option<&str>,
) -> Result<BackupInfo, String> {
    std::fs::create_dir_all(dir).map_err(|e| format!("cannot create backups dir: {e}"))?;
    let stamp: String =
        sql_err(conn.query_row("SELECT strftime('%Y%m%d-%H%M%S', 'now')", [], |r| r.get(0)))?;
    let file_name = match suffix {
        Some(suffix) => format!("{NAME_PATTERN}{stamp}{suffix}{LEGACY_DB_EXT}"),
        None => format!("{NAME_PATTERN}{stamp}{LEGACY_DB_EXT}"),
    };
    let path = dir.join(&file_name);
    write_db_snapshot(conn, &path)?;
    if suffix.is_none() {
        prune_old_backups(dir)?;
    }
    Ok(BackupInfo {
        bytes: file_size(&path)?,
        path: path.to_string_lossy().to_string(),
        file_name,
        created_at: stamp,
        kind: BackupKind::Database,
        job_count: None,
        version_count: None,
    })
}

/// Consistent snapshot of `conn` into `dest` via the online backup API, then
/// quick-checked — never keep a corrupt snapshot on disk.
fn write_db_snapshot(conn: &Connection, dest: &Path) -> Result<(), String> {
    let mut dst = Connection::open(dest).map_err(|e| format!("cannot open backup file: {e}"))?;
    {
        let backup = rusqlite::backup::Backup::new(conn, &mut dst)
            .map_err(|e| format!("backup init failed: {e}"))?;
        backup
            .run_to_completion(64, std::time::Duration::from_millis(0), None)
            .map_err(|e| format!("backup failed: {e}"))?;
    } // borrow of dst ends here — the integrity check needs it back.
    let check: String = sql_err(dst.query_row("PRAGMA quick_check", [], |r| r.get(0)))?;
    if check != "ok" {
        drop(dst);
        if let Err(e) = std::fs::remove_file(dest) {
            crate::logging::log_event(
                "warn",
                "backup_discard_failed",
                &[
                    ("path", dest.to_string_lossy().to_string()),
                    ("error", e.to_string()),
                ],
            );
        }
        return Err(format!("backup failed integrity check: {check}"));
    }
    Ok(())
}

fn table_counts(conn: &Connection) -> (i64, i64) {
    let jobs: i64 = conn
        .query_row("SELECT COUNT(*) FROM jobs WHERE deleted_at IS NULL", [], |r| r.get(0))
        .unwrap_or(0);
    let versions: i64 = conn
        .query_row("SELECT COUNT(*) FROM resume_versions", [], |r| r.get(0))
        .unwrap_or(0);
    (jobs, versions)
}

/// Walk `pdf_root` collecting every file as `pdf/<relative>` with its hash.
fn collect_pdf_files(
    pdf_root: &Path,
    prefix: String,
    files: &mut Vec<ManifestFile>,
) -> Result<(), String> {
    let entries = match std::fs::read_dir(pdf_root) {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(format!("cannot read pdf dir: {e}")),
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let rel = if prefix.is_empty() {
            entry.file_name().to_string_lossy().to_string()
        } else {
            format!("{prefix}/{}", entry.file_name().to_string_lossy())
        };
        if path.is_dir() {
            collect_pdf_files(&path, rel, files)?;
        } else {
            files.push(ManifestFile {
                path: format!("pdf/{rel}"),
                sha256: file_sha256(&path)?,
                bytes: file_size(&path)?,
            });
        }
    }
    Ok(())
}

fn write_archive(
    dest: &Path,
    manifest: &BackupManifest,
    staging_db: &Path,
    pdf_root: &Path,
) -> Result<(), String> {
    let file = std::fs::File::create(dest).map_err(|e| format!("cannot create archive: {e}"))?;
    let mut zip = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);

    let manifest_json =
        serde_json::to_string_pretty(manifest).map_err(|e| format!("manifest: {e}"))?;
    zip.start_file(MANIFEST_ENTRY, options)
        .map_err(|e| format!("cannot write manifest entry: {e}"))?;
    std::io::Write::write_all(&mut zip, manifest_json.as_bytes())
        .map_err(|e| format!("cannot write manifest: {e}"))?;

    add_file_to_zip(&mut zip, options, DB_ENTRY, staging_db)?;
    for file in &manifest.files {
        if file.path == DB_ENTRY {
            continue;
        }
        // Manifest paths are "pdf/<relative to app data>".
        let on_disk = pdf_root.join(file.path.strip_prefix("pdf/").unwrap_or(&file.path));
        add_file_to_zip(&mut zip, options, &file.path, &on_disk)?;
    }
    zip.finish().map_err(|e| format!("cannot finish zip: {e}"))?;
    Ok(())
}

fn add_file_to_zip(
    zip: &mut zip::ZipWriter<std::fs::File>,
    options: zip::write::SimpleFileOptions,
    entry_name: &str,
    src: &Path,
) -> Result<(), String> {
    let mut file =
        std::fs::File::open(src).map_err(|e| format!("cannot read {}: {e}", src.display()))?;
    zip.start_file(entry_name, options)
        .map_err(|e| format!("cannot add {entry_name}: {e}"))?;
    std::io::copy(&mut file, zip).map_err(|e| format!("cannot write {entry_name}: {e}"))?;
    Ok(())
}

/// Re-open a freshly written archive and hash every manifest entry — a backup
/// only counts as created once its own bytes round-trip.
fn verify_archive(path: &Path, manifest: &BackupManifest) -> Result<(), String> {
    let file = std::fs::File::open(path).map_err(|e| format!("cannot reopen archive: {e}"))?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("cannot read archive: {e}"))?;
    for expected in &manifest.files {
        let mut entry = archive
            .by_name(&expected.path)
            .map_err(|e| format!("archive missing {}: {e}", expected.path))?;
        let actual = stream_sha256(&mut entry)?;
        if actual != expected.sha256 {
            return Err(format!("hash mismatch for {}", expected.path));
        }
        if entry.size() != expected.bytes {
            return Err(format!("size mismatch for {}", expected.path));
        }
    }
    Ok(())
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
        let stem = name.trim_end_matches(ARCHIVE_EXT).trim_end_matches(LEGACY_DB_EXT);
        let mut info = BackupInfo {
            bytes: file_size(&entry.path())?,
            path: entry.path().to_string_lossy().to_string(),
            file_name: name.clone(),
            created_at: stem
                .trim_start_matches(NAME_PATTERN)
                .chars()
                .take(15)
                .collect(),
            kind: if name.ends_with(ARCHIVE_EXT) {
                BackupKind::Archive
            } else {
                BackupKind::Database
            },
            job_count: None,
            version_count: None,
        };
        if info.kind == BackupKind::Archive {
            // Cheap: read just the manifest entry out of the central directory.
            if let Ok(counts) = read_manifest_counts(&entry.path()) {
                info.job_count = Some(counts.0);
                info.version_count = Some(counts.1);
            }
        }
        backups.push(info);
    }
    // Names embed UTC timestamps, so lexicographic sort is chronological.
    backups.sort_by(|a, b| b.file_name.cmp(&a.file_name));
    Ok(backups)
}

fn read_manifest_counts(path: &Path) -> Result<(i64, i64), String> {
    let manifest = read_archive_manifest(path)?;
    Ok((manifest.job_count, manifest.version_count))
}

fn read_archive_manifest(path: &Path) -> Result<BackupManifest, String> {
    let file = std::fs::File::open(path).map_err(|e| format!("cannot open archive: {e}"))?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("cannot read archive: {e}"))?;
    let mut entry = archive
        .by_name(MANIFEST_ENTRY)
        .map_err(|e| format!("archive has no manifest: {e}"))?;
    let mut json = String::new();
    entry
        .read_to_string(&mut json)
        .map_err(|e| format!("cannot read manifest: {e}"))?;
    serde_json::from_str(&json).map_err(|e| format!("manifest unreadable: {e}"))
}

/// Restore `file_name` from `dir` into the live connection. Archives are
/// hash-verified entry by entry before anything live is touched; the DB must
/// carry the Kairo schema. The `pdf/` tree is swapped in only after the
/// database restore succeeded, with rollback if the swap fails. Migrations
/// are re-applied afterwards so older backups upgrade transparently.
pub fn restore_backup(
    live: &mut Connection,
    dir: &Path,
    file_name: &str,
    pdf_root: &Path,
) -> Result<RestoreReport, String> {
    if !is_backup_name(file_name) {
        return Err(format!(
            "'{file_name}' is not a Kairo backup file name (expected {NAME_PATTERN}<stamp>.zip)"
        ));
    }
    let path = dir.join(file_name);
    if !path.is_file() {
        return Err("Backup file not found".to_string());
    }
    if file_name.ends_with(LEGACY_DB_EXT) {
        return restore_legacy_db(live, dir, file_name);
    }
    restore_archive(live, &path, pdf_root, file_name)
}

fn restore_legacy_db(
    live: &mut Connection,
    dir: &Path,
    file_name: &str,
) -> Result<RestoreReport, String> {
    let path = dir.join(file_name);
    let src = Connection::open(&path).map_err(|e| format!("cannot open backup: {e}"))?;
    validate_kairo_db(&src)?;
    let safety = create_db_backup_inner(live, dir, Some(PRE_RESTORE_SUFFIX))?;
    let _ = safety;
    restore_db_into_live(&src, live)?;
    Ok(RestoreReport {
        restored_from: file_name.to_string(),
        applied_migrations: count_migrations(live),
        files_restored: 0,
    })
}

fn restore_archive(
    live: &mut Connection,
    path: &Path,
    pdf_root: &Path,
    file_name: &str,
) -> Result<RestoreReport, String> {
    // 1. Read the manifest and hash every entry against it. Nothing is
    //    extracted to its real location until every byte checks out.
    let manifest = read_archive_manifest(path)?;
    if manifest.format != FORMAT_ID {
        return Err(format!(
            "not a Kairo backup archive (format '{}')",
            manifest.format
        ));
    }
    if manifest.format_version > FORMAT_VERSION {
        return Err(format!(
            "backup was made by a newer Kairo (format v{}); update the app",
            manifest.format_version
        ));
    }
    let file = std::fs::File::open(path).map_err(|e| format!("cannot open archive: {e}"))?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("cannot read archive: {e}"))?;
    for expected in &manifest.files {
        let mut entry = archive
            .by_name(&expected.path)
            .map_err(|e| format!("archive missing {}: {e}", expected.path))?;
        let actual = stream_sha256(&mut entry)?;
        if actual != expected.sha256 {
            return Err(format!(
                "backup file is corrupt or was modified (hash mismatch: {})",
                expected.path
            ));
        }
    }

    // 2. Extract kairo.db to a staging file and prove it is a Kairo DB.
    let dir = path.parent().unwrap_or_else(|| Path::new("."));
    let staging_db = dir.join(format!(
        ".restore-{}-{DB_ENTRY}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0)
    ));
    {
        let mut entry = archive
            .by_name(DB_ENTRY)
            .map_err(|e| format!("archive missing {DB_ENTRY}: {e}"))?;
        let mut out = std::fs::File::create(&staging_db)
            .map_err(|e| format!("cannot stage database: {e}"))?;
        std::io::copy(&mut entry, &mut out).map_err(|e| format!("cannot stage database: {e}"))?;
    }
    let staging_conn = Connection::open(&staging_db)
        .map_err(|e| format!("staged database will not open: {e}"));
    if let Ok(ref conn) = staging_conn {
        if let Err(e) = validate_kairo_db(conn) {
            let _ = std::fs::remove_file(&staging_db);
            return Err(e);
        }
    }

    // 3. Safety net: snapshot the current live state first, so restoring the
    //    wrong backup (or an older-schema one) is always reversible.
    let safety = create_db_backup_inner(live, dir, Some(PRE_RESTORE_SUFFIX));
    let result = safety.and_then(|_| {
        let src = staging_conn.as_ref().map_err(Clone::clone)?;
        restore_db_into_live(src, live)?;
        // 4. DB restored — now swap the pdf tree, with rollback on failure.
        swap_pdf_tree(&mut archive, &manifest, pdf_root)
    });
    let _ = std::fs::remove_file(&staging_db);
    let files_restored = result?;
    Ok(RestoreReport {
        restored_from: file_name.to_string(),
        applied_migrations: count_migrations(live),
        files_restored,
    })
}

/// Copy the live DB from `src` into `live` through the online backup API and
/// re-run migrations (idempotent; upgrades older backups in place).
fn restore_db_into_live(src: &Connection, live: &mut Connection) -> Result<(), String> {
    {
        let backup = rusqlite::backup::Backup::new(src, live)
            .map_err(|e| format!("restore init failed: {e}"))?;
        backup
            .run_to_completion(64, std::time::Duration::from_millis(0), None)
            .map_err(|e| format!("restore failed: {e}"))?;
    } // mutable borrow of live ends here.
    super::apply_migrations(live).map_err(|e| format!("restored, but migration failed: {e}"))
}

fn count_migrations(live: &Connection) -> usize {
    sql_err(live.query_row("SELECT COUNT(*) FROM _migrations", [], |r| r.get::<_, i64>(0)))
        .map(|n| n as usize)
        .unwrap_or(0)
}

/// Extract the archived `pdf/` entries into a staging dir, then swap it in as
/// the live pdf tree. The previous tree is renamed aside first and only
/// deleted once the new one is in place; on any failure the old tree is
/// renamed back so the user is never left without their files.
fn swap_pdf_tree(
    archive: &mut zip::ZipArchive<std::fs::File>,
    manifest: &BackupManifest,
    pdf_root: &Path,
) -> Result<usize, String> {
    let parent = pdf_root.parent().unwrap_or_else(|| Path::new("."));
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let staging = parent.join(format!(".pdf-restore-{stamp}"));
    std::fs::create_dir_all(&staging).map_err(|e| format!("cannot stage pdf tree: {e}"))?;
    // A DB-only archive (nothing exported yet) must still swap in an empty
    // tree rather than fail the rename below.
    std::fs::create_dir_all(staging.join("pdf"))
        .map_err(|e| format!("cannot stage pdf tree: {e}"))?;

    let swap = (|| -> Result<usize, String> {
        for expected in &manifest.files {
            let name = &expected.path;
            if !name.starts_with("pdf/") {
                continue;
            }
            let target = staging.join(name);
            if let Some(parent) = target.parent() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| format!("cannot stage pdf dir: {e}"))?;
            }
            let mut entry = archive
                .by_name(name)
                .map_err(|e| format!("archive changed while restoring: {e}"))?;
            let mut out = std::fs::File::create(&target)
                .map_err(|e| format!("cannot stage {}: {e}", name))?;
            std::io::copy(&mut entry, &mut out)
                .map_err(|e| format!("cannot stage {name}: {e}"))?;
        }
        // Staged tree replaces the live one: old aside, new in, old gone.
        let old = parent.join(format!(".pdf-old-{stamp}"));
        if pdf_root.exists() {
            std::fs::rename(pdf_root, &old).map_err(|e| format!("cannot set aside old pdf dir: {e}"))?;
        }
        if let Err(e) = std::fs::rename(staging.join("pdf"), pdf_root) {
            // Roll the old tree back — the user keeps their current files.
            if old.exists() {
                let _ = std::fs::rename(&old, pdf_root);
            }
            return Err(format!("cannot move restored pdf tree into place: {e}"));
        }
        if old.exists() {
            let _ = std::fs::remove_dir_all(&old);
        }
        Ok(manifest
            .files
            .iter()
            .filter(|f| f.path.starts_with("pdf/"))
            .count())
    })();

    if swap.is_err() {
        let _ = std::fs::remove_dir_all(&staging);
    }
    swap
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
        let present: i64 = sql_err(conn.query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
            [table],
            |r| r.get(0),
        ))?;
        if present == 0 {
            return Err(format!(
                "file is not a Kairo backup (missing table '{table}')"
            ));
        }
    }
    let migrations: i64 =
        sql_err(conn.query_row("SELECT COUNT(*) FROM _migrations", [], |r| r.get(0)))?;
    if migrations == 0 || migrations as usize > MIGRATIONS.len() {
        return Err(format!(
            "backup has an incompatible migration count ({migrations})"
        ));
    }
    Ok(())
}

fn is_backup_name(name: &str) -> bool {
    let (stem, is_archive) = if let Some(stem) = name.strip_suffix(ARCHIVE_EXT) {
        (stem, true)
    } else if let Some(stem) = name.strip_suffix(LEGACY_DB_EXT) {
        (stem, false)
    } else {
        return false;
    };
    let stem = stem.strip_suffix(PRE_RESTORE_SUFFIX).unwrap_or(stem);
    let stamp = match stem.strip_prefix(NAME_PATTERN) {
        Some(stamp) => stamp,
        None => return false,
    };
    if stamp.len() < 15 || stamp.as_bytes()[8] != b'-' {
        return false;
    }
    // The core stamp is 15 chars; archives may carry a `-<n>` collision
    // suffix created when two backups land in the same second.
    let (core, extra) = stamp.split_at(15);
    let digits_ok = core
        .chars()
        .enumerate()
        .all(|(i, c)| i == 8 || c.is_ascii_digit());
    let extra_ok = extra.is_empty() || (is_archive && {
        let n = extra.strip_prefix('-').unwrap_or("");
        !n.is_empty() && n.chars().all(|c| c.is_ascii_digit())
    });
    digits_ok && extra_ok
}

/// `kairo-backup-<stamp>.zip`, or `-<n>` when the second's slot is taken.
fn unique_name(dir: &Path, stamp: &str) -> String {
    let base = format!("{NAME_PATTERN}{stamp}");
    let mut candidate = format!("{base}{ARCHIVE_EXT}");
    let mut n = 1;
    while dir.join(&candidate).exists() || dir.join(format!("{candidate}.part")).exists() {
        n += 1;
        candidate = format!("{base}-{n}{ARCHIVE_EXT}");
    }
    candidate
}

/// Keep only the newest `KEEP_BACKUPS` files (names sort chronologically).
fn prune_old_backups(dir: &Path) -> Result<(), String> {
    let backups = list_backups(dir)?;
    for old in backups.iter().skip(KEEP_BACKUPS) {
        // Safety snapshots are exempt — they exist precisely for the case
        // where everything else went wrong.
        if old.file_name.contains(PRE_RESTORE_SUFFIX) {
            continue;
        }
        if let Err(e) = std::fs::remove_file(&old.path) {
            // Pruning is housekeeping — never fail the backup over it, but a
            // backup dir that only grows is worth a warning.
            crate::logging::log_event(
                "warn",
                "backup_prune_failed",
                &[("file", old.file_name.clone()), ("error", e.to_string())],
            );
        }
    }
    Ok(())
}

fn file_sha256(path: &Path) -> Result<String, String> {
    let mut file =
        std::fs::File::open(path).map_err(|e| format!("cannot hash {}: {e}", path.display()))?;
    stream_sha256(&mut file)
}

fn stream_sha256<R: Read>(reader: &mut R) -> Result<String, String> {
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 64 * 1024];
    loop {
        let n = reader
            .read(&mut buf)
            .map_err(|e| format!("hash read failed: {e}"))?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(format!("{:x}", hasher.finalize()))
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
    use std::path::PathBuf;

    fn db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        apply_migrations(&conn).unwrap();
        conn
    }

    fn dir(tag: &str) -> PathBuf {
        let d =
            std::env::temp_dir().join(format!("kairo-backup-test-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        d
    }

    /// Fake app data root with a `pdf/job_<id>/` tree of fake PDFs.
    fn pdf_root(tag: &str, job_ids: &[i64]) -> PathBuf {
        let root = std::env::temp_dir().join(format!("kairo-backup-pdf-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        for id in job_ids {
            let job_dir = root.join(format!("job_{id}"));
            let versions = job_dir.join("versions").join("v1");
            std::fs::create_dir_all(&versions).unwrap();
            std::fs::write(job_dir.join("resume.pdf"), format!("%PDF-1.4 job {id}")).unwrap();
            std::fs::write(versions.join("resume.pdf"), format!("%PDF-1.4 job {id} v1")).unwrap();
        }
        root
    }

    fn project_count(conn: &Connection) -> i64 {
        conn.query_row("SELECT COUNT(*) FROM projects", [], |r| r.get(0))
            .unwrap()
    }

    #[test]
    fn archive_backup_carries_db_and_pdf_files() {
        let conn = db();
        conn.execute("INSERT INTO projects (title) VALUES ('Payments API')", [])
            .unwrap();
        conn.execute(
            "INSERT INTO jobs (company, role_title, raw_jd) VALUES ('Acme', 'Dev', 'jd')",
            [],
        )
        .unwrap();
        let job_id = conn.last_insert_rowid();
        let dir = dir("create");
        let pdfs = pdf_root("create", &[job_id]);

        let info = create_backup(&conn, &dir, &pdfs).unwrap();
        assert!(info.file_name.starts_with(NAME_PATTERN) && info.file_name.ends_with(ARCHIVE_EXT));
        assert_eq!(info.kind, BackupKind::Archive);
        assert_eq!(info.job_count, Some(1));

        // The archive must hold the manifest, the db, and every pdf file.
        let manifest = read_archive_manifest(Path::new(&info.path)).unwrap();
        assert_eq!(manifest.format, FORMAT_ID);
        assert!(manifest.files.iter().any(|f| f.path == DB_ENTRY));
        assert!(manifest
            .files
            .iter()
            .any(|f| f.path == format!("pdf/job_{job_id}/resume.pdf")));
        assert!(manifest
            .files
            .iter()
            .any(|f| f.path == format!("pdf/job_{job_id}/versions/v1/resume.pdf")));

        // No staging leftovers.
        assert!(!dir
            .join(format!(".staging-{}-{DB_ENTRY}", info.created_at))
            .exists());
        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::remove_dir_all(&pdfs);
    }

    #[test]
    fn restore_on_clean_install_brings_back_data_and_files() {
        let conn = db();
        conn.execute("INSERT INTO projects (title) VALUES ('V1')", [])
            .unwrap();
        conn.execute(
            "INSERT INTO jobs (company, role_title, raw_jd) VALUES ('Acme', 'Dev', 'jd')",
            [],
        )
        .unwrap();
        let job_id = conn.last_insert_rowid();
        let dir = dir("clean-restore");
        let pdfs = pdf_root("clean-restore", &[job_id]);
        let info = create_backup(&conn, &dir, &pdfs).unwrap();

        // A clean installation: fresh live DB, no pdf tree.
        let mut fresh = db();
        fresh.execute("DELETE FROM projects", []).unwrap();
        let fresh_pdfs = std::env::temp_dir().join(format!(
            "kairo-backup-restore-target-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&fresh_pdfs);

        let report = restore_backup(&mut fresh, &dir, &info.file_name, &fresh_pdfs).unwrap();
        assert_eq!(report.restored_from, info.file_name);
        assert_eq!(report.files_restored, 2);
        assert_eq!(project_count(&fresh), 1);
        let title: String = fresh
            .query_row("SELECT title FROM projects LIMIT 1", [], |r| r.get(0))
            .unwrap();
        assert_eq!(title, "V1");
        let compiled = fresh_pdfs.join(format!("job_{job_id}")).join("resume.pdf");
        let version = fresh_pdfs
            .join(format!("job_{job_id}"))
            .join("versions")
            .join("v1")
            .join("resume.pdf");
        assert_eq!(
            std::fs::read(&compiled).unwrap(),
            format!("%PDF-1.4 job {job_id}").into_bytes()
        );
        assert_eq!(
            std::fs::read(&version).unwrap(),
            format!("%PDF-1.4 job {job_id} v1").into_bytes()
        );

        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::remove_dir_all(&pdfs);
        let _ = std::fs::remove_dir_all(&fresh_pdfs);
    }

    #[test]
    fn restore_replaces_existing_pdf_tree_and_keeps_no_stale_files() {
        let conn = db();
        conn.execute(
            "INSERT INTO jobs (company, role_title, raw_jd) VALUES ('Acme', 'Dev', 'jd')",
            [],
        )
        .unwrap();
        let job_id = conn.last_insert_rowid();
        let dir = dir("swap");
        let pdfs = pdf_root("swap", &[job_id]);
        let info = create_backup(&conn, &dir, &pdfs).unwrap();

        // Live install has its own pdf tree with a file the backup lacks.
        let mut live = db();
        let live_pdfs = std::env::temp_dir()
            .join(format!("kairo-backup-swap-target-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&live_pdfs);
        let stale_dir = live_pdfs.join(format!("job_{job_id}"));
        std::fs::create_dir_all(&stale_dir).unwrap();
        std::fs::write(stale_dir.join("stale.pdf"), b"stale").unwrap();

        restore_backup(&mut live, &dir, &info.file_name, &live_pdfs).unwrap();
        assert!(stale_dir.join("resume.pdf").is_file());
        assert!(
            !stale_dir.join("stale.pdf").exists(),
            "restoring must not merge with the previous tree"
        );
        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::remove_dir_all(&pdfs);
        let _ = std::fs::remove_dir_all(&live_pdfs);
    }

    #[test]
    fn restore_refuses_tampered_archive_and_leaves_live_untouched() {
        let conn = db();
        conn.execute("INSERT INTO projects (title) VALUES ('Precious')", [])
            .unwrap();
        let dir = dir("tamper");
        let pdfs = pdf_root("tamper", &[]);
        let info = create_backup(&conn, &dir, &pdfs).unwrap();

        // Flip the last byte of kairo.db inside the archive while keeping the
        // original manifest — restore must refuse on the hash mismatch and
        // leave the live database untouched.
        let zip_path = dir.join(&info.file_name);
        rewrite_zip_entry(&zip_path, DB_ENTRY, |bytes| {
            let last = bytes.len() - 1;
            bytes[last] ^= 0xFF;
        });

        let mut live = conn;
        assert!(restore_backup(&mut live, &dir, &info.file_name, &pdfs).is_err());
        assert_eq!(project_count(&live), 1);
        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::remove_dir_all(&pdfs);
    }

    /// Rewrite `zip_path`, replacing `entry` bytes via `mutate`.
    fn rewrite_zip_entry(zip_path: &Path, entry: &str, mutate: impl Fn(&mut Vec<u8>)) {
        let file = std::fs::File::open(zip_path).unwrap();
        let mut archive = zip::ZipArchive::new(file).unwrap();
        let tmp = zip_path.with_extension("tamper.zip");
        {
            let mut out = std::fs::File::create(&tmp).unwrap();
            let mut writer = zip::ZipWriter::new(&mut out);
            for i in 0..archive.len() {
                let mut zipped = archive.by_index(i).unwrap();
                let name = zipped.name().to_string();
                let mut bytes = Vec::new();
                std::io::Read::read_to_end(&mut zipped, &mut bytes).unwrap();
                if name == entry {
                    mutate(&mut bytes);
                }
                writer
                    .start_file(&name, zip::write::SimpleFileOptions::default())
                    .unwrap();
                std::io::Write::write_all(&mut writer, &bytes).unwrap();
            }
            writer.finish().unwrap();
        }
        drop(archive);
        std::fs::rename(&tmp, zip_path).unwrap();
    }

    #[test]
    fn legacy_db_backup_still_lists_and_restores() {
        let conn = db();
        conn.execute("INSERT INTO projects (title) VALUES ('Old')", [])
            .unwrap();
        let dir = dir("legacy");
        let pdfs = pdf_root("legacy", &[]);
        let info = create_db_backup_inner(&conn, &dir, None).unwrap();
        assert!(info.file_name.ends_with(LEGACY_DB_EXT));

        let list = list_backups(&dir).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].kind, BackupKind::Database);

        let mut live = db();
        live.execute("DELETE FROM projects", []).unwrap();
        restore_backup(&mut live, &dir, &info.file_name, &pdfs).unwrap();
        assert_eq!(project_count(&live), 1);
        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::remove_dir_all(&pdfs);
    }

    #[test]
    fn restore_rejects_non_kairo_files_and_leaves_live_data_intact() {
        let conn = db();
        conn.execute("INSERT INTO projects (title) VALUES ('Precious')", [])
            .unwrap();
        let dir = dir("reject");
        let pdfs = pdf_root("reject", &[]);

        // 1. A garbage file with a plausible name.
        let fake = dir.join(format!("{NAME_PATTERN}20990101-000000{LEGACY_DB_EXT}"));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(&fake, b"this is definitely not sqlite").unwrap();
        let mut live = conn;
        assert!(
            restore_backup(&mut live, &dir, fake.file_name().unwrap().to_str().unwrap(), &pdfs)
                .is_err()
        );
        assert_eq!(project_count(&live), 1);

        // 2. A valid SQLite file that is not a Kairo database.
        let other = dir.join(format!("{NAME_PATTERN}20990101-000001{LEGACY_DB_EXT}"));
        let foreign = Connection::open(&other).unwrap();
        foreign
            .execute("CREATE TABLE stuff (x INTEGER)", [])
            .unwrap();
        let name = other.file_name().unwrap().to_str().unwrap().to_string();
        assert!(restore_backup(&mut live, &dir, &name, &pdfs).is_err());
        assert_eq!(project_count(&live), 1);

        // 3. Path traversal via the file name is rejected by the pattern.
        assert!(restore_backup(&mut live, &dir, "..\\secrets.db", &pdfs).is_err());
        assert!(
            restore_backup(&mut live, &dir, "sub/dir/kairo-backup-20990101-000000.zip", &pdfs)
                .is_err()
        );
        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::remove_dir_all(&pdfs);
    }

    #[test]
    fn list_is_newest_first_and_backup_prunes_to_keep_limit() {
        let dir = dir("prune");
        std::fs::create_dir_all(&dir).unwrap();
        for i in 0..(KEEP_BACKUPS + 3) {
            let name = format!("{NAME_PATTERN}20260913-{:06}{LEGACY_DB_EXT}", i);
            std::fs::write(dir.join(&name), b"x").unwrap();
        }
        // Non-matching files are ignored by listing and pruning alike.
        std::fs::write(dir.join("unrelated.db"), b"x").unwrap();
        std::fs::write(dir.join(format!("{NAME_PATTERN}bogus.zip")), b"x").unwrap();

        let list = list_backups(&dir).unwrap();
        assert_eq!(list.len(), KEEP_BACKUPS + 3);
        assert!(list[0].file_name > list[list.len() - 1].file_name);

        prune_old_backups(&dir).unwrap();
        let remaining = list_backups(&dir).unwrap();
        assert_eq!(remaining.len(), KEEP_BACKUPS);
        assert_eq!(
            remaining[0].file_name,
            format!("{NAME_PATTERN}20260913-{:06}{LEGACY_DB_EXT}", KEEP_BACKUPS + 2)
        );
        assert!(dir.join("unrelated.db").is_file());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn backup_names_must_match_pattern() {
        assert!(is_backup_name("kairo-backup-20260913-101500.zip"));
        assert!(is_backup_name("kairo-backup-20260913-101500.db"));
        assert!(is_backup_name("kairo-backup-20260913-101500-pre-restore.db"));
        assert!(is_backup_name("kairo-backup-20260913-101500-2.zip"));
        assert!(!is_backup_name("kairo-backup-20260913-101500.txt"));
        assert!(!is_backup_name("kairo-backup-notastamp.zip"));
        assert!(!is_backup_name("other-20260913-101500.zip"));
        assert!(!is_backup_name("kairo-backup-20260913_101500.zip"));
        assert!(!is_backup_name("kairo-backup-20260913-101500-2.db"));
    }
}
