//! Record provenance (Phase "rebuild the first-use experience").
//!
//! Imported records show where they came from and how far the user has
//! confirmed them: `origin` ('manual' | 'imported'), `edited_at` (stamped by
//! migration-0014 triggers on the first content change of an imported
//! record) and `verified_at` (set only by the explicit action below).
//! "Evidence attached" stays derived from the evidence count, so the UI can
//! show the honest ladder: Verified by you > Evidence attached > Edited by
//! you > Imported from resume — never calling imported text "verified
//! evidence".

use super::trust::EntityKind;
use super::vault::sql_err;
use rusqlite::Connection;
use serde::Serialize;

/// The record kinds that carry provenance (jobs and skills do not).
pub const ORIGIN_KINDS: &[EntityKind] = &[
    EntityKind::Project,
    EntityKind::Experience,
    EntityKind::Education,
    EntityKind::Certification,
    EntityKind::Achievement,
];

/// Explicitly records that the user has verified a record's facts against
/// the real world. Only this action may set `verified_at` — imported text is
/// never called verified by default.
pub fn mark_verified(conn: &Connection, entity_type: &str, entity_id: i64) -> Result<(), String> {
    let kind = EntityKind::parse(entity_type)?;
    if !ORIGIN_KINDS.contains(&kind) {
        return Err(format!(
            "'{entity_type}' records do not carry verification state"
        ));
    }
    let table = kind.table();
    let changed = sql_err(conn.execute(
        &format!("UPDATE {table} SET verified_at = datetime('now') WHERE id = ?1"),
        [entity_id],
    ))?;
    if changed == 0 {
        return Err("Record not found".to_string());
    }
    Ok(())
}

