//! Import command boundary (Phase 3). Extractors are pure — nothing here or in
//! `imports.rs` writes to the database, so an import can never touch the Vault
//! without going through the normal create commands after explicit approval.
//!
//! All three commands are `async` so they run on Tauri's command pool instead
//! of the main thread: parsing a very large paste must never block the window,
//! and a panic inside a parser can no longer unwind through the Windows event
//! loop and kill the whole app (v4 regression).

use crate::imports;

/// Hard cap for pasted text. Anything beyond this is rejected with a clear
/// message instead of being parsed (guards IPC payload size and pathological
/// parser input). Real resumes are a few hundred lines at most.
const MAX_IMPORT_CHARS: usize = 1_000_000;

fn guard_length(text: &str) -> Result<(), String> {
    if text.chars().count() > MAX_IMPORT_CHARS {
        Err(format!(
            "Text is too large to analyze (limit {} characters). Split it into smaller sections and import them one at a time.",
            MAX_IMPORT_CHARS
        ))
    } else {
        Ok(())
    }
}

#[tauri::command]
pub async fn parse_resume_text(text: String) -> Result<imports::ResumeImport, String> {
    guard_length(&text)?;
    Ok(imports::parse_resume_text(&text))
}

#[tauri::command]
pub async fn parse_certificate_text(text: String) -> Result<imports::CertificateCandidate, String> {
    guard_length(&text)?;
    Ok(imports::parse_certificate_text(&text))
}

#[tauri::command]
pub async fn github_repo_candidate(
    owner: String,
    repo: String,
) -> Result<imports::GithubRepoCandidate, String> {
    // Blocking network I/O — kept off the main thread like the parsers.
    imports::github_repo_candidate(&owner, &repo)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn length_guard_rejects_oversized_text() {
        assert!(guard_length(&"a".repeat(MAX_IMPORT_CHARS)).is_ok());
        assert!(guard_length(&"a".repeat(MAX_IMPORT_CHARS + 1)).is_err());
        assert!(guard_length("short").is_ok());
    }
}
