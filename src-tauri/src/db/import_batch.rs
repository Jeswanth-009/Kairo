//! Transactional resume import (Phase "reliability"). A first-run import
//! must be all-or-nothing: the review screen saves many records at once, and
//! a failure halfway (e.g. a bad skill link) used to leave a partial import.
//! Everything here runs in one SQLite transaction and returns the created
//! record ids so the UI can mark individual facts verified.

use super::trust::EntityKind;
use super::vault::{
    insert_entity_tx, sql_err, upsert_profile_tx, write_links, Achievement, Certification,
    Education, Experience, Profile, Project,
};
use crate::imports::{
    AchievementDraft, CertificationDraft, EducationDraft, ExperienceDraft, ProjectDraft, SkillDraft,
};
use rusqlite::{params, Connection, OptionalExtension};

#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ImportBatch {
    pub profile: Option<Profile>,
    pub projects: Vec<ProjectDraft>,
    pub experiences: Vec<ExperienceDraft>,
    pub education: Vec<EducationDraft>,
    pub achievements: Vec<AchievementDraft>,
    pub certifications: Vec<CertificationDraft>,
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
    pub certification_ids: Vec<i64>,
    pub skill_ids: Vec<i64>,
    /// Records that already existed (same title / org+role / degree) and were
    /// refreshed in place instead of duplicated. The Vault never grows a
    /// second copy of a record a re-import brings back.
    #[serde(default)]
    pub merged_project_ids: Vec<i64>,
    #[serde(default)]
    pub merged_experience_ids: Vec<i64>,
    #[serde(default)]
    pub merged_education_ids: Vec<i64>,
    #[serde(default)]
    pub merged_achievement_ids: Vec<i64>,
    #[serde(default)]
    pub merged_certification_ids: Vec<i64>,
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

/// Keep the source passage beside the imported record in the existing Proof
/// model. This runs inside the same import transaction; a failed passage write
/// rolls back the record as well.
fn save_source_passage_tx(
    conn: &Connection,
    kind: EntityKind,
    entity_id: i64,
    passage: &str,
) -> Result<(), String> {
    if passage.trim().is_empty() {
        return Ok(());
    }
    sql_err(conn.execute(
        "INSERT INTO evidence (entity_type, entity_id, kind, title, reference, note, verified) \
         VALUES (?1, ?2, 'document', 'Original resume passage', 'Imported resume', ?3, 0)",
        params![kind.as_str(), entity_id, passage.trim()],
    ))?;
    Ok(())
}

/// Finds the live record a draft re-imports, matched on the identity the
/// Vault dedupes on (normalized title / org+role / degree). A re-import must
/// refresh the existing record, never stack a second copy — duplicate rows
/// are what made the matcher show the same record three times.
fn find_live_by_tx(
    conn: &Connection,
    table: &str,
    key: &[(&str, &str)],
) -> Result<Option<i64>, String> {
    let where_sql = key
        .iter()
        .map(|(col, _)| format!("LOWER(TRIM({col})) = ?"))
        .collect::<Vec<_>>()
        .join(" AND ");
    let sql = format!(
        "SELECT id FROM {table} WHERE deleted_at IS NULL AND {where_sql} ORDER BY id LIMIT 1"
    );
    let values: Vec<rusqlite::types::Value> = key
        .iter()
        .map(|(_, v)| rusqlite::types::Value::Text(v.trim().to_lowercase()))
        .collect();
    conn.query_row(&sql, rusqlite::params_from_iter(values.iter()), |r| {
        r.get(0)
    })
    .optional()
    .map_err(|e| e.to_string())
}

