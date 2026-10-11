//! One-time-per-startup duplicate merge. Resume re-imports before the
//! update-in-place importer stacked identical vault records, and duplicates
//! poison every downstream view: the matcher shows the same record three
//! times in Supporting records, and the ranking repeats it per copy.
//!
//! The pass groups live records by the same identity the importer matches on
//! (normalized title / org+role / degree), keeps the oldest copy, moves the
//! duplicates' children (skill links, proof, bullets, decisions, saved-plan
//! references) onto the keeper, and hard-deletes the extras — all in one
//! transaction so a failure leaves the vault untouched. Idempotent: a clean
//! vault is a no-op.

use super::vault::sql_err;
use rusqlite::{params, Connection};
use std::collections::HashMap;

/// (table, identity columns) per entity kind. The identity columns must match
/// `find_live_by_tx` in import_batch — the merge and the importer must agree
/// on what makes two records "the same record".
const KINDS: &[(&str, &str, &[&str])] = &[
    ("projects", "project", &["title"]),
    ("experiences", "experience", &["organization", "role"]),
    (
        "education",
        "education",
        &["institution", "degree", "field_of_study"],
    ),
    ("certifications", "certification", &["title", "issuer"]),
    ("achievements", "achievement", &["title", "issuer"]),
];

/// Groups of 2+ live row ids that share an identity, lowest id first.
fn duplicate_groups(
    conn: &Connection,
    table: &str,
    key_cols: &[&str],
) -> Result<Vec<Vec<i64>>, String> {
    let cols = key_cols.join(", ");
    let sql = format!("SELECT id, {cols} FROM {table} WHERE deleted_at IS NULL ORDER BY id");
    let mut stmt = sql_err(conn.prepare(&sql))?;
    let rows = stmt
        .query_map([], |row| {
            let id: i64 = row.get(0)?;
            let mut key = String::new();
            for i in 1..=key_cols.len() {
                let value: String = row.get::<_, Option<String>>(i)?.unwrap_or_default();
                key.push('\u{1f}');
                key.push_str(value.trim().to_lowercase().as_str());
            }
            Ok((id, key))
        })
        .map_err(|e| e.to_string())?;
    let mut groups: HashMap<String, Vec<i64>> = HashMap::new();
    for pair in rows {
        let (id, key) = pair.map_err(|e| e.to_string())?;
        groups.entry(key).or_default().push(id);
    }
    let mut grouped: Vec<Vec<i64>> = groups.into_values().filter(|ids| ids.len() > 1).collect();
    for ids in &mut grouped {
        ids.sort_unstable();
    }
    Ok(grouped)
}

