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

pub fn save_artifact(conn: &Connection, artifact: &PdfArtifact) -> Result<(), String> {
    sql_err(conn.execute(
        "UPDATE resume_plans SET pdf_path = ?1, tex_path = ?2, page_count = ?3, \
           artifact_template_id = ?4, artifact_paper = ?5, \
           compiled_fingerprint = ?6, pdf_hash = ?7, artifact_plan_revision = ?8, \
           compiled_at = datetime('now') WHERE job_id = ?9",
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
    ))?;
    Ok(())
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

/// Outputs a compile closure produces inside its staging dir, relative to it.
/// Everything else the caller needs (log tail, page count) travels through
/// `stage_and_promote`'s payload.
pub struct StagedOutput {
    pub pdf_name: String,
    pub tex_name: String,
}

/// Runs `compile` inside a fresh `.staging` directory under `out_dir` and
/// only on success promotes its outputs into `out_dir` via atomic renames.
/// The previous PDF in `out_dir` is never touched until the new one is
/// complete and validated — an interrupted export leaves the last good
/// artifact in place. The staging dir is removed on every path.
///
/// The pdf file is hashed while promoting, so the caller can persist the
/// fingerprint of what was actually written. `compile` may hand any extra
/// payload through (`T`), e.g. the page count parsed from the compile log.
pub fn stage_and_promote<T>(
    out_dir: &Path,
    compile: impl FnOnce(&Path) -> Result<(StagedOutput, T), String>,
) -> Result<(PathBuf, PathBuf, String, T), String> {
    let staging = out_dir.join(".staging");
    let _ = std::fs::remove_dir_all(&staging);
    std::fs::create_dir_all(&staging).map_err(|e| format!("could not create build dir: {e}"))?;

    let result = compile(&staging).and_then(|(out, payload)| {
        let staged_pdf = staging.join(&out.pdf_name);
        let staged_tex = staging.join(&out.tex_name);
        // The hash is taken before the renames: it must describe the bytes
        // that land in the artifact, not whatever a later run would produce.
        let pdf_hash = super::fingerprint::file_sha256(&staged_pdf)?;
        let final_pdf = out_dir.join(&out.pdf_name);
        let final_tex = out_dir.join(&out.tex_name);
        std::fs::rename(&staged_pdf, &final_pdf)
            .map_err(|e| format!("could not promote the compiled PDF: {e}"))?;
        std::fs::rename(&staged_tex, &final_tex)
            .map_err(|e| format!("could not promote the .tex: {e}"))?;
        Ok((final_pdf, final_tex, pdf_hash, payload))
    });
    let _ = std::fs::remove_dir_all(&staging);
    result
}

/// Writes the .tex, runs Tectonic in a staging dir, validates the PDF, and
/// atomically promotes it into the artifact location. Caller must NOT hold
/// the DB lock (first run downloads the TeX bundle). `on_line` receives each
/// compiler output line as it arrives so the UI can show live progress
/// instead of a frozen spinner during long first compiles.
pub fn compile_locked(
    plan: ResumePlan,
    job_id: i64,
    template_id: &str,
    tectonic: &Path,
    app_data_dir: &Path,
    plan_revision: Option<i64>,
    on_line: &dyn Fn(&str),
) -> Result<CompileOutput, String> {
    let tex = crate::latex::render_plan(&plan, template_id);
    let paper = plan.config.paper.clone();

    let out_dir = app_data_dir.join("pdf").join(format!("job_{job_id}"));
    std::fs::create_dir_all(&out_dir).map_err(|e| format!("could not create build dir: {e}"))?;

    let (pdf_path, tex_path, pdf_hash, (log_tail, page_count)) =
        stage_and_promote(&out_dir, |staging| {
            let tex_path = staging.join("resume.tex");
            std::fs::write(&tex_path, &tex).map_err(|e| format!("could not write .tex: {e}"))?;
            let (log_tail, page_count) = run_tectonic(tectonic, staging, on_line)?;
            Ok((
                StagedOutput {
                    pdf_name: "resume.pdf".to_string(),
                    tex_name: "resume.tex".to_string(),
                },
                (log_tail, page_count),
            ))
        })?;

    // Store paths relative to the app data dir so backups restore portable.
    let relativize = |p: &Path| -> String {
        p.strip_prefix(app_data_dir)
            .map(|r| r.to_string_lossy().to_string())
            .unwrap_or_else(|_| p.to_string_lossy().to_string())
    };
    Ok(CompileOutput {
        artifact: PdfArtifact {
            job_id,
            tex_path: relativize(&tex_path),
            pdf_path: relativize(&pdf_path),
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
