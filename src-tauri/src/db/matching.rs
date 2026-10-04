//! Matching persistence + input loading (Phase 5). Composes Vault, trust and
//! job data into the pure matcher's input, then persists the explainable rows
//! and the full report snapshot.

use super::vault::sql_err;
use crate::matching::{
    MatchEntity, MatchInput, MatchReport, MatchRequirement, MatchSkill, MATCHING_VERSION,
};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

pub fn load_match_input(conn: &Connection, job_id: i64) -> Result<MatchInput, String> {
    let job = super::jobs::get_job_enriched(conn, job_id)?;
    let requirements = super::jobs::list_requirements(conn, job_id)?;

    let skills: Vec<MatchSkill> = super::vault::vault_list::<super::vault::Skill>(conn)?
        .into_iter()
        .map(|s| MatchSkill {
            id: s.id,
            canonical_name: s.canonical_name,
            aliases: s.aliases.into_iter().map(|a| a.alias).collect(),
        })
        .collect();

    let mut entities: Vec<MatchEntity> = Vec::new();

    let enrich_skills = |existing: Vec<(i64, i64)>, text: &str| -> Vec<(i64, i64)> {
        let mut result = existing;
        let lower = text.to_lowercase();
        let words: std::collections::HashSet<&str> = lower
            .split(|c: char| !c.is_alphanumeric() && c != '+' && c != '#')
            .filter(|w| !w.is_empty())
            .collect();
        for s in &skills {
            if result.iter().any(|(id, _)| *id == s.id) {
                continue;
            }
            let names = std::iter::once(&s.canonical_name).chain(s.aliases.iter());
            let matched = names.into_iter().any(|name| {
                let n_lower = name.to_lowercase();
                if n_lower.len() <= 2 {
                    words.contains(n_lower.as_str())
                } else if n_lower.contains(' ') {
                    lower.contains(&n_lower)
                } else {
                    words.contains(n_lower.as_str())
                }
            });
            if matched {
                result.push((s.id, 3));
            }
        }
        result
    };

    for project in super::vault::vault_list::<super::vault::Project>(conn)? {
        let bullets = super::trust::list_bullets(
            conn,
            crate::db::trust::EntityKind::Project.as_str(),
            project.id,
        )?
        .into_iter()
        .map(|b| b.text)
        .collect::<Vec<_>>();
        let text = format!(
            "{} {} {}",
            project.title,
            project.description,
            bullets.join(" ")
        );
        let existing_skills: Vec<(i64, i64)> = project
            .skills
            .into_iter()
            .map(|r| (r.skill_id, r.confidence))
            .collect();
        let entity_skills = enrich_skills(existing_skills, &text);
        entities.push(MatchEntity {
            entity_type: crate::db::trust::EntityKind::Project.as_str().to_string(),
            id: project.id,
            title: project.title,
            description: project.description,
            start_date: project.start_date,
            end_date: project.end_date,
            is_current: project.is_current,
            skills: entity_skills,
            evidence_count: project.evidence_count,
            bullets,
        });
    }

    for experience in super::vault::vault_list::<super::vault::Experience>(conn)? {
        let bullets = super::trust::list_bullets(
            conn,
            crate::db::trust::EntityKind::Experience.as_str(),
            experience.id,
        )?
        .into_iter()
        .map(|b| b.text)
        .collect::<Vec<_>>();
        let text = format!(
            "{} {} {} {}",
            experience.organization,
            experience.role,
            experience.description,
            bullets.join(" ")
        );
        let existing_skills: Vec<(i64, i64)> = experience
            .skills
            .into_iter()
            .map(|r| (r.skill_id, r.confidence))
            .collect();
        let entity_skills = enrich_skills(existing_skills, &text);
        entities.push(MatchEntity {
            entity_type: crate::db::trust::EntityKind::Experience
                .as_str()
                .to_string(),
            id: experience.id,
            title: format!("{} — {}", experience.organization, experience.role)
                .trim_end_matches(" —")
                .to_string(),
            description: experience.description,
            start_date: experience.start_date,
            end_date: experience.end_date,
            is_current: experience.is_current,
            skills: entity_skills,
            evidence_count: experience.evidence_count,
            bullets,
        });
    }

    for education in super::vault::vault_list::<super::vault::Education>(conn)? {
        let bullets = vec![format!(
            "{} in {}",
            education.degree, education.field_of_study
        )];
        let desc = format!(
            "{} in {}{}",
            education.degree,
            education.field_of_study,
            if education.description.is_empty() {
                String::new()
            } else {
                format!(". {}", education.description)
            }
        );
        entities.push(MatchEntity {
            entity_type: crate::db::trust::EntityKind::Education.as_str().to_string(),
            id: education.id,
            title: education.institution,
            description: desc,
            start_date: education.start_date,
            end_date: education.end_date,
            is_current: education.is_current,
            skills: Vec::new(),
            evidence_count: 0,
            bullets,
        });
    }

    for achievement in super::vault::vault_list::<super::vault::Achievement>(conn)? {
        let title = if achievement.issuer.is_empty() {
            achievement.title
        } else {
            format!("{} — {}", achievement.title, achievement.issuer)
        };
        entities.push(MatchEntity {
            entity_type: crate::db::trust::EntityKind::Achievement
                .as_str()
                .to_string(),
            id: achievement.id,
            title,
            description: achievement.description.clone(),
            start_date: achievement.achieved_on.clone(),
            end_date: achievement.achieved_on,
            is_current: false,
            skills: Vec::new(),
            evidence_count: 0,
            bullets: vec![achievement.description],
        });
    }

    for certification in super::vault::vault_list::<super::vault::Certification>(conn)? {
        let title = if certification.issuer.is_empty() {
            certification.title
        } else {
            format!("{} ({})", certification.title, certification.issuer)
        };
        entities.push(MatchEntity {
            entity_type: crate::db::trust::EntityKind::Certification
                .as_str()
                .to_string(),
            id: certification.id,
            title,
            description: certification.description.clone(),
            start_date: certification.issue_date.clone(),
            end_date: certification.expiry_date.clone(),
            is_current: false,
            skills: Vec::new(),
            evidence_count: 0,
            bullets: vec![certification.description],
        });
    }

    Ok(MatchInput {
        job_domain: job.domain,
        requirements: requirements
            .into_iter()
            .map(|r| MatchRequirement {
                id: r.id,
                kind: r.kind,
                raw_text: r.raw_text,
                importance: r.importance,
            })
            .collect(),
        skills,
        entities,
    })
}

