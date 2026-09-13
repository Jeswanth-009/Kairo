//! Integration test: runs the real version-snapshot flow against a copy of the
//! live database (job 1 = the NimbusPay workspace with a compiled PDF).

use kairo_lib::db::versions;
use rusqlite::Connection;
use std::path::PathBuf;

fn real_db_copy() -> Option<Connection> {
    let src = std::path::Path::new(
        &std::env::var("USERPROFILE").ok()?,
    )
    .join("AppData")
    .join("Roaming")
    .join("com.kairo.app")
    .join("kairo.db");
    if !src.exists() {
        return None;
    }
    let dst = std::env::temp_dir().join(format!("kairo-versions-test-{}.db", std::process::id()));
    std::fs::copy(&src, &dst).ok()?;
    // Also copy WAL/SHM if present so the latest data is visible.
    for ext in ["-wal", "-shm"] {
        let wal = std::path::Path::new(&src).with_extension(format!("db{ext}"));
        if wal.exists() {
            let _ = std::fs::copy(wal, std::path::Path::new(&dst).with_extension(format!("db{ext}")));
        }
    }
    Some(Connection::open(dst).ok()?)
}

#[test]
fn version_snapshot_flow_on_real_db() {
    let Some(conn) = real_db_copy() else {
        eprintln!("no real DB found — skipping");
        return;
    };
    let has_plan: Option<String> = conn
        .query_row(
            "SELECT plan_json FROM resume_plans WHERE job_id = 1",
            [],
            |r| r.get(0),
        )
        .ok();
    let Some(_plan_json) = has_plan else {
        eprintln!("job 1 has no plan — skipping");
        return;
    };

    let data_dir = std::env::temp_dir().join(format!("kairo-versions-test-data-{}", std::process::id()));
    std::fs::create_dir_all(&data_dir).unwrap();

    let v1 = versions::create_version(&conn, 1, &data_dir).expect("first version");
    assert_eq!(v1.version_number, 1);
    assert_eq!(v1.snapshot.version_number, 1);
    assert!(!v1.snapshot.job.raw_jd.is_empty());
    assert!(!v1.snapshot.requirements.is_empty());
    assert!(std::path::Path::new(&v1.pdf_path).exists());
    let pdf = std::fs::read(&v1.pdf_path).unwrap();
    assert!(pdf.starts_with(b"%PDF-"));

    let v2 = versions::create_version(&conn, 1, &data_dir).expect("second version");
    assert_eq!(v2.version_number, 2);

    let list = versions::list_versions(&conn, 1).unwrap();
    assert_eq!(list.len(), 2);
    assert_eq!(list[0].version_number, 2); // newest first

    let fetched = versions::get_version(&conn, v1.id).unwrap();
    assert_eq!(fetched.snapshot.plan.header.full_name, v1.snapshot.plan.header.full_name);

    let _ = std::fs::remove_dir_all(&data_dir);
}

// Placeholder check helper kept minimal (no-op) — the real DB presence is
// checked above.
#[allow(dead_code)]
fn kairo_lib_missing() -> bool {
    false
}
