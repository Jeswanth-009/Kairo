//! Backup & restore command boundary (Phase 14). Restore takes a backup file
//! *name* only — the path is always resolved under the app-owned backups dir.
//! Backups carry the SQLite database plus the whole `pdf/` tree in one
//! portable, hash-verified archive.

use crate::db::{backup, DbState};
use serde::Serialize;
use tauri::State;

use super::pdf_commands::AppDataDir;

const DB_LOCK: &str = "database lock poisoned";

#[tauri::command]
pub fn list_backups(
    app_data_dir: State<'_, AppDataDir>,
) -> Result<Vec<backup::BackupInfo>, String> {
    backup::list_backups(&backup::backups_dir(&app_data_dir.0))
}

#[tauri::command]
pub fn create_backup(
    state: State<'_, DbState>,
    app_data_dir: State<'_, AppDataDir>,
) -> Result<backup::BackupInfo, String> {
    let conn = state.0.lock().map_err(|_| DB_LOCK)?;
    let data = &app_data_dir.0;
    let info = backup::create_backup(&conn, &backup::backups_dir(data), &data.join("pdf"))?;
    crate::logging::log_event(
        "info",
        "backup_created",
        &[
            ("file_name", info.file_name.clone()),
            ("bytes", info.bytes.to_string()),
        ],
    );
    Ok(info)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreOk {
    pub ok: bool,
    pub applied_migrations: usize,
    pub files_restored: usize,
}

#[tauri::command]
pub fn restore_backup(
    state: State<'_, DbState>,
    app_data_dir: State<'_, AppDataDir>,
    file_name: String,
) -> Result<RestoreOk, String> {
    let mut conn = state.0.lock().map_err(|_| DB_LOCK)?;
    let data = &app_data_dir.0;
    let report = backup::restore_backup(
        &mut conn,
        &backup::backups_dir(data),
        &file_name,
        &data.join("pdf"),
        backup::FailPoint::None,
    )?;
    crate::logging::log_event(
        "info",
        "backup_restored",
        &[
            ("file_name", report.restored_from.clone()),
            ("applied_migrations", report.applied_migrations.to_string()),
            ("files_restored", report.files_restored.to_string()),
        ],
    );
    Ok(RestoreOk {
        ok: true,
        applied_migrations: report.applied_migrations,
        files_restored: report.files_restored,
    })
}

/// Open the backups folder in the OS file explorer so a backup made on this
/// machine can be copied out — or dropped into a clean installation.
#[tauri::command]
pub fn open_backups_dir(app_data_dir: State<'_, AppDataDir>) -> Result<(), String> {
    let dir = backup::backups_dir(&app_data_dir.0);
    std::fs::create_dir_all(&dir).map_err(|e| format!("cannot create backups dir: {e}"))?;
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&dir)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&dir)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&dir)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}
