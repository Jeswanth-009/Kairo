//! Application tracker command boundary (Phase 11).

use crate::db::{applications, DbState};
use serde::Serialize;
use tauri::State;

const DB_LOCK: &str = "database lock poisoned";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MutationOk {
    pub ok: bool,
}

#[tauri::command]
pub fn list_applications(state: State<'_, DbState>) -> Result<Vec<applications::Application>, String> {
    let conn = state.0.lock().map_err(|_| DB_LOCK)?;
    applications::list_applications(&conn)
}

#[tauri::command]
pub fn create_application(
    state: State<'_, DbState>,
    application: applications::Application,
) -> Result<applications::Application, String> {
    let conn = state.0.lock().map_err(|_| DB_LOCK)?;
    applications::create_application(&conn, &application)
}

#[tauri::command]
pub fn update_application(
    state: State<'_, DbState>,
    application: applications::Application,
) -> Result<applications::Application, String> {
    let conn = state.0.lock().map_err(|_| DB_LOCK)?;
    applications::update_application(&conn, &application)
}

#[tauri::command]
pub fn set_application_status(
    state: State<'_, DbState>,
    id: i64,
    status: String,
) -> Result<applications::Application, String> {
    let conn = state.0.lock().map_err(|_| DB_LOCK)?;
    applications::set_status(&conn, id, &status)
}

#[tauri::command]
pub fn delete_application(
    state: State<'_, DbState>,
    id: i64,
) -> Result<MutationOk, String> {
    let conn = state.0.lock().map_err(|_| DB_LOCK)?;
    applications::delete_application(&conn, id)?;
    Ok(MutationOk { ok: true })
}
