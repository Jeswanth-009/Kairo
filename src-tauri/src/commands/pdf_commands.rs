//! PDF command boundary (Phase 9).

use crate::db::{pdf, DbState};
use serde::Serialize;
use tauri::State;

const DB_LOCK: &str = "database lock poisoned";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    pub artifact: pdf::PdfArtifact,
    pub log_tail: String,
}

#[tauri::command]
pub fn export_pdf(
    state: State<'_, DbState>,
    job_id: i64,
    template_id: String,
    app_data_dir: State<'_, AppDataDir>,
) -> Result<ExportResult, String> {
    let started = std::time::Instant::now();
    // 1. Lock: load the plan and locate the compiler.
    let (plan, tectonic) = {
        let conn = state.0.lock().map_err(|_| DB_LOCK)?;
        let plan: crate::composer::ResumePlan = {
            let stored = crate::db::composer::get_plan(&conn, job_id)?;
            stored
                .ok_or_else(|| "No plan for this workspace — compose one in the Plan tab first".to_string())?
                .plan
        };
        let tectonic = pdf::find_tectonic(&conn)?;
        (plan, tectonic)
    }; // DB lock dropped — the compile can take minutes on first run.

    // 2. Write .tex + run Tectonic (no lock held).
    let out = match pdf::compile_locked(plan, job_id, &template_id, &tectonic, &app_data_dir.0) {
        Ok(out) => out,
        Err(e) => {
            crate::logging::log_event(
                "error",
                "pdf_export_failed",
                &[
                    ("job_id", job_id.to_string()),
                    ("duration_ms", started.elapsed().as_millis().to_string()),
                    ("error", e.clone()),
                ],
            );
            return Err(e);
        }
    };

    // 3. Re-lock: persist the artifact.
    {
        let conn = state.0.lock().map_err(|_| DB_LOCK)?;
        pdf::save_artifact(&conn, &out.artifact)?;
    }
    crate::logging::log_event(
        "info",
        "pdf_exported",
        &[
            ("job_id", job_id.to_string()),
            ("pages", out.artifact.page_count.unwrap_or(0).to_string()),
            ("duration_ms", started.elapsed().as_millis().to_string()),
        ],
    );
    Ok(ExportResult { artifact: out.artifact, log_tail: out.log_tail })
}

#[tauri::command]
pub fn get_pdf_artifact(
    state: State<'_, DbState>,
    job_id: i64,
) -> Result<Option<pdf::PdfArtifact>, String> {
    let conn = state.0.lock().map_err(|_| DB_LOCK)?;
    pdf::get_artifact(&conn, job_id)
}

/// Managed state carrying the app data dir into commands (Tauri provides it).
pub struct AppDataDir(pub std::path::PathBuf);

/// Open a file (e.g. a PDF) with the OS default application.
#[tauri::command]
pub fn open_file(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/c", "start", "", &path])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}
