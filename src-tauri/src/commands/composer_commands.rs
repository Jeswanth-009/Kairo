//! Composer command boundary (Phase 6).

use crate::composer::ComposerConfig;
use crate::db::{composer, DbState};
use serde::Serialize;
use tauri::State;

const DB_LOCK: &str = "database lock poisoned";

#[tauri::command]
pub fn run_composer(
    state: State<'_, DbState>,
    job_id: i64,
    config: Option<ComposerConfig>,
) -> Result<crate::composer::ResumePlan, String> {
    let conn = state.0.lock().map_err(|_| DB_LOCK)?;
    let config = config.unwrap_or_default();
    composer::run_composer(&conn, job_id, &config)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedPlan {
    pub ok: bool,
    /// Monotonic revision of the saved row — proof of which draft a PDF
    /// was compiled from.
    pub revision: i64,
}

#[tauri::command]
pub fn save_plan(
    state: State<'_, DbState>,
    job_id: i64,
    plan: crate::composer::ResumePlan,
) -> Result<SavedPlan, String> {
    let conn = state.0.lock().map_err(|_| DB_LOCK)?;
    let revision = composer::save_plan(&conn, job_id, &plan.config, &plan)?;
    Ok(SavedPlan { ok: true, revision })
}

#[tauri::command]
pub fn estimate_plan_lines(plan: crate::composer::ResumePlan) -> Result<u32, String> {
    Ok(crate::composer::estimate_plan_lines(&plan))
}

#[tauri::command]
pub fn get_plan(
    state: State<'_, DbState>,
    job_id: i64,
) -> Result<Option<composer::StoredPlan>, String> {
    let conn = state.0.lock().map_err(|_| DB_LOCK)?;
    composer::get_plan(&conn, job_id)
}
