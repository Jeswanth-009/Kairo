//! Dashboard command boundary (Phase 13). One read-only command that
//! assembles everything the front page needs.

use crate::db::{dashboard, DbState};
use tauri::State;

const DB_LOCK: &str = "database lock poisoned";

#[tauri::command]
pub fn get_dashboard(state: State<'_, DbState>) -> Result<dashboard::DashboardOverview, String> {
    let conn = state.0.lock().map_err(|_| DB_LOCK)?;
    dashboard::overview(&conn)
}
