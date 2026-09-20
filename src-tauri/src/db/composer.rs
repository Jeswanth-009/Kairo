//! Composer persistence + input assembly (Phase 6). Loads everything the pure
//! solver needs from Vault + match report, then stores the plan snapshot.

use super::vault::sql_err;
use crate::composer::{
    compose, ComposerBullet, ComposerConfig, ComposerEducation, ComposerEntity, ComposerInput,
    ComposerProfile, ResumePlan,
};
use rusqlite::{params, Connection};
use serde::Serialize;
use std::collections::HashMap;

pub fn load_composer_input(
    conn: &Connection,
    job_id: i64,
    config: &ComposerConfig,
) -> Result<ComposerInput, String> {
    let profile = super::vault::get_profile(conn)?.map(|p| ComposerProfile {
        full_name: p.full_name,
        headline: p.headline,
        email: p.email,
        phone: p.phone,
        location: p.location,
        website: p.website,
        github: p.github,
        linkedin: p.linkedin,
    });

    let education: Vec<ComposerEducation> = super::vault::vault_list::<super::vault::Education>(conn)?
        .into_iter()
        .map(|e| ComposerEducation {
            id: e.id,
            institution: e.institution,
            degree: e.degree,
            field_of_study: e.field_of_study,
            start_date: e.start_date,
            end_date: e.end_date,
            is_current: e.is_current,
        })
        .collect();

    // Relevance per (entity_type, id): from the stored match report, else 0
    // (the solver still ranks by evidence/skill tie-breakers).
    let mut relevance: HashMap<(String, i64), f64> = HashMap::new();
    if let Some(report) = super::matching::get_report(conn, job_id)? {
        for ranked in &report.entity_ranking {
            relevance.insert(
                (ranked.entity_type.clone(), ranked.id),
                ranked.relevance,
            );
        }
        let requirement_texts = report
            .results
            .iter()
            .map(|r| r.raw_text.clone())
            .collect::<Vec<_>>();
        let mut extra_warnings = Vec::new();
        let out = assemble(
            conn,
            job_id,
            &mut extra_warnings,
            profile,
            education,
            relevance,
            requirement_texts,
            config,
        );
        return out.map(|mut input| {
            input.extra_warnings = extra_warnings;
            input
        });
    }

    let mut extra_warnings = Vec::new();
    let out = assemble(
        conn,
        job_id,
        &mut extra_warnings,
        profile,
        education,
        relevance,
        Vec::new(),
        config,
    );
    out.map(|mut input| {
        input.extra_warnings = extra_warnings;
        input
    })
}

/// Ensures the entity has usable bullets: if none exist, canonical bullets are
/// split out of the record description (trusted — Vault-authored content).
/// Bullet creation failures are collected as warnings rather than swallowed,
/// and unapproved bullets are left unapproved (the trust model governs them;
/// the composer only excludes them, with a warning).
fn ensure_entity_bullets(
    conn: &Connection,
    entity_type: &str,
    entity_id: i64,
    description: &str,
    warnings: &mut Vec<String>,
) -> Result<Vec<ComposerBullet>, String> {
    let mut bullets = super::trust::list_bullets(conn, entity_type, entity_id)?;
    if bullets.is_empty() && !description.trim().is_empty() {
        let mut raw_lines = Vec::new();
        for line in description.lines() {
            if line.contains('•') {
                for part in line.split('•') {
                    raw_lines.push(part.trim().to_string());
                }
            } else if line.contains(" - ") {
                for part in line.split(" - ") {
                    raw_lines.push(part.trim().to_string());
                }
            } else {
                raw_lines.push(line.trim().to_string());
            }
        }
        let lines: Vec<String> = raw_lines
            .into_iter()
            .map(|l| l.trim_start_matches(['•', '-', '*', '▪', '·']).trim().to_string())
            .filter(|l| l.chars().count() > 5)
            .collect();
        for (i, line) in lines.into_iter().enumerate() {
            let cb = super::trust::CanonicalBullet {
                id: 0,
                entity_type: entity_type.to_string(),
                entity_id,
                text: line,
                approved: true,
                sort_order: (i + 1) as i64,
                evidence: Vec::new(),
                evidence_ids: Vec::new(),
            };
            if let Err(e) = super::trust::create_bullet(conn, &cb) {
                warnings.push(format!("Could not create a bullet on “{entity_type} #{entity_id}”: {e}"));
            }
        }
        bullets = super::trust::list_bullets(conn, entity_type, entity_id)?;
    }

    Ok(bullets
        .into_iter()
        .map(|b| ComposerBullet {
            id: b.id,
            text: b.text,
            approved: b.approved,
        })
        .collect())
}

