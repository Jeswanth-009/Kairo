//! Import command boundary (Phase 3). Extractors are pure — nothing here or in
//! `imports.rs` writes to the database, so an import can never touch the Vault
//! without going through the normal create commands after explicit approval.

use crate::imports;
use tauri::State;

/// Commands that never read the DB still take state to keep the boundary
/// uniform; parsing itself is pure.
#[tauri::command]
pub fn parse_resume_text(_state: State<'_, crate::db::DbState>, text: String) -> Result<imports::ResumeImport, String> {
    Ok(imports::parse_resume_text(&text))
}

#[tauri::command]
pub fn parse_certificate_text(
    _state: State<'_, crate::db::DbState>,
    text: String,
) -> Result<imports::CertificateCandidate, String> {
    Ok(imports::parse_certificate_text(&text))
}

#[tauri::command]
pub fn github_repo_candidate(
    _state: State<'_, crate::db::DbState>,
    owner: String,
    repo: String,
) -> Result<imports::GithubRepoCandidate, String> {
    imports::github_repo_candidate(&owner, &repo)
}
