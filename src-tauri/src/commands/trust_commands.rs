//! Evidence & Trust command boundary (Phase 2): evidence, canonical bullets
//! and claim rules. Validation and linking live in `db::trust`.

use crate::db::{trust, DbState};
use serde::Serialize;
use tauri::State;

const DB_LOCK: &str = "database lock poisoned";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MutationOk {
    pub ok: bool,
}

#[tauri::command]
pub fn list_evidence(
    state: State<'_, DbState>,
    entity_type: String,
    entity_id: i64,
) -> Result<Vec<trust::Evidence>, String> {
    let conn = state.0.lock().map_err(|_| DB_LOCK)?;
    trust::list_evidence(&conn, &entity_type, entity_id)
}

#[tauri::command]
pub fn create_evidence(
    state: State<'_, DbState>,
    evidence: trust::Evidence,
) -> Result<trust::Evidence, String> {
    let conn = state.0.lock().map_err(|_| DB_LOCK)?;
    trust::create_evidence(&conn, &evidence)
}

#[tauri::command]
pub fn update_evidence(
    state: State<'_, DbState>,
    evidence: trust::Evidence,
) -> Result<trust::Evidence, String> {
    let conn = state.0.lock().map_err(|_| DB_LOCK)?;
    trust::update_evidence(&conn, &evidence)
}

#[tauri::command]
pub fn delete_evidence(state: State<'_, DbState>, id: i64) -> Result<MutationOk, String> {
    let conn = state.0.lock().map_err(|_| DB_LOCK)?;
    trust::delete_evidence(&conn, id)?;
    Ok(MutationOk { ok: true })
}

#[tauri::command]
pub fn list_bullets(
    state: State<'_, DbState>,
    entity_type: String,
    entity_id: i64,
) -> Result<Vec<trust::CanonicalBullet>, String> {
    let conn = state.0.lock().map_err(|_| DB_LOCK)?;
    trust::list_bullets(&conn, &entity_type, entity_id)
}

#[tauri::command]
pub fn create_bullet(
    state: State<'_, DbState>,
    bullet: trust::CanonicalBullet,
) -> Result<trust::CanonicalBullet, String> {
    let conn = state.0.lock().map_err(|_| DB_LOCK)?;
    trust::create_bullet(&conn, &bullet)
}

#[tauri::command]
pub fn update_bullet(
    state: State<'_, DbState>,
    bullet: trust::CanonicalBullet,
) -> Result<trust::CanonicalBullet, String> {
    let conn = state.0.lock().map_err(|_| DB_LOCK)?;
    trust::update_bullet(&conn, &bullet)
}

#[tauri::command]
pub fn delete_bullet(state: State<'_, DbState>, id: i64) -> Result<MutationOk, String> {
    let conn = state.0.lock().map_err(|_| DB_LOCK)?;
    trust::delete_bullet(&conn, id)?;
    Ok(MutationOk { ok: true })
}

#[tauri::command]
pub fn list_claim_rules(
    state: State<'_, DbState>,
    entity_type: Option<String>,
    entity_id: Option<i64>,
) -> Result<Vec<trust::ClaimRule>, String> {
    let conn = state.0.lock().map_err(|_| DB_LOCK)?;
    trust::list_claim_rules(&conn, entity_type.as_deref(), entity_id)
}

#[tauri::command]
pub fn create_claim_rule(
    state: State<'_, DbState>,
    rule: trust::ClaimRule,
) -> Result<trust::ClaimRule, String> {
    let conn = state.0.lock().map_err(|_| DB_LOCK)?;
    trust::create_claim_rule(&conn, &rule)
}

#[tauri::command]
pub fn update_claim_rule(
    state: State<'_, DbState>,
    rule: trust::ClaimRule,
) -> Result<trust::ClaimRule, String> {
    let conn = state.0.lock().map_err(|_| DB_LOCK)?;
    trust::update_claim_rule(&conn, &rule)
}

#[tauri::command]
pub fn delete_claim_rule(state: State<'_, DbState>, id: i64) -> Result<MutationOk, String> {
    let conn = state.0.lock().map_err(|_| DB_LOCK)?;
    trust::delete_claim_rule(&conn, id)?;
    Ok(MutationOk { ok: true })
}