/// Merges a re-import's skill links into an existing record: union by skill,
/// highest confidence wins. `write_links` replaces the whole set, so the
/// existing links are read first and written back with the union.
fn merge_links_tx(
    conn: &Connection,
    kind: EntityKind,
    entity_id: i64,
    incoming: &[super::vault::SkillRef],
) -> Result<(), String> {
    if incoming.is_empty() {
        return Ok(());
    }
    let mut stmt = sql_err(conn.prepare(
        "SELECT skill_id, confidence FROM entity_skills WHERE entity_type = ?1 AND entity_id = ?2",
    ))?;
    let rows = stmt
        .query_map(params![kind.as_str(), entity_id], |r| {
            Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?))
        })
        .map_err(|e| e.to_string())?;
    let mut union: Vec<(i64, i64)> = rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    for skill in incoming {
        match union.iter_mut().find(|(sid, _)| *sid == skill.skill_id) {
            Some((_, confidence)) => {
                if skill.confidence > *confidence {
                    *confidence = skill.confidence;
                }
            }
            None => union.push((skill.skill_id, skill.confidence)),
        }
    }
    let links: Vec<super::vault::SkillRef> = union
        .into_iter()
        .map(|(skill_id, confidence)| super::vault::SkillRef {
            skill_id,
            canonical_name: String::new(),
            confidence,
        })
        .collect();
    write_links(conn, kind.as_str(), entity_id, &links)
}

