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
}

pub fn get_artifact(conn: &Connection, job_id: i64) -> Result<Option<PdfArtifact>, String> {
    let mut stmt = sql_err(conn.prepare(
        "SELECT job_id, tex_path, pdf_path, page_count, compiled_at FROM resume_plans \
         WHERE job_id = ?1 AND pdf_path IS NOT NULL",
    ))?;
    match stmt.query_row([job_id], |row| {
        Ok(PdfArtifact {
            job_id: row.get(0)?,
            tex_path: row.get(1)?,
            pdf_path: row.get(2)?,
            page_count: row.get(3)?,
            compiled_at: row.get(4)?,
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
) -> Result<(), String> {
    sql_err(conn.execute(
        "UPDATE resume_plans SET pdf_path = ?1, tex_path = ?2, page_count = ?3, \
           compiled_at = datetime('now') WHERE job_id = ?4",
        params![artifact.pdf_path, artifact.tex_path, artifact.page_count, artifact.job_id],
    ))?;
    Ok(())
}

/// Locates the Tectonic binary: explicit meta override → PATH → the portable
/// install used on this machine. Returns a helpful error when absent.
pub fn find_tectonic(conn: &Connection) -> Result<PathBuf, String> {
    let override_path: Option<String> = {
        let mut stmt = sql_err(conn.prepare(
            "SELECT value FROM meta WHERE key = 'tectonic_path'",
        ))?;
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
    if let Ok(path_var) = std::env::var("PATH") {
        for dir in std::env::split_paths(&path_var) {
            let candidate = dir.join("tectonic.exe");
            if candidate.exists() {
                return Ok(candidate);
            }
        }
    }
    if let Some(home) = dirs_home() {
        let candidate = home.join(".kairo-dev").join("bin").join("tectonic.exe");
        if candidate.exists() {
            return Ok(candidate);
        }
        let local = home
            .join("AppData")
            .join("Local")
            .join("Programs")
            .join("Kairo")
            .join("tectonic.exe");
        if local.exists() {
            return Ok(local);
        }
    }
    Err("Tectonic not found. Install it (winget install Tectonic.Typesetting or download from \
         github.com/tectonic-typesetting/tectonic/releases) and either add it to PATH or set the \
         path in Settings."
        .to_string())
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
                if let Ok(n) = std::str::from_utf8(&bytes[i + 7..j]).unwrap_or_default().parse::<i64>() {
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

/// Writes the .tex, runs Tectonic, validates the PDF, and returns the artifact.
/// Caller must NOT hold the DB lock (first run downloads the TeX bundle).
pub fn compile_locked(
    plan: ResumePlan,
    job_id: i64,
    template_id: &str,
    tectonic: &Path,
    app_data_dir: &Path,
) -> Result<CompileOutput, String> {
    let tex = crate::latex::render_plan(&plan, template_id);

    let out_dir = app_data_dir
        .join("pdf")
        .join(format!("job_{job_id}"));
    std::fs::create_dir_all(&out_dir).map_err(|e| format!("could not create build dir: {e}"))?;
    let tex_path = out_dir.join("resume.tex");
    std::fs::write(&tex_path, &tex).map_err(|e| format!("could not write .tex: {e}"))?;

    let output = std::process::Command::new(&tectonic)
        .arg("--outdir")
        .arg(&out_dir)
        .arg("--keep-logs")
        .arg("resume.tex")
        .current_dir(&out_dir)
        .output()
        .map_err(|e| format!("failed to launch Tectonic: {e}"))?;

    let mut log = String::new();
    log.push_str(&String::from_utf8_lossy(&output.stdout));
    log.push_str(&String::from_utf8_lossy(&output.stderr));
    let log_tail: String = log
        .lines()
        .rev()
        .take(15)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect::<Vec<_>>()
        .join("\n");

    if !output.status.success() {
        return Err(format!(
            "Tectonic failed (exit {:?}):\n{}",
            output.status.code(),
            log_tail
        ));
    }

    let pdf_path = out_dir.join("resume.pdf");
    if !pdf_path.exists() {
        return Err(format!("Tectonic reported success but resume.pdf is missing.\n{log_tail}"));
    }
    let size = std::fs::metadata(&pdf_path).map(|m| m.len()).unwrap_or(0);
    if size < 500 {
        return Err(format!("resume.pdf looks truncated ({size} bytes).\n{log_tail}"));
    }
    // Page count: the TeX log states "Output written on resume.xdv (N page".
    // Raw-byte /Count scanning fails here because xdvipdfmx compresses objects.
    let page_count = {
        let log_path = out_dir.join("resume.log");
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

    Ok(CompileOutput {
        artifact: PdfArtifact {
            job_id,
            tex_path: tex_path.display().to_string(),
            pdf_path: pdf_path.display().to_string(),
            page_count,
            compiled_at: None,
        },
        log_tail,
    })
}

/// Convenience used by tests: plan line estimate stays consistent with the composer.
#[allow(dead_code)]
pub fn plan_lines(plan: &ResumePlan) -> u32 {
    estimate_plan_lines(plan)
}
