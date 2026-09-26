//! Evidence & Trust layer (Phase 2 · spec §5).
//!
//! Evidence = proof attached to a career record (verified once the user
//! confirms it). Canonical bullets = approved factual language for
//! projects/experiences, each traceable to evidence rows. Claim rules =
//! explicit allowed/forbidden boundaries used by the later claim validator.

use rusqlite::types::Value;
use rusqlite::{params, params_from_iter, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

pub const EVIDENCE_ENTITY_TYPES: &[&str] = &[
    "project",
    "experience",
    "education",
    "certification",
    "achievement",
];
pub const EVIDENCE_KINDS: &[&str] = &[
    "repository",
    "document",
    "certificate",
    "metric",
    "note",
    "link",
    "other",
];
pub const BULLET_ENTITY_TYPES: &[&str] = &["project", "experience"];
pub const RULE_ENTITY_TYPES: &[&str] = &[
    "project",
    "experience",
    "education",
    "certification",
    "achievement",
    "skill",
];
pub const RULE_TYPES: &[&str] = &["forbidden_claim", "allowed_claim"];

fn str_err<T>(r: rusqlite::Result<T>) -> Result<T, String> {
    r.map_err(|e| e.to_string())
}

fn check_in(value: &str, allowed: &[&str], label: &str) -> Result<(), String> {
    if allowed.contains(&value) {
        Ok(())
    } else {
        Err(format!("Unknown {label} '{value}'"))
    }
}

fn require(label: &str, value: &str) -> Result<(), String> {
    if value.trim().is_empty() {
        Err(format!("{label} is required"))
    } else {
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Evidence {
    pub id: i64,
    pub entity_type: String,
    pub entity_id: i64,
    pub kind: String,
    pub title: String,
    pub reference: String,
    pub note: String,
    pub verified: bool,
}

fn evidence_cols() -> &'static str {
    "id, entity_type, entity_id, kind, title, reference, note, verified"
}

fn evidence_from_row(row: &rusqlite::Row) -> rusqlite::Result<Evidence> {
    Ok(Evidence {
        id: row.get(0)?,
        entity_type: row.get(1)?,
        entity_id: row.get(2)?,
        kind: row.get(3)?,
        title: row.get(4)?,
        reference: row.get(5)?,
        note: row.get(6)?,
        verified: row.get::<_, i64>(7)? != 0,
    })
}

impl Evidence {
    fn validate(&self) -> Result<(), String> {
        check_in(&self.entity_type, EVIDENCE_ENTITY_TYPES, "entity type")?;
        check_in(&self.kind, EVIDENCE_KINDS, "evidence kind")?;
        require("Title", &self.title)?;
        Ok(())
    }

    fn values(&self) -> Vec<Value> {
        vec![
            Value::Text(self.entity_type.clone()),
            Value::Integer(self.entity_id),
            Value::Text(self.kind.clone()),
            Value::Text(self.title.clone()),
            Value::Text(self.reference.clone()),
            Value::Text(self.note.clone()),
            Value::Integer(if self.verified { 1 } else { 0 }),
        ]
    }
}

pub fn list_evidence(
    conn: &Connection,
    entity_type: &str,
    entity_id: i64,
) -> Result<Vec<Evidence>, String> {
    check_in(entity_type, EVIDENCE_ENTITY_TYPES, "entity type")?;
    let sql = format!(
        "SELECT {} FROM evidence WHERE entity_type = ?1 AND entity_id = ?2 ORDER BY verified ASC, id DESC",
        evidence_cols()
    );
    let mut stmt = str_err(conn.prepare(&sql))?;
    let mapped = str_err(stmt.query_map(params![entity_type, entity_id], evidence_from_row))?;
    let rows = str_err(mapped.collect::<rusqlite::Result<Vec<_>>>())?;
    Ok(rows)
}

pub fn get_evidence(conn: &Connection, id: i64) -> Result<Evidence, String> {
    let sql = format!("SELECT {} FROM evidence WHERE id = ?1", evidence_cols());
    let mut stmt = str_err(conn.prepare(&sql))?;
    str_err(stmt.query_row([id], evidence_from_row))
}

fn evidence_parent_exists(
    conn: &Connection,
    entity_type: &str,
    entity_id: i64,
) -> Result<(), String> {
    let table = match entity_type {
        "project" => "projects",
        "experience" => "experiences",
        "education" => "education",
        "certification" => "certifications",
        "achievement" => "achievements",
        other => return Err(format!("Unknown entity type '{other}'")),
    };
    let sql = format!("SELECT COUNT(*) FROM {table} WHERE id = ?1");
    let count: i64 = str_err(conn.query_row(&sql, [entity_id], |r| r.get(0)))?;
    if count == 0 {
        Err("Parent record not found".to_string())
    } else {
        Ok(())
    }
}

pub fn create_evidence(conn: &Connection, evidence: &Evidence) -> Result<Evidence, String> {
    evidence.validate()?;
    evidence_parent_exists(conn, &evidence.entity_type, evidence.entity_id)?;
    let sql =
        "INSERT INTO evidence (entity_type, entity_id, kind, title, reference, note, verified) \
               VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)";
    let values: Vec<Value> = evidence.values();
    let tx = str_err(conn.unchecked_transaction())?;
    str_err(tx.execute(sql, params_from_iter(values.iter())))?;
    let id = tx.last_insert_rowid();
    str_err(tx.commit())?;
    get_evidence(conn, id)
}

pub fn update_evidence(conn: &Connection, evidence: &Evidence) -> Result<Evidence, String> {
    evidence.validate()?;
    let sql = "UPDATE evidence SET entity_type = ?1, entity_id = ?2, kind = ?3, title = ?4, \
               reference = ?5, note = ?6, verified = ?7, updated_at = datetime('now') WHERE id = ?8";
    let mut values: Vec<Value> = evidence.values();
    values.push(Value::Integer(evidence.id));
    let changed = str_err(conn.execute(sql, params_from_iter(values.iter())))?;
    if changed == 0 {
        return Err("Evidence not found".to_string());
    }
    get_evidence(conn, evidence.id)
}

pub fn delete_evidence(conn: &Connection, id: i64) -> Result<(), String> {
    let changed = str_err(conn.execute("DELETE FROM evidence WHERE id = ?1", [id]))?;
    if changed == 0 {
        return Err("Evidence not found".to_string());
    }
    Ok(())
}

/// Counts of evidence per entity id — used to enrich Vault cards.
pub fn evidence_count_map(
    conn: &Connection,
    entity_type: &str,
    ids: &[i64],
) -> rusqlite::Result<std::collections::HashMap<i64, i64>> {
    let mut map = std::collections::HashMap::new();
    if ids.is_empty() {
        return Ok(map);
    }
    // ?1 is entity_type; the IN list starts at ?2.
    let placeholders = (2..=ids.len() + 1)
        .map(|i| format!("?{i}"))
        .collect::<Vec<_>>()
        .join(", ");
    let sql = format!(
        "SELECT entity_id, COUNT(*) FROM evidence \
         WHERE entity_type = ?1 AND entity_id IN ({placeholders}) GROUP BY entity_id"
    );
    let mut params_vec: Vec<Value> = vec![Value::Text(entity_type.to_string())];
    params_vec.extend(ids.iter().map(|i| Value::Integer(*i)));
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params_from_iter(params_vec.iter()), |row| {
        Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?))
    })?;
    for row in rows {
        let (entity_id, count) = row?;
        map.insert(entity_id, count);
    }
    Ok(map)
}

