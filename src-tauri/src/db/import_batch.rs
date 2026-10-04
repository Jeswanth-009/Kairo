//! Transactional resume import (Phase "reliability"). A first-run import
//! must be all-or-nothing: the review screen saves many records at once, and
//! a failure halfway (e.g. a bad skill link) used to leave a partial import.
//! Everything here runs in one SQLite transaction and returns the created
//! record ids so the UI can mark individual facts verified.

use super::trust::EntityKind;
use super::vault::{
    insert_entity_tx, sql_err, upsert_profile_tx, write_links, Achievement, Education, Experience,
    Profile, Project,
};
use crate::imports::{AchievementDraft, EducationDraft, ExperienceDraft, ProjectDraft, SkillDraft};
use rusqlite::{params, Connection, OptionalExtension};

#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ImportBatch {
    pub profile: Option<Profile>,
    pub projects: Vec<ProjectDraft>,
    pub experiences: Vec<ExperienceDraft>,
    pub education: Vec<EducationDraft>,
    pub achievements: Vec<AchievementDraft>,
    pub skills: Vec<SkillDraft>,
}

#[derive(Debug, Clone, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportBatchResult {
    pub profile_saved: bool,
    pub project_ids: Vec<i64>,
    pub experience_ids: Vec<i64>,
    pub education_ids: Vec<i64>,
    pub achievement_ids: Vec<i64>,
    pub skill_ids: Vec<i64>,
}

