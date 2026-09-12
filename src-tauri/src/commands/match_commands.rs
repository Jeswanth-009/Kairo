//! Matching command boundary (Phase 5).

use crate::db::{matching, DbState};
use crate::matching::MatchReport;
use tauri::State;

const DB_LOCK: &str = "database lock poisoned";

fn now_month() -> String {
    // Days-since-epoch -> (year, month), Howard Hinnant's civil_from_days.
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let days = secs.div_euclid(86_400);
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 - doe / 36_524 + doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if m <= 2 { y + 1 } else { y };
    format!("{year:04}-{m:02}")
}

#[tauri::command]
pub fn run_job_match(state: State<'_, DbState>, job_id: i64) -> Result<MatchReport, String> {
    let conn = state.0.lock().map_err(|_| DB_LOCK)?;
    matching::run_and_persist(&conn, job_id, &now_month())
}

#[tauri::command]
pub fn get_match(state: State<'_, DbState>, job_id: i64) -> Result<Option<MatchReport>, String> {
    let conn = state.0.lock().map_err(|_| DB_LOCK)?;
    matching::get_report(&conn, job_id)
}
