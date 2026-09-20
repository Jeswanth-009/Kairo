//! Tailor persistence + grounding assembly (Phase 7).

use super::vault::sql_err;
use crate::ai::AiConfig;
use crate::tailor::{TailorContext, PROMPT_VERSION};
use rusqlite::{params, Connection};

// ---------------------------------------------------------------------------
// AI provider config (meta table; key lives in the OS credential store)
// ---------------------------------------------------------------------------

pub fn get_ai_config(conn: &Connection) -> Result<(AiConfig, bool), String> {
    let config_json: Option<String> = {
        let mut stmt = sql_err(conn.prepare(
            "SELECT value FROM meta WHERE key = 'ai_config'",
        ))?;
        let row = stmt.query_row([], |r| r.get(0));
        match row {
            Ok(v) => Some(v),
            Err(rusqlite::Error::QueryReturnedNoRows) => None,
            Err(e) => return Err(e.to_string()),
        }
    };
    let config = match config_json {
        Some(json) => match serde_json::from_str(&json) {
            Ok(config) => config,
            Err(e) => {
                // Never silently fall back to the OpenAI default: the stored
                // key would then be used against a paid endpoint the user
                // never chose.
                crate::logging::log_event(
                    "warn",
                    "ai_config_corrupt",
                    &[("error", e.to_string())],
                );
                return Err("Stored AI provider config is corrupt — re-enter it in Settings.".to_string());
            }
        },
        None => AiConfig::default(),
    };
    let has_key = crate::ai::load_api_key()?.is_some();
    Ok((config, has_key))
}

pub fn save_ai_config(conn: &Connection, config: &AiConfig, api_key: Option<&str>) -> Result<(), String> {
    if let Some(key) = api_key {
        if key.trim().is_empty() {
            // Explicitly blanked out in the UI — clear the stored credential
            // so local providers (Ollama, LM Studio) run without auth.
            crate::ai::delete_api_key()?;
        } else {
            crate::ai::store_api_key(key.trim())?;
        }
    }
    sql_err(conn.execute(
        "INSERT INTO meta (key, value) VALUES ('ai_config', ?1) \
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [serde_json::to_string(config).map_err(|e| e.to_string())?],
    ))?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Suggestions
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TailorSuggestion {
    pub id: i64,
    pub job_id: i64,
    pub bullet_id: i64,
    pub original_text: String,
    pub suggested_text: String,
    pub status: String,
    pub validation: crate::tailor::ValidationResult,
    pub model: String,
}

fn suggestion_from_row(row: &rusqlite::Row) -> rusqlite::Result<(i64, TailorSuggestion)> {
    let id: i64 = row.get(0)?;
    Ok((
        id,
        TailorSuggestion {
            id,
            job_id: row.get(1)?,
            bullet_id: row.get(2)?,
            original_text: row.get(3)?,
            suggested_text: row.get(4)?,
            status: row.get(5)?,
            validation: {
                let json: String = row.get(6)?;
                serde_json::from_str(&json).unwrap_or(crate::tailor::ValidationResult {
                    ok: false,
                    violations: vec![],
                })
            },
            model: row.get(7)?,
        },
    ))
}

const SUGGESTION_COLS: &str =
    "id, job_id, bullet_id, original_text, suggested_text, status, validation, model";

pub fn insert_suggestion(
    conn: &Connection,
    job_id: i64,
    bullet_id: i64,
    original_text: &str,
    suggested_text: &str,
    validation: &crate::tailor::ValidationResult,
    model: &str,
) -> Result<TailorSuggestion, String> {
    sql_err(conn.execute(
        "INSERT INTO tailor_suggestions (job_id, bullet_id, original_text, suggested_text, status, validation, model) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            job_id,
            bullet_id,
            original_text,
            suggested_text,
            if validation.ok { "pending" } else { "rejected" },
            serde_json::to_string(validation).map_err(|e| e.to_string())?,
            model,
        ],
    ))?;
    let id = conn.last_insert_rowid();
    let mut stmt = sql_err(conn.prepare(&format!(
        "SELECT {SUGGESTION_COLS} FROM tailor_suggestions WHERE id = ?1"
    )))?;
    let (_, suggestion) = sql_err(stmt.query_row([id], suggestion_from_row))?;
    Ok(suggestion)
}

pub fn list_suggestions(conn: &Connection, job_id: i64) -> Result<Vec<TailorSuggestion>, String> {
    let mut stmt = sql_err(conn.prepare(&format!(
        "SELECT {SUGGESTION_COLS} FROM tailor_suggestions WHERE job_id = ?1 ORDER BY id DESC"
    )))?;
    let mapped = sql_err(stmt.query_map([job_id], |row| suggestion_from_row(row).map(|(_, s)| s)))?;
    sql_err(mapped.collect::<rusqlite::Result<Vec<_>>>())
}

