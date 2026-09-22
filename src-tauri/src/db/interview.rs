//! Interview prep input assembly (Phase 12). Loads the exact JD, reviewed
//! requirements, match coverage and submitted plan, then hands them to the
//! pure generator.

use crate::interview::{generate, PrepEntity, PrepRequirement};
use rusqlite::Connection;

pub fn generate_for_job(conn: &Connection, job_id: i64) -> Result<InterviewPrep, String> {
    let job = super::jobs::get_job_enriched(conn, job_id)?;
    let requirements = super::jobs::list_requirements(conn, job_id)?;

    // Coverage per requirement from the stored match report (if any).
    let report = super::matching::get_report(conn, job_id)?;
    let coverage_by_id: std::collections::HashMap<i64, String> = report
        .as_ref()
        .map(|r| {
            r.results
                .iter()
                .map(|res| (res.requirement_id, res.coverage.as_str().to_string()))
                .collect()
        })
        .unwrap_or_default();

    let prep_requirements: Vec<PrepRequirement> = requirements
        .iter()
        .map(|r| PrepRequirement {
            id: r.id,
            kind: r.kind.clone(),
            raw_text: r.raw_text.clone(),
            coverage: coverage_by_id
                .get(&r.id)
                .cloned()
                .unwrap_or_else(|| "unmatched".to_string()),
        })
        .collect();

    let plan_owned = super::composer::get_plan(conn, job_id)?.map(|stored| stored.plan);
    let plan_ref = plan_owned.as_ref();

    let mut entities: Vec<PrepEntity> = Vec::new();
    for project in super::vault::vault_list::<super::vault::Project>(conn)? {
        let bullets = super::trust::list_bullets(conn, "project", project.id)?;
        let evidence = super::trust::list_evidence(conn, "project", project.id)?;
        entities.push(PrepEntity {
            entity_type: "project".to_string(),
            id: project.id,
            title: project.title,
            bullet_texts: bullets.iter().map(|b| effective_text(&b.text, plan_ref, b.id)).collect(),
            skill_names: project.skills.iter().map(|r| r.canonical_name.clone()).collect(),
            evidence_count: evidence.len() as i64,
            evidence_titles: evidence.iter().map(|e| e.title.clone()).collect(),
            relevance: relevance_of(&report, "project", project.id),
        });
    }
    for experience in super::vault::vault_list::<super::vault::Experience>(conn)? {
        let bullets = super::trust::list_bullets(conn, "experience", experience.id)?;
        let evidence = super::trust::list_evidence(conn, "experience", experience.id)?;
        let title = format!("{} {} {}", experience.organization, char_emdash(), experience.role)
            .trim_end_matches(char_emdash())
            .trim()
            .to_string();
        entities.push(PrepEntity {
            entity_type: "experience".to_string(),
            id: experience.id,
            title,
            bullet_texts: bullets.iter().map(|b| effective_text(&b.text, plan_ref, b.id)).collect(),
            skill_names: experience.skills.iter().map(|r| r.canonical_name.clone()).collect(),
            evidence_count: evidence.len() as i64,
            evidence_titles: evidence.iter().map(|e| e.title.clone()).collect(),
            relevance: relevance_of(&report, "experience", experience.id),
        });
    }

    let raw_jd_chars = job.raw_jd.chars().count();
    let label = if job.company.is_empty() {
        job.role_title.clone()
    } else {
        format!("{} {} {}", job.role_title, char_emdash(), job.company)
    };
    Ok(generate(&label, raw_jd_chars, &prep_requirements, &entities))
}

pub use crate::interview::InterviewPrep;

fn char_emdash() -> char {
    '\u{2014}'
}

/// Effective text: accepted tailored wording if present, else canonical.
fn effective_text(canonical: &str, plan: Option<&crate::composer::ResumePlan>, bullet_id: i64) -> String {
    if let Some(plan) = plan {
        for item in plan.experience.iter().chain(plan.projects.iter()) {
            for b in &item.bullets {
                if b.id == bullet_id {
                    return b.text.clone();
                }
            }
        }
    }
    canonical.to_string()
}

fn relevance_of(
    report: &Option<crate::matching::MatchReport>,
    entity_type: &str,
    id: i64,
) -> f64 {
    report
        .as_ref()
        .and_then(|r| {
            r.entity_ranking
                .iter()
                .find(|e| e.entity_type == entity_type && e.id == id)
                .map(|e| e.relevance)
        })
        .unwrap_or(0.0)
}
