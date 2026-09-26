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

/// The Tectonic compile can take minutes on first run — async so it never
/// blocks the main thread (the DB lock is dropped around the subprocess).
#[tauri::command]
pub async fn export_pdf(
    state: State<'_, DbState>,
    job_id: i64,
    mut template_id: String,
    app_data_dir: State<'_, AppDataDir>,
) -> Result<ExportResult, String> {
    let started = std::time::Instant::now();
    // 1. Lock: load the plan, overlay accepted tailor suggestions, locate the
    //    compiler. The overlay keeps the PDF in sync with what the Studio
    //    preview shows for accepted AI tailoring.
    let (plan, tectonic) = {
        let conn = state.0.lock().map_err(|_| DB_LOCK)?;
        let mut plan: crate::composer::ResumePlan = {
            let stored = crate::db::composer::get_plan(&conn, job_id)?;
            stored
                .ok_or_else(|| {
                    "No plan for this workspace — compose one in the Plan tab first".to_string()
                })?
                .plan
        };
        let _ = crate::db::tailor::apply_accepted_suggestions(&conn, job_id, &mut plan)?;
        let tectonic = pdf::find_tectonic(&conn)?;
        (plan, tectonic)
    }; // DB lock dropped — the compile can take minutes on first run.

    // Template fallback: an empty template id defers to the persisted choice.
    if template_id.trim().is_empty() {
        template_id = plan.config.template_id.clone();
    }
    if template_id.trim().is_empty() {
        template_id = "jake".to_string();
    }

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
    Ok(ExportResult {
        artifact: out.artifact,
        log_tail: out.log_tail,
    })
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
        // `explorer.exe <path>` — never a shell, so frontend-supplied paths
        // can't reach a command interpreter (cmd metacharacter injection).
        std::process::Command::new("explorer")
            .arg(&path)
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

/// Read a local file into raw binary bytes for frontend PDF rendering.
/// Scoped to the app data dir — the webview must not become a general file
/// read primitive.
#[tauri::command]
pub fn read_pdf_bytes(
    path: String,
    app_data_dir: State<'_, AppDataDir>,
) -> Result<Vec<u8>, String> {
    let p = std::path::Path::new(&path);
    if !p.exists() {
        return Err(format!("File does not exist: {}", path));
    }
    let allowed_root = app_data_dir.0.canonicalize().map_err(|e| e.to_string())?;
    let requested = p
        .canonicalize()
        .map_err(|e| format!("Failed to resolve file: {e}"))?;
    if !requested.starts_with(&allowed_root) {
        return Err("File is outside the Kairo data directory".to_string());
    }
    std::fs::read(p).map_err(|e| format!("Failed to read file: {e}"))
}

/// Reveal a file in the OS file explorer with the file selected.
#[tauri::command]
pub fn reveal_file(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .args(["/select,", &path])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .args(["-R", &path])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        if let Some(parent) = std::path::Path::new(&path).parent() {
            std::process::Command::new("xdg-open")
                .arg(parent)
                .spawn()
                .map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// Save / copy a PDF to the user's standard Downloads folder.
#[tauri::command]
pub fn save_pdf_to_downloads(
    src_path: String,
    custom_name: Option<String>,
) -> Result<String, String> {
    let src = std::path::Path::new(&src_path);
    if !src.exists() {
        return Err("Source file does not exist".to_string());
    }

    #[cfg(target_os = "windows")]
    let downloads = std::env::var("USERPROFILE")
        .map(|p| std::path::PathBuf::from(p).join("Downloads"))
        .unwrap_or_else(|_| std::path::PathBuf::from("."));

    #[cfg(not(target_os = "windows"))]
    let downloads = std::env::var("HOME")
        .map(|h| std::path::PathBuf::from(h).join("Downloads"))
        .unwrap_or_else(|_| std::path::PathBuf::from("."));

    if !downloads.exists() {
        std::fs::create_dir_all(&downloads).map_err(|e| {
            format!(
                "cannot create Downloads folder ({}): {e}",
                downloads.display()
            )
        })?;
    }

    let file_name = custom_name.unwrap_or_else(|| {
        src.file_name()
            .map(|f| f.to_string_lossy().to_string())
            .unwrap_or_else(|| "resume.pdf".to_string())
    });

    let dest = downloads.join(&file_name);
    std::fs::copy(src, &dest).map_err(|e| format!("Failed to copy to {}: {e}", dest.display()))?;
    Ok(dest.to_string_lossy().to_string())
}
