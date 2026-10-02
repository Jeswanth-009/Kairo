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
use std::path::Path;

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
/// evidence, bullets and skill links go with the row. For jobs, the compiled
/// PDF and version copies are removed with it — the one point where the
/// workspace's files become unrecoverable.
pub fn purge(
    conn: &Connection,
    entity_type: &str,
    entity_id: i64,
    pdf_root: &Path,
) -> Result<(), String> {
    let table = resolve_table(entity_type)?;
    let sql = format!("DELETE FROM {table} WHERE id = ?1");
    let changed = sql_err(conn.execute(&sql, [entity_id]))?;
    if changed == 0 {
        return Err("Trash item not found".to_string());
    }
    if entity_type == "job" {
        remove_job_dir(pdf_root, entity_id);
    }
    Ok(())
}

/// Startup expiry: rows trashed more than `TRASH_RETENTION_DAYS` ago are gone
/// for good. Job files go with them. Best-effort — a failure here must not
/// keep the app from opening.
pub fn purge_expired(conn: &Connection, pdf_root: &Path) -> Result<usize, String> {
    let mut total = 0usize;
    for (entity_type, _) in TRASH_ARMS {
        let table = resolve_table(entity_type)?;
        // Job ids are collected first so their files can be removed after
        // the rows are gone.
        let expired_ids: Vec<i64> = if *entity_type == "job" {
            let mut stmt = sql_err(conn.prepare(
                &format!("SELECT id FROM {table} WHERE deleted_at IS NOT NULL AND deleted_at <= datetime('now', ?1)"),
            ))?;
            let rows = sql_err(stmt.query_map(params![format!("-{TRASH_RETENTION_DAYS} days")], |r| r.get(0)))?;
            sql_err(rows.collect::<rusqlite::Result<Vec<i64>>>())?
        } else {
            vec![]
        };
        let sql = format!(
            "DELETE FROM {table} WHERE deleted_at IS NOT NULL \
             AND deleted_at <= datetime('now', ?1)"
        );
        let changed =
            sql_err(conn.execute(&sql, params![format!("-{TRASH_RETENTION_DAYS} days")]))?;
        total += changed as usize;
        for id in expired_ids {
            remove_job_dir(pdf_root, id);
        }
    }
    Ok(total)
}

/// Startup reconciliation: removes `pdf/job_*` directories whose job row no
/// longer exists in any state. These are orphans left by older releases that
/// deleted files eagerly on soft delete but never on purge — a soft-deleted
/// job's directory is never touched here (it must stay restorable).
pub fn gc_orphan_job_dirs(conn: &Connection, pdf_root: &Path) -> usize {
    let entries = match std::fs::read_dir(pdf_root) {
        Ok(entries) => entries,
        Err(_) => return 0,
    };
    let mut removed = 0usize;
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        let Some(id) = name
            .strip_prefix("job_")
            .and_then(|rest| rest.parse::<i64>().ok())
        else {
            continue;
        };
        let exists: i64 = match conn.query_row("SELECT COUNT(*) FROM jobs WHERE id = ?1", [id], |r| {
            r.get(0)
        }) {
            Ok(n) => n,
            Err(_) => continue,
        };
        if exists == 0 && std::fs::remove_dir_all(entry.path()).is_ok() {
            removed += 1;
        }
    }
    removed
}