/// Clears an accidental verification — verify must always be a deliberate
/// human act, so the Vault offers an unverify alongside it.
pub fn unmark_verified(conn: &Connection, entity_type: &str, entity_id: i64) -> Result<(), String> {
    let kind = EntityKind::parse(entity_type)?;
    if !ORIGIN_KINDS.contains(&kind) {
        return Err(format!(
            "'{entity_type}' records do not carry verification state"
        ));
    }
    let table = kind.table();
    let changed = sql_err(conn.execute(
        &format!("UPDATE {table} SET verified_at = NULL WHERE id = ?1"),
        [entity_id],
    ))?;
    if changed == 0 {
        return Err("Record not found".to_string());
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OnboardingStatus {
    pub has_profile: bool,
    pub project_count: i64,
    pub experience_count: i64,
    pub education_count: i64,
    pub skill_count: i64,
    pub job_count: i64,
    /// True once the user has anything to work with — the guided first-run
    /// flow is only for the truly blank slate.
    pub has_any_content: bool,
}

/// Snapshot for the first-run redirect and the dashboard CTA.
pub fn onboarding_status(conn: &Connection) -> Result<OnboardingStatus, String> {
    let count =
        |sql: &str| -> Result<i64, String> { sql_err(conn.query_row(sql, [], |r| r.get(0))) };
    let project_count = count("SELECT COUNT(*) FROM projects WHERE deleted_at IS NULL")?;
    let experience_count = count("SELECT COUNT(*) FROM experiences WHERE deleted_at IS NULL")?;
    let education_count = count("SELECT COUNT(*) FROM education WHERE deleted_at IS NULL")?;
    let skill_count = count("SELECT COUNT(*) FROM skills WHERE deleted_at IS NULL")?;
    let job_count = count("SELECT COUNT(*) FROM jobs WHERE deleted_at IS NULL")?;
    let profile: i64 = count("SELECT COUNT(*) FROM profiles")?;
    Ok(OnboardingStatus {
        has_profile: profile > 0,
        project_count,
        experience_count,
        education_count,
        skill_count,
        job_count,
        has_any_content: profile > 0
            || project_count > 0
            || experience_count > 0
            || education_count > 0
            || skill_count > 0
            || job_count > 0,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::apply_migrations;

    fn mem_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        apply_migrations(&conn).unwrap();
        conn
    }

    fn imported_project(conn: &Connection, title: &str) -> i64 {
        conn.execute(
            "INSERT INTO projects (title, description, origin) VALUES (?1, 'desc', 'imported')",
            [title],
        )
        .unwrap();
        conn.last_insert_rowid()
    }

    #[test]
    fn mark_verified_sets_and_unverify_clears() {
        let conn = mem_db();
        let id = imported_project(&conn, "PyKV");

        assert!(conn
            .query_row(
                "SELECT verified_at FROM projects WHERE id = ?1",
                [id],
                |r| r.get::<_, Option<String>>(0)
            )
            .unwrap()
            .is_none());

        mark_verified(&conn, "project", id).unwrap();
        assert!(conn
            .query_row(
                "SELECT verified_at FROM projects WHERE id = ?1",
                [id],
                |r| r.get::<_, Option<String>>(0)
            )
            .unwrap()
            .is_some());

        unmark_verified(&conn, "project", id).unwrap();
        assert!(conn
            .query_row(
                "SELECT verified_at FROM projects WHERE id = ?1",
                [id],
                |r| r.get::<_, Option<String>>(0)
            )
            .unwrap()
            .is_none());
    }

    #[test]
    fn verification_rejects_non_record_kinds_and_unknown_ids() {
        let conn = mem_db();
        // Jobs and skills do not carry provenance.
        assert!(mark_verified(&conn, "job", 1).is_err());
        assert!(mark_verified(&conn, "skill", 1).is_err());
        // Unknown kinds are refused by the EntityKind whitelist.
        assert!(mark_verified(&conn, "dragon", 1).is_err());
        // Known kind, missing row.
        assert!(mark_verified(&conn, "project", 999).is_err());
    }

    #[test]
    fn editing_imported_content_stamps_edited_once_and_verify_does_not() {
        let conn = mem_db();
        let id = imported_project(&conn, "Original title");

        // Verifying alone must not count as an edit.
        mark_verified(&conn, "project", id).unwrap();
        let edited: Option<String> = conn
            .query_row("SELECT edited_at FROM projects WHERE id = ?1", [id], |r| {
                r.get::<_, Option<String>>(0)
            })
            .unwrap();
        assert!(edited.is_none(), "verify is not an edit");

        // First content edit stamps edited_at…
        conn.execute("UPDATE projects SET title = 'Renamed' WHERE id = ?1", [id])
            .unwrap();
        let first: String = conn
            .query_row("SELECT edited_at FROM projects WHERE id = ?1", [id], |r| {
                r.get::<_, Option<String>>(0)
            })
            .unwrap()
            .expect("first edit stamps edited_at");

        // …and the timestamp survives further edits (first edit wins).
        conn.execute(
            "UPDATE projects SET title = 'Renamed again' WHERE id = ?1",
            [id],
        )
        .unwrap();
        let second: Option<String> = conn
            .query_row("SELECT edited_at FROM projects WHERE id = ?1", [id], |r| {
                r.get::<_, Option<String>>(0)
            })
            .unwrap();
        assert_eq!(second.as_deref(), Some(first.as_str()));
    }

    #[test]
    fn manual_records_never_gain_the_edited_flag() {
        let conn = mem_db();
        conn.execute(
            "INSERT INTO projects (title, description) VALUES ('Mine', 'desc')",
            [],
        )
        .unwrap();
        let id = conn.last_insert_rowid();
        conn.execute("UPDATE projects SET title = 'Renamed' WHERE id = ?1", [id])
            .unwrap();
        let edited: Option<String> = conn
            .query_row("SELECT edited_at FROM projects WHERE id = ?1", [id], |r| {
                r.get::<_, Option<String>>(0)
            })
            .unwrap();
        assert!(edited.is_none(), "manual records have no 'edited' state");
    }

    #[test]
    fn onboarding_status_counts_live_rows() {
        let conn = mem_db();
        let status = onboarding_status(&conn).unwrap();
        assert!(!status.has_any_content);

        imported_project(&conn, "PyKV");
        conn.execute(
            "INSERT INTO jobs (company, role_title, raw_jd) VALUES ('Acme', 'Dev', 'jd')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO skills (canonical_name, category) VALUES ('Rust', 'language')",
            [],
        )
        .unwrap();
        // A soft-deleted record must not count.
        conn.execute(
            "INSERT INTO projects (title, description) VALUES ('Gone', 'x')",
            [],
        )
        .unwrap();
        let gone = conn.last_insert_rowid();
        conn.execute(
            "UPDATE projects SET deleted_at = datetime('now') WHERE id = ?1",
            [gone],
        )
        .unwrap();

        let status = onboarding_status(&conn).unwrap();
        assert_eq!(status.project_count, 1);
        assert_eq!(status.job_count, 1);
        assert_eq!(status.skill_count, 1);
        assert!(status.has_any_content);
        assert!(!status.has_profile);
    }
}
