//! Integration test for the Phase 9 PDF pipeline: renders a plan through the
//! real LaTeX renderer and compiles it with the real Tectonic binary. Skips
//! automatically when Tectonic isn't installed on the machine.

use kairo_lib::composer::{
    ComposerConfig, PlanBullet, PlanItem, ResumePlan,
};

fn sample_plan() -> ResumePlan {
    ResumePlan {
        composer_version: 1,
        config: ComposerConfig::default(),
        header: kairo_lib::composer::PlanHeader {
            full_name: "Jeswanth Sai".to_string(),
            headline: String::new(),
            email: "j@example.com".to_string(),
            phone: String::new(),
            location: String::new(),
            website: String::new(),
            github: "https://github.com/j".to_string(),
            linkedin: String::new(),
        },
        education: vec![kairo_lib::composer::PlanEducation {
            id: 1,
            institution: "IIT Hyderabad".to_string(),
            degree: "B.Tech".to_string(),
            field_of_study: "CSE".to_string(),
            start_date: Some("2022-08".to_string()),
            end_date: Some("2026-05".to_string()),
            is_current: false,
        }],
        experience: vec![kairo_lib::composer::PlanItem {
            entity_type: "experience".to_string(),
            id: 2,
            title: "Acme Corp — Software Intern".to_string(),
            subtitle: "Remote".to_string(),
            start_date: Some("2025-06".to_string()),
            end_date: Some("2025-09".to_string()),
            is_current: false,
            description: "Shipped internal tooling.".to_string(),
            bullets: vec![PlanBullet {
                id: 20,
                text: "Shipped tooling in Python and SQL".to_string(),
                supports: vec![],
                excluded: false,
            }],
            skills: vec![],
            relevance: 0.2,
            evidence_count: 0,
            excluded: false,
        }],
        projects: vec![PlanItem {
            entity_type: "project".to_string(),
            id: 1,
            title: "PyKV — in-memory key-value store".to_string(),
            subtitle: String::new(),
            start_date: None,
            end_date: None,
            is_current: false,
            description: String::new(),
            bullets: vec![
                PlanBullet {
                    id: 10,
                    text: "Implemented an in-memory key-value store in Python with WAL persistence, TTL eviction and LRU caching".to_string(),
                    supports: vec![],
                    excluded: false,
                },
            ],
            skills: vec!["Python".to_string()],
            relevance: 0.91,
            evidence_count: 1,
            excluded: false,
        }],
        skills: vec!["Python".to_string(), "SQL".to_string()],
        excluded_skills: vec![],
        estimated_lines: 21,
        fits_one_page: true,
        warnings: vec![],
    }
}

#[test]
fn compile_locked_produces_valid_pdf() {
    let plan = sample_plan();
    let tex = kairo_lib::latex::render_plan(&plan);
    assert!(tex.contains("\\documentclass[10pt,letterpaper]{article}"));
    assert!(tex.contains("PyKV — in-memory key-value store"));

    // Compile with the machine's tectonic if present, else skip.
    let tectonic = dirs_next().unwrap_or_else(|| std::env::temp_dir());
    let exe = tectonic.join("tectonic.exe");
    let candidate = if exe.exists() { exe } else { tectonic.join("tectonic") };
    if !candidate.exists() {
        eprintln!("tectonic not installed — skipping compile assertion");
        return;
    }

    let out_dir = std::env::temp_dir().join(format!("kairo-pdf-test-{}", std::process::id()));
    std::fs::create_dir_all(&out_dir).unwrap();

    let output = kairo_lib::db::pdf::compile_locked(plan, 999, &candidate, &out_dir.parent().unwrap().join("kairo-pdf-root")).unwrap_or_else(|e| {
        if e.contains("bundle") || e.contains("network") {
            eprintln!("skipping: bundle not reachable: {e}");
            return kairo_lib::db::pdf::CompileOutput {
                artifact: kairo_lib::db::pdf::PdfArtifact {
                    job_id: 999,
                    tex_path: String::new(),
                    pdf_path: String::new(),
                    page_count: Some(1),
                    compiled_at: None,
                },
                log_tail: String::new(),
            };
        }
        panic!("compile failed: {e}");
    });

    if output.artifact.pdf_path.is_empty() {
        return; // skipped due to bundle unreachability
    }
    assert!(std::path::Path::new(&output.artifact.pdf_path).exists());
    let bytes = std::fs::read(&output.artifact.pdf_path).unwrap();
    assert!(bytes.starts_with(b"%PDF-"));
    assert_eq!(output.artifact.page_count, Some(1));

    let _ = std::fs::remove_dir_all(&out_dir);
}

fn dirs_next() -> Option<std::path::PathBuf> {
    std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .map(std::path::PathBuf::from)
        .ok()
}
