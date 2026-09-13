//! Composer command boundary (Phase 6).

use crate::composer::ComposerConfig;
use crate::db::{composer, DbState};
use serde::Serialize;
use tauri::State;

const DB_LOCK: &str = "database lock poisoned";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MutationOk {
    pub ok: bool,
}

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

#[tauri::command]
pub fn get_plan(
    state: State<'_, DbState>,
    job_id: i64,
) -> Result<Option<composer::StoredPlan>, String> {
    let conn = state.0.lock().map_err(|_| DB_LOCK)?;
    composer::get_plan(&conn, job_id)
}
