//! Dashboard overview (Phase 13). Assembles the real numbers the front page
//! shows: Vault/trust counts, pipeline counts, evidence still awaiting
//! verification, and a recent-activity feed drawn from updated_at across
//! domains. Read-only — the dashboard never writes.

use super::vault::sql_err;
use rusqlite::Connection;
use serde::Serialize;

/// How many unverified evidence rows the review list returns (the count tile
/// always shows the true total).
pub const REVIEW_LIMIT: i64 = 25;
/// Per-source caps and the overall cap for the activity feed.
pub const ACTIVITY_PER_SOURCE: i64 = 5;
pub const ACTIVITY_TOTAL: usize = 12;

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardCounts {
    // Vault
    pub projects: i64,
    pub experiences: i64,
    pub education: i64,
    pub certifications: i64,
    pub achievements: i64,
    pub skills: i64,
    // Trust
    pub evidence_total: i64,
    pub evidence_verified: i64,
    pub evidence_unverified: i64,
    pub canonical_bullets: i64,
    pub bullets_approved: i64,
    pub claim_rules: i64,
    // Pipeline
    pub jobs: i64,
    pub jobs_with_match: i64,
    pub jobs_with_plan: i64,
    pub pdfs_compiled: i64,
    pub resume_versions: i64,
    pub suggestions_pending: i64,
    pub applications: i64,
    /// Applications currently in flight (applied → offer).
    pub applications_active: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EvidenceReviewItem {
    pub id: i64,
    pub entity_type: String,
    pub entity_id: i64,
    /// Resolved parent record label ("Payments API", "NimbusPay — Backend Engineer").
    pub entity_label: String,
    pub kind: String,
    pub title: String,
    pub reference: String,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityItem {
    pub kind: String,
    /// Route hint: "job" → /jobs/:id, "application" → /applications, else /vault.
    pub ref_type: String,
    pub ref_id: i64,
    pub label: String,
    pub detail: String,
    /// SQLite UTC datetime ("YYYY-MM-DD HH:MM:SS") — lexicographic = chronological.
    pub at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardOverview {
    pub counts: DashboardCounts,
    pub evidence_needing_review: Vec<EvidenceReviewItem>,
    pub recent_activity: Vec<ActivityItem>,
}

pub fn overview(conn: &Connection) -> Result<DashboardOverview, String> {
    Ok(DashboardOverview {
        counts: counts(conn)?,
        evidence_needing_review: evidence_needing_review(conn, REVIEW_LIMIT)?,
        recent_activity: recent_activity(conn)?,
    })
}

pub fn counts(conn: &Connection) -> Result<DashboardCounts, String> {
    const SQL: &str = "SELECT
        (SELECT COUNT(*) FROM projects),
        (SELECT COUNT(*) FROM experiences),
        (SELECT COUNT(*) FROM education),
        (SELECT COUNT(*) FROM certifications),
        (SELECT COUNT(*) FROM achievements),
        (SELECT COUNT(*) FROM skills),
        (SELECT COUNT(*) FROM evidence),
        (SELECT COALESCE(SUM(verified), 0) FROM evidence),
        (SELECT COUNT(*) FROM canonical_bullets),
        (SELECT COALESCE(SUM(approved), 0) FROM canonical_bullets),
        (SELECT COUNT(*) FROM claim_rules),
        (SELECT COUNT(*) FROM jobs),
        (SELECT COUNT(*) FROM match_reports),
        (SELECT COUNT(*) FROM resume_plans),
        (SELECT COUNT(*) FROM resume_plans WHERE pdf_path IS NOT NULL AND pdf_path <> ''),
        (SELECT COUNT(*) FROM resume_versions),
        (SELECT COUNT(*) FROM tailor_suggestions WHERE status = 'pending'),
        (SELECT COUNT(*) FROM applications),
        (SELECT COUNT(*) FROM applications
           WHERE status IN ('applied','oa','interview','final','offer'))";
    sql_err(conn.query_row(SQL, [], |row| {
        let evidence_total: i64 = row.get(6)?;
        let evidence_verified: i64 = row.get(7)?;
        Ok(DashboardCounts {
            projects: row.get(0)?,
            experiences: row.get(1)?,
            education: row.get(2)?,
            certifications: row.get(3)?,
            achievements: row.get(4)?,
            skills: row.get(5)?,
            evidence_total,
            evidence_verified,
            evidence_unverified: evidence_total - evidence_verified,
            canonical_bullets: row.get(8)?,
            bullets_approved: row.get(9)?,
            claim_rules: row.get(10)?,
            jobs: row.get(11)?,
            jobs_with_match: row.get(12)?,
            jobs_with_plan: row.get(13)?,
            pdfs_compiled: row.get(14)?,
            resume_versions: row.get(15)?,
            suggestions_pending: row.get(16)?,
            applications: row.get(17)?,
            applications_active: row.get(18)?,
        })
    }))
}

/// Unverified evidence, newest first, with the owning record's label resolved
/// (evidence rows are trigger-cleaned on record delete, so the join always hits).
pub fn evidence_needing_review(
    conn: &Connection,
    limit: i64,
) -> Result<Vec<EvidenceReviewItem>, String> {
    const SQL: &str = "SELECT e.id, e.entity_type, e.entity_id, e.kind, e.title, e.reference, e.created_at,
            COALESCE(CASE e.entity_type
                WHEN 'project' THEN (SELECT p.title FROM projects p WHERE p.id = e.entity_id)
                WHEN 'experience' THEN (SELECT x.organization || ' — ' || x.role FROM experiences x WHERE x.id = e.entity_id)
                WHEN 'education' THEN (SELECT d.institution || ' — ' || d.degree FROM education d WHERE d.id = e.entity_id)
                WHEN 'certification' THEN (SELECT c.title FROM certifications c WHERE c.id = e.entity_id)
                WHEN 'achievement' THEN (SELECT a.title FROM achievements a WHERE a.id = e.entity_id)
            END, '') AS entity_label
        FROM evidence e
        WHERE e.verified = 0
        ORDER BY e.created_at DESC, e.id DESC
        LIMIT ?1";
    let mut stmt = sql_err(conn.prepare(SQL))?;
    let mapped = sql_err(stmt.query_map([limit], |row| {
        Ok(EvidenceReviewItem {
            id: row.get(0)?,
            entity_type: row.get(1)?,
            entity_id: row.get(2)?,
            kind: row.get(3)?,
            title: row.get(4)?,
            reference: row.get(5)?,
            created_at: row.get(6)?,
            entity_label: row.get(7)?,
        })
    }))?;
    sql_err(mapped.collect::<rusqlite::Result<Vec<_>>>())
}

pub fn recent_activity(conn: &Connection) -> Result<Vec<ActivityItem>, String> {
    let sources = vec![
        activity_source(
            conn,
            "SELECT 'job', id, company || ' — ' || role_title, 'Job workspace', updated_at
             FROM jobs ORDER BY updated_at DESC, id DESC",
            "job",
        )?,
        activity_source(
            conn,
            "SELECT 'application', id, company || ' — ' || role, 'Application · ' || status, updated_at
             FROM applications ORDER BY updated_at DESC, id DESC",
            "application",
        )?,
        activity_source(
            conn,
            "SELECT 'version', v.id, 'v' || v.version_number || ' — ' || j.company || ' ' || j.role_title,
                    'Resume version saved', v.created_at
             FROM resume_versions v JOIN jobs j ON j.id = v.job_id
             ORDER BY v.created_at DESC, v.id DESC",
            "job",
        )?,
        activity_source(
            conn,
            "SELECT 'evidence', id, title, 'Evidence · ' || entity_type, updated_at
             FROM evidence ORDER BY updated_at DESC, id DESC",
            "vault",
        )?,
        activity_source(
            conn,
            "SELECT 'bullet', id, substr(text, 1, 90),
                    CASE approved WHEN 1 THEN 'Bullet · approved' ELSE 'Bullet · draft' END, updated_at
             FROM canonical_bullets ORDER BY updated_at DESC, id DESC",
            "vault",
        )?,
        vault_source(conn, "projects", "title", "project")?,
        vault_source(conn, "experiences", "organization || ' — ' || role", "experience")?,
        vault_source(conn, "education", "institution || ' — ' || degree", "education")?,
        vault_source(conn, "certifications", "title", "certification")?,
        vault_source(conn, "achievements", "title", "achievement")?,
    ];
    Ok(merge_activity(sources, ACTIVITY_TOTAL))
}

/// Pure merge: newest first (ties broken deterministically), truncated to `total`.
pub fn merge_activity(mut sources: Vec<Vec<ActivityItem>>, total: usize) -> Vec<ActivityItem> {
    let mut all: Vec<ActivityItem> = sources.drain(..).flatten().collect();
    all.sort_by(|a, b| {
        b.at.cmp(&a.at)
            .then_with(|| a.kind.cmp(&b.kind))
            .then_with(|| b.ref_id.cmp(&a.ref_id))
    });
    all.truncate(total);
    all
}

fn activity_source(
    conn: &Connection,
    sql: &str,
    ref_type: &str,
) -> Result<Vec<ActivityItem>, String> {
    let sql = format!("{sql} LIMIT {ACTIVITY_PER_SOURCE}");
    let mut stmt = sql_err(conn.prepare(&sql))?;
    let mapped = sql_err(stmt.query_map([], |row| {
        Ok(ActivityItem {
            kind: row.get(0)?,
            ref_id: row.get(1)?,
            label: row.get(2)?,
            detail: row.get(3)?,
            at: row.get(4)?,
            ref_type: ref_type.to_string(),
        })
    }))?;
    sql_err(mapped.collect::<rusqlite::Result<Vec<_>>>())
}

/// One Vault record type as an activity source. `label_expr` selects the
/// record's display name from its own table.
fn vault_source(
    conn: &Connection,
    table: &str,
    label_expr: &str,
    kind_word: &str,
) -> Result<Vec<ActivityItem>, String> {
    let sql = format!(
        "SELECT '{kind_word}', id, {label_expr}, 'Vault · {kind_word}', updated_at \
         FROM {table} ORDER BY updated_at DESC, id DESC"
    );
    activity_source(conn, &sql, "vault")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::apply_migrations;
    use rusqlite::Connection;

    fn db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        apply_migrations(&conn).unwrap();
        conn
    }

    /// Covers every table the dashboard reads so count assertions are complete.
    fn fixture(conn: &Connection) {
        conn.execute(
            "INSERT INTO projects (title, description) VALUES ('Payments API', 'Core ledger')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO experiences (organization, role) VALUES ('NimbusPay', 'Backend Engineer')",
            [],
        )
        .unwrap();
        conn.execute("INSERT INTO skills (canonical_name) VALUES ('Rust')", [])
            .unwrap();
        conn.execute(
            "INSERT INTO evidence (entity_type, entity_id, kind, title, verified)
             VALUES ('project', 1, 'repository', 'Repo link', 1)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO evidence (entity_type, entity_id, kind, title, verified)
             VALUES ('project', 1, 'metric', 'Latency note', 0)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO evidence (entity_type, entity_id, kind, title, verified)
             VALUES ('experience', 1, 'document', 'Perf review', 0)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO canonical_bullets (entity_type, entity_id, text, approved)
             VALUES ('project', 1, 'Built the payments API', 1)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO canonical_bullets (entity_type, entity_id, text, approved)
             VALUES ('experience', 1, 'Owned the ledger service', 0)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO claim_rules (rule_type, pattern) VALUES ('forbidden_claim', 'revolutionary')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO jobs (company, role_title, raw_jd) VALUES ('Acme', 'Senior Rust Dev', 'jd')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO job_requirements (job_id, kind, raw_text) VALUES (1, 'required_skill', 'Rust')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO match_reports (job_id, report_json, matching_version) VALUES (1, '{}', 1)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO resume_plans (job_id, config_json, plan_json, composer_version)
             VALUES (1, '{}', '{}', 1)",
            [],
        )
        .unwrap();
        conn.execute(
            "UPDATE resume_plans SET pdf_path = 'pdf/job_1/resume.pdf', page_count = 1 WHERE job_id = 1",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO resume_versions (job_id, version_number, snapshot_json, pdf_path)
             VALUES (1, 1, '{}', 'pdf/job_1/versions/v_1/resume.pdf')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO applications (company, role, status) VALUES ('Acme', 'Senior Rust Dev', 'applied')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO applications (company, role, status) VALUES ('Beta', 'Dev', 'wishlist')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO tailor_suggestions (job_id, bullet_id, original_text, suggested_text, status)
             VALUES (1, 1, 'a', 'b', 'pending')",
            [],
        )
        .unwrap();
    }

    #[test]
    fn empty_database_counts_are_zero() {
        let conn = db();
        let c = counts(&conn).unwrap();
        assert_eq!(c.projects, 0);
        assert_eq!(c.evidence_total, 0);
        assert_eq!(c.evidence_unverified, 0);
        assert_eq!(c.jobs, 0);
        assert_eq!(c.applications_active, 0);
        assert!(evidence_needing_review(&conn, 10).unwrap().is_empty());
        assert!(recent_activity(&conn).unwrap().is_empty());
    }

    #[test]
    fn counts_reflect_fixtures() {
        let conn = db();
        fixture(&conn);
        let c = counts(&conn).unwrap();
        assert_eq!(c.projects, 1);
        assert_eq!(c.experiences, 1);
        assert_eq!(c.skills, 1);
        assert_eq!(c.evidence_total, 3);
        assert_eq!(c.evidence_verified, 1);
        assert_eq!(c.evidence_unverified, 2);
        assert_eq!(c.canonical_bullets, 2);
        assert_eq!(c.bullets_approved, 1);
        assert_eq!(c.claim_rules, 1);
        assert_eq!(c.jobs, 1);
        assert_eq!(c.jobs_with_match, 1);
        assert_eq!(c.jobs_with_plan, 1);
        assert_eq!(c.pdfs_compiled, 1);
        assert_eq!(c.resume_versions, 1);
        assert_eq!(c.suggestions_pending, 1);
        assert_eq!(c.applications, 2);
        assert_eq!(c.applications_active, 1); // applied counts, wishlist does not
    }

    #[test]
    fn evidence_review_lists_only_unverified_with_labels() {
        let conn = db();
        fixture(&conn);
        let items = evidence_needing_review(&conn, 10).unwrap();
        assert_eq!(items.len(), 2);
        // Newest id first on timestamp ties.
        assert_eq!(items[0].title, "Perf review");
        assert_eq!(items[0].entity_label, "NimbusPay — Backend Engineer");
        assert_eq!(items[1].title, "Latency note");
        assert_eq!(items[1].entity_label, "Payments API");
        // The verified row never appears.
        assert!(!items.iter().any(|i| i.title == "Repo link"));
    }

    #[test]
    fn recent_activity_spans_domains() {
        let conn = db();
        fixture(&conn);
        let feed = recent_activity(&conn).unwrap();
        assert!(feed.len() <= ACTIVITY_TOTAL);
        let labels: Vec<&str> = feed.iter().map(|i| i.label.as_str()).collect();
        assert!(labels.contains(&"Acme — Senior Rust Dev")); // job + application
        assert!(labels.iter().any(|l| l.starts_with("v1 — Acme"))); // version
        assert!(labels.contains(&"Payments API")); // vault project
        assert!(feed
            .iter()
            .any(|i| i.kind == "application" && i.detail == "Application · applied"));
        // Newest first under equal timestamps: deterministic kind tie-break.
        let sorted = merge_activity(vec![feed.clone()], ACTIVITY_TOTAL);
        assert_eq!(sorted, feed);
    }

    #[test]
    fn merge_activity_sorts_newest_first_and_truncates() {
        let mk = |at: &str, kind: &str, id: i64| ActivityItem {
            kind: kind.to_string(),
            ref_type: "vault".to_string(),
            ref_id: id,
            label: format!("{kind} {id}"),
            detail: String::new(),
            at: at.to_string(),
        };
        let feed = merge_activity(
            vec![
                vec![mk("2026-01-01 10:00:00", "job", 1)],
                vec![
                    mk("2026-01-03 10:00:00", "application", 2),
                    mk("2026-01-02 10:00:00", "project", 3),
                ],
            ],
            2,
        );
        assert_eq!(feed.len(), 2);
        assert_eq!(feed[0].label, "application 2"); // Jan 3
        assert_eq!(feed[1].label, "project 3"); // Jan 2
    }
}
