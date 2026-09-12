//! Foundation commands: diagnostics and the database read/write smoke test.
//! Domain services (matching, constraints, claims, LaTeX) join this boundary
//! in later phases.

use crate::db::{self, DbState};
use serde::Serialize;
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use tauri::State;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Diagnostics {
    pub app_version: String,
    pub schema_version: u32,
    pub latest_migration: String,
    pub sqlite_version: String,
    pub db_path: String,
    pub migrations_applied: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SmokeTestResult {
    pub ok: bool,
    pub token_written: String,
    pub token_read_back: String,
    pub duration_ms: u64,
    pub error: Option<String>,
}

fn unique_token() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("kairo-smoke-{nanos:x}")
}

#[tauri::command]
pub fn get_diagnostics(
    state: State<'_, DbState>,
    app: tauri::AppHandle,
) -> Result<Diagnostics, String> {
    let conn = state
        .0
        .lock()
        .map_err(|_| "database lock poisoned".to_string())?;
    let migrations = db::applied_migrations(&conn).map_err(|e| e.to_string())?;

    Ok(Diagnostics {
        app_version: app.package_info().version.to_string(),
        schema_version: migrations.len() as u32,
        latest_migration: migrations
            .last()
            .cloned()
            .unwrap_or_else(|| "none".to_string()),
        sqlite_version: rusqlite::version().to_string(),
        db_path: conn.path().unwrap_or_default().to_string(),
        migrations_applied: migrations,
    })
}

/// Writes a unique token into `meta`, reads it back, and reports whether the
/// round trip matched — the Phase 0 acceptance check for persistence.
#[tauri::command]
pub fn db_smoke_test(state: State<'_, DbState>) -> Result<SmokeTestResult, String> {
    let token = unique_token();
    let start = Instant::now();

    let conn = state
        .0
        .lock()
        .map_err(|_| "database lock poisoned".to_string())?;

    let outcome = (|| -> Result<SmokeTestResult, rusqlite::Error> {
        conn.execute(
            "INSERT INTO meta (key, value) VALUES ('smoke_test_token', ?1) \
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            [&token],
        )?;
        let read_back: String = conn.query_row(
            "SELECT value FROM meta WHERE key = 'smoke_test_token'",
            [],
            |row| row.get(0),
        )?;
        Ok(SmokeTestResult {
            ok: read_back == token,
            token_written: token.clone(),
            token_read_back: read_back,
            duration_ms: start.elapsed().as_millis() as u64,
            error: None,
        })
    })();

    Ok(outcome.unwrap_or_else(|e| SmokeTestResult {
        ok: false,
        token_written: token,
        token_read_back: String::new(),
        duration_ms: start.elapsed().as_millis() as u64,
        error: Some(e.to_string()),
    }))
}
