//! PDF command boundary (Phase 9).

use crate::db::{fingerprint, pdf, versions, DbState};
use serde::Serialize;
use tauri::{Emitter, State};

const DB_LOCK: &str = "database lock poisoned";
/// Live compile progress channel: the backend streams Tectonic output lines
/// here; the Studio/Resume UI renders them instead of a frozen spinner.
const PDF_PROGRESS_EVENT: &str = "pdf://progress";

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PdfProgress {
    pub job_id: i64,
    pub line: String,
}

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
    app: tauri::AppHandle,
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

    // Fingerprint of the exact render inputs. `create_version` recomputes
    // this the same way and refuses to save a version when it no longer
    // matches — the plan must not drift from the exported PDF unnoticed.
    let fingerprint = fingerprint::render_fingerprint(&plan, &template_id, &plan.config.paper);

    // 2. Write .tex + run Tectonic (no lock held), streaming each compiler
    //    line to the webview so long first compiles visibly progress. The
    //    compile happens in a staging dir; the previous good PDF in
    //    `pdf/job_{id}/` is only replaced once the new one is complete.
    let on_line = |line: &str| {
        let _ = app.emit(
            PDF_PROGRESS_EVENT,
            PdfProgress {
                job_id,
                line: line.to_string(),
            },
        );
    };
    let mut out = match pdf::compile_locked(
        plan,
        job_id,
        &template_id,
        &tectonic,
        &app_data_dir.0,
        &on_line,
    ) {
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
    out.artifact.fingerprint = Some(fingerprint);

    // 3. Re-lock: persist the artifact (now pointing at the promoted file).
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

// ---------------------------------------------------------------------------
// Artifact-scoped file access
// ---------------------------------------------------------------------------

/// Resolve an app-recorded path, refusing anything that is missing or
/// resolves outside the app data dir. Canonicalizes both roots so symlinks
/// and `..` cannot smuggle a path past the check (same pattern as the old
/// `read_pdf_bytes` guard).
fn scoped_artifact_path(
    path: &std::path::Path,
    app_data_dir: &AppDataDir,
) -> Result<std::path::PathBuf, String> {
    if !path.exists() {
        return Err(format!("File does not exist: {}", path.display()));
    }
    let allowed_root = app_data_dir
        .0
        .canonicalize()
        .map_err(|e| format!("cannot resolve app data dir: {e}"))?;
    let requested = path
        .canonicalize()
        .map_err(|e| format!("Failed to resolve file: {e}"))?;
    if !requested.starts_with(&allowed_root) {
        return Err("File is outside the Kairo data directory".to_string());
    }
    Ok(requested)
}

fn resolve_job_pdf(
    state: State<'_, DbState>,
    job_id: i64,
    app_data_dir: State<'_, AppDataDir>,
) -> Result<std::path::PathBuf, String> {
    let conn = state.0.lock().map_err(|_| DB_LOCK)?;
    let artifact = pdf::get_artifact(&conn, job_id)?
        .ok_or_else(|| "No compiled PDF for this workspace — export it first".to_string())?;
    drop(conn);
    scoped_artifact_path(std::path::Path::new(&artifact.pdf_path), &app_data_dir)
}

fn resolve_version_pdf(
    state: State<'_, DbState>,
    version_id: i64,
    app_data_dir: State<'_, AppDataDir>,
) -> Result<std::path::PathBuf, String> {
    let conn = state.0.lock().map_err(|_| DB_LOCK)?;
    let version = versions::get_version(&conn, version_id)?;
    drop(conn);
    scoped_artifact_path(std::path::Path::new(&version.pdf_path), &app_data_dir)
}

fn open_with_os(path: &std::path::Path) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        // `explorer.exe <path>` — never a shell, so paths can't reach a
        // command interpreter (cmd metacharacter injection).
        std::process::Command::new("explorer")
            .arg(path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn reveal_with_os(path: &std::path::Path) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg("/select,")
            .arg(path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("-R")
            .arg(path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        if let Some(parent) = path.parent() {
            std::process::Command::new("xdg-open")
                .arg(parent)
                .spawn()
                .map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// Open a workspace's compiled PDF with the OS default application.
#[tauri::command]
pub fn open_job_pdf(
    state: State<'_, DbState>,
    job_id: i64,
    app_data_dir: State<'_, AppDataDir>,
) -> Result<(), String> {
    open_with_os(&resolve_job_pdf(state, job_id, app_data_dir)?)
}

/// Open a saved version's PDF copy with the OS default application.
#[tauri::command]
pub fn open_version_pdf(
    state: State<'_, DbState>,
    version_id: i64,
    app_data_dir: State<'_, AppDataDir>,
) -> Result<(), String> {
    open_with_os(&resolve_version_pdf(state, version_id, app_data_dir)?)
}

/// Reveal a workspace's compiled PDF in the OS file explorer.
#[tauri::command]
pub fn reveal_job_pdf(
    state: State<'_, DbState>,
    job_id: i64,
    app_data_dir: State<'_, AppDataDir>,
) -> Result<(), String> {
    reveal_with_os(&resolve_job_pdf(state, job_id, app_data_dir)?)
}

/// Reveal a saved version's PDF copy in the OS file explorer.
#[tauri::command]
pub fn reveal_version_pdf(
    state: State<'_, DbState>,
    version_id: i64,
    app_data_dir: State<'_, AppDataDir>,
) -> Result<(), String> {
    reveal_with_os(&resolve_version_pdf(state, version_id, app_data_dir)?)
}

/// Read a workspace's compiled PDF into raw bytes for frontend rendering.
#[tauri::command]
pub fn read_job_pdf_bytes(
    state: State<'_, DbState>,
    job_id: i64,
    app_data_dir: State<'_, AppDataDir>,
) -> Result<Vec<u8>, String> {
    let path = resolve_job_pdf(state, job_id, app_data_dir)?;
    std::fs::read(&path).map_err(|e| format!("Failed to read file: {e}"))
}

/// Read a saved version's PDF copy into raw bytes for frontend rendering.
#[tauri::command]
pub fn read_version_pdf_bytes(
    state: State<'_, DbState>,
    version_id: i64,
    app_data_dir: State<'_, AppDataDir>,
) -> Result<Vec<u8>, String> {
    let path = resolve_version_pdf(state, version_id, app_data_dir)?;
    std::fs::read(&path).map_err(|e| format!("Failed to read file: {e}"))
}

/// Copy a PDF to the user's standard Downloads folder. Never overwrites an
/// existing file — duplicates get "name (1).ext" — and the copy lands
/// atomically via a `.part` file so an interrupted copy cannot leave a
/// truncated file where a good one used to be.
fn copy_to_downloads(src: &std::path::Path, custom_name: Option<String>) -> Result<String, String> {
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

    let raw_name = custom_name.unwrap_or_else(|| {
        src.file_name()
            .map(|f| f.to_string_lossy().to_string())
            .unwrap_or_else(|| "resume.pdf".to_string())
    });
    let file_name = sanitize_download_name(&raw_name)?;

    let mut dest = downloads.join(&file_name);
    if dest.exists() {
        dest = dedup_path(&downloads, &file_name);
    }

    // Copy to a sibling .part file first; only a complete copy is renamed
    // over the destination name.
    let part = downloads.join(format!(
        ".{}.part",
        dest.file_name()
            .map(|f| f.to_string_lossy().to_string())
            .unwrap_or_else(|| "resume.pdf".to_string())
    ));
    std::fs::copy(src, &part)
        .map_err(|e| format!("Failed to copy to {}: {e}", dest.display()))?;
    if let Err(e) = std::fs::rename(&part, &dest) {
        let _ = std::fs::remove_file(&part);
        return Err(format!("Failed to save to {}: {e}", dest.display()));
    }
    Ok(dest.to_string_lossy().to_string())
}

/// `resume.pdf` taken? Try `resume (1).pdf`, `resume (2).pdf`, …
fn dedup_path(downloads: &std::path::Path, file_name: &str) -> std::path::PathBuf {
    let stem = std::path::Path::new(file_name)
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| file_name.to_string());
    let ext = std::path::Path::new(file_name)
        .extension()
        .map(|e| format!(".{}", e.to_string_lossy()))
        .unwrap_or_default();
    for n in 1..1000u32 {
        let candidate = downloads.join(format!("{stem} ({n}){ext}"));
        if !candidate.exists() {
            return candidate;
        }
    }
    // Practically unreachable; fall back to a timestamped name.
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    downloads.join(format!("{stem} ({stamp}){ext}"))
}

#[tauri::command]
pub fn save_job_pdf_to_downloads(
    state: State<'_, DbState>,
    job_id: i64,
    custom_name: Option<String>,
    app_data_dir: State<'_, AppDataDir>,
) -> Result<String, String> {
    let path = resolve_job_pdf(state, job_id, app_data_dir)?;
    copy_to_downloads(&path, custom_name)
}

#[tauri::command]
pub fn save_version_pdf_to_downloads(
    state: State<'_, DbState>,
    version_id: i64,
    custom_name: Option<String>,
    app_data_dir: State<'_, AppDataDir>,
) -> Result<String, String> {
    let path = resolve_version_pdf(state, version_id, app_data_dir)?;
    copy_to_downloads(&path, custom_name)
}

/// Reduces a user-supplied name to a bare file name so the destination always
/// stays inside Downloads — no `..`, separators, or null-byte escapes.
fn sanitize_download_name(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("File name is empty".to_string());
    }
    // Cut at the platform separator first, then reject anything still
    // carrying one (covers `a\b.pdf` on Unix, where `\` is a normal char).
    let base = std::path::Path::new(trimmed)
        .file_name()
        .map(|f| f.to_string_lossy().to_string())
        .unwrap_or_default();
    if base.is_empty()
        || base.contains('/')
        || base.contains('\\')
        || base.contains('\0')
        || base.starts_with('.')
    {
        return Err(format!("Invalid file name: {trimmed}"));
    }
    Ok(base)
}