/// Moves one duplicate's children onto the keeper, then deletes the duplicate.
/// Parent-table DELETE fires the cleanup triggers, which sweep whatever child
/// rows were not re-pointed.
fn merge_into_keeper(
    conn: &Connection,
    table: &str,
    kind: &str,
    keeper: i64,
    dup: i64,
) -> Result<(), String> {
    // Skill links: union onto the keeper, highest confidence wins.
    sql_err(conn.execute(
        "INSERT INTO entity_skills (entity_type, entity_id, skill_id, confidence) \
         SELECT ?1, ?2, skill_id, confidence FROM entity_skills \
          WHERE entity_type = ?1 AND entity_id = ?3 \
         ON CONFLICT(entity_type, entity_id, skill_id) \
         DO UPDATE SET confidence = MAX(confidence, excluded.confidence)",
        params![kind, keeper, dup],
    ))?;

    // Proof: a re-import leaves an identical passage row on each copy — drop
    // the ones the keeper already has, re-point the rest (bullet_evidence
    // follows the evidence id).
    sql_err(conn.execute(
        "DELETE FROM evidence WHERE entity_type = ?1 AND entity_id = ?3 \
         AND EXISTS (SELECT 1 FROM evidence k \
                     WHERE k.entity_type = evidence.entity_type AND k.entity_id = ?2 \
                       AND k.kind = evidence.kind AND k.title = evidence.title \
                       AND k.reference = evidence.reference AND k.note = evidence.note)",
        params![kind, keeper, dup],
    ))?;
    sql_err(conn.execute(
        "UPDATE evidence SET entity_id = ?2, updated_at = datetime('now') \
         WHERE entity_type = ?1 AND entity_id = ?3",
        params![kind, keeper, dup],
    ))?;

    // Canonical bullets exist for projects/experiences only; same policy.
    if kind == "project" || kind == "experience" {
        sql_err(conn.execute(
            "DELETE FROM canonical_bullets WHERE entity_type = ?1 AND entity_id = ?3 \
             AND EXISTS (SELECT 1 FROM canonical_bullets k \
                         WHERE k.entity_type = canonical_bullets.entity_type \
                           AND k.entity_id = ?2 AND k.text = canonical_bullets.text)",
            params![kind, keeper, dup],
        ))?;
        sql_err(conn.execute(
            "UPDATE canonical_bullets SET entity_id = ?2, updated_at = datetime('now') \
             WHERE entity_type = ?1 AND entity_id = ?3",
            params![kind, keeper, dup],
        ))?;
    }

    sql_err(conn.execute(
        "UPDATE claim_rules SET entity_id = ?2 WHERE entity_type = ?1 AND entity_id = ?3",
        params![kind, keeper, dup],
    ))?;

    // Evidence decisions are unique per (requirement, record): keep the
    // decision already attached to the keeper, otherwise take the dup's.
    sql_err(conn.execute(
        "DELETE FROM evidence_selections WHERE entity_type = ?1 AND entity_id = ?3 \
         AND EXISTS (SELECT 1 FROM evidence_selections k \
                     WHERE k.requirement_id = evidence_selections.requirement_id \
                       AND k.entity_type = evidence_selections.entity_type \
                       AND k.entity_id = ?2)",
        params![kind, keeper, dup],
    ))?;
    sql_err(conn.execute(
        "UPDATE evidence_selections SET entity_id = ?2, updated_at = datetime('now') \
         WHERE entity_type = ?1 AND entity_id = ?3",
        params![kind, keeper, dup],
    ))?;

    sql_err(conn.execute(&format!("DELETE FROM {table} WHERE id = ?1"), [dup]))?;
    Ok(())
}

fn remap_plan_items(
    items: &mut Vec<crate::composer::PlanItem>,
    kind: &str,
    remap: &HashMap<(String, i64), i64>,
    changed: &mut bool,
) {
    for item in items.iter_mut() {
        if let Some(keeper) = remap.get(&(kind.to_string(), item.id)) {
            if *keeper != item.id {
                item.id = *keeper;
                *changed = true;
            }
        }
    }
    // A saved plan can carry both copies as separate items; after the remap
    // they would render twice on the resume — keep the first.
    let mut seen: Vec<i64> = Vec::new();
    items.retain(|item| {
        if seen.contains(&item.id) {
            *changed = true;
            false
        } else {
            seen.push(item.id);
            true
        }
    });
}

