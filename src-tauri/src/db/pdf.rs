//! PDF artifact persistence + the compile orchestration (Phase 9 · spec §9.1).
//! The DB lock is held only for load/persist — the Tectonic run (which can
//! download the whole TeX bundle on first use) happens unlocked.

use super::vault::sql_err;
use crate::composer::{estimate_plan_lines, ResumePlan};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::io::Read;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfArtifact {
    pub job_id: i64,
    pub tex_path: String,
    pub pdf_path: String,
    pub page_count: Option<i64>,
    pub compiled_at: Option<String>,
    /// Template the PDF was compiled with, so the UI can flag staleness when
    /// the Studio's picked template moves on. Empty for pre-3.0 artifacts.
    #[serde(default)]
    pub template_id: String,
    #[serde(default)]
    pub paper: String,
    /// Fingerprint of the exact render inputs (post-overlay plan + template +
    /// paper) that produced this PDF. None for pre-fingerprint artifacts;
    /// version saves then demand a recompile.
    #[serde(default)]
    pub fingerprint: Option<String>,
    /// SHA-256 of the generated PDF file at export time.
    #[serde(default)]
    pub pdf_hash: Option<String>,
    /// Plan revision this PDF was compiled from (null for pre-15 rows).
    #[serde(default)]
    pub artifact_plan_revision: Option<i64>,
}

/// Resolves a stored artifact path. Rows written since migration 0015 hold
/// paths relative to the app data dir (portable across machines and
/// restores); older rows may hold absolute paths, which still work.
pub fn resolve_artifact_path(app_data_dir: &Path, stored: &str) -> PathBuf {
    let p = Path::new(stored);
    if p.is_absolute() {
        p.to_path_buf()
    } else {
        app_data_dir.join(p)
    }
}