// ---------------------------------------------------------------------------
// Canonical bullets
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BulletEvidenceRef {
    pub id: i64,
    pub title: String,
    pub kind: String,
    pub verified: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CanonicalBullet {
    pub id: i64,
    pub entity_type: String,
    pub entity_id: i64,
    pub text: String,
    pub approved: bool,
    pub sort_order: i64,
    /// Populated on read: the proof supporting this bullet.
    #[serde(default)]
    pub evidence: Vec<BulletEvidenceRef>,
    /// Populated on read / accepted on write.
    #[serde(default)]
    pub evidence_ids: Vec<i64>,
}

const BULLET_COLS: &str = "id, entity_type, entity_id, text, approved, sort_order";

fn bullet_from_row(row: &rusqlite::Row) -> rusqlite::Result<CanonicalBullet> {
    Ok(CanonicalBullet {
        id: row.get(0)?,
        entity_type: row.get(1)?,
        entity_id: row.get(2)?,
        text: row.get(3)?,
        approved: row.get::<_, i64>(4)? != 0,
        sort_order: row.get(5)?,
        evidence: Vec::new(),
        evidence_ids: Vec::new(),
    })
}

fn bullet_evidence_map(
    conn: &Connection,
    bullet_ids: &[i64],
) -> rusqlite::Result<std::collections::HashMap<i64, Vec<BulletEvidenceRef>>> {
    let mut map = std::collections::HashMap::new();
    if bullet_ids.is_empty() {
        return Ok(map);
    }
    let placeholders = (1..=bullet_ids.len())
        .map(|i| format!("?{i}"))
        .collect::<Vec<_>>()
        .join(", ");
    let sql = format!(
        "SELECT be.bullet_id, e.id, e.title, e.kind, e.verified \
         FROM bullet_evidence be JOIN evidence e ON e.id = be.evidence_id \
         WHERE be.bullet_id IN ({placeholders}) ORDER BY e.verified DESC, e.id"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params_from_iter(bullet_ids.iter()), |row| {
        Ok((
            row.get::<_, i64>(0)?,
            BulletEvidenceRef {
                id: row.get(1)?,
                title: row.get(2)?,
                kind: row.get(3)?,
                verified: row.get::<_, i64>(4)? != 0,
            },
        ))
    })?;
    for row in rows {
        let (bullet_id, reference) = row?;
        map.entry(bullet_id).or_default().push(reference);
    }
    Ok(map)
}

fn load_bullet_evidence(conn: &Connection, bullets: &mut [CanonicalBullet]) -> Result<(), String> {
    let ids: Vec<i64> = bullets.iter().map(|b| b.id).collect();
    let map = str_err(bullet_evidence_map(conn, &ids))?;
    for bullet in bullets.iter_mut() {
        if let Some(refs) = map.get(&bullet.id) {
            bullet.evidence = refs.clone();
            bullet.evidence_ids = refs.iter().map(|r| r.id).collect();
        }
    }
    Ok(())
}

pub fn list_bullets(
    conn: &Connection,
    entity_type: &str,
    entity_id: i64,
) -> Result<Vec<CanonicalBullet>, String> {
    check_in(entity_type, BULLET_ENTITY_TYPES, "entity type")?;
    let sql = format!(
        "SELECT {BULLET_COLS} FROM canonical_bullets WHERE entity_type = ?1 AND entity_id = ?2 \
         ORDER BY sort_order, id"
    );
    let mut stmt = str_err(conn.prepare(&sql))?;
    let mapped = str_err(stmt.query_map(params![entity_type, entity_id], bullet_from_row))?;
    let mut bullets = str_err(mapped.collect::<rusqlite::Result<Vec<_>>>())?;
    load_bullet_evidence(conn, &mut bullets)?;
    Ok(bullets)
}

pub fn get_bullet(conn: &Connection, id: i64) -> Result<CanonicalBullet, String> {
    let sql = format!("SELECT {BULLET_COLS} FROM canonical_bullets WHERE id = ?1");
    let mut stmt = str_err(conn.prepare(&sql))?;
    let mut bullet = str_err(stmt.query_row([id], bullet_from_row))?;
    load_bullet_evidence(conn, std::slice::from_mut(&mut bullet))?;
    Ok(bullet)
}

impl CanonicalBullet {
    fn validate(&self) -> Result<(), String> {
        check_in(&self.entity_type, BULLET_ENTITY_TYPES, "entity type")?;
        require("Bullet text", &self.text)?;
        Ok(())
    }

    /// Replaces the bullet's evidence links after insert/update, in-tx.
    /// Always runs: an empty list explicitly clears all references.
    fn write_evidence_links(&self, conn: &Connection) -> Result<(), String> {
        str_err(conn.execute(
            "DELETE FROM bullet_evidence WHERE bullet_id = ?1",
            [self.id],
        ))?;
        for evidence_id in &self.evidence_ids {
            let parent: Option<(String, i64)> = str_err(
                conn.query_row(
                    "SELECT entity_type, entity_id FROM evidence WHERE id = ?1",
                    [evidence_id],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .optional(),
            )?;
            let Some((parent_type, parent_id)) = parent else {
                return Err(format!("Evidence {evidence_id} not found"));
            };
            if parent_type != self.entity_type || parent_id != self.entity_id {
                return Err(format!(
                    "Evidence {} belongs to a different record",
                    evidence_id
                ));
            }
            str_err(conn.execute(
                "INSERT OR IGNORE INTO bullet_evidence (bullet_id, evidence_id) VALUES (?1, ?2)",
                params![self.id, evidence_id],
            ))?;
        }
        Ok(())
    }
}

pub fn create_bullet(
    conn: &Connection,
    bullet: &CanonicalBullet,
) -> Result<CanonicalBullet, String> {
    bullet.validate()?;
    let next_order: i64 = str_err(conn.query_row(
        "SELECT COALESCE(MAX(sort_order), 0) + 1 FROM canonical_bullets \
         WHERE entity_type = ?1 AND entity_id = ?2",
        params![bullet.entity_type, bullet.entity_id],
        |r| r.get(0),
    ))?;
    let sql = "INSERT INTO canonical_bullets (entity_type, entity_id, text, approved, sort_order) \
               VALUES (?1, ?2, ?3, ?4, ?5)";
    let tx = str_err(conn.unchecked_transaction())?;
    str_err(tx.execute(
        sql,
        params![
            bullet.entity_type,
            bullet.entity_id,
            bullet.text,
            bullet.approved as i64,
            next_order
        ],
    ))?;
    let id = tx.last_insert_rowid();
    let stored = CanonicalBullet {
        id,
        entity_type: bullet.entity_type.clone(),
        entity_id: bullet.entity_id,
        text: bullet.text.clone(),
        approved: bullet.approved,
        sort_order: next_order,
        evidence: Vec::new(),
        evidence_ids: bullet.evidence_ids.clone(),
    };
    stored.write_evidence_links(&tx)?;
    str_err(tx.commit())?;
    get_bullet(conn, id)
}

pub fn update_bullet(
    conn: &Connection,
    bullet: &CanonicalBullet,
) -> Result<CanonicalBullet, String> {
    bullet.validate()?;
    let sql =
        "UPDATE canonical_bullets SET text = ?1, approved = ?2, updated_at = datetime('now') \
               WHERE id = ?3";
    let tx = str_err(conn.unchecked_transaction())?;
    let changed =
        str_err(tx.execute(sql, params![bullet.text, bullet.approved as i64, bullet.id]))?;
    if changed == 0 {
        return Err("Bullet not found".to_string());
    }
    // The inspector always sends the full link list, so replace links on every
    // update (an empty list explicitly clears all references).
    bullet.write_evidence_links(&tx)?;
    str_err(tx.commit())?;
    get_bullet(conn, bullet.id)
}

pub fn delete_bullet(conn: &Connection, id: i64) -> Result<(), String> {
    let changed = str_err(conn.execute("DELETE FROM canonical_bullets WHERE id = ?1", [id]))?;
    if changed == 0 {
        return Err("Bullet not found".to_string());
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Claim rules
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaimRule {
    pub id: i64,
    /// NULL = global rule.
    pub entity_type: Option<String>,
    pub entity_id: Option<i64>,
    pub rule_type: String,
    pub pattern: String,
    pub note: String,
}

const RULE_COLS: &str = "id, entity_type, entity_id, rule_type, pattern, note";

fn rule_from_row(row: &rusqlite::Row) -> rusqlite::Result<ClaimRule> {
    Ok(ClaimRule {
        id: row.get(0)?,
        entity_type: row.get(1)?,
        entity_id: row.get(2)?,
        rule_type: row.get(3)?,
        pattern: row.get(4)?,
        note: row.get(5)?,
    })
}

impl ClaimRule {
    fn validate(&self) -> Result<(), String> {
        check_in(&self.rule_type, RULE_TYPES, "rule type")?;
        require("Pattern", &self.pattern)?;
        match (&self.entity_type, &self.entity_id) {
            (Some(t), Some(_)) => check_in(t, RULE_ENTITY_TYPES, "entity type")?,
            (None, None) => {}
            _ => {
                return Err(
                    "Claim rules must be global or scoped to a full entity reference".to_string(),
                )
            }
        }
        Ok(())
    }
}

/// Rules that apply to a record: its own rules plus global ones.
pub fn list_claim_rules(
    conn: &Connection,
    entity_type: Option<&str>,
    entity_id: Option<i64>,
) -> Result<Vec<ClaimRule>, String> {
    let sql = if entity_type.is_some() {
        format!(
            "SELECT {RULE_COLS} FROM claim_rules \
             WHERE (entity_type IS NULL AND entity_id IS NULL) \
                OR (entity_type = ?1 AND entity_id = ?2) ORDER BY id"
        )
    } else {
        format!(
            "SELECT {RULE_COLS} FROM claim_rules WHERE entity_type IS NULL AND entity_id IS NULL ORDER BY id"
        )
    };
    let mut stmt = str_err(conn.prepare(&sql))?;
    let rows = if entity_type.is_some() {
        let mapped = str_err(stmt.query_map(params![entity_type, entity_id], rule_from_row))?;
        str_err(mapped.collect::<rusqlite::Result<Vec<_>>>())?
    } else {
        let mapped = str_err(stmt.query_map([], rule_from_row))?;
        str_err(mapped.collect::<rusqlite::Result<Vec<_>>>())?
    };
    Ok(rows)
}

pub fn create_claim_rule(conn: &Connection, rule: &ClaimRule) -> Result<ClaimRule, String> {
    rule.validate()?;
    if let (Some(t), Some(id)) = (&rule.entity_type, rule.entity_id) {
        // Skills are not evidence parents but can still carry claim rules.
        if t == "skill" {
            let count: i64 = str_err(conn.query_row(
                "SELECT COUNT(*) FROM skills WHERE id = ?1",
                [id],
                |r| r.get(0),
            ))?;
            if count == 0 {
                return Err("Parent record not found".to_string());
            }
        } else {
            evidence_parent_exists(conn, t, id)?;
        }
    }
    let sql = "INSERT INTO claim_rules (entity_type, entity_id, rule_type, pattern, note) \
               VALUES (?1, ?2, ?3, ?4, ?5)";
    let values: Vec<Value> = vec![
        rule.entity_type
            .clone()
            .map(Value::Text)
            .unwrap_or(Value::Null),
        rule.entity_id.map(Value::Integer).unwrap_or(Value::Null),
        Value::Text(rule.rule_type.clone()),
        Value::Text(rule.pattern.clone()),
        Value::Text(rule.note.clone()),
    ];
    let tx = str_err(conn.unchecked_transaction())?;
    str_err(tx.execute(sql, params_from_iter(values.iter())))?;
    let id = tx.last_insert_rowid();
    str_err(tx.commit())?;
    let sql_get = format!("SELECT {RULE_COLS} FROM claim_rules WHERE id = ?1");
    let mut stmt = str_err(conn.prepare(&sql_get))?;
    str_err(stmt.query_row([id], rule_from_row))
}

pub fn update_claim_rule(conn: &Connection, rule: &ClaimRule) -> Result<ClaimRule, String> {
    rule.validate()?;
    let sql = "UPDATE claim_rules SET rule_type = ?1, pattern = ?2, note = ?3, \
               updated_at = datetime('now') WHERE id = ?4";
    let changed = str_err(conn.execute(
        sql,
        params![rule.rule_type, rule.pattern, rule.note, rule.id],
    ))?;
    if changed == 0 {
        return Err("Claim rule not found".to_string());
    }
    let sql_get = format!("SELECT {RULE_COLS} FROM claim_rules WHERE id = ?1");
    let mut stmt = str_err(conn.prepare(&sql_get))?;
    str_err(stmt.query_row([rule.id], rule_from_row))
}

pub fn delete_claim_rule(conn: &Connection, id: i64) -> Result<(), String> {
    let changed = str_err(conn.execute("DELETE FROM claim_rules WHERE id = ?1", [id]))?;
    if changed == 0 {
        return Err("Claim rule not found".to_string());
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::apply_migrations;
    use crate::db::vault::{vault_create, vault_delete, Project};

    fn mem_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        apply_migrations(&conn).unwrap();
        conn
    }

    fn project(conn: &Connection, title: &str) -> Project {
        vault_create(
            conn,
            &Project {
                id: 0,
                title: title.to_string(),
                description: String::new(),
                start_date: None,
                end_date: None,
                is_current: false,
                url: String::new(),
                repo_url: String::new(),
                skills: vec![],
                evidence_count: 0,
            },
        )
        .unwrap()
    }

    fn evidence(conn: &Connection, project_id: i64, title: &str, verified: bool) -> Evidence {
        create_evidence(
            conn,
            &Evidence {
                id: 0,
                entity_type: "project".to_string(),
                entity_id: project_id,
                kind: "repository".to_string(),
                title: title.to_string(),
                reference: "https://github.com/me/pykv".to_string(),
                note: String::new(),
                verified,
            },
        )
        .unwrap()
    }

    #[test]
    fn evidence_crud_and_cascade() {
        let conn = mem_db();
        let p = project(&conn, "PyKV");
        let e1 = evidence(&conn, p.id, "Repository", true);
        evidence(&conn, p.id, "Benchmarks", false);

        let list = list_evidence(&conn, "project", p.id).unwrap();
        assert_eq!(list.len(), 2);
        // Unverified sorts first (review queue), verified last.
        assert_eq!(list[0].title, "Benchmarks");
        assert!(list[1].verified);

        let counts = evidence_count_map(&conn, "project", &[p.id]).unwrap();
        assert_eq!(counts.get(&p.id), Some(&2));

        vault_delete::<Project>(&conn, p.id).unwrap();
        let remaining: i64 = conn
            .query_row("SELECT COUNT(*) FROM evidence", [], |r| r.get(0))
            .unwrap();
        assert_eq!(remaining, 0);
        let _ = e1;
    }

    #[test]
    fn evidence_rejects_bad_kind_and_missing_parent() {
        let conn = mem_db();
        let mut e = Evidence {
            id: 0,
            entity_type: "project".to_string(),
            entity_id: 999,
            kind: "repository".to_string(),
            title: "X".to_string(),
            reference: String::new(),
            note: String::new(),
            verified: false,
        };
        assert!(create_evidence(&conn, &e).is_err()); // missing parent
        e.entity_id = project(&conn, "P").id;
        e.kind = "magic".to_string();
        assert!(create_evidence(&conn, &e).is_err()); // bad kind
    }

    #[test]
    fn bullets_link_evidence_and_validate_scope() {
        let conn = mem_db();
        let p = project(&conn, "PyKV");
        let other = project(&conn, "Other");
        let e1 = evidence(&conn, p.id, "Repository", true);
        let e2 = evidence(&conn, p.id, "Measured tests", true);
        let foreign = evidence(&conn, other.id, "Foreign", false);

        let created = create_bullet(
            &conn,
            &CanonicalBullet {
                id: 0,
                entity_type: "project".to_string(),
                entity_id: p.id,
                text: "Implemented WAL with crash recovery".to_string(),
                approved: true,
                sort_order: 0,
                evidence: vec![],
                evidence_ids: vec![e1.id, e2.id],
            },
        )
        .unwrap();
        assert_eq!(created.evidence.len(), 2);
        assert!(created.approved);

        // Cross-entity evidence is rejected.
        let mut bad = created.clone();
        bad.id = 0;
        bad.evidence_ids = vec![foreign.id];
        assert!(create_bullet(&conn, &bad).is_err());

        // Update: text edit plus explicit link replacement (empty clears links).
        let mut edit = created.clone();
        edit.text = "Implemented WAL with crash recovery and TTL eviction".to_string();
        edit.evidence_ids = Vec::new();
        let edited = update_bullet(&conn, &edit).unwrap();
        assert_eq!(edited.evidence.len(), 0);
        assert!(edited.text.contains("TTL"));

        // Re-linking works on a subsequent update.
        let mut relink = edited.clone();
        relink.evidence_ids = vec![e1.id];
        let relinked = update_bullet(&conn, &relink).unwrap();
        assert_eq!(relinked.evidence.len(), 1);
        assert_eq!(relinked.evidence[0].title, "Repository");

        // Deleting the project cascades bullets and links.
        vault_delete::<Project>(&conn, p.id).unwrap();
        let bullets_left: i64 = conn
            .query_row("SELECT COUNT(*) FROM canonical_bullets", [], |r| r.get(0))
            .unwrap();
        let links_left: i64 = conn
            .query_row("SELECT COUNT(*) FROM bullet_evidence", [], |r| r.get(0))
            .unwrap();
        assert_eq!(bullets_left, 0);
        assert_eq!(links_left, 0);
    }

    #[test]
    fn claim_rules_global_and_scoped() {
        let conn = mem_db();
        let p = project(&conn, "PyKV");
        let s = vault_create(
            &conn,
            &crate::db::vault::Skill {
                id: 0,
                canonical_name: "Python".to_string(),
                category: "language".to_string(),
                aliases: vec![],
            },
        )
        .unwrap();

        let global = create_claim_rule(
            &conn,
            &ClaimRule {
                id: 0,
                entity_type: None,
                entity_id: None,
                rule_type: "forbidden_claim".to_string(),
                pattern: "served millions of users".to_string(),
                note: "Never claim scale that is not evidenced".to_string(),
            },
        )
        .unwrap();
        assert!(global.entity_type.is_none());

        create_claim_rule(
            &conn,
            &ClaimRule {
                id: 0,
                entity_type: Some("project".to_string()),
                entity_id: Some(p.id),
                rule_type: "forbidden_claim".to_string(),
                pattern: "production-scale distributed system".to_string(),
                note: String::new(),
            },
        )
        .unwrap();

        let scoped = list_claim_rules(&conn, Some("project"), Some(p.id)).unwrap();
        assert_eq!(scoped.len(), 2); // global + own

        // Unscoped (entity_type without id) is rejected.
        let bad = ClaimRule {
            id: 0,
            entity_type: Some("skill".to_string()),
            entity_id: Some(s.id),
            rule_type: "allowed_claim".to_string(),
            pattern: "used in projects".to_string(),
            note: String::new(),
        };
        assert!(create_claim_rule(&conn, &bad).is_ok());

        let mut no_id = bad.clone();
        no_id.entity_id = None;
        assert!(create_claim_rule(&conn, &no_id).is_err());

        let mut bad_type = no_id.clone();
        bad_type.entity_id = Some(p.id);
        bad_type.rule_type = "forbidden_thought".to_string();
        assert!(create_claim_rule(&conn, &bad_type).is_err());

        assert!(delete_claim_rule(&conn, global.id).is_ok());
    }
}