/// Rewrites saved resume plans so references to merged-away ids point at the
/// keepers. Plans that no longer deserialize are left untouched rather than
/// failing the whole startup.
fn remap_saved_plans(conn: &Connection, remap: &HashMap<(String, i64), i64>) -> Result<(), String> {
    if remap.is_empty() {
        return Ok(());
    }
    let mut stmt = sql_err(conn.prepare("SELECT job_id, plan_json FROM resume_plans"))?;
    let rows = stmt
        .query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))
        .map_err(|e| e.to_string())?;
    let plans: Vec<(i64, String)> = rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    drop(stmt);

    for (job_id, json) in plans {
        let Ok(mut plan) = serde_json::from_str::<crate::composer::ResumePlan>(&json) else {
            continue;
        };
        let mut changed = false;
        remap_plan_items(&mut plan.experience, "experience", remap, &mut changed);
        remap_plan_items(&mut plan.projects, "project", remap, &mut changed);
        for education in &mut plan.education {
            if let Some(keeper) = remap.get(&("education".to_string(), education.id)) {
                if *keeper != education.id {
                    education.id = *keeper;
                    changed = true;
                }
            }
        }
        // Education remaps can collide the same way items can.
        let mut seen_edu: Vec<i64> = Vec::new();
        plan.education.retain(|education| {
            if seen_edu.contains(&education.id) {
                changed = true;
                false
            } else {
                seen_edu.push(education.id);
                true
            }
        });
        for achievement in &mut plan.achievements {
            if let Some(keeper) = remap.get(&("achievement".to_string(), achievement.id)) {
                if *keeper != achievement.id {
                    achievement.id = *keeper;
                    changed = true;
                }
            }
        }
        let mut seen_ach: Vec<i64> = Vec::new();
        plan.achievements.retain(|achievement| {
            if seen_ach.contains(&achievement.id) {
                changed = true;
                false
            } else {
                seen_ach.push(achievement.id);
                true
            }
        });
        if changed {
            let json = serde_json::to_string(&plan).map_err(|e| e.to_string())?;
            sql_err(conn.execute(
                "UPDATE resume_plans SET plan_json = ?1, updated_at = datetime('now') WHERE job_id = ?2",
                params![json, job_id],
            ))?;
        }
    }
    Ok(())
}