pub fn get_artifact(conn: &Connection, job_id: i64) -> Result<Option<PdfArtifact>, String> {
    let mut stmt = sql_err(conn.prepare(
        "SELECT job_id, tex_path, pdf_path, page_count, compiled_at, artifact_template_id, artifact_paper, \
         compiled_fingerprint, pdf_hash, artifact_plan_revision \
         FROM resume_plans WHERE job_id = ?1 AND pdf_path IS NOT NULL",
    ))?;
    match stmt.query_row([job_id], |row| {
        Ok(PdfArtifact {
            job_id: row.get(0)?,
            tex_path: row.get(1)?,
            pdf_path: row.get(2)?,
            page_count: row.get(3)?,
            compiled_at: row.get(4)?,
            template_id: row.get(5)?,
            paper: row.get(6)?,
            fingerprint: row.get(7)?,
            pdf_hash: row.get(8)?,
            artifact_plan_revision: row.get(9)?,
        })
    }) {
        Ok(a) => Ok(Some(a)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

pub fn save_artifact(
    conn: &Connection,
    artifact: &PdfArtifact,
    expect_revision: Option<i64>,
) -> Result<(), String> {
    // The revision condition makes the persist a compare-and-set: a plan save
    // that landed while the PDF compiled must never be overwritten by an
    // artifact describing the older content. 0 rows = the plan changed or was
    // deleted mid-compile — the caller refuses instead of recording a stale
    // artifact row.
    let sql = if expect_revision.is_some() {
        "UPDATE resume_plans SET pdf_path = ?1, tex_path = ?2, page_count = ?3, \
           artifact_template_id = ?4, artifact_paper = ?5, \
           compiled_fingerprint = ?6, pdf_hash = ?7, artifact_plan_revision = ?8, \
           compiled_at = datetime('now') WHERE job_id = ?9 AND plan_revision = ?10"
    } else {
        "UPDATE resume_plans SET pdf_path = ?1, tex_path = ?2, page_count = ?3, \
           artifact_template_id = ?4, artifact_paper = ?5, \
           compiled_fingerprint = ?6, pdf_hash = ?7, artifact_plan_revision = ?8, \
           compiled_at = datetime('now') WHERE job_id = ?9"
    };
    let changed = if let Some(expected) = expect_revision {
        sql_err(conn.execute(
            sql,
            params![
                artifact.pdf_path,
                artifact.tex_path,
                artifact.page_count,
                artifact.template_id,
                artifact.paper,
                artifact.fingerprint,
                artifact.pdf_hash,
                artifact.artifact_plan_revision,
                artifact.job_id,
                expected
            ],
        ))
    } else {
        sql_err(conn.execute(
            sql,
            params![
                artifact.pdf_path,
                artifact.tex_path,
                artifact.page_count,
                artifact.template_id,
                artifact.paper,
                artifact.fingerprint,
                artifact.pdf_hash,
                artifact.artifact_plan_revision,
                artifact.job_id
            ],
        ))
    }?;
    if changed == 0 {
        return Err(
            "This workspace's plan changed or was removed while the PDF compiled — \
             the previous good PDF is untouched; review the draft and export again."
                .to_string(),
        );
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Saved-vs-artifact status: the one source of truth for "is this PDF current"
// ---------------------------------------------------------------------------

/// What the saved plan and the recorded artifact say about the current PDF.
/// Every UI label ("Draft", "PDF needs update", "Current PDF") must derive
/// from here — never from timestamps or local flags.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfStatus {
    /// "none" (no plan or never compiled) · "missing-file" (artifact row but
    /// the PDF file is gone) · "stale" (plan edited after this compile) ·
    /// "template-stale" (template/paper changed after this compile) ·
    /// "current".
    pub state: String,
    pub plan_revision: Option<i64>,
    pub artifact_plan_revision: Option<i64>,
    pub template_id: Option<String>,
    pub artifact_template_id: Option<String>,
    pub paper: Option<String>,
    pub artifact_paper: Option<String>,
    pub page_count: Option<i64>,
    pub compiled_at: Option<String>,
    pub pdf_hash: Option<String>,
}

/// The template a compile of `config` would use — the same fallback chain as
/// `export_pdf` ("" defers to "jake") so comparisons never false-positive.
fn effective_template(config_template: &str) -> String {
    let trimmed = config_template.trim();
    if trimmed.is_empty() {
        "jake".to_string()
    } else {
        trimmed.to_string()
    }
}

pub fn pdf_status(
    conn: &Connection,
    job_id: i64,
    app_data_dir: &Path,
) -> Result<PdfStatus, String> {
    let stored = super::composer::get_plan(conn, job_id)?;
    let artifact = get_artifact(conn, job_id)?;
    let (plan_revision, template_id, paper) = match &stored {
        Some(plan) => (
            Some(plan.plan_revision),
            Some(effective_template(&plan.config.template_id)),
            Some(plan.config.paper.clone()),
        ),
        None => (None, None, None),
    };
    let base = PdfStatus {
        state: "none".to_string(),
        plan_revision,
        artifact_plan_revision: artifact.as_ref().and_then(|a| a.artifact_plan_revision),
        template_id,
        artifact_template_id: artifact.as_ref().map(|a| a.template_id.clone()),
        paper,
        artifact_paper: artifact.as_ref().map(|a| a.paper.clone()),
        page_count: artifact.as_ref().and_then(|a| a.page_count),
        compiled_at: artifact.as_ref().and_then(|a| a.compiled_at.clone()),
        pdf_hash: artifact.as_ref().and_then(|a| a.pdf_hash.clone()),
    };
    let (Some(stored), Some(artifact)) = (stored, artifact) else {
        return Ok(base);
    };

    // The file must exist where the row says it does — otherwise every other
    // state is a lie.
    let pdf_file = resolve_artifact_path(app_data_dir, &artifact.pdf_path);
    if !pdf_file.is_file() {
        return Ok(PdfStatus {
            state: "missing-file".to_string(),
            ..base
        });
    }

    if artifact.artifact_plan_revision != Some(stored.plan_revision) {
        return Ok(PdfStatus {
            state: "stale".to_string(),
            ..base
        });
    }

    if artifact.template_id != effective_template(&stored.config.template_id)
        || (artifact.paper != stored.config.paper)
    {
        return Ok(PdfStatus {
            state: "template-stale".to_string(),
            ..base
        });
    }

    Ok(PdfStatus {
        state: "current".to_string(),
        ..base
    })
}

/// Platform-correct Tectonic binary name (`tectonic.exe` only on Windows).
fn tectonic_binary_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "tectonic.exe"
    } else {
        "tectonic"
    }
}

/// Locates the Tectonic binary: explicit meta override → the binary bundled
/// next to the app executable (the installer ships it as a Tauri sidecar) →
/// PATH → the portable dev install. Returns a helpful error when absent.
pub fn find_tectonic(conn: &Connection) -> Result<PathBuf, String> {
    let binary_name = tectonic_binary_name();
    let override_path: Option<String> = {
        let mut stmt = sql_err(conn.prepare("SELECT value FROM meta WHERE key = 'tectonic_path'"))?;
        match stmt.query_row([], |r| r.get(0)) {
            Ok(v) => Some(v),
            Err(rusqlite::Error::QueryReturnedNoRows) => None,
            Err(e) => return Err(e.to_string()),
        }
    };
    if let Some(p) = &override_path {
        let path = PathBuf::from(p);
        if path.exists() {
            return Ok(path);
        }
        return Err(format!(
            "tectonic_path setting points to '{}' which does not exist",
            p
        ));
    }
    // Sidecar: Tauri places external binaries next to the main executable
    // (install dir when packaged, target/{debug,release} during development).
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let candidate = dir.join(binary_name);
            if candidate.exists() {
                return Ok(candidate);
            }
        }
    }
    if let Ok(path_var) = std::env::var("PATH") {
        for dir in std::env::split_paths(&path_var) {
            let candidate = dir.join(binary_name);
            if candidate.is_file() {
                return Ok(candidate);
            }
        }
    }
    if let Some(home) = dirs_home() {
        let candidate = home.join(".kairo-dev").join("bin").join(binary_name);
        if candidate.exists() {
            return Ok(candidate);
        }
        #[cfg(target_os = "windows")]
        let local = home
            .join("AppData")
            .join("Local")
            .join("Programs")
            .join("Kairo")
            .join(binary_name);
        #[cfg(not(target_os = "windows"))]
        let local = home.join(".local").join("bin").join(binary_name);
        if local.exists() {
            return Ok(local);
        }
    }
    Err(
        "Tectonic not found. Install it (winget install Tectonic.Typesetting or download from \
         github.com/tectonic-typesetting/tectonic/releases) and either add it to PATH or set the \
         path in Settings."
            .to_string(),
    )
}

