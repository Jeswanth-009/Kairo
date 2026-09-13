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

#[tauri::command]
pub fn ai_test_connection(state: State<'_, DbState>) -> Result<String, String> {
    let conn = state.0.lock().map_err(|_| DB_LOCK)?;
    let (config, _) = tailor::get_ai_config(&conn)?;
    let key = crate::ai::load_api_key()?.unwrap_or_default();
    crate::ai::test_connection(&config, &key)
}

#[tauri::command]
pub fn tailor_suggest(
    state: State<'_, DbState>,
    job_id: i64,
    bullet_id: i64,
) -> Result<tailor::TailorSuggestion, String> {
    // Gather grounding while holding the DB lock, then DROP the lock before the
    // network call — a 60s HTTP request must never freeze the rest of the app.
    let (grounding, config, key) = {
        let conn = state.0.lock().map_err(|_| DB_LOCK)?;
        let grounding = tailor::assemble_grounding(&conn, job_id, bullet_id)?;
        let (config, _) = tailor::get_ai_config(&conn)?;
        let key = crate::ai::load_api_key()?.unwrap_or_default();
        (grounding, config, key)
    };

    let raw = crate::ai::chat(
        &config,
        &key,
        crate::tailor::SYSTEM_PROMPT,
        &crate::tailor::build_user_prompt(&grounding.context),
    )?;
    let output = crate::tailor::check(&raw, &grounding.context)?;
    let validation = crate::tailor::validate(&grounding.context, &output);

    let conn = state.0.lock().map_err(|_| DB_LOCK)?;
    tailor::insert_suggestion(
        &conn,
        job_id,
        bullet_id,
        &grounding.bullet_text,
        &output.text,
        &validation,
        &config.model,
    )
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
pub fn tailor_delete(state: State<'_, DbState>, id: i64) -> Result<MutationOk, String> {
    let conn = state.0.lock().map_err(|_| DB_LOCK)?;
    tailor::delete_suggestion(&conn, id)?;
    Ok(MutationOk { ok: true })
}
