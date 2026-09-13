//! Backup & restore command boundary (Phase 14). Restore takes a backup file
//! *name* only — the path is always resolved under the app-owned backups dir.

use crate::db::{backup, DbState};
use serde::Serialize;
use tauri::State;

use super::pdf_commands::AppDataDir;

const DB_LOCK: &str = "database lock poisoned";

#[tauri::command]
pub fn list_backups(app_data_dir: State<'_, AppDataDir>) -> Result<Vec<backup::BackupInfo>, String> {
    backup::list_backups(&backup::backups_dir(&app_data_dir.0))
}

#[tauri::command]
pub fn create_backup(
    state: State<'_, DbState>,
    app_data_dir: State<'_, AppDataDir>,
) -> Result<backup::BackupInfo, String> {
    let mut conn = state.0.lock().map_err(|_| DB_LOCK)?;
    let info = backup::create_backup(&mut conn, &backup::backups_dir(&app_data_dir.0))?;
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
}

#[tauri::command]
pub fn restore_backup(
    state: State<'_, DbState>,
    app_data_dir: State<'_, AppDataDir>,
    file_name: String,
) -> Result<RestoreOk, String> {
    let mut conn = state.0.lock().map_err(|_| DB_LOCK)?;
    let report = backup::restore_backup(&mut conn, &backup::backups_dir(&app_data_dir.0), &file_name)?;
    crate::logging::log_event(
        "info",
        "backup_restored",
        &[
            ("file_name", report.restored_from),
            ("applied_migrations", report.applied_migrations.to_string()),
        ],
    );
    Ok(RestoreOk { ok: true, applied_migrations: report.applied_migrations })
}
