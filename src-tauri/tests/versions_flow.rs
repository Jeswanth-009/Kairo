//! Integration test: the immutable version-snapshot flow against a fixture
//! database the test seeds itself (profile → job + requirements → plan →
//! compiled PDF), so it runs real assertions on every machine and in CI —
//! no dependency on any developer's live data. Covers the exactness gate:
//! a version may only freeze a PDF whose fingerprint still matches the plan.

use kairo_lib::composer::ComposerConfig;
use kairo_lib::db::vault as vault_db;
use kairo_lib::db::versions;
use kairo_lib::db::{composer as composer_db, fingerprint, jobs as jobs_db, tailor as tailor_db};
use rusqlite::Connection;

fn fixture_db() -> Connection {
    let conn = Connection::open_in_memory().expect("open in-memory db");
    kairo_lib::db::apply_migrations(&conn).expect("migrations apply cleanly");
    conn
}

fn seed_profile(conn: &Connection) {
    vault_db::upsert_profile(
        conn,
        &vault_db::Profile {
            full_name: "Test User".to_string(),
            headline: "Backend Developer".to_string(),
            email: "test.user@example.com".to_string(),
            phone: String::new(),
            location: String::new(),
            website: String::new(),
            github: String::new(),
            linkedin: String::new(),
            summary: String::new(),
        },
    )
    .expect("profile seeds");
}

fn seed_job_with_requirements(conn: &Connection) -> i64 {
    let job = jobs_db::Job {
        id: 0,
        company: "Fixture Robotics".to_string(),
        role_title: "Backend Engineer".to_string(),
        url: String::new(),
        raw_jd: "Build reliable data pipelines in Rust. Requirements: Rust, SQL, queues."
            .to_string(),
        seniority: "Mid".to_string(),
        domain: "Backend".to_string(),
        kind: "role".to_string(),
        requirement_count: 0,
    };
    let requirements = vec![
        jobs_db::JobRequirement {
            id: 0,
            job_id: 0,
            kind: "required_skill".to_string(),
            raw_text: "Rust".to_string(),
            normalized_key: "rust".to_string(),
            importance: 0.9,
            user_confirmed: true,
        },
        jobs_db::JobRequirement {
            id: 0,
            job_id: 0,
            kind: "responsibility".to_string(),
            raw_text: "Build reliable data pipelines".to_string(),
            normalized_key: "build reliable data pipelines".to_string(),
            importance: 0.7,
            user_confirmed: true,
        },
    ];
    jobs_db::create_job_with_requirements(conn, &job, &requirements)
        .expect("job seeds")
        .job
        .id
}

/// A minimal but real PDF file — `create_version` must copy it verbatim.
/// Also records the fingerprint + hash exactly the way `export_pdf` does, so
/// the fixture looks like a genuine export to the exactness gate.
fn seed_compiled_pdf(conn: &Connection, job_id: i64, tag: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "kairo-versions-fixture-{tag}-{}-{job_id}",
        std::process::id()
    ));
    std::fs::create_dir_all(&dir).expect("artifact dir");
    let pdf = dir.join("resume.pdf");
    std::fs::write(&pdf, b"%PDF-1.4\n%fixture artifact\n%%EOF\n").expect("artifact pdf");
    let tex = dir.join("resume.tex");
    std::fs::write(
        &tex,
        b"\\documentclass{article}\\begin{document}x\\end{document}",
    )
    .expect("artifact tex");

    let stored = composer_db::get_plan(conn, job_id)
        .expect("plan readable")
        .expect("plan exists");
    let template_id = stored.plan.config.template_id.clone();
    let paper = stored.plan.config.paper.clone();
    let mut rendered = stored.plan;
    tailor_db::apply_accepted_suggestions(conn, job_id, &mut rendered).expect("overlay applies");
    let fingerprint = fingerprint::render_fingerprint(&rendered, &template_id, &paper);
    let pdf_hash = fingerprint::file_sha256(&pdf).expect("artifact hashes");
    conn.execute(
        "UPDATE resume_plans SET pdf_path = ?1, tex_path = ?2, artifact_template_id = ?3, \
         artifact_paper = ?4, compiled_fingerprint = ?5, pdf_hash = ?6,          reviewed_pdf_hash = ?6 WHERE job_id = ?7",
        rusqlite::params![
            pdf.display().to_string(),
            tex.display().to_string(),
            template_id,
            paper,
            fingerprint,
            pdf_hash,
            job_id
        ],
    )
    .expect("attach artifact to plan");
    pdf
}

