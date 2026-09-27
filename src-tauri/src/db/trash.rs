//! Recently-deleted (trash) repository.
//!
//! Vault records and jobs soft-delete into a 30-day trash. Entries carry a
//! human label so the UI can list everything in one flat view without knowing
//! each table's display column. Restore un-deletes; purge removes the row for
//! good and lets the existing cleanup triggers take the children with it.

use super::trust::EntityKind;
use super::vault::sql_err;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

/// How long a trashed row stays recoverable before startup purge removes it.
pub const TRASH_RETENTION_DAYS: i64 = 30;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrashItem {
    pub entity_type: String,
    pub entity_id: i64,
    pub label: String,
    pub deleted_at: String,
}

/// One UNION arm per soft-deletable table, projecting each table's display
/// column into a common `label`.
const TRASH_ARMS: &[(&str, &str)] = &[
    ("project", "SELECT 'project' AS entity_type, id AS entity_id, title AS label, deleted_at FROM projects WHERE deleted_at IS NOT NULL"),
    ("experience", "SELECT 'experience', id, CASE WHEN role <> '' THEN organization || ' — ' || role ELSE organization END, deleted_at FROM experiences WHERE deleted_at IS NOT NULL"),
    ("education", "SELECT 'education', id, institution, deleted_at FROM education WHERE deleted_at IS NOT NULL"),
    ("certification", "SELECT 'certification', id, title, deleted_at FROM certifications WHERE deleted_at IS NOT NULL"),
    ("achievement", "SELECT 'achievement', id, title, deleted_at FROM achievements WHERE deleted_at IS NOT NULL"),
    ("skill", "SELECT 'skill', id, canonical_name, deleted_at FROM skills WHERE deleted_at IS NOT NULL"),
    ("job", "SELECT 'job', id, role_title, deleted_at FROM jobs WHERE deleted_at IS NOT NULL"),
];

pub fn list_trash(conn: &Connection) -> Result<Vec<TrashItem>, String> {
    let sql = format!(
        "SELECT entity_type, entity_id, label, deleted_at FROM ({}) ORDER BY deleted_at DESC, entity_type, entity_id LIMIT 200",
        TRASH_ARMS
            .iter()
            .map(|(_, arm)| *arm)
            .collect::<Vec<_>>()
            .join(" UNION ALL ")
    );
    let mut stmt = sql_err(conn.prepare(&sql))?;
    let mapped = stmt.query_map([], |row| {
        Ok(TrashItem {
            entity_type: row.get(0)?,
            entity_id: row.get(1)?,
            label: row.get(2)?,
            deleted_at: row.get(3)?,
        })
    });
    let rows = sql_err(mapped)?;
    sql_err(rows.collect::<rusqlite::Result<Vec<_>>>())
}

fn resolve_table(entity_type: &str) -> Result<&'static str, String> {
    EntityKind::parse(entity_type).map(|kind| kind.table())
}

pub fn restore(conn: &Connection, entity_type: &str, entity_id: i64) -> Result<(), String> {
    let table = resolve_table(entity_type)?;
    let sql = format!("UPDATE {table} SET deleted_at = NULL WHERE id = ?1");
    let changed = sql_err(conn.execute(&sql, [entity_id]))?;
    if changed == 0 {
        return Err("Trash item not found".to_string());
    }
    Ok(())
}

/// Hard delete of one trash entry. Fires the parent-cleanup triggers so
/// evidence, bullets and skill links go with the row.
pub fn purge(conn: &Connection, entity_type: &str, entity_id: i64) -> Result<(), String> {
    let table = resolve_table(entity_type)?;
    let sql = format!("DELETE FROM {table} WHERE id = ?1");
    let changed = sql_err(conn.execute(&sql, [entity_id]))?;
    if changed == 0 {
        return Err("Trash item not found".to_string());
    }
    Ok(())
}

/// Startup expiry: rows trashed more than `TRASH_RETENTION_DAYS` ago are gone
/// for good. Best-effort — a failure here must not keep the app from opening.
pub fn purge_expired(conn: &Connection) -> Result<usize, String> {
    let mut total = 0usize;
    for (entity_type, _) in TRASH_ARMS {
        let table = resolve_table(entity_type)?;
        let sql = format!(
            "DELETE FROM {table} WHERE deleted_at IS NOT NULL \
             AND deleted_at <= datetime('now', ?1)"
        );
        let changed =
            sql_err(conn.execute(&sql, params![format!("-{TRASH_RETENTION_DAYS} days")]))?;
        total += changed as usize;
    }
    Ok(total)
}

