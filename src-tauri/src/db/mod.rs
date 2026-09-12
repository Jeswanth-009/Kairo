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

pub struct DbState(pub Mutex<Connection>);

const MIGRATIONS: &[(&str, &str)] = &[("0001_init", include_str!("../../migrations/0001_init.sql"))];

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
        assert_eq!(names, vec!["0001_init".to_string()]);
    }

    #[test]
    fn migrations_are_idempotent() {
        let conn = Connection::open_in_memory().unwrap();
        apply_migrations(&conn).unwrap();
        apply_migrations(&conn).unwrap();
        let names = applied_migrations(&conn).unwrap();
        assert_eq!(names.len(), 1);
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
}