#[test]
fn version_snapshot_flow_roundtrips_every_input() {
    let conn = fixture_db();
    seed_profile(&conn);
    let job_id = seed_job_with_requirements(&conn);
    composer_db::run_composer(&conn, job_id, &ComposerConfig::default()).expect("plan composes");
    let artifact = seed_compiled_pdf(&conn, job_id, "roundtrip");

    let data_dir =
        std::env::temp_dir().join(format!("kairo-versions-test-data-{}", std::process::id()));
    std::fs::create_dir_all(&data_dir).unwrap();

    let v1 = versions::create_version(&conn, job_id, &data_dir).expect("first version");
    assert_eq!(v1.version_number, 1);
    assert_eq!(v1.snapshot.version_number, 1);
    assert!(v1.snapshot.job.raw_jd.contains("data pipelines"));
    assert_eq!(v1.snapshot.requirements.len(), 2);
    assert_eq!(v1.snapshot.plan.header.full_name, "Test User");
    assert!(
        v1.fingerprint.is_some(),
        "version records the export fingerprint"
    );
    assert!(v1.pdf_hash.is_some(), "version records the PDF hash");
    // Stored paths are relative to the app data dir (migration 0015).
    let v1_path = data_dir.join(&v1.pdf_path);
    assert!(
        v1_path.exists(),
        "version pdf exists at {}",
        v1_path.display()
    );
    assert_ne!(v1_path, artifact, "version owns its PDF copy");
    let pdf = std::fs::read(&v1_path).unwrap();
    assert!(pdf.starts_with(b"%PDF-"));

    let v2 = versions::create_version(&conn, job_id, &data_dir).expect("second version");
    assert_eq!(v2.version_number, 2);

    let list = versions::list_versions(&conn, job_id).unwrap();
    assert_eq!(list.len(), 2);
    assert_eq!(list[0].version_number, 2); // newest first

    let fetched = versions::get_version(&conn, v1.id).unwrap();
    assert_eq!(
        fetched.snapshot.plan.header.full_name,
        v1.snapshot.plan.header.full_name
    );

    let _ = std::fs::remove_dir_all(&data_dir);
    let _ = std::fs::remove_dir_all(artifact.parent().unwrap());
}

/// Acceptance check: "Edit a plan after export; 'Save version' must require
/// a new export." Recomposing the plan with different caps changes its
/// fingerprint; saving must refuse until the fixture re-exports.
#[test]
fn editing_the_plan_after_export_requires_a_new_export() {
    let conn = fixture_db();
    seed_profile(&conn);
    let job_id = seed_job_with_requirements(&conn);
    composer_db::run_composer(&conn, job_id, &ComposerConfig::default()).expect("plan composes");
    let artifact = seed_compiled_pdf(&conn, job_id, "stale-plan");

    let data_dir =
        std::env::temp_dir().join(format!("kairo-versions-test-stale-{}", std::process::id()));
    std::fs::create_dir_all(&data_dir).unwrap();

    // The plan drifts after the export: target_pages lives inside the plan
    // config, so the recomposed plan is guaranteed to hash differently.
    let drifted = ComposerConfig {
        target_pages: 2,
        ..Default::default()
    };
    composer_db::run_composer(&conn, job_id, &drifted).expect("plan recomposes");

    let err = versions::create_version(&conn, job_id, &data_dir).unwrap_err();
    assert!(
        err.contains("recompile"),
        "staleness must demand a recompile, got: {err}"
    );
    // Nothing may have been written.
    assert!(
        versions::list_versions(&conn, job_id).unwrap().is_empty(),
        "a refused save must not leave a version row"
    );

    // Re-export (fresh fingerprint for the new plan) → the save goes through.
    let artifact2 = seed_compiled_pdf(&conn, job_id, "stale-plan2");
    let v = versions::create_version(&conn, job_id, &data_dir).expect("save after re-export");
    assert_eq!(v.version_number, 1);
    assert!(v.fingerprint.is_some());

    // A pre-fingerprint artifact (older release) is refused too.
    conn.execute(
        "UPDATE resume_plans SET compiled_fingerprint = NULL WHERE job_id = ?1",
        [job_id],
    )
    .unwrap();
    let err = versions::create_version(&conn, job_id, &data_dir).unwrap_err();
    assert!(
        err.contains("older Kairo"),
        "pre-fingerprint artifacts must be refused, got: {err}"
    );

    let _ = std::fs::remove_dir_all(&data_dir);
    let _ = std::fs::remove_dir_all(artifact.parent().unwrap());
    let _ = std::fs::remove_dir_all(artifact2.parent().unwrap());
}