fn dirs_home() -> Option<PathBuf> {
    std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .map(PathBuf::from)
        .ok()
}

/// Best-effort page count from the PDF's page-tree /Count entries.
fn count_pages(pdf_path: &Path) -> Option<i64> {
    let mut file = std::fs::File::open(pdf_path).ok()?;
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes).ok()?;
    let mut max: Option<i64> = None;
    let mut i = 0;
    while i + 7 <= bytes.len() {
        if &bytes[i..i + 7] == b"/Count " {
            let mut j = i + 7;
            while j < bytes.len() && (bytes[j] as char).is_ascii_digit() {
                j += 1;
            }
            if j > i + 7 {
                if let Ok(n) = std::str::from_utf8(&bytes[i + 7..j])
                    .unwrap_or_default()
                    .parse::<i64>()
                {
                    if n > 0 && max.map(|m| n > m).unwrap_or(true) {
                        max = Some(n);
                    }
                }
            }
            i = j;
        } else {
            i += 1;
        }
    }
    max
}

pub struct CompileOutput {
    pub artifact: PdfArtifact,
    pub log_tail: String,
}

/// Per-process counter making concurrent staging dirs unique — two exports
/// for the same job must never share (and clobber) one `.staging` dir.
fn staging_seq() -> u128 {
    use std::sync::atomic::{AtomicU64, Ordering};
    static SEQ: AtomicU64 = AtomicU64::new(0);
    let n = SEQ.fetch_add(1, Ordering::Relaxed) as u128;
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos() * 1000 + n)
        .unwrap_or(n)
}

/// A compile that finished inside its staging dir and is ready to promote.
/// Nothing under the live artifact location has been touched yet — the
/// caller gets the chance to re-check the plan revision (an edit may have
/// landed during the compile) before promoting.
pub struct StagedCompile {
    staging_dir: PathBuf,
    out_dir: PathBuf,
    staged_pdf: PathBuf,
    staged_tex: PathBuf,
    pub pdf_hash: String,
    pub log_tail: String,
    pub page_count: Option<i64>,
    /// Paths the artifact row will record, relative to the app data dir
    /// (portable across machines and restores).
    pub pdf_rel_path: String,
    pub tex_rel_path: String,
}

impl Drop for StagedCompile {
    fn drop(&mut self) {
        // An unpromoted staged compile (refused export, failed promote)
        // leaves nothing behind. A promoted one no longer has the dir.
        let _ = std::fs::remove_dir_all(&self.staging_dir);
    }
}

