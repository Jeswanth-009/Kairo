//! AI + tailoring command boundary (Phase 7).

use crate::ai::AiConfig;
use crate::db::{tailor, DbState};
use serde::Serialize;
use tauri::State;

const DB_LOCK: &str = "database lock poisoned";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MutationOk {
    pub ok: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiConfigView {
    pub base_url: String,
    pub model: String,
    pub has_api_key: bool,
}

#[tauri::command]
pub fn ai_get_config(state: State<'_, DbState>) -> Result<AiConfigView, String> {
    let conn = state.0.lock().map_err(|_| DB_LOCK)?;
    let (config, has_key) = tailor::get_ai_config(&conn)?;
    Ok(AiConfigView {
        base_url: config.base_url,
        model: config.model,
        has_api_key: has_key,
    })
}

#[tauri::command]
pub fn ai_save_config(
    state: State<'_, DbState>,
    base_url: String,
    model: String,
    api_key: Option<String>,
) -> Result<AiConfigView, String> {
    let conn = state.0.lock().map_err(|_| DB_LOCK)?;
    let config = AiConfig { base_url: base_url.trim().to_string(), model: model.trim().to_string() };
    tailor::save_ai_config(&conn, &config, api_key.as_deref())?;
    let (_, has_key) = tailor::get_ai_config(&conn)?;
    Ok(AiConfigView { base_url: config.base_url, model: config.model, has_api_key: has_key })
}

/// Blocking network call — async so it runs on the command pool, never the
/// main thread (a 240s timeout must never freeze the window).
#[tauri::command]
pub async fn ai_test_connection(state: State<'_, DbState>) -> Result<String, String> {
    // Gather config under the lock, then DROP it before the network call —
    // a 240s timeout must never freeze every other command.
    let (config, key) = {
        let conn = state.0.lock().map_err(|_| DB_LOCK)?;
        let (config, _) = tailor::get_ai_config(&conn)?;
        let key = crate::ai::load_api_key()?.unwrap_or_default();
        (config, key)
    };
    crate::ai::test_connection(&config, &key)
}

/// Lists models from the provider's OpenAI-compatible /models endpoint so
/// Settings can offer a picker (works with Ollama and LM Studio).
#[tauri::command]
pub async fn ai_list_models(state: State<'_, DbState>, base_url: String) -> Result<Vec<String>, String> {
    // Lock held only for the keyring read, not the network GET.
    let key = {
        let _conn = state.0.lock().map_err(|_| DB_LOCK)?;
        crate::ai::load_api_key()?.unwrap_or_default()
    };
    crate::ai::list_models(&base_url, &key)
}

/// Cooperative cancel flag for tailor runs — one user, one run at a time.
#[derive(Clone, Default)]
pub struct TailorCancel(pub std::sync::Arc<std::sync::atomic::AtomicBool>);

/// What one rewrite attempt produced before validation.
struct RewriteOutcome {
    output: Option<crate::tailor::RewriteOutput>,
    chat: crate::ai::ChatResult,
    parse_error: Option<String>,
}

/// One bounded LLM rewrite: plain decoding first (the fast path), then at most
/// one retry — JSON-mode when parsing failed on free-form output, or a 4×
/// token cap when the model hit the length limit mid-output.
fn bounded_rewrite(
    config: &crate::ai::AiConfig,
    key: &str,
    system: &str,
    user: &str,
    max_tokens: u32,
    timeout: std::time::Duration,
) -> RewriteOutcome {
    let mut opts = crate::ai::ChatOptions {
        max_tokens,
        timeout,
        force_json_mode: false,
    };
    let mut chat = match crate::ai::chat(config, key, system, user, &opts) {
        Ok(c) => c,
        Err(e) => {
            return RewriteOutcome {
                output: None,
                parse_error: Some(e),
                chat: crate::ai::ChatResult {
                    content: String::new(),
                    finish_reason: None,
                    prompt_tokens: None,
                    completion_tokens: None,
                    duration_ms: 0,
                },
            }
        }
    };
    let empty_content = chat.content.trim().is_empty();
    let mut output = if empty_content {
        Err("the model returned no content — its reasoning consumed the token budget".to_string())
    } else {
        crate::tailor::parse_response(&chat.content).map_err(|e| e.to_string())
    };
    if output.is_err() {
        let truncated =
            chat.finish_reason.as_deref() == Some("length") || empty_content;
        if truncated {
            opts.max_tokens *= 4;
        } else {
            opts.force_json_mode = true;
        }
        match crate::ai::chat(config, key, system, user, &opts) {
            Ok(second) => {
                output = crate::tailor::parse_response(&second.content).map_err(|e| e.to_string());
                chat.duration_ms += second.duration_ms;
                chat.completion_tokens = second.completion_tokens.or(chat.completion_tokens);
                chat.content = second.content;
            }
            Err(e) => output = Err(e),
        }
    }
    match output {
        Ok(parsed) => RewriteOutcome {
            output: Some(parsed),
            parse_error: None,
            chat,
        },
        Err(parse_error) => RewriteOutcome {
            output: None,
            parse_error: Some(parse_error),
            chat,
        },
    }
}

fn log_tailor_call(event: &str, model: &str, chat: &crate::ai::ChatResult, extra: &[(&str, String)]) {
    let mut fields: Vec<(&str, String)> = vec![
        ("model", model.to_string()),
        (
            "chat_duration_ms",
            chat.duration_ms.to_string(),
        ),
        (
            "completion_tokens",
            chat.completion_tokens.map(|t| t.to_string()).unwrap_or_default(),
        ),
        (
            "finish_reason",
            chat.finish_reason.clone().unwrap_or_default(),
        ),
    ];
    fields.extend_from_slice(extra);
    crate::logging::log_event("info", event, &fields);
}

#[tauri::command]
pub async fn tailor_suggest(
    state: State<'_, DbState>,
    job_id: i64,
    bullet_id: i64,
) -> Result<tailor::TailorSuggestion, String> {
    let started = std::time::Instant::now();
    // Grounding under the lock (milliseconds), then the network without it.
    let (grounding, config, key) = {
        let conn = state.0.lock().map_err(|_| DB_LOCK)?;
        let (config, _) = tailor::get_ai_config(&conn)?;
        let key = crate::ai::load_api_key()?.unwrap_or_default();
        let grounding = tailor::assemble_grounding(&conn, job_id, bullet_id)?;
        (grounding, config, key)
    };
    let model = config.model.clone();

    let outcome = bounded_rewrite(
        &config,
        &key,
        crate::tailor::SYSTEM_PROMPT,
        &crate::tailor::build_user_prompt(&grounding.context),
        700,
        crate::ai::SINGLE_CALL_TIMEOUT,
    );
    log_tailor_call(
        "tailor_suggest",
        &model,
        &outcome.chat,
        &[("bullet_id", bullet_id.to_string())],
    );

    let output = match outcome.output {
        Some(output) => output,
        None => {
            return Err(outcome
                .parse_error
                .unwrap_or_else(|| "unknown tailor failure".to_string()))
        }
    };
    let validation = crate::tailor::validate(&grounding.context, &output);

    // Rejected rewrites are stored with their violations so the UI shows what
    // was wrong instead of a bare error — same contract the batch flow uses.
    let conn = state.0.lock().map_err(|_| DB_LOCK)?;
    let suggestion = tailor::insert_suggestion(
        &conn,
        job_id,
        bullet_id,
        &grounding.bullet_text,
        &output.text,
        &validation,
        &model,
    );
    crate::logging::log_event(
        "info",
        "tailor_suggest_done",
        &[
            ("job_id", job_id.to_string()),
            ("bullet_id", bullet_id.to_string()),
            ("duration_ms", started.elapsed().as_millis().to_string()),
            ("valid", validation.ok.to_string()),
        ],
    );
    suggestion
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TailorBatchReport {
    pub suggestions: Vec<tailor::TailorSuggestion>,
    pub model: String,
    /// true = one LLM call covered the plan; false = per-bullet fallback.
    pub batch_used: bool,
    pub cancelled: bool,
    pub duration_ms: u128,
    pub prompt_tokens: Option<u32>,
    pub completion_tokens: Option<u32>,
}

/// Tailors every planned bullet of a workspace. The default path is ONE LLM
/// call for the whole plan (per-item validation unchanged); when the provider
/// cannot produce a usable batch it falls back to per-bullet calls with
/// bounded parallelism. The no-fabrication gates are identical on every path.
#[tauri::command]
pub async fn tailor_plan_batch(
    state: State<'_, DbState>,
    cancel: State<'_, TailorCancel>,
    job_id: i64,
) -> Result<TailorBatchReport, String> {
    use std::sync::atomic::Ordering;
    let started = std::time::Instant::now();
    cancel.0.store(false, Ordering::Relaxed);

    // Phase 1 (lock): config, plan, and grounding for every bullet in one pass.
    let (config, key, groundings, role_line) = {
        let conn = state.0.lock().map_err(|_| DB_LOCK)?;
        let (config, _) = tailor::get_ai_config(&conn)?;
        let key = crate::ai::load_api_key()?.unwrap_or_default();
        let stored = crate::db::composer::get_plan(&conn, job_id)?
            .ok_or_else(|| "No plan for this workspace — compose one in the Plan tab first".to_string())?;
        let index = tailor::build_grounding_index(&conn, job_id)?;
        let groundings = index.for_plan(&stored.plan)?;
        if groundings.is_empty() {
            return Err("The plan has no approved bullets to tailor — approve some in the record inspector first".to_string());
        }
        (config, key, groundings, index.job_role_line.clone())
    };
    let model = config.model.clone();
    let expected_ids: Vec<i64> = groundings.iter().map(|g| g.bullet_id).collect();

    // Phase 2: one LLM call for the whole plan.
    let batch_items: Vec<crate::tailor::BatchItemInput> = groundings
        .iter()
        .map(|g| crate::tailor::BatchItemInput {
            bullet_id: g.bullet_id,
            bullet_text: g.bullet_text.clone(),
            evidence_notes: g.context.evidence_notes.clone(),
            target_requirements: g.context.target_requirements.clone(),
            allowed_fact_ids: g.context.allowed_fact_ids.clone(),
        })
        .collect();
    let mut forbidden_union: Vec<String> = Vec::new();
    for g in &groundings {
        for pattern in &g.context.forbidden_patterns {
            if !forbidden_union.contains(pattern) {
                forbidden_union.push(pattern.clone());
            }
        }
    }
    let prompt = crate::tailor::build_batch_user_prompt(&role_line, &forbidden_union, &batch_items);
    // Reasoning models spend budget before the JSON — per-bullet headroom
    // instead of the theoretical minimum, still bounded.
    let max_tokens = (500 * groundings.len() as u32 + 500).min(8192);

    if cancel.0.load(Ordering::Relaxed) {
        return Err("Tailoring cancelled".to_string());
    }
    let batch_chat = crate::ai::chat(
        &config,
        &key,
        crate::tailor::BATCH_SYSTEM_PROMPT,
        &prompt,
        &crate::ai::ChatOptions {
            max_tokens,
            timeout: crate::ai::BATCH_CALL_TIMEOUT,
            force_json_mode: false,
        },
    );

    let mut suggestions: Vec<tailor::TailorSuggestion> = Vec::new();
    let mut batch_used = false;
    let mut prompt_tokens = None;
    let mut completion_tokens = None;
    let mut cancelled = false;

    match batch_chat {
        Ok(chat) => {
            prompt_tokens = chat.prompt_tokens;
            completion_tokens = chat.completion_tokens;
            match crate::tailor::parse_batch_response(&chat.content, &expected_ids) {
                Ok(items) => {
                    batch_used = true;
                    let by_id: std::collections::HashMap<i64, &crate::tailor::BatchRewriteItem> =
                        items.iter().map(|i| (i.bullet_id, i)).collect();
                    let conn = state.0.lock().map_err(|_| DB_LOCK)?;
                    for grounding in &groundings {
                        let suggestion = match by_id.get(&grounding.bullet_id) {
                            Some(item) => {
                                let output = crate::tailor::RewriteOutput {
                                    text: item.text.clone(),
                                    facts_used: item.facts_used.clone(),
                                };
                                let validation =
                                    crate::tailor::validate(&grounding.context, &output);
                                tailor::insert_suggestion(
                                    &conn,
                                    job_id,
                                    grounding.bullet_id,
                                    &grounding.bullet_text,
                                    &output.text,
                                    &validation,
                                    &model,
                                )?
                            }
                            None => {
                                // The model skipped this bullet — record it so
                                // the UI shows an actionable gap, not silence.
                                let validation = crate::tailor::ValidationResult {
                                    ok: false,
                                    violations: vec![
                                        "the model returned no rewrite for this bullet".to_string(),
                                    ],
                                };
                                tailor::insert_suggestion(
                                    &conn,
                                    job_id,
                                    grounding.bullet_id,
                                    &grounding.bullet_text,
                                    "No rewrite returned — retry this bullet individually.",
                                    &validation,
                                    &model,
                                )?
                            }
                        };
                        suggestions.push(suggestion);
                    }
                }
                Err(e) => {
                    crate::logging::log_event(
                        "warn",
                        "tailor_batch_parse_failed",
                        &[("error", e.clone()), ("model", model.clone())],
                    );
                }
            }
        }
        Err(e) => {
            crate::logging::log_event(
                "warn",
                "tailor_batch_call_failed",
                &[("error", e.clone()), ("model", model.clone())],
            );
        }
    }

    // Phase 3 fallback: the batch could not carry the plan — per-bullet calls
    // with bounded parallelism (network only in threads; inserts after join).
    if !batch_used {
        if cancel.0.load(Ordering::Relaxed) {
            return Err("Tailoring cancelled".to_string());
        }
        let pending: Vec<&crate::db::tailor::BulletGrounding> = groundings.iter().collect();
        let next = std::sync::atomic::AtomicUsize::new(0);
        let worker_results: Vec<Vec<(i64, RewriteOutcome, crate::tailor::TailorContext)>> =
            std::thread::scope(|scope| {
                let handles: Vec<_> = (0..3)
                    .map(|_| {
                        scope.spawn(|| {
                            let mut out =
                                Vec::<(i64, RewriteOutcome, crate::tailor::TailorContext)>::new();
                            loop {
                                if cancel.0.load(Ordering::Relaxed) {
                                    break;
                                }
                                let i = next.fetch_add(1, Ordering::Relaxed);
                                if i >= pending.len() {
                                    break;
                                }
                                let grounding = pending[i];
                                let outcome = bounded_rewrite(
                                    &config,
                                    &key,
                                    crate::tailor::SYSTEM_PROMPT,
                                    &crate::tailor::build_user_prompt(&grounding.context),
                                    700,
                                    crate::ai::SINGLE_CALL_TIMEOUT,
                                );
                                out.push((grounding.bullet_id, outcome, grounding.context.clone()));
                            }
                            out
                        })
                    })
                    .collect();
                handles
                    .into_iter()
                    .map(|h| h.join().expect("tailor worker"))
                    .collect()
            });
        cancelled = cancel.0.load(Ordering::Relaxed);
        let conn = state.0.lock().map_err(|_| DB_LOCK)?;
        for outcomes in worker_results {
            for (bullet_id, outcome, context) in outcomes {
                let grounding_text = groundings
                    .iter()
                    .find(|g| g.bullet_id == bullet_id)
                    .map(|g| g.bullet_text.clone())
                    .unwrap_or_default();
                let suggestion = match outcome.output {
                    Some(output) => {
                        let validation = crate::tailor::validate(&context, &output);
                        tailor::insert_suggestion(
                            &conn,
                            job_id,
                            bullet_id,
                            &grounding_text,
                            &output.text,
                            &validation,
                            &model,
                        )?
                    }
                    None => {
                        let reason = outcome
                            .parse_error
                            .unwrap_or_else(|| "rewrite failed".to_string());
                        let validation = crate::tailor::ValidationResult {
                            ok: false,
                            violations: vec![reason],
                        };
                        tailor::insert_suggestion(
                            &conn,
                            job_id,
                            bullet_id,
                            &grounding_text,
                            "Rewrite failed — retry this bullet individually.",
                            &validation,
                            &model,
                        )?
                    }
                };
                suggestions.push(suggestion);
            }
        }
    }

    crate::logging::log_event(
        "info",
        "tailor_plan_batch",
        &[
            ("job_id", job_id.to_string()),
            ("bullets", groundings.len().to_string()),
            ("batch_used", batch_used.to_string()),
            ("cancelled", cancelled.to_string()),
            ("duration_ms", started.elapsed().as_millis().to_string()),
            ("model", model.clone()),
        ],
    );
    Ok(TailorBatchReport {
        suggestions,
        model,
        batch_used,
        cancelled,
        duration_ms: started.elapsed().as_millis(),
        prompt_tokens,
        completion_tokens,
    })
}

#[tauri::command]
pub fn tailor_cancel(cancel: State<'_, TailorCancel>) -> Result<MutationOk, String> {
    use std::sync::atomic::Ordering;
    cancel.0.store(true, Ordering::Relaxed);
    Ok(MutationOk { ok: true })
}

#[tauri::command]
pub fn tailor_list(
    state: State<'_, DbState>,
    job_id: i64,
) -> Result<Vec<tailor::TailorSuggestion>, String> {
    let conn = state.0.lock().map_err(|_| DB_LOCK)?;
    tailor::list_suggestions(&conn, job_id)
}

#[tauri::command]
pub fn tailor_set_status(
    state: State<'_, DbState>,
    id: i64,
    status: String,
    text: Option<String>,
) -> Result<tailor::TailorSuggestion, String> {
    let conn = state.0.lock().map_err(|_| DB_LOCK)?;
    tailor::set_suggestion_status(&conn, id, &status, text.as_deref())
}

#[tauri::command]
pub fn claim_changes(
    state: State<'_, DbState>,
    job_id: i64,
    bullet_id: i64,
    new_text: String,
) -> Result<crate::tailor::ValidationResult, String> {
    let conn = state.0.lock().map_err(|_| DB_LOCK)?;
    tailor::claim_change_report(&conn, job_id, bullet_id, &new_text)
}

#[tauri::command]
pub fn tailor_save_manual_edit(
    state: State<'_, DbState>,
    job_id: i64,
    bullet_id: i64,
    text: String,
) -> Result<tailor::TailorSuggestion, String> {
    let conn = state.0.lock().map_err(|_| DB_LOCK)?;
    tailor::save_manual_edit(&conn, job_id, bullet_id, &text)
}

#[tauri::command]
pub fn tailor_delete(state: State<'_, DbState>, id: i64) -> Result<MutationOk, String> {
    let conn = state.0.lock().map_err(|_| DB_LOCK)?;
    tailor::delete_suggestion(&conn, id)?;
    Ok(MutationOk { ok: true })
}
