//! Matching persistence + input loading (Phase 5). Composes Vault, trust and
//! job data into the pure matcher's input, then persists the explainable rows
//! and the full report snapshot.

use super::vault::sql_err;
use crate::matching::{
    MatchEntity, MatchInput, MatchReport, MatchRequirement, MatchSkill, MATCHING_VERSION,
};
use rusqlite::{params, Connection};

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

    for project in super::vault::vault_list::<super::vault::Project>(conn)? {
        let bullets = super::trust::list_bullets(conn, "project", project.id)?
            .into_iter()
            .map(|b| b.text)
            .collect();
        entities.push(MatchEntity {
            entity_type: "project".to_string(),
            id: project.id,
            title: project.title,
            description: project.description,
            start_date: project.start_date,
            end_date: project.end_date,
            is_current: project.is_current,
            skills: project.skills.into_iter().map(|r| (r.skill_id, r.confidence)).collect(),
            evidence_count: project.evidence_count,
            bullets,
        });
    }

    for experience in super::vault::vault_list::<super::vault::Experience>(conn)? {
        let bullets = super::trust::list_bullets(conn, "experience", experience.id)?
            .into_iter()
            .map(|b| b.text)
            .collect();
        entities.push(MatchEntity {
            entity_type: "experience".to_string(),
            id: experience.id,
            title: format!("{} — {}", experience.organization, experience.role)
                .trim_end_matches(" —")
                .to_string(),
            description: experience.description,
            start_date: experience.start_date,
            end_date: experience.end_date,
            is_current: experience.is_current,
            skills: experience.skills.into_iter().map(|r| (r.skill_id, r.confidence)).collect(),
            evidence_count: experience.evidence_count,
            bullets,
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
    let mut stmt = sql_err(conn.prepare(
        "SELECT report_json FROM match_reports WHERE job_id = ?1",
    ))?;
    match stmt.query_row([job_id], |row| row.get::<_, String>(0)) {
        Ok(json) => serde_json::from_str(&json).map(Some).map_err(|e| e.to_string()),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}