/// Runs the matcher and persists rows + snapshot in one transaction.
pub fn run_and_persist(conn: &Connection, job_id: i64, now: &str) -> Result<MatchReport, String> {
    let input = load_match_input(conn, job_id)?;
    let report = crate::matching::run_match(&input, now);

    let tx = sql_err(conn.unchecked_transaction())?;
    sql_err(tx.execute("DELETE FROM match_results WHERE job_id = ?1", [job_id]))?;
    for result in &report.results {
        sql_err(tx.execute(
            "INSERT INTO match_results (job_id, requirement_id, coverage, score, explanation, entity_refs, matched_skills) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                job_id,
                result.requirement_id,
                result.coverage.as_str(),
                0.0,
                result.explanation,
                serde_json::to_string(&result.entity_refs).unwrap_or_else(|_| "[]".to_string()),
                serde_json::to_string(&result.matched_skills).unwrap_or_else(|_| "[]".to_string()),
            ],
        ))?;
    }
    sql_err(tx.execute("DELETE FROM match_reports WHERE job_id = ?1", [job_id]))?;
    sql_err(tx.execute(
        "INSERT INTO match_reports (job_id, report_json, matching_version) VALUES (?1, ?2, ?3)",
        params![
            job_id,
            serde_json::to_string(&report).map_err(|e| e.to_string())?,
            MATCHING_VERSION
        ],
    ))?;
    sql_err(tx.commit())?;

    Ok(report)
}