/// Best-effort removal of one job's build dir; a leftover directory is
/// preferable to failing the DB mutation that just succeeded.
fn remove_job_dir(pdf_root: &Path, job_id: i64) {
    let dir = pdf_root.join(format!("job_{job_id}"));
    if let Err(e) = std::fs::remove_dir_all(&dir) {
        if e.kind() != std::io::ErrorKind::NotFound {
            crate::logging::log_event(
                "warn",
                "job_files_purge_failed",
                &[
                    ("job_id", job_id.to_string()),
                    ("path", dir.to_string_lossy().to_string()),
                    ("error", e.to_string()),
                ],
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::super::vault;
    use super::*;
    use crate::db::apply_migrations;
    use std::path::PathBuf;

    fn mem_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        apply_migrations(&conn).unwrap();
        conn
    }

    fn pdf_root(tag: &str) -> PathBuf {
        let d =
            std::env::temp_dir().join(format!("kairo-trash-test-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
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

    fn job(conn: &Connection, role: &str) -> i64 {
        conn.execute(
            "INSERT INTO jobs (company, role_title, raw_jd) VALUES ('Acme', ?1, 'jd')",
            [role],
        )
        .unwrap();
        conn.last_insert_rowid()
    }

    /// Fake compiled + version PDFs, mirroring the real `pdf/job_{id}` layout.
    fn seed_job_files(root: &Path, job_id: i64) {
        let dir = root.join(format!("job_{job_id}"));
        let versions = dir.join("versions").join("v1");
        std::fs::create_dir_all(&versions).unwrap();
        std::fs::write(dir.join("resume.pdf"), b"%PDF-1.4 main").unwrap();
        std::fs::write(versions.join("resume.pdf"), b"%PDF-1.4 version").unwrap();
    }

    fn dir_exists(root: &Path, job_id: i64) -> bool {
        root.join(format!("job_{job_id}")).exists()
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
        let root = pdf_root("purge-vault");
        let p = project(&conn, "Doomed");
        vault::vault_delete::<vault::Project>(&conn, p.id).unwrap();

        purge(&conn, "project", p.id, &root).unwrap();
        let rows: i64 = conn
            .query_row("SELECT COUNT(*) FROM projects", [], |r| r.get(0))
            .unwrap();
        assert_eq!(rows, 0);
        assert!(list_trash(&conn).unwrap().is_empty());

        assert!(purge(&conn, "dragon", 1, &root).is_err());
        assert!(restore(&conn, "dragon", 1).is_err());
        assert!(purge(&conn, "project", 999, &root).is_err());
    }

    #[test]
    fn expired_entries_purge_on_startup() {
        let conn = mem_db();
        let root = pdf_root("expire-vault");
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

        let removed = purge_expired(&conn, &root).unwrap();
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

    /// Acceptance check: "Delete a job, restore it, and open every prior PDF."
    #[test]
    fn soft_delete_keeps_job_files_restore_brings_them_back() {
        let conn = mem_db();
        let root = pdf_root("soft-delete");
        let id = job(&conn, "Dev");
        seed_job_files(&root, id);

        vault::vault_delete::<super::super::jobs::Job>(&conn, id).unwrap();
        assert!(
            dir_exists(&root, id),
            "soft delete must retain the compiled PDF and version copies"
        );

        restore(&conn, "job", id).unwrap();
        let main = root.join(format!("job_{id}")).join("resume.pdf");
        let version = root
            .join(format!("job_{id}"))
            .join("versions")
            .join("v1")
            .join("resume.pdf");
        assert_eq!(std::fs::read(&main).unwrap(), b"%PDF-1.4 main");
        assert_eq!(std::fs::read(&version).unwrap(), b"%PDF-1.4 version");
    }

    /// Acceptance check: files leave disk only when the job is purged for good.
    #[test]
    fn purging_a_job_removes_its_files() {
        let conn = mem_db();
        let root = pdf_root("purge-job");
        let id = job(&conn, "Doomed role");
        seed_job_files(&root, id);

        vault::vault_delete::<super::super::jobs::Job>(&conn, id).unwrap();
        purge(&conn, "job", id, &root).unwrap();
        assert!(
            !dir_exists(&root, id),
            "purge must remove the job's PDF directory"
        );
    }

    #[test]
    fn expired_jobs_lose_their_files_on_startup_expiry() {
        let conn = mem_db();
        let root = pdf_root("expire-job");
        let keep = job(&conn, "Keep");
        let gone = job(&conn, "Gone");
        seed_job_files(&root, keep);
        seed_job_files(&root, gone);

        vault::vault_delete::<super::super::jobs::Job>(&conn, keep).unwrap();
        vault::vault_delete::<super::super::jobs::Job>(&conn, gone).unwrap();
        conn.execute(
            "UPDATE jobs SET deleted_at = datetime('now', '-40 days') WHERE id = ?1",
            [gone],
        )
        .unwrap();

        purge_expired(&conn, &root).unwrap();
        assert!(dir_exists(&root, keep), "unexpired trash must keep files");
        assert!(!dir_exists(&root, gone), "expired trash must lose files");
    }

    #[test]
    fn gc_removes_only_dirs_whose_job_row_is_gone() {
        let conn = mem_db();
        let root = pdf_root("gc");
        let live = job(&conn, "Live");
        let trashed = job(&conn, "Trashed");
        seed_job_files(&root, live);
        seed_job_files(&root, trashed);
        vault::vault_delete::<super::super::jobs::Job>(&conn, trashed).unwrap();
        // Orphan from an older release: purged job whose dir was left behind.
        let orphan_id = live + 10_000;
        seed_job_files(&root, orphan_id);

        let removed = gc_orphan_job_dirs(&conn, &root);
        assert_eq!(removed, 1);
        assert!(dir_exists(&root, live));
        assert!(
            dir_exists(&root, trashed),
            "soft-deleted jobs must keep their files"
        );
        assert!(!dir_exists(&root, orphan_id));
    }
}