/// Keeps exactly one "Original resume passage" per record: a re-import
/// updates the stored passage instead of stacking a new row per import.
fn refresh_source_passage_tx(
    conn: &Connection,
    kind: EntityKind,
    entity_id: i64,
    passage: &str,
) -> Result<(), String> {
    if passage.trim().is_empty() {
        return Ok(());
    }
    let changed = sql_err(conn.execute(
        "UPDATE evidence SET note = ?3, updated_at = datetime('now') \
         WHERE entity_type = ?1 AND entity_id = ?2 \
           AND kind = 'document' AND title = 'Original resume passage'",
        params![kind.as_str(), entity_id, passage.trim()],
    ))?;
    if changed == 0 {
        save_source_passage_tx(conn, kind, entity_id, passage)?;
    }
    Ok(())
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

        let existing = find_live_by_tx(
            tx,
            "experiences",
            &[("organization", &draft.organization), ("role", &draft.role)],
        )?;
        let id = match existing {
            Some(id) => {
                // Re-import: refresh the existing row in place. Only fields
                // the draft carries are overwritten; the edited_flag trigger
                // stamps edited_at when content actually changes.
                sql_err(tx.execute(
                    "UPDATE experiences SET \
                        description = CASE WHEN ?1 != '' THEN ?1 ELSE description END, \
                        start_date = COALESCE(?2, start_date), \
                        end_date = COALESCE(?3, end_date), \
                        is_current = ?4, \
                        location = CASE WHEN ?5 != '' THEN ?5 ELSE location END, \
                        updated_at = datetime('now') \
                     WHERE id = ?6",
                    params![
                        draft.description,
                        draft.start_date,
                        draft.end_date,
                        draft.is_current,
                        draft.location.trim(),
                        id
                    ],
                ))?;
                merge_links_tx(tx, EntityKind::Experience, id, &links)?;
                refresh_source_passage_tx(tx, EntityKind::Experience, id, &draft.source_snippet)?;
                out.merged_experience_ids.push(id);
                id
            }
            None => {
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
                save_source_passage_tx(tx, EntityKind::Experience, id, &draft.source_snippet)?;
                if !links.is_empty() {
                    write_links(tx, EntityKind::Experience.as_str(), id, &links)?;
                }
                id
            }
        };
        out.experience_ids.push(id);
    }

    for draft in &batch.projects {
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

        let existing = find_live_by_tx(tx, "projects", &[("title", &draft.title)])?;
        let id = match existing {
            Some(id) => {
                // Re-import: refresh the existing row in place; see the
                // experience note above.
                sql_err(tx.execute(
                    "UPDATE projects SET \
                        description = CASE WHEN ?1 != '' THEN ?1 ELSE description END, \
                        start_date = COALESCE(?2, start_date), \
                        end_date = COALESCE(?3, end_date), \
                        is_current = ?4, \
                        url = CASE WHEN ?5 != '' THEN ?5 ELSE url END, \
                        repo_url = CASE WHEN ?6 != '' THEN ?6 ELSE repo_url END, \
                        updated_at = datetime('now') \
                     WHERE id = ?7",
                    params![
                        draft.description,
                        draft.start_date,
                        draft.end_date,
                        draft.is_current,
                        draft.url.trim(),
                        draft.repo_url.trim(),
                        id
                    ],
                ))?;
                merge_links_tx(tx, EntityKind::Project, id, &links)?;
                refresh_source_passage_tx(tx, EntityKind::Project, id, &draft.source_snippet)?;
                out.merged_project_ids.push(id);
                id
            }
            None => {
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
                save_source_passage_tx(tx, EntityKind::Project, id, &draft.source_snippet)?;
                if !links.is_empty() {
                    write_links(tx, EntityKind::Project.as_str(), id, &links)?;
                }
                id
            }
        };
        out.project_ids.push(id);
    }

    for draft in &batch.education {
        let existing = find_live_by_tx(
            tx,
            "education",
            &[
                ("institution", &draft.institution),
                ("degree", &draft.degree),
                ("field_of_study", &draft.field_of_study),
            ],
        )?;
        let id = match existing {
            Some(id) => {
                sql_err(tx.execute(
                    "UPDATE education SET \
                        start_date = COALESCE(?1, start_date), \
                        end_date = COALESCE(?2, end_date), \
                        is_current = ?3, \
                        updated_at = datetime('now') \
                     WHERE id = ?4",
                    params![draft.start_date, draft.end_date, draft.is_current, id],
                ))?;
                refresh_source_passage_tx(tx, EntityKind::Education, id, &draft.source_snippet)?;
                out.merged_education_ids.push(id);
                id
            }
            None => {
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
                save_source_passage_tx(tx, EntityKind::Education, id, &draft.source_snippet)?;
                id
            }
        };
        out.education_ids.push(id);
    }

    for draft in &batch.achievements {
        let existing = find_live_by_tx(
            tx,
            "achievements",
            &[("title", &draft.title), ("issuer", &draft.issuer)],
        )?;
        let id = match existing {
            Some(id) => {
                sql_err(tx.execute(
                    "UPDATE achievements SET \
                        description = CASE WHEN ?1 != '' THEN ?1 ELSE description END, \
                        achieved_on = COALESCE(?2, achieved_on), \
                        updated_at = datetime('now') \
                     WHERE id = ?3",
                    params![draft.description, draft.achieved_on, id],
                ))?;
                refresh_source_passage_tx(tx, EntityKind::Achievement, id, &draft.source_snippet)?;
                out.merged_achievement_ids.push(id);
                id
            }
            None => {
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
                save_source_passage_tx(tx, EntityKind::Achievement, id, &draft.source_snippet)?;
                id
            }
        };
        out.achievement_ids.push(id);
    }

    for draft in &batch.certifications {
        let existing = find_live_by_tx(
            tx,
            "certifications",
            &[("title", &draft.title), ("issuer", &draft.issuer)],
        )?;
        let id = match existing {
            Some(id) => {
                sql_err(tx.execute(
                    "UPDATE certifications SET \
                        description = CASE WHEN ?1 != '' THEN ?1 ELSE description END, \
                        issue_date = COALESCE(?2, issue_date), \
                        updated_at = datetime('now') \
                     WHERE id = ?3",
                    params![draft.description, draft.issue_date, id],
                ))?;
                refresh_source_passage_tx(
                    tx,
                    EntityKind::Certification,
                    id,
                    &draft.source_snippet,
                )?;
                out.merged_certification_ids.push(id);
                id
            }
            None => {
                let certification = Certification {
                    id: 0,
                    title: draft.title.trim().to_string(),
                    issuer: draft.issuer.trim().to_string(),
                    description: draft.description.clone(),
                    issue_date: draft.issue_date.clone(),
                    expiry_date: None,
                    credential_id: String::new(),
                    url: String::new(),
                    origin: "imported".to_string(),
                    edited_at: None,
                    verified_at: None,
                };
                let id = insert_entity_tx::<Certification>(tx, &certification)?;
                save_source_passage_tx(tx, EntityKind::Certification, id, &draft.source_snippet)?;
                id
            }
        };
        out.certification_ids.push(id);
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
            certifications: vec![],
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
    fn imported_passage_stays_with_its_record() {
        let mut conn = mem_db();
        let mut batch = sample();
        batch.projects[0].source_snippet = "Built PyKV with Python for fast lookups".to_string();
        let result = import_resume_batch(&mut conn, &batch).unwrap();
        let passage: String = conn
            .query_row(
                "SELECT note FROM evidence WHERE entity_type = 'project' AND entity_id = ?1",
                [result.project_ids[0]],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(passage, batch.projects[0].source_snippet);
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
            certifications: vec![],
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

    /// Re-importing the same resume must refresh the existing records, never
    /// stack second copies — duplicate rows are what made the matcher show
    /// the same record three times in the Evidence tab.
    #[test]
    fn reimport_refreshes_existing_records_instead_of_duplicating() {
        let mut conn = mem_db();
        let mut first_batch = sample();
        first_batch.projects[0].source_snippet = "PyKV passage v1".to_string();
        first_batch.experiences[0].source_snippet = "Acme passage v1".to_string();
        first_batch.education[0].source_snippet = "Edu passage v1".to_string();
        let first = import_resume_batch(&mut conn, &first_batch).unwrap();

        let mut updated = sample();
        updated.projects[0].description = "in-memory cache with TTL".to_string();
        updated.projects[0].skills.push("Rust".to_string());
        updated.projects[0].source_snippet = "PyKV passage v2".to_string();
        updated.experiences[0].description = "built tooling with Python and Rust".to_string();
        updated.experiences[0].source_snippet = "Acme passage v2".to_string();
        updated.education[0].source_snippet = "Edu passage v2".to_string();
        let second = import_resume_batch(&mut conn, &updated).unwrap();

        // Same records, same ids — refreshed in place.
        assert_eq!(second.project_ids, first.project_ids);
        assert_eq!(second.experience_ids, first.experience_ids);
        assert_eq!(second.education_ids, first.education_ids);
        assert_eq!(second.merged_project_ids, first.project_ids);
        assert_eq!(second.merged_experience_ids, first.experience_ids);
        assert_eq!(second.merged_education_ids, first.education_ids);

        for (table, expected) in [("projects", 1), ("experiences", 1), ("education", 1)] {
            let count: i64 = conn
                .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r.get(0))
                .unwrap();
            assert_eq!(count, expected, "{table} must not grow a second copy");
        }

        // Content refreshes and skill links union (Python + Rust both linked).
        let (desc, links): (String, i64) = conn
            .query_row(
                "SELECT description, (SELECT COUNT(*) FROM entity_skills es \
                 WHERE es.entity_type = 'project' AND es.entity_id = projects.id) \
                 FROM projects WHERE id = ?1",
                [second.project_ids[0]],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(desc, "in-memory cache with TTL");
        assert_eq!(links, 2, "Python + Rust links survive the merge");

        // Exactly one original-passage row per record, note refreshed to v2.
        for (kind, id, v2) in [
            ("project", second.project_ids[0], "PyKV passage v2"),
            ("experience", second.experience_ids[0], "Acme passage v2"),
            ("education", second.education_ids[0], "Edu passage v2"),
        ] {
            let (count, note): (i64, String) = conn
                .query_row(
                    "SELECT COUNT(*) OVER (), note FROM evidence \
                     WHERE entity_type = ?1 AND entity_id = ?2 \
                       AND kind = 'document' AND title = 'Original resume passage'",
                    params![kind, id],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .unwrap();
            assert_eq!(count, 1, "one passage per {kind}, not one per import");
            assert_eq!(note, v2, "{kind} passage refreshed in place");
        }

        // A genuinely new record still inserts (and is not reported merged).
        let mut extra = sample();
        extra.projects[0].title = "Different Project".to_string();
        let third = import_resume_batch(&mut conn, &extra).unwrap();
        assert_ne!(third.project_ids[0], second.project_ids[0]);
        assert!(third.merged_project_ids.is_empty());
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM projects", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 2);
    }

    /// Case and whitespace differences in the source resume must not defeat
    /// the identity match — the same record is still recognized.
    #[test]
    fn reimport_matches_identity_despite_case_and_padding() {
        let mut conn = mem_db();
        let first = import_resume_batch(&mut conn, &sample()).unwrap();

        let mut noisy = sample();
        noisy.projects[0].title = "  pykv ".to_string();
        noisy.experiences[0].organization = "ACME".to_string();
        noisy.experiences[0].role = "intern".to_string();
        let second = import_resume_batch(&mut conn, &noisy).unwrap();

        assert_eq!(second.project_ids, first.project_ids);
        assert_eq!(second.experience_ids, first.experience_ids);
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM projects", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 1);
    }
}