pub fn get_report(conn: &Connection, job_id: i64) -> Result<Option<MatchReport>, String> {
    let mut stmt =
        sql_err(conn.prepare("SELECT report_json FROM match_reports WHERE job_id = ?1"))?;
    match stmt.query_row([job_id], |row| row.get::<_, String>(0)) {
        Ok(json) => serde_json::from_str(&json)
            .map(Some)
            .map_err(|e| e.to_string()),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

// ---------------------------------------------------------------------------
// Evidence stage: the user's Use/Dismiss decisions per (requirement, record),
// plus staleness — a report computed before the last requirement or Vault
// change describes a world that no longer exists.
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EvidenceSelection {
    pub id: i64,
    pub job_id: i64,
    pub requirement_id: i64,
    pub entity_type: String,
    pub entity_id: i64,
    pub decision: String, // "use" | "dismiss"
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
}

pub fn list_evidence_selections(
    conn: &Connection,
    job_id: i64,
) -> Result<Vec<EvidenceSelection>, String> {
    let mut stmt = sql_err(conn.prepare(
        "SELECT id, job_id, requirement_id, entity_type, entity_id, decision, created_at, updated_at \
         FROM evidence_selections WHERE job_id = ?1 ORDER BY id",
    ))?;
    let rows = stmt
        .query_map([job_id], |r| {
            Ok(EvidenceSelection {
                id: r.get(0)?,
                job_id: r.get(1)?,
                requirement_id: r.get(2)?,
                entity_type: r.get(3)?,
                entity_id: r.get(4)?,
                decision: r.get(5)?,
                created_at: r.get(6)?,
                updated_at: r.get(7)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

/// Upsert one decision. The (requirement, record) pair is unique — switching
/// a decision updates the existing row rather than stacking a second one.
pub fn set_evidence_selection(
    conn: &Connection,
    job_id: i64,
    requirement_id: i64,
    entity_type: &str,
    entity_id: i64,
    decision: &str,
) -> Result<EvidenceSelection, String> {
    if decision != "use" && decision != "dismiss" {
        return Err(format!("unknown evidence decision '{decision}'"));
    }
    if super::trust::EntityKind::parse(entity_type).is_err() {
        return Err(format!("unknown entity type '{entity_type}'"));
    }
    sql_err(conn.execute(
        "INSERT INTO evidence_selections (job_id, requirement_id, entity_type, entity_id, decision) \
         VALUES (?1, ?2, ?3, ?4, ?5) \
         ON CONFLICT(requirement_id, entity_type, entity_id) \
         DO UPDATE SET decision = excluded.decision, updated_at = datetime('now')",
        params![job_id, requirement_id, entity_type, entity_id, decision],
    ))?;
    let mut stmt = sql_err(conn.prepare(
        "SELECT id, job_id, requirement_id, entity_type, entity_id, decision, created_at, updated_at \
         FROM evidence_selections WHERE requirement_id = ?1 AND entity_type = ?2 AND entity_id = ?3",
    ))?;
    stmt.query_row(params![requirement_id, entity_type, entity_id], |r| {
        Ok(EvidenceSelection {
            id: r.get(0)?,
            job_id: r.get(1)?,
            requirement_id: r.get(2)?,
            entity_type: r.get(3)?,
            entity_id: r.get(4)?,
            decision: r.get(5)?,
            created_at: r.get(6)?,
            updated_at: r.get(7)?,
        })
    })
    .map_err(|e| e.to_string())
}

pub fn delete_evidence_selection(
    conn: &Connection,
    requirement_id: i64,
    entity_type: &str,
    entity_id: i64,
) -> Result<(), String> {
    sql_err(conn.execute(
        "DELETE FROM evidence_selections WHERE requirement_id = ?1 AND entity_type = ?2 AND entity_id = ?3",
        params![requirement_id, entity_type, entity_id],
    ))?;
    Ok(())
}

/// True when the stored report was computed before the last change to this
/// job's requirements or to any Vault record the matcher reads. Timestamps
/// are SQLite "YYYY-MM-DD HH:MM:SS" — lexicographic compare is correct.
pub fn is_match_stale(conn: &Connection, job_id: i64) -> Result<bool, String> {
    let row = sql_err(conn.query_row(
        "SELECT \
           (SELECT computed_at FROM match_reports WHERE job_id = ?1), \
           (SELECT MAX(updated_at) FROM job_requirements WHERE job_id = ?1), \
           (SELECT MAX(updated_at) FROM projects WHERE deleted_at IS NULL), \
           (SELECT MAX(updated_at) FROM experiences WHERE deleted_at IS NULL), \
           (SELECT MAX(updated_at) FROM education WHERE deleted_at IS NULL), \
           (SELECT MAX(updated_at) FROM certifications WHERE deleted_at IS NULL), \
           (SELECT MAX(updated_at) FROM achievements WHERE deleted_at IS NULL), \
           (SELECT MAX(updated_at) FROM skills)",
        [job_id],
        |r| {
            Ok((
                r.get::<_, Option<String>>(0)?,
                r.get::<_, Option<String>>(1)?,
                r.get::<_, Option<String>>(2)?,
                r.get::<_, Option<String>>(3)?,
                r.get::<_, Option<String>>(4)?,
                r.get::<_, Option<String>>(5)?,
                r.get::<_, Option<String>>(6)?,
                r.get::<_, Option<String>>(7)?,
            ))
        },
    ))?;
    let (computed, reqs, projects, experiences, education, certifications, achievements, skills) =
        row;
    let Some(computed) = computed else {
        return Ok(false); // no report — nothing to be stale
    };
    let newest = [
        reqs,
        projects,
        experiences,
        education,
        certifications,
        achievements,
        skills,
    ]
    .into_iter()
    .flatten()
    .max();
    Ok(newest.is_some_and(|n| n > computed))
}

#[cfg(test)]
mod evidence_tests {
    use super::*;
    use crate::db::apply_migrations;
    use rusqlite::Connection;

    fn mem_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        apply_migrations(&conn).unwrap();
        conn
    }

    fn seed_job_with_requirement(conn: &Connection) -> (i64, i64) {
        conn.execute(
            "INSERT INTO jobs (company, role_title, raw_jd) VALUES ('Acme', 'Dev', 'a sufficiently long job description body for validation')",
            [],
        )
        .unwrap();
        let job_id = conn.last_insert_rowid();
        conn.execute(
            "INSERT INTO job_requirements (job_id, kind, raw_text, normalized_key, importance, user_confirmed, updated_at) \
             VALUES (?1, 'required_skill', 'Rust', 'rust', 0.9, 1, '2026-01-01 00:00:00')",
            params![job_id],
        )
        .unwrap();
        let req_id = conn.last_insert_rowid();
        (job_id, req_id)
    }

    #[test]
    fn selections_upsert_per_requirement_and_record() {
        let conn = mem_db();
        let (job_id, req_id) = seed_job_with_requirement(&conn);

        let first = set_evidence_selection(&conn, job_id, req_id, "project", 3, "use").unwrap();
        assert_eq!(first.decision, "use");
        // Switching the decision updates the same row — one decision per pair.
        let switched =
            set_evidence_selection(&conn, job_id, req_id, "project", 3, "dismiss").unwrap();
        assert_eq!(switched.id, first.id);
        assert_eq!(switched.decision, "dismiss");
        assert_eq!(list_evidence_selections(&conn, job_id).unwrap().len(), 1);

        // A second record gets its own row.
        set_evidence_selection(&conn, job_id, req_id, "experience", 9, "use").unwrap();
        assert_eq!(list_evidence_selections(&conn, job_id).unwrap().len(), 2);

        // Unknown decisions and entity types are refused.
        assert!(set_evidence_selection(&conn, job_id, req_id, "project", 3, "maybe").is_err());
        assert!(set_evidence_selection(&conn, job_id, req_id, "dragon", 3, "use").is_err());

        delete_evidence_selection(&conn, req_id, "project", 3).unwrap();
        assert_eq!(list_evidence_selections(&conn, job_id).unwrap().len(), 1);
    }

    #[test]
    fn staleness_follows_requirements_and_vault_changes() {
        let conn = mem_db();
        let (job_id, _req) = seed_job_with_requirement(&conn);
        conn.execute("INSERT INTO projects (title, origin, updated_at) VALUES ('PyKV', 'imported', '2026-01-01 00:00:00')", []).unwrap();

        // No report yet — staleness is meaningless, so false.
        assert!(!is_match_stale(&conn, job_id).unwrap());

        // A report computed BEFORE the newest change is stale.
        conn.execute(
            "INSERT INTO match_reports (job_id, report_json, matching_version, computed_at) \
             VALUES (?1, '{}', 1, '2025-12-31 00:00:00')",
            params![job_id],
        )
        .unwrap();
        assert!(
            is_match_stale(&conn, job_id).unwrap(),
            "vault changed after compute"
        );

        // Recompute "now" — fresh again.
        conn.execute(
            "UPDATE match_reports SET computed_at = '2026-06-01 00:00:00' WHERE job_id = ?1",
            params![job_id],
        )
        .unwrap();
        assert!(!is_match_stale(&conn, job_id).unwrap());

        // A requirement edit after the compute → stale again.
        conn.execute(
            "UPDATE job_requirements SET raw_text = 'Rust + SQL', updated_at = '2026-07-01 00:00:00' WHERE job_id = ?1",
            params![job_id],
        )
        .unwrap();
        assert!(
            is_match_stale(&conn, job_id).unwrap(),
            "requirement changed after compute"
        );
    }
}
