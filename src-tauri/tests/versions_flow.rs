//! Integration test: the immutable version-snapshot flow against a fixture
//! database the test seeds itself (profile → job + requirements → plan →
//! compiled PDF), so it runs real assertions on every machine and in CI —
//! no dependency on any developer's live data.

use kairo_lib::composer::ComposerConfig;
use kairo_lib::db::versions;
use kairo_lib::db::{composer as composer_db, jobs as jobs_db, vault as vault_db};
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
fn seed_compiled_pdf(conn: &Connection, job_id: i64) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "kairo-versions-fixture-{}-{job_id}",
        std::process::id()
    ));
    std::fs::create_dir_all(&dir).expect("artifact dir");
    let pdf = dir.join("resume.pdf");
    std::fs::write(&pdf, b"%PDF-1.4\n%fixture artifact\n%%EOF\n").expect("artifact pdf");
    conn.execute(
        "UPDATE resume_plans SET pdf_path = ?1 WHERE job_id = ?2",
        rusqlite::params![pdf.display().to_string(), job_id],
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
    let artifact = seed_compiled_pdf(&conn, job_id);

    let data_dir =
        std::env::temp_dir().join(format!("kairo-versions-test-data-{}", std::process::id()));
    std::fs::create_dir_all(&data_dir).unwrap();

    let v1 = versions::create_version(&conn, job_id, &data_dir).expect("first version");
    assert_eq!(v1.version_number, 1);
    assert_eq!(v1.snapshot.version_number, 1);
    assert!(v1.snapshot.job.raw_jd.contains("data pipelines"));
    assert_eq!(v1.snapshot.requirements.len(), 2);
    assert_eq!(v1.snapshot.plan.header.full_name, "Test User");
    assert!(std::path::Path::new(&v1.pdf_path).exists());
    assert_ne!(
        v1.pdf_path,
        artifact.display().to_string(),
        "version owns its PDF copy"
    );
    let pdf = std::fs::read(&v1.pdf_path).unwrap();
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