/// Compiles into a private staging dir under `pdf/job_{id}` without touching
/// the live artifact. Caller must NOT hold the DB lock (first run downloads
/// the TeX bundle) — serialize same-job compiles with the export lock instead.
pub fn compile_staged(
    plan: &ResumePlan,
    job_id: i64,
    template_id: &str,
    tectonic: &Path,
    app_data_dir: &Path,
    on_line: &dyn Fn(&str),
) -> Result<StagedCompile, String> {
    let tex = crate::latex::render_plan(plan, template_id);

    let out_dir = app_data_dir.join("pdf").join(format!("job_{job_id}"));
    std::fs::create_dir_all(&out_dir).map_err(|e| format!("could not create build dir: {e}"))?;

    let staging = out_dir.join(format!(".staging-{}", staging_seq()));
    let run = (|| -> Result<StagedCompile, String> {
        let staged_tex = staging.join("resume.tex");
        std::fs::write(&staged_tex, &tex).map_err(|e| format!("could not write .tex: {e}"))?;
        let (log_tail, page_count) = run_tectonic(tectonic, &staging, on_line)?;
        let staged_pdf = staging.join("resume.pdf");
        let pdf_hash = super::fingerprint::file_sha256(&staged_pdf)?;
        Ok(StagedCompile {
            staging_dir: staging.clone(),
            out_dir,
            staged_pdf,
            staged_tex,
            pdf_hash,
            log_tail,
            page_count,
            pdf_rel_path: format!("pdf/job_{job_id}/resume.pdf"),
            tex_rel_path: format!("pdf/job_{job_id}/resume.tex"),
        })
    })();
    match run {
        Ok(staged) => Ok(staged),
        Err(e) => {
            let _ = std::fs::remove_dir_all(&staging);
            Err(e)
        }
    }
}

/// Promotes a staged compile into the live artifact location via atomic
/// renames (PDF first, then the .tex; a failed .tex rename removes the
/// promoted PDF again). Hold the job's export lock so no other compile can
/// race the renames.
pub fn promote_staged(staged: StagedCompile) -> Result<(PathBuf, PathBuf), String> {
    let final_pdf = staged.out_dir.join("resume.pdf");
    let final_tex = staged.out_dir.join("resume.tex");
    std::fs::rename(&staged.staged_pdf, &final_pdf)
        .map_err(|e| format!("could not promote the compiled PDF: {e}"))?;
    if let Err(e) = std::fs::rename(&staged.staged_tex, &final_tex) {
        let _ = std::fs::remove_file(&final_pdf);
        return Err(format!("could not promote the .tex: {e}"));
    }
    Ok((final_pdf, final_tex))
}

/// Writes the .tex, runs Tectonic in a staging dir, validates the PDF, and
/// atomically promotes it into the artifact location in one go. Kept for
/// callers that don't need a revision re-check between the two (tests).
pub fn compile_locked(
    plan: ResumePlan,
    job_id: i64,
    template_id: &str,
    tectonic: &Path,
    app_data_dir: &Path,
    plan_revision: Option<i64>,
    on_line: &dyn Fn(&str),
) -> Result<CompileOutput, String> {
    let paper = plan.config.paper.clone();
    let staged = compile_staged(&plan, job_id, template_id, tectonic, app_data_dir, on_line)?;
    let log_tail = staged.log_tail.clone();
    let page_count = staged.page_count;
    let pdf_hash = staged.pdf_hash.clone();
    let (final_pdf, final_tex) = promote_staged(staged)?;
    Ok(CompileOutput {
        artifact: PdfArtifact {
            job_id,
            tex_path: relativize_or(&final_tex, app_data_dir),
            pdf_path: relativize_or(&final_pdf, app_data_dir),
            page_count,
            compiled_at: None,
            template_id: template_id.to_string(),
            paper,
            fingerprint: None,
            pdf_hash: Some(pdf_hash),
            artifact_plan_revision: plan_revision,
        },
        log_tail,
    })
}

fn relativize_or(p: &Path, app_data_dir: &Path) -> String {
    p.strip_prefix(app_data_dir)
        .map(|r| r.to_string_lossy().to_string())
        .unwrap_or_else(|_| p.to_string_lossy().to_string())
}