/// Merges duplicate vault records. Returns how many duplicate rows were
/// removed. Bumps each keeper's `updated_at` so a stored match report goes
/// stale and the Evidence tab offers a re-run.
pub fn merge_duplicate_vault_records(conn: &Connection) -> Result<usize, String> {
    let tx = sql_err(conn.unchecked_transaction())?;
    let mut merged = 0usize;
    let mut remap: HashMap<(String, i64), i64> = HashMap::new();
    let mut keepers_touched: Vec<(String, String, i64)> = Vec::new();

    for (table, kind, key_cols) in KINDS {
        for ids in duplicate_groups(&tx, table, key_cols)? {
            let keeper = ids[0];
            for dup in &ids[1..] {
                merge_into_keeper(&tx, table, kind, keeper, *dup)?;
                remap.insert(((*kind).to_string(), *dup), keeper);
                merged += 1;
            }
            keepers_touched.push((table.to_string(), kind.to_string(), keeper));
        }
    }

    remap_saved_plans(&tx, &remap)?;

    // Mark keepers changed so stored match reports for jobs that referenced
    // the duplicates go stale (is_match_stale compares timestamps).
    for (table, _kind, keeper) in keepers_touched {
        sql_err(tx.execute(
            &format!("UPDATE {table} SET updated_at = datetime('now') WHERE id = ?1"),
            [keeper],
        ))?;
    }

    sql_err(tx.commit())?;
    Ok(merged)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::apply_migrations;
    use rusqlite::Connection;

    fn mem_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        apply_migrations(&conn).unwrap();
        conn
    }

    #[test]
    fn duplicates_merge_and_children_repoint_to_the_keeper() {
        let conn = mem_db();
        // Two identical projects: keeper 1, duplicate 2.
        conn.execute("INSERT INTO projects (id, title) VALUES (1, 'Kairo')", [])
            .unwrap();
        conn.execute("INSERT INTO projects (id, title) VALUES (2, ' kairo ')", [])
            .unwrap();

        // Skill links: keeper has Python@2, dup has Python@4 and Rust@3.
        conn.execute(
            "INSERT INTO skills (id, canonical_name) VALUES (10, 'Python'), (11, 'Rust')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO entity_skills (entity_type, entity_id, skill_id, confidence) VALUES ('project', 1, 10, 2)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO entity_skills (entity_type, entity_id, skill_id, confidence) VALUES \
             ('project', 2, 10, 4), ('project', 2, 11, 3)",
            [],
        )
        .unwrap();

        // Proof: dup passage identical to keeper's (dropped) + a unique one (re-pointed).
        conn.execute(
            "INSERT INTO evidence (id, entity_type, entity_id, kind, title, note) \
             VALUES (1, 'project', 1, 'document', 'Original resume passage', 'same')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO evidence (id, entity_type, entity_id, kind, title, note) \
             VALUES (2, 'project', 2, 'document', 'Original resume passage', 'same'), \
                    (3, 'project', 2, 'note', 'Unique proof', 'keep me')",
            [],
        )
        .unwrap();

        // Bullets: one identical (dropped), one unique (re-pointed).
        conn.execute(
            "INSERT INTO canonical_bullets (id, entity_type, entity_id, text) \
             VALUES (1, 'project', 1, 'Built X'), (2, 'project', 2, 'Built X'), (3, 'project', 2, 'Built Y')",
            [],
        )
        .unwrap();

        // Evidence decisions: job/requirement rows to satisfy the FKs.
        conn.execute(
            "INSERT INTO jobs (id, company, role_title, raw_jd) VALUES (1, 'Acme', 'Dev', 'jd body long enough')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO job_requirements (id, job_id, kind, raw_text, normalized_key, importance, user_confirmed, updated_at) \
             VALUES (1, 1, 'required_skill', 'Rust', 'rust', 0.9, 1, '2026-01-01 00:00:00')",
            [],
        )
        .unwrap();
        // Keeper already has a decision for req 1 → dup's decision is dropped.
        // Keeper has none for req 2 → dup's decision re-points.
        conn.execute(
            "INSERT INTO job_requirements (id, job_id, kind, raw_text, normalized_key, importance, user_confirmed, updated_at) \
             VALUES (2, 1, 'required_skill', 'SQL', 'sql', 0.8, 1, '2026-01-01 00:00:00')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO evidence_selections (job_id, requirement_id, entity_type, entity_id, decision) VALUES \
             (1, 1, 'project', 1, 'use'), (1, 1, 'project', 2, 'dismiss'), (1, 2, 'project', 2, 'use')",
            [],
        )
        .unwrap();

        let merged = merge_duplicate_vault_records(&conn).unwrap();
        assert_eq!(merged, 1);

        // One project left, with the union of links at max confidence.
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM projects", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 1);
        let links: Vec<(i64, i64)> = {
            let mut stmt = conn
                .prepare("SELECT skill_id, confidence FROM entity_skills WHERE entity_id = 1 ORDER BY skill_id")
                .unwrap();
            stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
                .unwrap()
                .collect::<Result<Vec<_>, _>>()
                .unwrap()
        };
        assert_eq!(links, vec![(10, 4), (11, 3)]);

        // Proof re-pointed, exact passage collapsed.
        let evidence: Vec<i64> = {
            let mut stmt = conn
                .prepare("SELECT id FROM evidence WHERE entity_id = 1 ORDER BY id")
                .unwrap();
            stmt.query_map([], |r| r.get(0))
                .unwrap()
                .collect::<Result<Vec<_>, _>>()
                .unwrap()
        };
        assert_eq!(evidence, vec![1, 3]);
        let none_on_dup: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM evidence WHERE entity_id = 2",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(none_on_dup, 0);

        let bullets: Vec<i64> = {
            let mut stmt = conn
                .prepare("SELECT id FROM canonical_bullets WHERE entity_id = 1 ORDER BY id")
                .unwrap();
            stmt.query_map([], |r| r.get(0))
                .unwrap()
                .collect::<Result<Vec<_>, _>>()
                .unwrap()
        };
        assert_eq!(bullets, vec![1, 3]);

        // Decisions: (req 1, keeper) survived the collision; (req 2) re-pointed.
        let selections: Vec<(i64, i64, String)> = {
            let mut stmt = conn
                .prepare("SELECT requirement_id, entity_id, decision FROM evidence_selections ORDER BY requirement_id")
                .unwrap();
            stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
                .unwrap()
                .collect::<Result<Vec<_>, _>>()
                .unwrap()
        };
        assert_eq!(selections, vec![(1, 1, "use".into()), (2, 1, "use".into())]);

        // Idempotent: a second pass finds nothing.
        assert_eq!(merge_duplicate_vault_records(&conn).unwrap(), 0);
    }

    #[test]
    fn saved_plans_remap_to_the_keeper_and_drop_duplicate_items() {
        let conn = mem_db();
        conn.execute("INSERT INTO projects (id, title) VALUES (1, 'Kairo')", [])
            .unwrap();
        conn.execute("INSERT INTO projects (id, title) VALUES (2, 'Kairo')", [])
            .unwrap();
        conn.execute(
            "INSERT INTO jobs (id, company, role_title, raw_jd) VALUES (1, 'Acme', 'Dev', 'jd body long enough')",
            [],
        )
        .unwrap();

        let plan = crate::composer::ResumePlan {
            composer_version: 1,
            config: crate::composer::ComposerConfig::default(),
            header: crate::composer::PlanHeader {
                full_name: "A".into(),
                headline: String::new(),
                email: String::new(),
                phone: String::new(),
                location: String::new(),
                website: String::new(),
                github: String::new(),
                linkedin: String::new(),
            },
            education: Vec::new(),
            experience: Vec::new(),
            projects: vec![
                crate::composer::PlanItem {
                    entity_type: "project".into(),
                    id: 1,
                    title: "Kairo".into(),
                    subtitle: String::new(),
                    start_date: None,
                    end_date: None,
                    is_current: false,
                    description: String::new(),
                    bullets: Vec::new(),
                    skills: Vec::new(),
                    relevance: 0.0,
                    evidence_count: 0,
                    origin: "imported".into(),
                    excluded: false,
                },
                crate::composer::PlanItem {
                    entity_type: "project".into(),
                    id: 2,
                    title: "Kairo".into(),
                    subtitle: String::new(),
                    start_date: None,
                    end_date: None,
                    is_current: false,
                    description: String::new(),
                    bullets: Vec::new(),
                    skills: Vec::new(),
                    relevance: 0.0,
                    evidence_count: 0,
                    origin: "imported".into(),
                    excluded: false,
                },
            ],
            achievements: Vec::new(),
            skills: Vec::new(),
            skills_grouped: Vec::new(),
            excluded_skills: Vec::new(),
            estimated_lines: 0,
            fits_one_page: true,
            warnings: Vec::new(),
        };
        conn.execute(
            "INSERT INTO resume_plans (job_id, config_json, plan_json, composer_version) VALUES (1, '{}', ?1, 1)",
            [serde_json::to_string(&plan).unwrap()],
        )
        .unwrap();

        assert_eq!(merge_duplicate_vault_records(&conn).unwrap(), 1);

        let stored: String = conn
            .query_row(
                "SELECT plan_json FROM resume_plans WHERE job_id = 1",
                [],
                |r| r.get(0),
            )
            .unwrap();
        let saved: crate::composer::ResumePlan = serde_json::from_str(&stored).unwrap();
        assert_eq!(saved.projects.len(), 1, "duplicate plan item collapsed");
        assert_eq!(saved.projects[0].id, 1, "item now points at the keeper");

        assert_eq!(merge_duplicate_vault_records(&conn).unwrap(), 0);
    }

    #[test]
    fn distinct_records_are_never_merged() {
        let conn = mem_db();
        conn.execute(
            "INSERT INTO projects (id, title) VALUES (1, 'Kairo'), (2, 'PyKV'), (3, 'WatchDog')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO experiences (id, organization, role) VALUES \
             (1, 'Acme', 'Intern'), (2, 'Acme', 'Engineer')",
            [],
        )
        .unwrap();
        assert_eq!(merge_duplicate_vault_records(&conn).unwrap(), 0);
        let count: i64 = conn
            .query_row(
                "SELECT (SELECT COUNT(*) FROM projects) + (SELECT COUNT(*) FROM experiences)",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 5);
    }
}
