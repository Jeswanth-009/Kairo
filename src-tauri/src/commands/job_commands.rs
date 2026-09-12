//! Job Workspace command boundary (Phase 4): job CRUD, requirement editing and
//! the pure JD extraction entry point.

use crate::db::{jobs, DbState};
use serde::Serialize;
use tauri::State;

const DB_LOCK: &str = "database lock poisoned";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MutationOk {
    pub ok: bool,
}

#[tauri::command]
pub fn list_jobs(state: State<'_, DbState>) -> Result<Vec<jobs::Job>, String> {
    let conn = state.0.lock().map_err(|_| DB_LOCK)?;
    crate::db::vault::vault_list::<jobs::Job>(&conn)
}

#[tauri::command]
pub fn get_job(state: State<'_, DbState>, id: i64) -> Result<jobs::Job, String> {
    let conn = state.0.lock().map_err(|_| DB_LOCK)?;
    jobs::get_job_enriched(&conn, id)
}

#[tauri::command]
pub fn update_job(state: State<'_, DbState>, job: jobs::Job) -> Result<jobs::Job, String> {
    let conn = state.0.lock().map_err(|_| DB_LOCK)?;
    jobs::update_job(&conn, &job)
}

#[tauri::command]
pub fn delete_job(state: State<'_, DbState>, id: i64) -> Result<MutationOk, String> {
    let conn = state.0.lock().map_err(|_| DB_LOCK)?;
    jobs::delete_job(&conn, id)?;
    Ok(MutationOk { ok: true })
}

#[tauri::command]
pub fn create_job_with_requirements(
    state: State<'_, DbState>,
    job: jobs::Job,
    requirements: Vec<jobs::JobRequirement>,
) -> Result<jobs::JobWithRequirements, String> {
    let conn = state.0.lock().map_err(|_| DB_LOCK)?;
    jobs::create_job_with_requirements(&conn, &job, &requirements)
}

#[tauri::command]
pub fn list_requirements(
    state: State<'_, DbState>,
    job_id: i64,
) -> Result<Vec<jobs::JobRequirement>, String> {
    let conn = state.0.lock().map_err(|_| DB_LOCK)?;
    jobs::list_requirements(&conn, job_id)
}

#[tauri::command]
pub fn add_requirement(
    state: State<'_, DbState>,
    requirement: jobs::JobRequirement,
) -> Result<jobs::JobRequirement, String> {
    let conn = state.0.lock().map_err(|_| DB_LOCK)?;
    jobs::add_requirement(&conn, &requirement)
}

#[tauri::command]
pub fn update_requirement(
    state: State<'_, DbState>,
    requirement: jobs::JobRequirement,
) -> Result<jobs::JobRequirement, String> {
    let conn = state.0.lock().map_err(|_| DB_LOCK)?;
    jobs::update_requirement(&conn, &requirement)
}

#[tauri::command]
pub fn delete_requirement(state: State<'_, DbState>, id: i64) -> Result<MutationOk, String> {
    let conn = state.0.lock().map_err(|_| DB_LOCK)?;
    jobs::delete_requirement(&conn, id)?;
    Ok(MutationOk { ok: true })
}

#[tauri::command]
pub fn parse_jd(
    _state: State<'_, DbState>,
    text: String,
) -> Result<crate::jd::JobExtraction, String> {
    Ok(crate::jd::parse_jd(&text))
}