/// Runs Tectonic inside `dir` (which must already hold `resume.tex`), drains
/// its output, and validates the produced `resume.pdf`. Returns the log tail
/// and the page count. Everything happens inside the caller's staging dir —
/// the live artifact location is not touched.
fn run_tectonic(
    tectonic: &Path,
    dir: &Path,
    on_line: &dyn Fn(&str),
) -> Result<(String, Option<i64>), String> {
    let mut child = std::process::Command::new(tectonic)
        .arg("--outdir")
        .arg(dir)
        .arg("--keep-logs")
        .arg("resume.tex")
        .current_dir(dir)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("failed to launch Tectonic: {e}"))?;

    // Drain stdout on a thread so a full pipe can never deadlock the compile;
    // progress lines stream from stderr while we read it here.
    let mut stdout_pipe = child.stdout.take();
    let stdout_thread = std::thread::spawn(move || {
        let mut buf = String::new();
        if let Some(pipe) = stdout_pipe.as_mut() {
            use std::io::Read;
            let _ = pipe.read_to_string(&mut buf);
        }
        buf
    });

    let mut log = String::new();
    if let Some(stderr) = child.stderr.take() {
        use std::io::{BufRead, BufReader};
        for line in BufReader::new(stderr).lines() {
            match line {
                Ok(l) => {
                    log.push_str(&l);
                    log.push('\n');
                    on_line(&l);
                }
                Err(_) => break,
            }
        }
    }
    let stdout_tail = stdout_thread.join().unwrap_or_default();
    if !stdout_tail.is_empty() {
        log.push_str(&stdout_tail);
        log.push('\n');
    }

    let status = child
        .wait()
        .map_err(|e| format!("failed to wait for Tectonic: {e}"))?;

    let log_tail: String = log
        .lines()
        .rev()
        .take(15)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect::<Vec<_>>()
        .join("\n");

    if !status.success() {
        return Err(format!(
            "Tectonic failed (exit {:?}):\n{}",
            status.code(),
            log_tail
        ));
    }

    let pdf_path = dir.join("resume.pdf");
    if !pdf_path.exists() {
        return Err(format!(
            "Tectonic reported success but resume.pdf is missing.\n{log_tail}"
        ));
    }
    let size = std::fs::metadata(&pdf_path).map(|m| m.len()).unwrap_or(0);
    if size < 500 {
        return Err(format!(
            "resume.pdf looks truncated ({size} bytes).\n{log_tail}"
        ));
    }
    // Page count: the TeX log states "Output written on resume.xdv (N page".
    // Raw-byte /Count scanning fails here because xdvipdfmx compresses objects.
    let page_count = {
        let log_path = dir.join("resume.log");
        let log = std::fs::read_to_string(&log_path).unwrap_or_default();
        let from_log = log
            .split("Output written on ")
            .last()
            .and_then(|seg| seg.split_whitespace().next())
            .and_then(|seg| {
                seg.strip_suffix("page")
                    .or_else(|| seg.strip_suffix("pages"))
                    .map(|p| p.to_string())
            })
            .and_then(|p| p.parse::<i64>().ok());
        from_log.or_else(|| count_pages(&pdf_path))
    };

    Ok((log_tail, page_count))
}

