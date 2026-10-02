//! Content fingerprints tying exports to versions (Phase "make versions
//! exact"). A fingerprint is the SHA-256 over exactly the inputs that
//! produced a PDF — the plan *after* the accepted-tailoring overlay, plus the
//! template and paper it was rendered with. Export records it; saving a
//! version recomputes it and refuses when the plan has moved on.

use sha2::{Digest, Sha256};

use crate::composer::ResumePlan;

/// Fingerprint of the render inputs. Must be called on the *overlaid* plan —
/// `export_pdf` applies `apply_accepted_suggestions` before compiling, and
/// `create_version` re-applies it before comparing, so both sides see the
/// identical input here.
pub fn render_fingerprint(plan: &ResumePlan, template_id: &str, paper: &str) -> String {
    // json! preserves insertion order and ResumePlan serializes in struct
    // field order, so the same inputs always produce the same bytes.
    let canonical = serde_json::json!({
        "format": "kairo-render-fingerprint",
        "version": 1,
        "templateId": template_id,
        "paper": paper,
        "plan": plan,
    });
    let mut hasher = Sha256::new();
    hasher.update(canonical.to_string().as_bytes());
    format!("{:x}", hasher.finalize())
}

/// SHA-256 of a file on disk, streamed (PDFs are small, but be tidy).
pub fn file_sha256(path: &std::path::Path) -> Result<String, String> {
    use std::io::Read;
    let mut file =
        std::fs::File::open(path).map_err(|e| format!("cannot hash {}: {e}", path.display()))?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 64 * 1024];
    loop {
        let n = file
            .read(&mut buf)
            .map_err(|e| format!("hash read failed: {e}"))?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_plan() -> ResumePlan {
        serde_json::from_str(
            r#"{
                "composerVersion": 1,
                "config": {
                    "targetPages": 1,
                    "maxProjects": 4,
                    "maxExperienceItems": 3,
                    "maxBulletsPerItem": 3,
                    "minFontSizePt": 9.0,
                    "templateId": "jake",
                    "paper": "letter"
                },
                "header": { "fullName": "Ada Lovelace", "headline": "", "email": "ada@example.com",
                    "phone": "", "location": "", "website": "", "github": "", "linkedin": "" },
                "education": [],
                "experience": [],
                "projects": [],
                "achievements": [],
                "skills": ["Rust"],
                "skillsGrouped": [],
                "excludedSkills": [],
                "estimatedLines": 10,
                "fitsOnePage": true,
                "warnings": []
            }"#,
        )
        .unwrap()
    }

    #[test]
    fn fingerprint_is_deterministic_and_order_stable() {
        let plan = sample_plan();
        let a = render_fingerprint(&plan, "jake", "letter");
        let b = render_fingerprint(&plan, "jake", "letter");
        assert_eq!(a, b);
        assert_eq!(a.len(), 64);
    }

    #[test]
    fn fingerprint_moves_when_any_input_moves() {
        let mut plan = sample_plan();
        let base = render_fingerprint(&plan, "jake", "letter");

        plan.skills.push("SQLite".to_string());
        assert_ne!(render_fingerprint(&plan, "jake", "letter"), base);

        let mut plan = sample_plan();
        plan.config.paper = "a4".to_string();
        assert_ne!(render_fingerprint(&plan, "jake", "letter"), base);

        let mut plan = sample_plan();
        plan.config.template_id = "plushcv".to_string();
        assert_ne!(render_fingerprint(&plan, "plushcv", "letter"), base);

        // A wording change — exactly where the accepted-tailoring overlay
        // lands — must move the fingerprint too.
        let mut plan = sample_plan();
        plan.experience.push(crate::composer::PlanItem {
            entity_type: "experience".to_string(),
            id: 1,
            title: "Eng".to_string(),
            subtitle: String::new(),
            start_date: None,
            end_date: None,
            is_current: false,
            description: String::new(),
            bullets: vec![crate::composer::PlanBullet {
                id: 11,
                text: "Original wording".to_string(),
                supports: vec![],
                excluded: false,
            }],
            skills: vec![],
            relevance: 0.0,
            evidence_count: 0,
            excluded: false,
        });
        let original = render_fingerprint(&plan, "jake", "letter");
        plan.experience[0].bullets[0].text = "Rewritten by tailoring".to_string();
        assert_ne!(render_fingerprint(&plan, "jake", "letter"), original);
    }

    #[test]
    fn file_sha256_matches_known_vector() {
        let dir = std::env::temp_dir().join(format!("kairo-fp-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("hello.txt");
        std::fs::write(&path, b"hello").unwrap();
        // Well-known sha256("hello").
        assert_eq!(
            file_sha256(&path).unwrap(),
            "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }
}
