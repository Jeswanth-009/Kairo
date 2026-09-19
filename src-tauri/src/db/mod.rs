//! Database access: connection management and numbered migrations.
//!
//! The connection lives in Tauri-managed state (`DbState`) so every command
//! shares one source of truth. Migrations are embedded at compile time and
//! applied in order inside transactions; applied ones are recorded in
//! `_migrations` (spec §4.2: never edit a shipped migration, only add new ones).

use rusqlite::Connection;
use std::error::Error;
use std::fs;
use std::path::Path;
use std::sync::Mutex;

pub mod applications;
pub mod backup;
pub mod composer;
pub mod dashboard;
pub mod interview;
pub mod jobs;
pub mod matching;
pub mod pdf;
pub mod tailor;
pub mod trust;
pub mod versions;
pub mod vault;

pub struct DbState(pub Mutex<Connection>);

const MIGRATIONS: &[(&str, &str)] = &[
    ("0001_init", include_str!("../../migrations/0001_init.sql")),
    ("0002_career_vault", include_str!("../../migrations/0002_career_vault.sql")),
    ("0003_evidence_trust", include_str!("../../migrations/0003_evidence_trust.sql")),
    ("0004_jobs", include_str!("../../migrations/0004_jobs.sql")),
    ("0005_match", include_str!("../../migrations/0005_match.sql")),
    ("0006_composer", include_str!("../../migrations/0006_composer.sql")),
    ("0007_tailor", include_str!("../../migrations/0007_tailor.sql")),
    ("0008_pdf", include_str!("../../migrations/0008_pdf.sql")),
    ("0009_versions", include_str!("../../migrations/0009_versions.sql")),
    ("0010_applications", include_str!("../../migrations/0010_applications.sql")),
    ("0011_artifact_template", include_str!("../../migrations/0011_artifact_template.sql")),
];

pub fn open_and_migrate(path: &Path) -> Result<Connection, Box<dyn Error>> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let conn = Connection::open(path)?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    apply_migrations(&conn)?;
    Ok(conn)
}

pub fn apply_migrations(conn: &Connection) -> Result<(), Box<dyn Error>> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS _migrations (
             name       TEXT PRIMARY KEY,
             applied_at TEXT NOT NULL DEFAULT (datetime('now'))
         );",
    )?;

    for (name, sql) in MIGRATIONS {
        let already_applied: i64 = conn.query_row(
            "SELECT COUNT(*) FROM _migrations WHERE name = ?1",
            [name],
            |row| row.get(0),
        )?;
        if already_applied == 0 {
            let tx = conn.unchecked_transaction()?;
            tx.execute_batch(sql)?;
            tx.execute("INSERT INTO _migrations (name) VALUES (?1)", [name])?;
            tx.commit()?;
        }
    }
    Ok(())
}

pub fn applied_migrations(conn: &Connection) -> Result<Vec<String>, Box<dyn Error>> {
    let mut stmt = conn.prepare("SELECT name FROM _migrations ORDER BY name")?;
    let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrations_apply_to_fresh_database() {
        let conn = Connection::open_in_memory().unwrap();
        apply_migrations(&conn).unwrap();
        let names = applied_migrations(&conn).unwrap();
        assert_eq!(
            names,
            vec![
                "0001_init".to_string(),
                "0002_career_vault".to_string(),
                "0003_evidence_trust".to_string(),
                "0004_jobs".to_string(),
                "0005_match".to_string(),
                "0006_composer".to_string(),
                "0007_tailor".to_string(),
                "0008_pdf".to_string(),
                "0009_versions".to_string(),
                "0010_applications".to_string(),
                "0011_artifact_template".to_string()
            ]
        );
    }

    #[test]
    fn migrations_are_idempotent() {
        let conn = Connection::open_in_memory().unwrap();
        apply_migrations(&conn).unwrap();
        apply_migrations(&conn).unwrap();
        let names = applied_migrations(&conn).unwrap();
        assert_eq!(names.len(), 11);
    }

    #[test]
    fn smoke_roundtrip_works() {
        let conn = Connection::open_in_memory().unwrap();
        apply_migrations(&conn).unwrap();
        conn.execute(
            "INSERT INTO meta (key, value) VALUES ('t', 'abc') \
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            [],
        )
        .unwrap();
        let value: String = conn
            .query_row("SELECT value FROM meta WHERE key = 't'", [], |row| row.get(0))
            .unwrap();
        assert_eq!(value, "abc");
    }

    /// Build a database carrying only the first `count` migrations (the
    /// upgrade-test fixture: an app data file from an older release).
    fn old_schema_db(count: usize) -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS _migrations (
                 name       TEXT PRIMARY KEY,
                 applied_at TEXT NOT NULL DEFAULT (datetime('now'))
             );",
        )
        .unwrap();
        for (name, sql) in MIGRATIONS.iter().take(count) {
            conn.execute_batch(sql).unwrap();
            conn.execute("INSERT INTO _migrations (name) VALUES (?1)", [name])
                .unwrap();
        }
        conn
    }

    #[test]
    fn upgrade_from_previous_release_applies_new_migrations_and_keeps_data() {
        // A database migrated only through 0009 (the phase-10 release).
        let conn = old_schema_db(MIGRATIONS.len() - 1);
        conn.execute(
            "INSERT INTO projects (title, description) VALUES ('Kept', 'written pre-upgrade')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO jobs (company, role_title, raw_jd) VALUES ('Acme', 'Dev', 'jd')",
            [],
        )
        .unwrap();

        apply_migrations(&conn).unwrap();
        let names = applied_migrations(&conn).unwrap();
        assert_eq!(names.len(), MIGRATIONS.len());
        assert_eq!(names.last().unwrap(), "0011_artifact_template");

        // Pre-upgrade data survives byte-for-byte.
        let title: String = conn
            .query_row("SELECT title FROM projects WHERE title = 'Kept'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(title, "Kept");
        let jobs: i64 = conn.query_row("SELECT COUNT(*) FROM jobs", [], |r| r.get(0)).unwrap();
        assert_eq!(jobs, 1);

        // The new schema is usable immediately.
        conn.execute(
            "INSERT INTO applications (company, role, status) VALUES ('Acme', 'Dev', 'applied')",
            [],
        )
        .unwrap();
    }

    #[test]
    fn upgrade_from_very_old_release_applies_everything_in_order() {
        // A database migrated only through 0003 (phase-2 era).
        let conn = old_schema_db(3);
        conn.execute(
            "INSERT INTO projects (title) VALUES ('Ancient')",
            [],
        )
        .unwrap();
        apply_migrations(&conn).unwrap();
        let names = applied_migrations(&conn).unwrap();
        assert_eq!(names.len(), MIGRATIONS.len());
        let title: String = conn
            .query_row("SELECT title FROM projects LIMIT 1", [], |r| r.get(0))
            .unwrap();
        assert_eq!(title, "Ancient");
    }
}
