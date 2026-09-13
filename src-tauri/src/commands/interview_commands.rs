//! Interview Prep command boundary (Phase 12).

use crate::db::{interview, DbState};
use tauri::State;

const DB_LOCK: &str = "database lock poisoned";

#[tauri::command]
pub fn generate_interview_prep(
    state: State<'_, DbState>,
    job_id: i64,
) -> Result<crate::interview::InterviewPrep, String> {
    let conn = state.0.lock().map_err(|_| DB_LOCK)?;
    interview::generate_for_job(&conn, job_id)
}