/// Convenience used by tests: plan line estimate stays consistent with the composer.
#[allow(dead_code)]
pub fn plan_lines(plan: &ResumePlan) -> u32 {
    estimate_plan_lines(plan)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::apply_migrations;
    use rusqlite::Connection;

    fn mem_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        apply_migrations(&conn).unwrap();
        conn
    }

    fn plan_config(template: &str, paper: &str) -> crate::composer::ComposerConfig {
        crate::composer::ComposerConfig {
            target_pages: 1,
            max_projects: 4,
            max_experience_items: 3,
            max_bullets_per_item: 4,
            min_font_size_pt: 9.0,
            template_id: template.to_string(),
            paper: paper.to_string(),
        }
    }

    fn plan_json(config: &crate::composer::ComposerConfig) -> String {
        serde_json::json!({
            "composerVersion": 1,
            "config": config,
            "header": {
                "fullName": "Ada", "headline": "", "email": "", "phone": "",
                "location": "", "website": "", "github": "", "linkedin": ""
            },
            "education": [],
            "experience": [],
            "projects": [],
            "skills": [],
            "estimatedLines": 10,
            "fitsOnePage": true,
            "warnings": []
        })
        .to_string()
    }

    fn seed_plan(conn: &Connection, revision: i64, template: &str, paper: &str) -> i64 {
        conn.execute(
            "INSERT INTO jobs (company, role_title, raw_jd) VALUES ('Acme', 'Dev', 'jd')",
            [],
        )
        .unwrap();
        let job_id = conn.last_insert_rowid();
        let config = plan_config(template, paper);
        conn.execute(
            "INSERT INTO resume_plans (job_id, config_json, plan_json, composer_version, plan_revision) \
             VALUES (?1, ?2, ?3, 'test', ?4)",
            rusqlite::params![
                job_id,
                serde_json::to_string(&config).unwrap(),
                plan_json(&config),
                revision
            ],
        )
        .unwrap();
        job_id
    }

    fn sample_artifact(job_id: i64, revision: i64, template: &str, paper: &str) -> PdfArtifact {
        PdfArtifact {
            job_id,
            tex_path: format!("pdf/job_{job_id}/resume.tex"),
            pdf_path: format!("pdf/job_{job_id}/resume.pdf"),
            page_count: Some(1),
            compiled_at: None,
            template_id: template.to_string(),
            paper: paper.to_string(),
            fingerprint: Some("fp".to_string()),
            pdf_hash: Some("hash".to_string()),
            artifact_plan_revision: Some(revision),
        }
    }

    /// The artifact persist is a compare-and-set on the plan revision: a save
    /// that landed while the PDF compiled must never be overwritten by an
    /// artifact describing the older content.
    #[test]
    fn save_artifact_is_conditional_on_the_plan_revision() {
        let conn = mem_db();
        let job_id = seed_plan(&conn, 1, "jake", "letter");

        // Matching revision — the row is written.
        save_artifact(
            &conn,
            &sample_artifact(job_id, 1, "jake", "letter"),
            Some(1),
        )
        .unwrap();
        let stored = get_artifact(&conn, job_id).unwrap().unwrap();
        assert_eq!(stored.artifact_plan_revision, Some(1));
        assert_eq!(stored.pdf_hash.as_deref(), Some("hash"));

        // An edit landed (revision bumped): the older export must be refused
        // and the row must keep describing the newer compile.
        conn.execute(
            "UPDATE resume_plans SET plan_revision = 2 WHERE job_id = ?1",
            [job_id],
        )
        .unwrap();
        let err = save_artifact(
            &conn,
            &sample_artifact(job_id, 1, "jake", "letter"),
            Some(1),
        )
        .unwrap_err();
        assert!(err.contains("plan changed"), "{err}");
        let stored = get_artifact(&conn, job_id).unwrap().unwrap();
        assert_eq!(stored.artifact_plan_revision, Some(1), "row untouched");
        assert_eq!(stored.pdf_hash.as_deref(), Some("hash"), "row untouched");
    }

    #[test]
    fn pdf_status_derives_from_saved_and_artifact_state() {
        let conn = mem_db();
        let dir = std::env::temp_dir().join(format!("kairo-pdf-status-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();

        // No plan at all.
        assert_eq!(pdf_status(&conn, 999, &dir).unwrap().state, "none");

        let job_id = seed_plan(&conn, 1, "jake", "letter");
        assert_eq!(pdf_status(&conn, job_id, &dir).unwrap().state, "none");

        // Plan + artifact row + file on disk → current.
        let pdf_file = dir
            .join("pdf")
            .join(format!("job_{job_id}"))
            .join("resume.pdf");
        std::fs::create_dir_all(pdf_file.parent().unwrap()).unwrap();
        std::fs::write(&pdf_file, b"%PDF-1.4 fake").unwrap();
        save_artifact(
            &conn,
            &sample_artifact(job_id, 1, "jake", "letter"),
            Some(1),
        )
        .unwrap();
        assert_eq!(pdf_status(&conn, job_id, &dir).unwrap().state, "current");

        // An edit after the compile → stale.
        conn.execute(
            "UPDATE resume_plans SET plan_revision = 2 WHERE job_id = ?1",
            [job_id],
        )
        .unwrap();
        assert_eq!(pdf_status(&conn, job_id, &dir).unwrap().state, "stale");

        // Same revision but a different template → template-stale.
        conn.execute(
            "UPDATE resume_plans SET plan_revision = 1, config_json = ?2 WHERE job_id = ?1",
            rusqlite::params![
                job_id,
                serde_json::to_string(&plan_config("expressive", "letter")).unwrap()
            ],
        )
        .unwrap();
        assert_eq!(
            pdf_status(&conn, job_id, &dir).unwrap().state,
            "template-stale"
        );

        // File deleted → missing-file beats every other state.
        std::fs::remove_file(&pdf_file).unwrap();
        assert_eq!(
            pdf_status(&conn, job_id, &dir).unwrap().state,
            "missing-file"
        );

        let _ = std::fs::remove_dir_all(&dir);
    }
}
