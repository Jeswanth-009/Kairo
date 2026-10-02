//! Immutable resume version snapshots (Phase 10 · spec §9.2).
//!
//! A version freezes every input that produced the compiled PDF: the raw JD
//! and requirement set, the match report, the plan, accepted tailoring, all
//! engine versions, and a private copy of the PDF. Rows are never updated —
//! "reopen what I sent" must stay possible forever.

use super::vault::sql_err;
use crate::composer::ResumePlan;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

pub const TEMPLATE_VERSION: u32 = 1; // the single ATS-safe LaTeX template

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionSnapshot {
    pub version_number: u32,
    pub job: super::jobs::Job,
    pub requirements: Vec<super::jobs::JobRequirement>,
    pub match_report: Option<crate::matching::MatchReport>,
    pub plan: crate::composer::ResumePlan,
    pub accepted_tailorings: Vec<super::tailor::TailorSuggestion>,
    pub matching_version: u32,
    pub composer_version: u32,
    pub template_version: u32,
    pub pdf_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResumeVersion {
    pub id: i64,
    pub job_id: i64,
    pub version_number: u32,
    pub created_at: String,
    pub pdf_path: String,
    /// Fingerprint of the render inputs recorded at export — proves this
    /// snapshot froze exactly what produced the PDF.
    #[serde(default)]
    pub fingerprint: Option<String>,
    /// SHA-256 of the version's own PDF copy.
    #[serde(default)]
    pub pdf_hash: Option<String>,
    pub snapshot: VersionSnapshot,
}

const VERSION_COLS: &str =
    "id, job_id, version_number, snapshot_json, pdf_path, created_at, fingerprint, pdf_hash";

fn hydrate(row: &rusqlite::Row) -> rusqlite::Result<ResumeVersion> {
    let id: i64 = row.get(0)?;
    let job_id: i64 = row.get(1)?;
    let version_number: u32 = row.get(2)?;
    let snapshot_json: String = row.get(3)?;
    let pdf_path: String = row.get(4)?;
    let created_at: String = row.get(5)?;
    let fingerprint: Option<String> = row.get(6)?;
    let pdf_hash: Option<String> = row.get(7)?;
    let snapshot: VersionSnapshot = serde_json::from_str(&snapshot_json).unwrap_or_else(|_| {
        // Corrupt snapshot: keep the metadata, expose an empty body rather
        // than failing the whole list. Constructed directly — a JSON
        // round-trip cannot build a valid default (required fields).
        VersionSnapshot {
            version_number,
            job: super::jobs::Job {
                id: job_id,
                company: String::new(),
                role_title: String::new(),
                url: String::new(),
                raw_jd: String::new(),
                seniority: String::new(),
                domain: String::new(),
                requirement_count: 0,
            },
            requirements: vec![],
            match_report: None,
            plan: ResumePlan {
                composer_version: 0,
                config: crate::composer::ComposerConfig::default(),
                header: crate::composer::PlanHeader {
                    full_name: String::new(),
                    headline: String::new(),
                    email: String::new(),
                    phone: String::new(),
                    location: String::new(),
                    website: String::new(),
                    github: String::new(),
                    linkedin: String::new(),
                },
                education: vec![],
                experience: vec![],
                projects: vec![],
                achievements: vec![],
                skills: vec![],
                skills_grouped: vec![],
                excluded_skills: vec![],
                estimated_lines: 0,
                fits_one_page: false,
                warnings: vec![
                    "This version's snapshot could not be read (corrupt row) — metadata is intact."
                        .to_string(),
                ],
            },
            accepted_tailorings: vec![],
            matching_version: 0,
            composer_version: 0,
            template_version: 0,
            pdf_path: pdf_path.clone(),
        }
    });
    Ok(ResumeVersion {
        id,
        job_id,
        version_number,
        created_at,
        pdf_path,
        fingerprint,
        pdf_hash,
        snapshot,
    })
}

/// Creates the next immutable version for a job: snapshots every input and
/// copies the current PDF into a version-owned directory.
///
/// Refuses to save when the current plan has drifted from the exported PDF:
/// the artifact's `compiled_fingerprint` (recorded at export over the
/// post-overlay plan + template + paper) is recomputed from live state and
/// must match, and the PDF on disk must match the export's hash. "Reopen
/// what I sent" stays exact — a version is only ever the PDF you exported
/// with the plan that produced it.
pub fn create_version(
    conn: &Connection,
    job_id: i64,
    app_data_dir: &std::path::Path,
) -> Result<ResumeVersion, String> {
    // 1. Gather the current state (all reads before any writes).
    let job = super::jobs::get_job_enriched(conn, job_id)?;
    let requirements = super::jobs::list_requirements(conn, job_id)?;
    let match_report = super::matching::get_report(conn, job_id)?;
    let stored_plan = super::composer::get_plan(conn, job_id)?.ok_or_else(|| {
        "No plan for this workspace — compose one before saving a version".to_string()
    })?;
    let artifact = super::pdf::get_artifact(conn, job_id)?
        .ok_or_else(|| "No compiled PDF for this workspace — export the PDF first".to_string())?;
    let all_tailorings = list_tailorings(conn, job_id)?;
    let accepted_tailorings: Vec<super::tailor::TailorSuggestion> = all_tailorings
        .into_iter()
        .filter(|s| s.status == "accepted")
        .collect();

    // 2. Exactness gate: the artifact must carry a fingerprint (pre-0013
    //    exports predate it) and the live render inputs must still hash to
    //    it — otherwise the PDF on disk is not what the plan would produce.
    let exported_fingerprint = artifact.fingerprint.as_deref().ok_or_else(|| {
        "This PDF was exported by an older Kairo — recompile once, then save the version"
            .to_string()
    })?;
    let mut rendered = stored_plan.plan.clone();
    let _ = super::tailor::apply_accepted_suggestions(conn, job_id, &mut rendered)?;
    let current_fingerprint =
        super::fingerprint::render_fingerprint(&rendered, &artifact.template_id, &artifact.paper);
    if current_fingerprint != exported_fingerprint {
        return Err(
            "The plan changed since the PDF was exported — recompile, then save the version"
                .to_string(),
        );
    }
    let pdf_src = std::path::PathBuf::from(&artifact.pdf_path);
    if !pdf_src.is_file() {
        return Err(
            "The compiled PDF is missing on disk — recompile before saving a version".to_string(),
        );
    }
    let pdf_hash = super::fingerprint::file_sha256(&pdf_src)?;
    if let Some(recorded) = artifact.pdf_hash.as_deref() {
        if recorded != pdf_hash {
            return Err(
                "The compiled PDF on disk no longer matches its export record — recompile before saving a version"
                    .to_string(),
            );
        }
    }

    // 3. Numbering: next per-job version.
    let next: u32 = sql_err(conn.query_row(
        "SELECT COALESCE(MAX(version_number), 0) + 1 FROM resume_versions WHERE job_id = ?1",
        [job_id],
        |r| r.get(0),
    ))?;

    // 4. Copy the PDF into a version-owned directory (immutability). The
    //    copy lands via a `.part` rename so a half-written file can never
    //    occupy the version's permanent name, and the row is only inserted
    //    once the copy is complete.
    let version_dir = app_data_dir
        .join("pdf")
        .join(format!("job_{job_id}"))
        .join("versions")
        .join(format!("v{next}"));
    std::fs::create_dir_all(&version_dir)
        .map_err(|e| format!("could not create version dir: {e}"))?;
    let version_pdf = version_dir.join("resume.pdf");
    let copy = (|| -> Result<(), String> {
        let part = version_dir.join("resume.pdf.part");
        std::fs::copy(&pdf_src, &part).map_err(|e| {
            format!(
                "could not copy the compiled PDF ({}): {e}",
                pdf_src.display()
            )
        })?;
        std::fs::rename(&part, &version_pdf)
            .map_err(|e| format!("could not finalize the version PDF: {e}"))
    })();
    if let Err(e) = copy {
        let _ = std::fs::remove_dir_all(&version_dir);
        return Err(e);
    }

    // 5. Insert the snapshot.
    let snapshot = VersionSnapshot {
        version_number: next,
        job: job.clone(),
        requirements: requirements.clone(),
        match_report: match_report.clone(),
        plan: stored_plan.plan.clone(),
        accepted_tailorings: accepted_tailorings.clone(),
        matching_version: match_report
            .as_ref()
            .map(|r| r.matching_version)
            .unwrap_or(0),
        composer_version: stored_plan.plan.composer_version,
        template_version: TEMPLATE_VERSION,
        pdf_path: version_pdf.display().to_string(),
    };
    let snapshot_json = serde_json::to_string(&snapshot).map_err(|e| e.to_string())?;

    sql_err(conn.execute(
        "INSERT INTO resume_versions (job_id, version_number, snapshot_json, pdf_path, fingerprint, pdf_hash) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            job_id,
            next as i64,
            snapshot_json,
            version_pdf.display().to_string(),
            exported_fingerprint,
            pdf_hash
        ],
    ))?;
    let id = conn.last_insert_rowid();

    let mut stmt = sql_err(conn.prepare(&format!(
        "SELECT {} FROM resume_versions WHERE id = ?1",
        VERSION_COLS
    )))?;
    sql_err(stmt.query_row([id], hydrate))
}

fn list_tailorings(
    conn: &Connection,
    job_id: i64,
) -> Result<Vec<super::tailor::TailorSuggestion>, String> {
    super::tailor::list_suggestions(conn, job_id)
}

pub fn list_versions(conn: &Connection, job_id: i64) -> Result<Vec<ResumeVersion>, String> {
    let mut stmt = sql_err(conn.prepare(&format!(
        "SELECT {} FROM resume_versions WHERE job_id = ?1 ORDER BY version_number DESC",
        VERSION_COLS
    )))?;
    let mapped = sql_err(stmt.query_map([job_id], hydrate))?;
    sql_err(mapped.collect::<rusqlite::Result<Vec<_>>>())
}

pub fn get_version(conn: &Connection, id: i64) -> Result<ResumeVersion, String> {
    let mut stmt = sql_err(conn.prepare(&format!(
        "SELECT {} FROM resume_versions WHERE id = ?1",
        VERSION_COLS
    )))?;
    sql_err(stmt.query_row([id], hydrate))
}
