//! Provenance command boundary (Phase "first-use"): explicit verification of
//! vault records, and the onboarding snapshot that decides whether the app
//! still needs its guided first-run flow.

use crate::db::{origin, DbState};
use serde::Serialize;
use tauri::State;

const DB_LOCK: &str = "database lock poisoned";

/// The user has personally checked a record's facts. Imported text is never
/// called verified by anything else.
#[tauri::command]
pub fn mark_verified(
    state: State<'_, DbState>,
    entity_type: String,
    entity_id: i64,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|_| DB_LOCK)?;
    origin::mark_verified(&conn, &entity_type, entity_id)
}

/// Withdraw an accidental verification — verifying must stay deliberate.
#[tauri::command]
pub fn unmark_verified(
    state: State<'_, DbState>,
    entity_type: String,
    entity_id: i64,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|_| DB_LOCK)?;
    origin::unmark_verified(&conn, &entity_type, entity_id)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OnboardingStatusView {
    pub has_profile: bool,
    pub project_count: i64,
    pub experience_count: i64,
    pub education_count: i64,
    pub skill_count: i64,
    pub job_count: i64,
    pub has_any_content: bool,
}

#[tauri::command]
pub fn get_onboarding_status(state: State<'_, DbState>) -> Result<OnboardingStatusView, String> {
    let conn = state.0.lock().map_err(|_| DB_LOCK)?;
    let status = origin::onboarding_status(&conn)?;
    Ok(OnboardingStatusView {
        has_profile: status.has_profile,
        project_count: status.project_count,
        experience_count: status.experience_count,
        education_count: status.education_count,
        skill_count: status.skill_count,
        job_count: status.job_count,
        has_any_content: status.has_any_content,
    })
}