/// Overlays accepted tailor suggestions onto the plan's bullets so the
/// exported PDF matches what the Studio preview shows. Bullets are matched
/// by canonical bullet id; the accepted (possibly manually edited) text wins.
pub fn apply_accepted_suggestions(
    conn: &Connection,
    job_id: i64,
    plan: &mut crate::composer::ResumePlan,
) -> Result<usize, String> {
    let accepted: Vec<TailorSuggestion> = list_suggestions(conn, job_id)?
        .into_iter()
        .filter(|s| s.status == "accepted" && !s.suggested_text.trim().is_empty())
        .collect();
    if accepted.is_empty() {
        return Ok(0);
    }
    let mut applied = 0;
    for item in plan.experience.iter_mut().chain(plan.projects.iter_mut()) {
        for bullet in item.bullets.iter_mut() {
            if let Some(s) = accepted.iter().find(|s| s.bullet_id == bullet.id) {
                bullet.text = s.suggested_text.clone();
                applied += 1;
            }
        }
    }
    Ok(applied)
}

pub fn set_suggestion_status(
    conn: &Connection,
    id: i64,
    status: &str,
    text: Option<&str>,
) -> Result<TailorSuggestion, String> {
    if !matches!(status, "accepted" | "rejected") {
        return Err("status must be accepted or rejected".to_string());
    }
    let affected = match text {
        Some(t) => sql_err(conn.execute(
            "UPDATE tailor_suggestions SET status = ?1, suggested_text = ?2, updated_at = datetime('now') WHERE id = ?3",
            params![status, t, id],
        ))?,
        None => sql_err(conn.execute(
            "UPDATE tailor_suggestions SET status = ?1, updated_at = datetime('now') WHERE id = ?2",
            params![status, id],
        ))?,
    };
    if affected == 0 {
        return Err("Suggestion not found".to_string());
    }
    let mut stmt = sql_err(conn.prepare(&format!(
        "SELECT {SUGGESTION_COLS} FROM tailor_suggestions WHERE id = ?1"
    )))?;
    let (_, suggestion) = sql_err(stmt.query_row([id], suggestion_from_row))?;
    Ok(suggestion)
}

/// Deletes a pending suggestion ("reset" in the UI).
pub fn delete_suggestion(conn: &Connection, id: i64) -> Result<(), String> {
    sql_err(conn.execute("DELETE FROM tailor_suggestions WHERE id = ?1", [id]))?;
    Ok(())
}

/// Detected claim changes for a proposed wording of an existing bullet
/// (used by the Resume Studio editor on manual edits). Manual edits inherit
/// the record's evidence, so only metric/tech/forbidden diffs are reported.
pub fn claim_change_report(
    conn: &Connection,
    job_id: i64,
    bullet_id: i64,
    new_text: &str,
) -> Result<crate::tailor::ValidationResult, String> {
    let grounding = assemble_grounding(conn, job_id, bullet_id)?;
    let output = crate::tailor::RewriteOutput {
        text: new_text.to_string(),
        facts_used: grounding.context.allowed_fact_ids.clone(),
    };
    Ok(crate::tailor::validate(&grounding.context, &output))
}

/// Saves a manual studio edit as the accepted wording for a bullet
/// (model = "manual"). Any previously accepted suggestion for the bullet
/// is replaced.
pub fn save_manual_edit(
    conn: &Connection,
    job_id: i64,
    bullet_id: i64,
    text: &str,
) -> Result<TailorSuggestion, String> {
    let grounding = assemble_grounding(conn, job_id, bullet_id)?;
    let report = claim_change_report(conn, job_id, bullet_id, text)?;
    // Replace-then-insert atomically — a failed insert must not lose the
    // previously accepted wording.
    let tx = sql_err(conn.unchecked_transaction())?;
    sql_err(tx.execute(
        "DELETE FROM tailor_suggestions WHERE job_id = ?1 AND bullet_id = ?2 AND status = 'accepted'",
        params![job_id, bullet_id],
    ))?;
    sql_err(tx.execute(
        "INSERT INTO tailor_suggestions (job_id, bullet_id, original_text, suggested_text, status, validation, model)          VALUES (?1, ?2, ?3, ?4, 'accepted', ?5, 'manual')",
        params![
            job_id,
            bullet_id,
            grounding.bullet_text,
            text,
            serde_json::to_string(&report).map_err(|e| e.to_string())?
        ],
    ))?;
    tx.commit().map_err(|e| e.to_string())?;
    let id = conn.last_insert_rowid();
    let mut stmt = sql_err(conn.prepare(&format!(
        "SELECT {SUGGESTION_COLS} FROM tailor_suggestions WHERE id = ?1"
    )))?;
    let (_, suggestion) = sql_err(stmt.query_row([id], suggestion_from_row))?;
    Ok(suggestion)
}

// ---------------------------------------------------------------------------
// Grounding assembly: everything the prompt needs for one bullet
// ---------------------------------------------------------------------------