/// Every version needs a human review of THIS exact PDF — not just version 1.
#[test]
fn saving_a_version_requires_the_exact_pdf_reviewed() {
    let conn = fixture_db();
    seed_profile(&conn);
    let job_id = seed_job_with_requirements(&conn);
    composer_db::run_composer(&conn, job_id, &ComposerConfig::default()).expect("plan composes");
    let artifact = seed_compiled_pdf(&conn, job_id, "review-gate");
    // The fixture pre-marks the artifact reviewed for the other tests —
    // clear it here so the gate is what is under test.

    let data_dir =
        std::env::temp_dir().join(format!("kairo-versions-test-review-{}", std::process::id()));
    std::fs::create_dir_all(&data_dir).unwrap();

    conn.execute(
        "UPDATE resume_plans SET reviewed_pdf_hash = NULL WHERE job_id = ?1",
        [job_id],
    )
    .unwrap();

    let err = versions::create_version(&conn, job_id, &data_dir).unwrap_err();
    assert!(
        err.contains("not been marked reviewed"),
        "unreviewed PDFs must not freeze, got: {err}"
    );
    assert!(versions::list_versions(&conn, job_id).unwrap().is_empty());

    // Marking this exact artifact reviewed unlocks the save.
    conn.execute(
        "UPDATE resume_plans SET reviewed_pdf_hash = pdf_hash, reviewed_at = datetime('now') WHERE job_id = ?1",
        [job_id],
    )
    .unwrap();
    let v = versions::create_version(&conn, job_id, &data_dir).expect("reviewed version saves");
    assert_eq!(v.version_number, 1);

    let _ = std::fs::remove_dir_all(&data_dir);
    let _ = std::fs::remove_dir_all(artifact.parent().unwrap());
}

/// Acceptance check: the PDF on disk is swapped/truncated after export —
/// the recorded hash catches it and the version save refuses.
#[test]
fn a_modified_pdf_on_disk_refuses_version_save() {
    let conn = fixture_db();
    seed_profile(&conn);
    let job_id = seed_job_with_requirements(&conn);
    composer_db::run_composer(&conn, job_id, &ComposerConfig::default()).expect("plan composes");
    let artifact = seed_compiled_pdf(&conn, job_id, "tampered-pdf");

    let data_dir =
        std::env::temp_dir().join(format!("kairo-versions-test-tamper-{}", std::process::id()));
    std::fs::create_dir_all(&data_dir).unwrap();

    std::fs::write(&artifact, b"%PDF-1.4\n%tampered after export\n%%EOF\n").unwrap();
    let err = versions::create_version(&conn, job_id, &data_dir).unwrap_err();
    assert!(
        err.contains("no longer matches"),
        "hash mismatch must be caught, got: {err}"
    );
    assert!(versions::list_versions(&conn, job_id).unwrap().is_empty());

    // A missing file is caught too.
    std::fs::remove_file(&artifact).unwrap();
    let err = versions::create_version(&conn, job_id, &data_dir).unwrap_err();
    assert!(
        err.contains("missing on disk"),
        "missing artifact must be caught, got: {err}"
    );

    let _ = std::fs::remove_dir_all(&data_dir);
    let _ = std::fs::remove_dir_all(artifact.parent().unwrap());
}

#[test]
fn create_version_refuses_workspaces_without_plan_or_pdf() {
    let conn = fixture_db();
    seed_profile(&conn);
    let job_id = seed_job_with_requirements(&conn);
    let data_dir =
        std::env::temp_dir().join(format!("kairo-versions-test-guard-{}", std::process::id()));

    let no_plan = versions::create_version(&conn, job_id, &data_dir).unwrap_err();
    assert!(no_plan.contains("No plan"), "unexpected error: {no_plan}");

    composer_db::run_composer(&conn, job_id, &ComposerConfig::default()).expect("plan composes");
    let no_pdf = versions::create_version(&conn, job_id, &data_dir).unwrap_err();
    assert!(
        no_pdf.contains("No compiled PDF"),
        "unexpected error: {no_pdf}"
    );
}