#[cfg(test)]
mod tests {
    use super::super::vault;
    use super::*;
    use crate::db::apply_migrations;

    fn mem_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        apply_migrations(&conn).unwrap();
        conn
    }

    fn project(conn: &Connection, title: &str) -> vault::Project {
        vault::vault_create(
            conn,
            &vault::Project {
                id: 0,
                title: title.to_string(),
                description: String::new(),
                start_date: None,
                end_date: None,
                is_current: false,
                url: String::new(),
                repo_url: String::new(),
                skills: vec![],
                evidence_count: 0,
            },
        )
        .unwrap()
    }

    #[test]
    fn delete_hides_restore_recovers() {
        let conn = mem_db();
        let p = project(&conn, "PyKV");

        vault::vault_delete::<vault::Project>(&conn, p.id).unwrap();
        assert!(vault::vault_list::<vault::Project>(&conn)
            .unwrap()
            .is_empty());
        assert!(vault::vault_get::<vault::Project>(&conn, p.id).is_err());

        let trash = list_trash(&conn).unwrap();
        assert_eq!(trash.len(), 1);
        assert_eq!(trash[0].entity_type, "project");
        assert_eq!(trash[0].label, "PyKV");

        restore(&conn, "project", p.id).unwrap();
        let back = vault::vault_list::<vault::Project>(&conn).unwrap();
        assert_eq!(back.len(), 1);
        assert_eq!(back[0].title, "PyKV");
        assert!(list_trash(&conn).unwrap().is_empty());
    }

    #[test]
    fn purge_removes_children_and_rejects_unknown_types() {
        let conn = mem_db();
        let p = project(&conn, "Doomed");
        vault::vault_delete::<vault::Project>(&conn, p.id).unwrap();

        purge(&conn, "project", p.id).unwrap();
        let rows: i64 = conn
            .query_row("SELECT COUNT(*) FROM projects", [], |r| r.get(0))
            .unwrap();
        assert_eq!(rows, 0);
        assert!(list_trash(&conn).unwrap().is_empty());

        assert!(purge(&conn, "dragon", 1).is_err());
        assert!(restore(&conn, "dragon", 1).is_err());
        assert!(purge(&conn, "project", 999).is_err());
    }

    #[test]
    fn expired_entries_purge_on_startup() {
        let conn = mem_db();
        let keep = project(&conn, "Fresh");
        let gone = project(&conn, "Ancient");

        vault::vault_delete::<vault::Project>(&conn, keep.id).unwrap();
        vault::vault_delete::<vault::Project>(&conn, gone.id).unwrap();
        // Age one entry past the retention window.
        conn.execute(
            "UPDATE projects SET deleted_at = datetime('now', '-40 days') WHERE id = ?1",
            [gone.id],
        )
        .unwrap();

        let removed = purge_expired(&conn).unwrap();
        assert_eq!(removed, 1);
        let trash = list_trash(&conn).unwrap();
        assert_eq!(trash.len(), 1);
        assert_eq!(trash[0].label, "Fresh");
    }

    #[test]
    fn trashing_jobs_keeps_requirements_for_restore() {
        let conn = mem_db();
        conn.execute(
            "INSERT INTO jobs (company, role_title, raw_jd) VALUES ('Acme', 'Dev', 'jd')",
            [],
        )
        .unwrap();
        let job_id = conn.last_insert_rowid();
        conn.execute(
            "INSERT INTO job_requirements (job_id, kind, raw_text, normalized_key, importance, user_confirmed) \
             VALUES (?1, 'required_skill', 'Rust', 'rust', 0.9, 1)",
            [job_id],
        )
        .unwrap();

        vault::vault_delete::<super::super::jobs::Job>(&conn, job_id).unwrap();
        let reqs: i64 = conn
            .query_row("SELECT COUNT(*) FROM job_requirements", [], |r| r.get(0))
            .unwrap();
        assert_eq!(reqs, 1, "soft delete must not cascade");

        restore(&conn, "job", job_id).unwrap();
        let job = vault::vault_get::<super::super::jobs::Job>(&conn, job_id).unwrap();
        assert_eq!(job.role_title, "Dev");
    }
}