/// Resolves a skill by canonical name or alias, creating it when missing.
/// Runs on the caller's transaction. Returns the skill id.
fn resolve_skill_tx(conn: &Connection, draft: &SkillDraft) -> Result<i64, String> {
    let name = draft.name.trim();
    if name.is_empty() {
        return Err("empty skill name in import".to_string());
    }
    let lower = name.to_lowercase();
    let existing: Option<i64> = conn
        .query_row(
            "SELECT s.id FROM skills s \
             LEFT JOIN skill_aliases a ON a.skill_id = s.id \
             WHERE LOWER(s.canonical_name) = ?1 OR LOWER(a.alias) = ?1 \
             LIMIT 1",
            [&lower],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    if let Some(id) = existing {
        return Ok(id);
    }
    sql_err(conn.execute(
        "INSERT INTO skills (canonical_name, category) VALUES (?1, ?2)",
        params![name, draft.category],
    ))?;
    Ok(conn.last_insert_rowid())
}

/// The whole import in one transaction: profile, skills, and every accepted
/// record with its skill links. Any failure rolls back everything.
pub fn import_resume_batch(
    conn: &mut Connection,
    batch: &ImportBatch,
) -> Result<ImportBatchResult, String> {
    let tx = sql_err(conn.unchecked_transaction())?;
    let result = run_batch(&tx, batch);
    match result {
        Ok(r) => {
            sql_err(tx.commit())?;
            Ok(r)
        }
        Err(e) => Err(e), // tx drops → rollback
    }
}

fn run_batch(tx: &Connection, batch: &ImportBatch) -> Result<ImportBatchResult, String> {
    let mut out = ImportBatchResult::default();

    if let Some(profile) = &batch.profile {
        upsert_profile_tx(tx, profile)?;
        out.profile_saved = true;
    }

    // Skills first: records link to them.
    let mut skill_ids: Vec<(String, i64)> = Vec::new();
    for draft in &batch.skills {
        let id = resolve_skill_tx(tx, draft)?;
        skill_ids.push((draft.name.trim().to_lowercase(), id));
        out.skill_ids.push(id);
    }
    // Resolves a record-referenced skill that the top-level skill list does
    // not carry (the user may have pruned the list without editing every
    // record). Deduped by lowercase name so shared skills stay one row.
    let referenced = |name: &str,
                      skill_ids: &mut Vec<(String, i64)>,
                      out: &mut ImportBatchResult|
     -> Result<i64, String> {
        let lower = name.trim().to_lowercase();
        if lower.is_empty() {
            return Err("empty skill name in import".to_string());
        }
        if let Some((_, id)) = skill_ids.iter().find(|(n, _)| *n == lower) {
            return Ok(*id);
        }
        let id = resolve_skill_tx(
            tx,
            &SkillDraft {
                name: name.trim().to_string(),
                category: "other".to_string(),
            },
        )?;
        skill_ids.push((lower, id));
        out.skill_ids.push(id);
        Ok(id)
    };

    // Pre-resolve the skills referenced by project drafts so the experience
    // text-matching below sees the complete name→id map regardless of the
    // order the records are processed in.
    for draft in &batch.projects {
        for s in &draft.skills {
            if !s.trim().is_empty() {
                referenced(s, &mut skill_ids, &mut out)?;
            }
        }
    }

    for draft in &batch.experiences {
        let experience = Experience {
            id: 0,
            organization: draft.organization.trim().to_string(),
            role: draft.role.trim().to_string(),
            description: draft.description.clone(),
            start_date: draft.start_date.clone(),
            end_date: draft.end_date.clone(),
            is_current: draft.is_current,
            location: draft.location.clone(),
            skills: Vec::new(),
            evidence_count: 0,
            origin: "imported".to_string(),
            edited_at: None,
            verified_at: None,
        };
        let id = insert_entity_tx::<Experience>(tx, &experience)?;
        out.experience_ids.push(id);
        // Experiences carry no per-draft skill list — link top-level skills
        // whose name appears in the description (the old importer's behavior).
        // Collect every match, then write once: write_links replaces the
        // record's whole link set, so per-link calls would drop all but the
        // last.
        let text = format!(
            "{} {} {}",
            draft.organization, draft.role, draft.description
        )
        .to_lowercase();
        let mut links: Vec<super::vault::SkillRef> = Vec::new();
        let mut seen: Vec<i64> = Vec::new();
        for (name, skill_id) in &skill_ids {
            if text.contains(name.as_str()) && !seen.contains(skill_id) {
                seen.push(*skill_id);
                links.push(super::vault::SkillRef {
                    skill_id: *skill_id,
                    canonical_name: name.clone(),
                    confidence: 3,
                });
            }
        }
        if !links.is_empty() {
            write_links(tx, EntityKind::Experience.as_str(), id, &links)?;
        }
    }

    for draft in &batch.projects {
        let project = Project {
            id: 0,
            title: draft.title.trim().to_string(),
            description: draft.description.clone(),
            start_date: draft.start_date.clone(),
            end_date: draft.end_date.clone(),
            is_current: draft.is_current,
            url: draft.url.clone(),
            repo_url: draft.repo_url.clone(),
            skills: Vec::new(),
            evidence_count: 0,
            origin: "imported".to_string(),
            edited_at: None,
            verified_at: None,
        };
        let id = insert_entity_tx::<Project>(tx, &project)?;
        out.project_ids.push(id);
        // One write_links call per record with the full link set — see the
        // experience note above.
        let mut links: Vec<super::vault::SkillRef> = Vec::new();
        let mut seen: Vec<String> = Vec::new();
        for s in &draft.skills {
            let lower = s.trim().to_lowercase();
            if lower.is_empty() || seen.contains(&lower) {
                continue;
            }
            seen.push(lower.clone());
            let skill_id = referenced(s, &mut skill_ids, &mut out)?;
            links.push(super::vault::SkillRef {
                skill_id,
                canonical_name: s.trim().to_string(),
                confidence: 3,
            });
        }
        if !links.is_empty() {
            write_links(tx, EntityKind::Project.as_str(), id, &links)?;
        }
    }

    for draft in &batch.education {
        let education = Education {
            id: 0,
            institution: draft.institution.trim().to_string(),
            degree: draft.degree.trim().to_string(),
            field_of_study: draft.field_of_study.trim().to_string(),
            description: String::new(),
            start_date: draft.start_date.clone(),
            end_date: draft.end_date.clone(),
            is_current: draft.is_current,
            origin: "imported".to_string(),
            edited_at: None,
            verified_at: None,
        };
        let id = insert_entity_tx::<Education>(tx, &education)?;
        out.education_ids.push(id);
    }

    for draft in &batch.achievements {
        let achievement = Achievement {
            id: 0,
            title: draft.title.trim().to_string(),
            issuer: draft.issuer.trim().to_string(),
            description: draft.description.clone(),
            achieved_on: draft.achieved_on.clone(),
            origin: "imported".to_string(),
            edited_at: None,
            verified_at: None,
        };
        let id = insert_entity_tx::<Achievement>(tx, &achievement)?;
        out.achievement_ids.push(id);
    }

    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::apply_migrations;

    fn mem_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        apply_migrations(&conn).unwrap();
        conn
    }

    fn sample() -> ImportBatch {
        ImportBatch {
            profile: Some(Profile {
                full_name: "Ada Lovelace".to_string(),
                headline: String::new(),
                email: "ada@example.com".to_string(),
                phone: String::new(),
                location: String::new(),
                website: String::new(),
                github: String::new(),
                linkedin: String::new(),
                summary: String::new(),
            }),
            projects: vec![ProjectDraft {
                title: "PyKV".to_string(),
                description: "in-memory cache".to_string(),
                skills: vec!["Python".to_string()],
                start_date: Some("2024-01".to_string()),
                end_date: None,
                is_current: true,
                url: "https://pykv.dev".to_string(),
                repo_url: "https://github.com/ada/pykv".to_string(),
                source_snippet: String::new(),
            }],
            experiences: vec![ExperienceDraft {
                organization: "Acme".to_string(),
                role: "Intern".to_string(),
                description: "built tooling with Python".to_string(),
                start_date: Some("2025-06".to_string()),
                end_date: None,
                is_current: true,
                location: String::new(),
                source_snippet: String::new(),
            }],
            education: vec![EducationDraft {
                institution: "IIT".to_string(),
                degree: "B.Tech".to_string(),
                field_of_study: "CSE".to_string(),
                start_date: Some("2022-08".to_string()),
                end_date: None,
                is_current: true,
                source_snippet: String::new(),
            }],
            achievements: vec![],
            skills: vec![
                SkillDraft {
                    name: "Python".to_string(),
                    category: "language".to_string(),
                },
                SkillDraft {
                    name: "Rust".to_string(),
                    category: "language".to_string(),
                },
            ],
        }
    }

    #[test]
    fn batch_import_creates_everything_and_resolves_shared_skills() {
        let mut conn = mem_db();
        let result = import_resume_batch(&mut conn, &sample()).unwrap();

        assert!(result.profile_saved);
        assert_eq!(result.project_ids.len(), 1);
        assert_eq!(result.experience_ids.len(), 1);
        assert_eq!(result.education_ids.len(), 1);
        // Python is shared between project, experience and the skill list —
        // exactly one skill row may exist for it.
        assert_eq!(result.skill_ids.len(), 2);
        let py_rows: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM skills WHERE canonical_name = 'Python'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(py_rows, 1);

        // The project and experience link the SAME Python skill id (never 0).
        let links: Vec<i64> = {
            let mut stmt = conn
                .prepare(
                    "SELECT es.skill_id FROM entity_skills es JOIN skills s ON s.id = es.skill_id \
                     WHERE s.canonical_name = 'Python' ORDER BY es.skill_id",
                )
                .unwrap();
            let rows = stmt.query_map([], |r| r.get(0)).unwrap();
            rows.map(|r| r.unwrap()).collect()
        };
        assert_eq!(links.len(), 2, "project + experience link Python");
        assert!(links.iter().all(|id| *id > 0));

        // Project dates and links survive the batch instead of being blanked.
        let (start, end, current, url, repo): (Option<String>, Option<String>, bool, String, String) = conn
            .query_row(
                "SELECT start_date, end_date, is_current, url, repo_url FROM projects WHERE id = ?1",
                [result.project_ids[0]],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
            )
            .unwrap();
        assert_eq!(start.as_deref(), Some("2024-01"));
        assert_eq!(end, None);
        assert!(current);
        assert_eq!(url, "https://pykv.dev");
        assert_eq!(repo, "https://github.com/ada/pykv");

        // Records carry the honest imported origin.
        let origin: String = conn
            .query_row(
                "SELECT origin FROM projects WHERE id = ?1",
                [result.project_ids[0]],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(origin, "imported");
    }

    /// A record naming several skills keeps every link (write_links replaces
    /// the record's whole link set, so per-link calls used to drop all but
    /// the last), and skills referenced by records but missing from the
    /// top-level skill list are created and linked anyway.
    #[test]
    fn batch_keeps_every_link_and_resolves_referenced_skills() {
        let mut conn = mem_db();
        let batch = ImportBatch {
            profile: None,
            projects: vec![ProjectDraft {
                title: "Mono".to_string(),
                description: "a compiler".to_string(),
                skills: vec!["Rust".to_string(), "LLVM".to_string()],
                start_date: Some("2023-02".to_string()),
                end_date: Some("2024-06".to_string()),
                is_current: false,
                url: "https://mono.dev".to_string(),
                repo_url: String::new(),
                source_snippet: String::new(),
            }],
            experiences: vec![ExperienceDraft {
                organization: "Acme".to_string(),
                role: "Engineer".to_string(),
                description: "wrote Rust and LLVM passes".to_string(),
                start_date: None,
                end_date: None,
                is_current: true,
                location: String::new(),
                source_snippet: String::new(),
            }],
            education: vec![],
            achievements: vec![],
            // The list is empty on purpose — the records still get links.
            skills: vec![],
        };
        let result = import_resume_batch(&mut conn, &batch).unwrap();

        // Both referenced skills were created and appear in skill_ids.
        let mut names = result.skill_ids.clone();
        names.sort();
        assert_eq!(names.len(), 2, "Rust + LLVM, deduplicated: {names:?}");

        let links_for = |entity_type: &str, entity_id: i64| -> Vec<String> {
            let id_str = entity_id.to_string();
            let mut stmt = conn
                .prepare(
                    "SELECT s.canonical_name FROM entity_skills es \
                     JOIN skills s ON s.id = es.skill_id \
                     WHERE es.entity_type = ?1 AND es.entity_id = ?2 ORDER BY s.canonical_name",
                )
                .unwrap();
            let rows = stmt
                .query_map([entity_type, id_str.as_str()], |r| r.get(0))
                .unwrap();
            rows.map(|r| r.unwrap()).collect()
        };

        let project_links = links_for("project", result.project_ids[0]);
        assert_eq!(
            project_links,
            vec!["LLVM", "Rust"],
            "both project links survive"
        );

        let experience_links = links_for("experience", result.experience_ids[0]);
        assert_eq!(
            experience_links,
            vec!["LLVM", "Rust"],
            "every mentioned skill links, not just the last"
        );
    }

    /// A batch that fails partway (empty organization fails validation) must
    /// roll back everything — the profile and earlier records included.
    #[test]
    fn batch_import_is_all_or_nothing() {
        let mut conn = mem_db();
        let mut batch = sample();
        batch.experiences[0].organization = "   ".to_string(); // validation failure
        let err = import_resume_batch(&mut conn, &batch).unwrap_err();
        assert!(err.to_lowercase().contains("organization"), "{err}");

        let counts: Vec<i64> = ["projects", "experiences", "skills", "profiles"]
            .iter()
            .map(|t| {
                conn.query_row(&format!("SELECT COUNT(*) FROM {t}"), [], |r| r.get(0))
                    .unwrap()
            })
            .collect();
        assert_eq!(counts, vec![0, 0, 0, 0], "no partial rows may survive");
    }
}