fn assemble(
    conn: &Connection,
    job_id: i64,
    extra_warnings: &mut Vec<String>,
    profile: Option<ComposerProfile>,
    education: Vec<ComposerEducation>,
    relevance: HashMap<(String, i64), f64>,
    requirement_texts: Vec<String>,
    config: &ComposerConfig,
) -> Result<ComposerInput, String> {
    let _ = job_id;
    let mut entities: Vec<ComposerEntity> = Vec::new();

    for project in super::vault::vault_list::<super::vault::Project>(conn)? {
        let bullets = ensure_entity_bullets(conn, "project", project.id, &project.description, extra_warnings)?;
        entities.push(ComposerEntity {
            entity_type: "project".to_string(),
            id: project.id,
            title: project.title,
            subtitle: String::new(),
            description: project.description,
            start_date: project.start_date,
            end_date: project.end_date,
            is_current: project.is_current,
            skill_names: project.skills.iter().map(|r| r.canonical_name.clone()).collect(),
            evidence_count: project.evidence_count,
            bullets,
            relevance: relevance
                .get(&("project".to_string(), project.id))
                .copied()
                .unwrap_or(0.0),
        });
    }

    for experience in super::vault::vault_list::<super::vault::Experience>(conn)? {
        let bullets = ensure_entity_bullets(conn, "experience", experience.id, &experience.description, extra_warnings)?;
        entities.push(ComposerEntity {
            entity_type: "experience".to_string(),
            id: experience.id,
            title: format!("{} — {}", experience.organization, experience.role)
                .trim_end_matches(" —")
                .to_string(),
            subtitle: experience.location,
            description: experience.description,
            start_date: experience.start_date,
            end_date: experience.end_date,
            is_current: experience.is_current,
            skill_names: experience.skills.iter().map(|r| r.canonical_name.clone()).collect(),
            evidence_count: experience.evidence_count,
            bullets,
            relevance: relevance
                .get(&("experience".to_string(), experience.id))
                .copied()
                .unwrap_or(0.0),
        });
    }

    let achievements = super::vault::vault_list::<super::vault::Achievement>(conn)?
        .into_iter()
        .map(|a| crate::composer::ComposerAchievement {
            id: a.id,
            title: a.title,
            issuer: a.issuer,
            description: a.description,
            achieved_on: a.achieved_on,
        })
        .collect();

    let vault_skills: Vec<crate::composer::ComposerSkill> =
        super::vault::vault_list::<super::vault::Skill>(conn)?
            .into_iter()
            .map(|s| crate::composer::ComposerSkill {
                name: s.canonical_name.trim().to_string(),
                category: if s.category.is_empty() { "other".to_string() } else { s.category },
            })
            .filter(|s| !s.name.is_empty())
            .collect();

    Ok(ComposerInput {
        profile,
        education,
        entities,
        achievements,
        vault_skills,
        requirement_texts,
        config: config.clone(),
        extra_warnings: std::mem::take(extra_warnings),
    })
}

pub fn save_plan(
    conn: &Connection,
    job_id: i64,
    config: &ComposerConfig,
    plan: &ResumePlan,
) -> Result<(), String> {
    sql_err(conn.execute(
        "INSERT INTO resume_plans (job_id, config_json, plan_json, composer_version) \
         VALUES (?1, ?2, ?3, ?4) \
         ON CONFLICT(job_id) DO UPDATE SET \
           config_json = excluded.config_json, \
           plan_json = excluded.plan_json, \
           composer_version = excluded.composer_version, \
           updated_at = datetime('now')",
        params![
            job_id,
            serde_json::to_string(config).map_err(|e| e.to_string())?,
            serde_json::to_string(plan).map_err(|e| e.to_string())?,
            plan.composer_version
        ],
    ))?;
    Ok(())
}

#[derive(Debug, Clone, Serialize)]
pub struct StoredPlan {
    pub config: ComposerConfig,
    pub plan: ResumePlan,
}

pub fn get_plan(conn: &Connection, job_id: i64) -> Result<Option<StoredPlan>, String> {
    let mut stmt = sql_err(conn.prepare(
        "SELECT config_json, plan_json FROM resume_plans WHERE job_id = ?1",
    ))?;
    match stmt.query_row([job_id], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    }) {
        Ok((config_json, plan_json)) => {
            let config: ComposerConfig =
                serde_json::from_str(&config_json).map_err(|e| e.to_string())?;
            let plan: ResumePlan = serde_json::from_str(&plan_json).map_err(|e| e.to_string())?;
            Ok(Some(StoredPlan { config, plan }))
        }
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

/// Entry point used by the command: load → compose → persist.
pub fn run_composer(conn: &Connection, job_id: i64, config: &ComposerConfig) -> Result<ResumePlan, String> {
    let input = load_composer_input(conn, job_id, config)?;
    let plan = compose(&input);
    save_plan(conn, job_id, config, &plan)?;
    Ok(plan)
}
