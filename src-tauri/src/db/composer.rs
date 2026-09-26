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

    let education: Vec<ComposerEducation> =
        super::vault::vault_list::<super::vault::Education>(conn)?
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
            relevance.insert((ranked.entity_type.clone(), ranked.id), ranked.relevance);
        }
        let requirement_texts = report
            .results
            .iter()
            .map(|r| r.raw_text.clone())
            .collect::<Vec<_>>();
        let mut extra_warnings = Vec::new();
        let out = assemble(
            conn,
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

/// Bullet-length limit: auto-split bullets longer than this are paragraphs.
const PARAGRAPH_BULLET_CHARS: usize = 320;

/// Long paragraph lines are split into sentence-packed bullets (verbatim
/// record content, so they remain approved). A single sentence that alone
/// exceeds `limit` is returned as-is and will stay unapproved.
fn expand_paragraphs(lines: Vec<String>) -> Vec<String> {
    let mut expanded = Vec::with_capacity(lines.len());
    for line in lines {
        if line.chars().count() <= PARAGRAPH_BULLET_CHARS {
            expanded.push(line);
            continue;
        }
        let mut buffer = String::new();
        for sentence in split_sentences(&line) {
            let count = sentence.chars().count();
            if count > PARAGRAPH_BULLET_CHARS {
                if !buffer.trim().is_empty() {
                    expanded.push(buffer.trim().to_string());
                    buffer.clear();
                }
                expanded.push(sentence);
                continue;
            }
            if !buffer.is_empty() && buffer.chars().count() + count + 1 > PARAGRAPH_BULLET_CHARS {
                expanded.push(buffer.trim().to_string());
                buffer.clear();
            }
            if !buffer.is_empty() {
                buffer.push(' ');
            }
            buffer.push_str(&sentence);
        }
        if !buffer.trim().is_empty() {
            expanded.push(buffer.trim().to_string());
        }
    }
    expanded
}

/// Splits on sentence terminators (`.!?`) followed by whitespace or
/// end-of-line, keeping the terminator attached. Char-boundary safe.
fn split_sentences(line: &str) -> Vec<String> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return Vec::new();
    }
    let mut sentences: Vec<String> = Vec::new();
    let mut start = 0usize;
    let mut iter = trimmed.char_indices().peekable();
    while let Some((idx, c)) = iter.next() {
        if c != '.' && c != '!' && c != '?' {
            continue;
        }
        let breaks = match iter.peek() {
            None => true,
            Some((_, next)) => matches!(*next, ' ' | '\t' | '\n' | '\r'),
        };
        if breaks {
            let end = idx + c.len_utf8();
            let sentence = trimmed[start..end].trim();
            if !sentence.is_empty() {
                sentences.push(sentence.to_string());
            }
            start = end;
        }
    }
    let tail = trimmed[start..].trim();
    if !tail.is_empty() {
        sentences.push(tail.to_string());
    }
    if sentences.is_empty() {
        sentences.push(trimmed.to_string());
    }
    sentences
}

/// Narrative-import descriptions summarize their source with "Key: value ·
/// Key: value" segments; those lines are record metadata, not resume bullets.
fn looks_like_narrative_meta_line(line: &str) -> bool {
    let parts: Vec<&str> = line.split(" · ").collect();
    if parts.len() < 2 {
        return false;
    }
    parts
        .iter()
        .filter(|p| match p.find(": ") {
            Some(i) => {
                i > 0 && i <= 28 && p[..i].chars().all(|c| c.is_ascii_alphabetic() || c == ' ')
            }
            None => false,
        })
        .count()
        >= 2
}

