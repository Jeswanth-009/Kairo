//! Recently-deleted (trash) command boundary: list, restore, delete forever.

use crate::db::{trash, DbState};
use serde::Serialize;
use tauri::State;

const DB_LOCK: &str = "database lock poisoned";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MutationOk {
    pub ok: bool,
}

#[tauri::command]
pub fn trash_list(state: State<'_, DbState>) -> Result<Vec<trash::TrashItem>, String> {
    let conn = state.0.lock().map_err(|_| DB_LOCK)?;
    trash::list_trash(&conn)
}

#[tauri::command]
pub fn trash_restore(
    state: State<'_, DbState>,
    entity_type: String,
    entity_id: i64,
) -> Result<MutationOk, String> {
    let conn = state.0.lock().map_err(|_| DB_LOCK)?;
    trash::restore(&conn, &entity_type, entity_id)?;
    Ok(MutationOk { ok: true })
}

/// Delete forever — this is the only user-facing hard delete for vault
/// records and jobs.
#[tauri::command]
pub fn trash_purge(
    state: State<'_, DbState>,
    entity_type: String,
    entity_id: i64,
) -> Result<MutationOk, String> {
    let conn = state.0.lock().map_err(|_| DB_LOCK)?;
    trash::purge(&conn, &entity_type, entity_id)?;
    Ok(MutationOk { ok: true })
}
