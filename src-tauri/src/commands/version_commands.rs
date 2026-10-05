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

/// The user has looked at THIS exact PDF (its hash is recorded). Review is
/// per-artifact: the next compile leaves the old hash behind, so the state
/// reads "needs review" again — and saving a version requires the match.
#[tauri::command]
pub fn mark_artifact_reviewed(
    state: State<'_, DbState>,
    job_id: i64,
    app_data_dir: tauri::State<'_, crate::commands::pdf_commands::AppDataDir>,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|_| DB_LOCK)?;
    let status = crate::db::pdf::pdf_status(&conn, job_id, &app_data_dir.0)?;
    if status.state != "current" {
        return Err("Export the latest saved draft before marking its PDF reviewed".to_string());
    }
    let artifact = crate::db::pdf::get_artifact(&conn, job_id)?
        .ok_or_else(|| "No compiled PDF for this workspace — export it first".to_string())?;
    let pdf_path = crate::db::pdf::resolve_artifact_path(&app_data_dir.0, &artifact.pdf_path);
    let hash = crate::db::fingerprint::file_sha256(&pdf_path)?;
    if artifact.pdf_hash.as_deref() != Some(hash.as_str()) {
        return Err(
            "The PDF on disk no longer matches its export record — recompile, then review it"
                .to_string(),
        );
    }
    crate::db::vault::sql_err(conn.execute(
        "UPDATE resume_plans SET reviewed_pdf_hash = ?1, reviewed_at = datetime('now') \
         WHERE job_id = ?2",
        rusqlite::params![hash, job_id],
    ))?;
    Ok(())
}
