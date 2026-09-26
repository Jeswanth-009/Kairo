//! Composer command boundary (Phase 6).

use crate::composer::ComposerConfig;
use crate::db::{composer, vault::sql_err, DbState};
use rusqlite::params;
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
pub fn save_plan(
    state: State<'_, DbState>,
    job_id: i64,
    plan: crate::composer::ResumePlan,
) -> Result<MutationOk, String> {
    let conn = state.0.lock().map_err(|_| DB_LOCK)?;
    let plan_json = serde_json::to_string(&plan).map_err(|e| e.to_string())?;
    // The plan embeds its config (caps, template, paper); persist it as the
    // authoritative config mirror so Studio choices survive restarts.
    let config_json = serde_json::to_string(&plan.config).map_err(|e| e.to_string())?;
    sql_err(conn.execute(
        "INSERT INTO resume_plans (job_id, config_json, plan_json, composer_version)          VALUES (?1, ?2, ?3, ?4)          ON CONFLICT(job_id) DO UPDATE SET plan_json = excluded.plan_json,            config_json = excluded.config_json,            updated_at = datetime('now')",
        params![job_id, config_json, plan_json, plan.composer_version],
    ))?;
    Ok(MutationOk { ok: true })
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
