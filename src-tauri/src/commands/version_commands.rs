//! Version command boundary (Phase 10).

use crate::db::{versions, DbState};
use tauri::State;

const DB_LOCK: &str = "database lock poisoned";

#[tauri::command]
pub fn save_resume_version(
    state: State<'_, DbState>,
    job_id: i64,
    app_data_dir: tauri::State<'_, crate::commands::pdf_commands::AppDataDir>,
) -> Result<versions::ResumeVersion, String> {
    let conn = state.0.lock().map_err(|_| DB_LOCK)?;
    versions::create_version(&conn, job_id, &app_data_dir.0)
}

#[tauri::command]
pub fn list_resume_versions(
    state: State<'_, DbState>,
    job_id: i64,
) -> Result<Vec<versions::ResumeVersion>, String> {
    let conn = state.0.lock().map_err(|_| DB_LOCK)?;
    versions::list_versions(&conn, job_id)
}

#[tauri::command]
pub fn get_resume_version(
    state: State<'_, DbState>,
    id: i64,
) -> Result<versions::ResumeVersion, String> {
    let conn = state.0.lock().map_err(|_| DB_LOCK)?;
    versions::get_version(&conn, id)
}