pub struct BulletGrounding {
    pub bullet_id: i64,
    pub entity_type: String,
    pub entity_id: i64,
    pub bullet_text: String,
    pub context: TailorContext,
}

pub fn assemble_grounding(
    conn: &Connection,
    job_id: i64,
    bullet_id: i64,
) -> Result<BulletGrounding, String> {
    // Locate the bullet across projects and experiences.
    let mut found: Option<(String, i64, String, String, Vec<String>)> = None;
    for project in super::vault::vault_list::<super::vault::Project>(conn)? {
        for bullet in super::trust::list_bullets(conn, "project", project.id)? {
            if bullet.id == bullet_id {
                let skills = project.skills.iter().map(|s| s.canonical_name.clone()).collect();
                found = Some(("project".to_string(), project.id, bullet.text, project.title.clone(), skills));
            }
        }
        if found.is_some() {
            break;
        }
    }
    if found.is_none() {
        for experience in super::vault::vault_list::<super::vault::Experience>(conn)? {
            for bullet in super::trust::list_bullets(conn, "experience", experience.id)? {
                if bullet.id == bullet_id {
                    let skills = experience.skills.iter().map(|s| s.canonical_name.clone()).collect();
                    found = Some(("experience".to_string(), experience.id, bullet.text, format!("{} at {}", experience.role, experience.organization), skills));
                }
                if found.is_some() {
                    break;
                }
            }
            if found.is_some() {
                break;
            }
        }
    }
    let (entity_type, entity_id, bullet_text, entity_title, entity_skills) =
        found.ok_or_else(|| "Bullet not found in the Vault".to_string())?;

    let mut evidence_notes: Vec<String> =
        super::trust::list_evidence(conn, &entity_type, entity_id)?
            .into_iter()
            .map(|e| {
                if e.note.is_empty() {
                    format!("{}: {}", e.kind, e.title)
                } else {
                    format!("{}: {} — {}", e.kind, e.title, e.note)
                }
            })
            .collect();

    if evidence_notes.is_empty() {
        evidence_notes.push(format!("Record context: {}", entity_title));
        if !entity_skills.is_empty() {
            evidence_notes.push(format!("Verified technologies for this record: {}", entity_skills.join(", ")));
        }
    }

    let allowed_fact_ids: Vec<i64> =
        super::trust::list_evidence(conn, &entity_type, entity_id)?
            .into_iter()
            .map(|e| e.id)
            .collect();

    let claim_rules = super::trust::list_claim_rules(conn, Some(&entity_type), Some(entity_id))?;
    let forbidden_patterns: Vec<String> = claim_rules
        .iter()
        .filter(|r| r.rule_type == "forbidden_claim")
        .map(|r| r.pattern.clone())
        .collect();

    let skill_vocabulary: Vec<String> = super::vault::vault_list::<super::vault::Skill>(conn)?
        .into_iter()
        .flat_map(|s| {
            let mut names = vec![s.canonical_name.clone()];
            names.extend(s.aliases.into_iter().map(|a| a.alias));
            names
        })
        .collect();

    // Target requirements: the ones this bullet supports per the composer's
    // overlap heuristic, falling back to the job's most relevant requirements.
    let requirement_texts: Vec<String> = {
        let job = super::jobs::get_job_enriched(conn, job_id)?;
        let requirements = super::jobs::list_requirements(conn, job_id)?;
        
        let all_req_texts: Vec<String> = requirements.iter().map(|r| r.raw_text.clone()).collect();
        let mut supported = crate::composer::bullet_supports(&bullet_text, &all_req_texts);
        
        if supported.is_empty() {
            // Rank requirements by token overlap against bullet_text, take top 2
            let mut scored: Vec<(String, usize)> = requirements
                .iter()
                .map(|r| {
                    let text = r.raw_text.clone();
                    let hits = crate::composer::bullet_overlap_count(&bullet_text, &text);
                    (text, hits)
                })
                .collect();
            scored.sort_by(|a, b| b.1.cmp(&a.1));
            supported = scored
                .into_iter()
                .filter(|(_, hits)| *hits > 0)
                .take(2)
                .map(|(text, _)| text)
                .collect();
        }

        if supported.is_empty() {
            supported = requirements
                .iter()
                .filter(|r| r.kind == "required_skill")
                .take(2)
                .map(|r| r.raw_text.clone())
                .collect();
        }

        supported
            .into_iter()
            .chain(std::iter::once(format!(
                "(role: {} at {}; seniority: {})",
                job.role_title, job.company, job.seniority
            )))
            .collect()
    };

    Ok(BulletGrounding {
        bullet_id,
        entity_type: entity_type.clone(),
        entity_id,
        bullet_text: bullet_text.clone(),
        context: TailorContext {
            bullet_text,
            target_requirements: requirement_texts,
            evidence_notes,
            forbidden_patterns,
            allowed_fact_ids,
            skill_vocabulary,
        },
    })
}

pub const PROMPT_VERSION_CONST: u32 = PROMPT_VERSION;