/// Ensures the entity has usable bullets: if none exist, canonical bullets are
/// split out of the record description (trusted — Vault-authored content).
/// Paragraph-length narrative lines and "Key: value" metadata summaries are
/// not resume bullets: metadata lines are skipped, paragraphs are created
/// unapproved so the trust model (not the importer) decides what surfaces.
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
        let mut paragraph_count = 0usize;
        let lines: Vec<String> = raw_lines
            .into_iter()
            .map(|l| {
                l.trim_start_matches(['•', '-', '*', '▪', '·'])
                    .trim()
                    .to_string()
            })
            .filter(|l| l.chars().count() > 5)
            .filter(|l| !looks_like_narrative_meta_line(l))
            .collect();
        // Paragraph-style descriptions (the common import shape) used to fall
        // through as one over-length unapproved bullet each, starving the
        // plan. Split them into sentence-packed bullets — still verbatim
        // record content, so they stay approved; only a single sentence that
        // alone exceeds the limit remains unapproved for review.
        for (i, line) in expand_paragraphs(lines).into_iter().enumerate() {
            let is_paragraph = line.chars().count() > PARAGRAPH_BULLET_CHARS;
            if is_paragraph {
                paragraph_count += 1;
            }
            let cb = super::trust::CanonicalBullet {
                id: 0,
                entity_type: entity_type.to_string(),
                entity_id,
                text: line,
                approved: !is_paragraph,
                sort_order: (i + 1) as i64,
                evidence: Vec::new(),
                evidence_ids: Vec::new(),
            };
            if let Err(e) = super::trust::create_bullet(conn, &cb) {
                warnings.push(format!(
                    "Could not create a bullet on “{entity_type} #{entity_id}”: {e}"
                ));
            }
        }
        if paragraph_count > 0 {
            warnings.push(format!(
                "{paragraph_count} auto-generated bullet(s) exceeded {PARAGRAPH_BULLET_CHARS} characters and were left unapproved — review them in the record inspector."
            ));
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
    extra_warnings: &mut Vec<String>,
    profile: Option<ComposerProfile>,
    education: Vec<ComposerEducation>,
    relevance: HashMap<(String, i64), f64>,
    requirement_texts: Vec<String>,
    config: &ComposerConfig,
) -> Result<ComposerInput, String> {
    let mut entities: Vec<ComposerEntity> = Vec::new();

    for project in super::vault::vault_list::<super::vault::Project>(conn)? {
        let bullets = ensure_entity_bullets(
            conn,
            "project",
            project.id,
            &project.description,
            extra_warnings,
        )?;
        entities.push(ComposerEntity {
            entity_type: "project".to_string(),
            id: project.id,
            title: project.title,
            subtitle: String::new(),
            description: project.description,
            start_date: project.start_date,
            end_date: project.end_date,
            is_current: project.is_current,
            skill_names: project
                .skills
                .iter()
                .map(|r| r.canonical_name.clone())
                .collect(),
            evidence_count: project.evidence_count,
            bullets,
            relevance: relevance
                .get(&("project".to_string(), project.id))
                .copied()
                .unwrap_or(0.0),
        });
    }

    for experience in super::vault::vault_list::<super::vault::Experience>(conn)? {
        let bullets = ensure_entity_bullets(
            conn,
            "experience",
            experience.id,
            &experience.description,
            extra_warnings,
        )?;
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
            skill_names: experience
                .skills
                .iter()
                .map(|r| r.canonical_name.clone())
                .collect(),
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
                category: if s.category.is_empty() {
                    "other".to_string()
                } else {
                    s.category
                },
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
    let mut stmt =
        sql_err(conn.prepare("SELECT config_json, plan_json FROM resume_plans WHERE job_id = ?1"))?;
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
pub fn run_composer(
    conn: &Connection,
    job_id: i64,
    config: &ComposerConfig,
) -> Result<ResumePlan, String> {
    let input = load_composer_input(conn, job_id, config)?;
    let plan = compose(&input);
    save_plan(conn, job_id, config, &plan)?;
    Ok(plan)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn long_paragraphs_pack_into_approved_sentence_bullets() {
        let s1 = "Built the ingestion service and scaled it to two million events per day while keeping p99 latency under eighty milliseconds for all consumers.";
        let s2 = "Migrated the storage layer to PostgreSQL declarative partitioning and cut query times on the largest tables by an order of magnitude in production.";
        let s3 = "Led the migration of the deployment pipeline to Kubernetes with canary releases and zero downtime across every service rollout this year.";
        let paragraph = format!("{s1} {s2} {s3}");

        let expanded = expand_paragraphs(vec![paragraph]);
        assert_eq!(expanded.len(), 2, "got {expanded:?}");
        for bullet in &expanded {
            assert!(
                bullet.chars().count() <= PARAGRAPH_BULLET_CHARS,
                "too long: {bullet}"
            );
        }
        assert!(expanded[0].starts_with("Built the ingestion"));
        assert!(expanded.iter().any(|b| b.contains("zero downtime")));
    }

    #[test]
    fn pathological_single_sentences_stay_unapproved_length() {
        let long_sentence = format!("{}.", "word ".repeat(120));
        let expanded = expand_paragraphs(vec![long_sentence]);
        assert_eq!(expanded.len(), 1);
        assert!(expanded[0].chars().count() > PARAGRAPH_BULLET_CHARS);
    }

    #[test]
    fn short_lines_pass_through_unsplit() {
        let lines = vec!["Short line one".to_string(), "Short line two".to_string()];
        assert_eq!(expand_paragraphs(lines.clone()), lines);
    }

    #[test]
    fn split_sentences_keeps_terminators_attached() {
        let s = split_sentences("First sentence. Second one! Third? tail without dot");
        assert_eq!(
            s,
            vec![
                "First sentence.",
                "Second one!",
                "Third?",
                "tail without dot"
            ]
        );
        assert!(split_sentences("   ").is_empty());
        assert_eq!(
            split_sentences("No terminator here"),
            vec!["No terminator here"]
        );
    }
}
