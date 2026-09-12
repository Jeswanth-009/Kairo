//! Career Vault repository (Phase 1).
//!
//! One generic CRUD engine drives the six record tables; each entity supplies
//! its column contract, validation, and optional enrichment. Projects and
//! experiences additionally carry linked skills with a 0–5 confidence.

use rusqlite::types::Value;
use rusqlite::{params, params_from_iter, Connection, Row};
use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// Generic engine
// ---------------------------------------------------------------------------

/// A column value in INSERT_COLS order. `bool` maps to SQLite INTEGER 0/1.
#[derive(Debug, Clone)]
pub enum FieldVal {
    Text(String),
    OptText(Option<String>),
    Int(i64),
    OptInt(Option<i64>),
    Bool(bool),
}

impl FieldVal {
    fn to_value(&self) -> Value {
        match self {
            FieldVal::Text(s) => Value::Text(s.clone()),
            FieldVal::OptText(v) => match v {
                Some(s) => Value::Text(s.clone()),
                None => Value::Null,
            },
            FieldVal::Int(i) => Value::Integer(*i),
            FieldVal::OptInt(v) => match v {
                Some(i) => Value::Integer(*i),
                None => Value::Null,
            },
            FieldVal::Bool(b) => Value::Integer(if *b { 1 } else { 0 }),
        }
    }
}

pub trait VaultEntity: Sized {
    const TABLE: &'static str;
    const ORDER_BY: &'static str;
    const SEARCH_COLS: &'static [&'static str];
    /// Writable columns in `values()` order (excludes `id`).
    const INSERT_COLS: &'static [&'static str];

    fn id(&self) -> i64;
    /// Row layout: column 0 is `id`, then INSERT_COLS in order.
    fn from_row(row: &Row) -> rusqlite::Result<Self>;
    fn values(&self) -> Vec<FieldVal>;
    fn validate(&self) -> Result<(), String>;

    /// Post-load enrichment (skill links, aliases). Default: none.
    fn enrich(_conn: &Connection, _rows: &mut [Self]) -> rusqlite::Result<()> {
        let _ = _rows;
        Ok(())
    }

    /// Extra writes after insert/update, inside the same transaction.
    fn after_write(_conn: &Connection, _id: i64, _value: &Self) -> Result<(), String> {
        Ok(())
    }
}

fn sql_err<T>(r: rusqlite::Result<T>) -> Result<T, String> {
    r.map_err(|e| e.to_string())
}

pub fn vault_list<E: VaultEntity>(conn: &Connection) -> Result<Vec<E>, String> {
    let sql = format!(
        "SELECT id, {} FROM {} ORDER BY {}",
        E::INSERT_COLS.join(", "),
        E::TABLE,
        E::ORDER_BY
    );
    let mut stmt = sql_err(conn.prepare(&sql))?;
    let mapped = sql_err(stmt.query_map([], |row| E::from_row(row)))?;
    let mut rows = sql_err(mapped.collect::<rusqlite::Result<Vec<_>>>())?;
    sql_err(E::enrich(conn, &mut rows))?;
    Ok(rows)
}

pub fn vault_get<E: VaultEntity>(conn: &Connection, id: i64) -> Result<E, String> {
    let mut rows = match vault_get_opt::<E>(conn, id)? {
        Some(r) => vec![r],
        None => return Err("Record not found".to_string()),
    };
    sql_err(E::enrich(conn, &mut rows))?;
    Ok(rows.remove(0))
}

fn vault_get_opt<E: VaultEntity>(conn: &Connection, id: i64) -> Result<Option<E>, String> {
    let sql = format!(
        "SELECT id, {} FROM {} WHERE id = ?1",
        E::INSERT_COLS.join(", "),
        E::TABLE
    );
    let mut stmt = sql_err(conn.prepare(&sql))?;
    match stmt.query_row([id], |row| E::from_row(row)) {
        Ok(v) => Ok(Some(v)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

pub fn vault_create<E: VaultEntity>(conn: &Connection, value: &E) -> Result<E, String> {
    value.validate()?;
    let cols = E::INSERT_COLS.join(", ");
    let placeholders = (1..=E::INSERT_COLS.len())
        .map(|i| format!("?{i}"))
        .collect::<Vec<_>>()
        .join(", ");
    let sql = format!("INSERT INTO {} ({}) VALUES ({})", E::TABLE, cols, placeholders);
    let values: Vec<Value> = value.values().iter().map(|v| v.to_value()).collect();

    let tx = sql_err(conn.unchecked_transaction())?;
    sql_err(tx.execute(&sql, params_from_iter(values.iter())))?;
    let id = tx.last_insert_rowid();
    E::after_write(&tx, id, value)?;
    sql_err(tx.commit())?;
    vault_get::<E>(conn, id)
}

pub fn vault_update<E: VaultEntity>(conn: &Connection, value: &E) -> Result<E, String> {
    value.validate()?;
    let id = value.id();
    let assignments = E::INSERT_COLS
        .iter()
        .enumerate()
        .map(|(i, col)| format!("{col} = ?{}", i + 1))
        .collect::<Vec<_>>()
        .join(", ");
    let sql = format!(
        "UPDATE {} SET {}, updated_at = datetime('now') WHERE id = ?{}",
        E::TABLE,
        assignments,
        E::INSERT_COLS.len() + 1
    );
    let mut values: Vec<Value> = value.values().iter().map(|v| v.to_value()).collect();
    values.push(Value::Integer(id));

    let tx = sql_err(conn.unchecked_transaction())?;
    let changed = sql_err(tx.execute(&sql, params_from_iter(values.iter())))?;
    if changed == 0 {
        return Err("Record not found".to_string());
    }
    E::after_write(&tx, id, value)?;
    sql_err(tx.commit())?;
    vault_get::<E>(conn, id)
}

pub fn vault_delete<E: VaultEntity>(conn: &Connection, id: i64) -> Result<(), String> {
    let sql = format!("DELETE FROM {} WHERE id = ?1", E::TABLE);
    let changed = sql_err(conn.execute(&sql, [id]))?;
    if changed == 0 {
        return Err("Record not found".to_string());
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

fn require(label: &str, value: &str) -> Result<(), String> {
    if value.trim().is_empty() {
        Err(format!("{label} is required"))
    } else {
        Ok(())
    }
}

/// Strict month precision "YYYY-MM" (the Vault's date format; empty means unset).
fn valid_month(value: &Option<String>, label: &str) -> Result<(), String> {
    let Some(s) = value else { return Ok(()) };
    let s = s.trim();
    if s.is_empty() {
        return Ok(());
    }
    let parts: Vec<&str> = s.split('-').collect();
    let ok = parts.len() == 2
        && parts[0].len() == 4
        && parts[1].len() == 2
        && parts.iter().all(|p| p.chars().all(|c| c.is_ascii_digit()))
        && (1..=12).contains(&parts[1].parse::<u8>().unwrap_or(0));
    if ok {
        Ok(())
    } else {
        Err(format!("{label} must use YYYY-MM format"))
    }
}

fn date_order(start: &Option<String>, end: &Option<String>) -> Result<(), String> {
    if let (Some(s), Some(e)) = (start, end) {
        if !s.is_empty() && !e.is_empty() && e < s {
            return Err("End date cannot be before start date".to_string());
        }
    }
    Ok(())
}

fn valid_url(value: &str, label: &str) -> Result<(), String> {
    let v = value.trim();
    if v.is_empty() || v.starts_with("http://") || v.starts_with("https://") {
        Ok(())
    } else {
        Err(format!("{label} must start with http:// or https://"))
    }
}

// ---------------------------------------------------------------------------
// Entity-skill links (shared by project + experience)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillRef {
    pub skill_id: i64,
    #[serde(default)]
    pub canonical_name: String,
    pub confidence: i64,
}

trait HasSkillLinks {
    fn row_id(&self) -> i64;
    fn skills_mut(&mut self) -> &mut Vec<SkillRef>;
}

fn load_links<T: HasSkillLinks>(
    conn: &Connection,
    entity_type: &str,
    rows: &mut [T],
) -> rusqlite::Result<()> {
    let ids: Vec<i64> = rows.iter().map(|r| r.row_id()).collect();
    let mut by_id: std::collections::HashMap<i64, Vec<SkillRef>> = std::collections::HashMap::new();
    if !ids.is_empty() {
        // ?1 is entity_type; the IN list starts at ?2.
        let placeholders =
            (2..=ids.len() + 1).map(|i| format!("?{i}")).collect::<Vec<_>>().join(", ");
        let sql = format!(
            "SELECT es.entity_id, s.id, s.canonical_name, es.confidence \
             FROM entity_skills es JOIN skills s ON s.id = es.skill_id \
             WHERE es.entity_type = ?1 AND es.entity_id IN ({placeholders}) \
             ORDER BY es.confidence DESC, s.canonical_name COLLATE NOCASE"
        );
        let mut stmt = conn.prepare(&sql)?;
        let mut query_params: Vec<Value> = vec![Value::Text(entity_type.to_string())];
        query_params.extend(ids.iter().map(|i| Value::Integer(*i)));
        let mapped = stmt.query_map(params_from_iter(query_params.iter()), |row| {
            Ok((
                row.get::<_, i64>(0)?,
                SkillRef {
                    skill_id: row.get(1)?,
                    canonical_name: row.get(2)?,
                    confidence: row.get(3)?,
                },
            ))
        })?;
        for item in mapped {
            let (entity_id, link) = item?;
            by_id.entry(entity_id).or_default().push(link);
        }
    }
    for row in rows.iter_mut() {
        if let Some(links) = by_id.remove(&row.row_id()) {
            *row.skills_mut() = links;
        }
    }
    Ok(())
}

fn write_links(
    conn: &Connection,
    entity_type: &str,
    entity_id: i64,
    skills: &[SkillRef],
) -> Result<(), String> {
    for skill in skills {
        if !(0..=5).contains(&skill.confidence) {
            return Err("Skill confidence must be between 0 and 5".to_string());
        }
    }
    sql_err(conn.execute(
        "DELETE FROM entity_skills WHERE entity_type = ?1 AND entity_id = ?2",
        params![entity_type, entity_id],
    ))?;
    for skill in skills {
        sql_err(conn.execute(
            "INSERT INTO entity_skills (entity_type, entity_id, skill_id, confidence) \
             VALUES (?1, ?2, ?3, ?4) \
             ON CONFLICT(entity_type, entity_id, skill_id) \
             DO UPDATE SET confidence = excluded.confidence",
            params![entity_type, entity_id, skill.skill_id, skill.confidence],
        ))?;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Project
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: i64,
    pub title: String,
    pub description: String,
    pub start_date: Option<String>,
    pub end_date: Option<String>,
    pub is_current: bool,
    pub url: String,
    pub repo_url: String,
    #[serde(default)]
    pub skills: Vec<SkillRef>,
}

impl HasSkillLinks for Project {
    fn row_id(&self) -> i64 {
        self.id
    }
    fn skills_mut(&mut self) -> &mut Vec<SkillRef> {
        &mut self.skills
    }
}

impl VaultEntity for Project {
    const TABLE: &'static str = "projects";
    const ORDER_BY: &'static str = "COALESCE(start_date, '') DESC, id DESC";
    const SEARCH_COLS: &'static [&'static str] = &["title", "description"];
    const INSERT_COLS: &'static [&'static str] =
        &["title", "description", "start_date", "end_date", "is_current", "url", "repo_url"];

    fn id(&self) -> i64 {
        self.id
    }

    fn from_row(row: &Row) -> rusqlite::Result<Self> {
        Ok(Project {
            id: row.get(0)?,
            title: row.get(1)?,
            description: row.get(2)?,
            start_date: row.get(3)?,
            end_date: row.get(4)?,
            is_current: row.get::<_, i64>(5)? != 0,
            url: row.get(6)?,
            repo_url: row.get(7)?,
            skills: Vec::new(),
        })
    }

    fn values(&self) -> Vec<FieldVal> {
        vec![
            FieldVal::Text(self.title.clone()),
            FieldVal::Text(self.description.clone()),
            FieldVal::OptText(self.start_date.clone()),
            FieldVal::OptText(self.end_date.clone()),
            FieldVal::Bool(self.is_current),
            FieldVal::Text(self.url.clone()),
            FieldVal::Text(self.repo_url.clone()),
        ]
    }

    fn validate(&self) -> Result<(), String> {
        require("Title", &self.title)?;
        valid_month(&self.start_date, "Start date")?;
        if !self.is_current {
            valid_month(&self.end_date, "End date")?;
        }
        date_order(&self.start_date, &self.end_date)?;
        valid_url(&self.url, "URL")?;
        valid_url(&self.repo_url, "Repository URL")?;
        Ok(())
    }

    fn enrich(conn: &Connection, rows: &mut [Self]) -> rusqlite::Result<()> {
        load_links(conn, "project", rows)
    }

    fn after_write(conn: &Connection, id: i64, value: &Self) -> Result<(), String> {
        write_links(conn, "project", id, &value.skills)
    }
}

// ---------------------------------------------------------------------------
// Experience
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Experience {
    pub id: i64,
    pub organization: String,
    pub role: String,
    pub description: String,
    pub start_date: Option<String>,
    pub end_date: Option<String>,
    pub is_current: bool,
    pub location: String,
    #[serde(default)]
    pub skills: Vec<SkillRef>,
}

impl HasSkillLinks for Experience {
    fn row_id(&self) -> i64 {
        self.id
    }
    fn skills_mut(&mut self) -> &mut Vec<SkillRef> {
        &mut self.skills
    }
}

impl VaultEntity for Experience {
    const TABLE: &'static str = "experiences";
    const ORDER_BY: &'static str = "COALESCE(start_date, '') DESC, id DESC";
    const SEARCH_COLS: &'static [&'static str] = &["organization", "role", "description"];
    const INSERT_COLS: &'static [&'static str] = &[
        "organization",
        "role",
        "description",
        "start_date",
        "end_date",
        "is_current",
        "location",
    ];

    fn id(&self) -> i64 {
        self.id
    }

    fn from_row(row: &Row) -> rusqlite::Result<Self> {
        Ok(Experience {
            id: row.get(0)?,
            organization: row.get(1)?,
            role: row.get(2)?,
            description: row.get(3)?,
            start_date: row.get(4)?,
            end_date: row.get(5)?,
            is_current: row.get::<_, i64>(6)? != 0,
            location: row.get(7)?,
            skills: Vec::new(),
        })
    }

    fn values(&self) -> Vec<FieldVal> {
        vec![
            FieldVal::Text(self.organization.clone()),
            FieldVal::Text(self.role.clone()),
            FieldVal::Text(self.description.clone()),
            FieldVal::OptText(self.start_date.clone()),
            FieldVal::OptText(self.end_date.clone()),
            FieldVal::Bool(self.is_current),
            FieldVal::Text(self.location.clone()),
        ]
    }

    fn validate(&self) -> Result<(), String> {
        require("Organization", &self.organization)?;
        require("Role", &self.role)?;
        valid_month(&self.start_date, "Start date")?;
        if !self.is_current {
            valid_month(&self.end_date, "End date")?;
        }
        date_order(&self.start_date, &self.end_date)?;
        Ok(())
    }

    fn enrich(conn: &Connection, rows: &mut [Self]) -> rusqlite::Result<()> {
        load_links(conn, "experience", rows)
    }

    fn after_write(conn: &Connection, id: i64, value: &Self) -> Result<(), String> {
        write_links(conn, "experience", id, &value.skills)
    }
}

// ---------------------------------------------------------------------------
// Education / Certification / Achievement
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Education {
    pub id: i64,
    pub institution: String,
    pub degree: String,
    pub field_of_study: String,
    pub description: String,
    pub start_date: Option<String>,
    pub end_date: Option<String>,
    pub is_current: bool,
}

impl VaultEntity for Education {
    const TABLE: &'static str = "education";
    const ORDER_BY: &'static str = "COALESCE(end_date, start_date, '') DESC, id DESC";
    const SEARCH_COLS: &'static [&'static str] = &["institution", "degree", "field_of_study"];
    const INSERT_COLS: &'static [&'static str] = &[
        "institution",
        "degree",
        "field_of_study",
        "description",
        "start_date",
        "end_date",
        "is_current",
    ];

    fn id(&self) -> i64 {
        self.id
    }

    fn from_row(row: &Row) -> rusqlite::Result<Self> {
        Ok(Education {
            id: row.get(0)?,
            institution: row.get(1)?,
            degree: row.get(2)?,
            field_of_study: row.get(3)?,
            description: row.get(4)?,
            start_date: row.get(5)?,
            end_date: row.get(6)?,
            is_current: row.get::<_, i64>(7)? != 0,
        })
    }

    fn values(&self) -> Vec<FieldVal> {
        vec![
            FieldVal::Text(self.institution.clone()),
            FieldVal::Text(self.degree.clone()),
            FieldVal::Text(self.field_of_study.clone()),
            FieldVal::Text(self.description.clone()),
            FieldVal::OptText(self.start_date.clone()),
            FieldVal::OptText(self.end_date.clone()),
            FieldVal::Bool(self.is_current),
        ]
    }

    fn validate(&self) -> Result<(), String> {
        require("Institution", &self.institution)?;
        require("Degree", &self.degree)?;
        valid_month(&self.start_date, "Start date")?;
        if !self.is_current {
            valid_month(&self.end_date, "End date")?;
        }
        date_order(&self.start_date, &self.end_date)?;
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Certification {
    pub id: i64,
    pub title: String,
    pub issuer: String,
    pub description: String,
    pub issue_date: Option<String>,
    pub expiry_date: Option<String>,
    pub credential_id: String,
    pub url: String,
}

impl VaultEntity for Certification {
    const TABLE: &'static str = "certifications";
    const ORDER_BY: &'static str = "COALESCE(issue_date, '') DESC, id DESC";
    const SEARCH_COLS: &'static [&'static str] = &["title", "issuer"];
    const INSERT_COLS: &'static [&'static str] = &[
        "title",
        "issuer",
        "description",
        "issue_date",
        "expiry_date",
        "credential_id",
        "url",
    ];

    fn id(&self) -> i64 {
        self.id
    }

    fn from_row(row: &Row) -> rusqlite::Result<Self> {
        Ok(Certification {
            id: row.get(0)?,
            title: row.get(1)?,
            issuer: row.get(2)?,
            description: row.get(3)?,
            issue_date: row.get(4)?,
            expiry_date: row.get(5)?,
            credential_id: row.get(6)?,
            url: row.get(7)?,
        })
    }

    fn values(&self) -> Vec<FieldVal> {
        vec![
            FieldVal::Text(self.title.clone()),
            FieldVal::Text(self.issuer.clone()),
            FieldVal::Text(self.description.clone()),
            FieldVal::OptText(self.issue_date.clone()),
            FieldVal::OptText(self.expiry_date.clone()),
            FieldVal::Text(self.credential_id.clone()),
            FieldVal::Text(self.url.clone()),
        ]
    }

    fn validate(&self) -> Result<(), String> {
        require("Title", &self.title)?;
        require("Issuer", &self.issuer)?;
        valid_month(&self.issue_date, "Issue date")?;
        valid_month(&self.expiry_date, "Expiry date")?;
        date_order(&self.issue_date, &self.expiry_date)?;
        valid_url(&self.url, "URL")?;
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Achievement {
    pub id: i64,
    pub title: String,
    pub issuer: String,
    pub description: String,
    pub achieved_on: Option<String>,
}

impl VaultEntity for Achievement {
    const TABLE: &'static str = "achievements";
    const ORDER_BY: &'static str = "COALESCE(achieved_on, '') DESC, id DESC";
    const SEARCH_COLS: &'static [&'static str] = &["title", "description", "issuer"];
    const INSERT_COLS: &'static [&'static str] = &["title", "issuer", "description", "achieved_on"];

    fn id(&self) -> i64 {
        self.id
    }

    fn from_row(row: &Row) -> rusqlite::Result<Self> {
        Ok(Achievement {
            id: row.get(0)?,
            title: row.get(1)?,
            issuer: row.get(2)?,
            description: row.get(3)?,
            achieved_on: row.get(4)?,
        })
    }

    fn values(&self) -> Vec<FieldVal> {
        vec![
            FieldVal::Text(self.title.clone()),
            FieldVal::Text(self.issuer.clone()),
            FieldVal::Text(self.description.clone()),
            FieldVal::OptText(self.achieved_on.clone()),
        ]
    }

    fn validate(&self) -> Result<(), String> {
        require("Title", &self.title)?;
        valid_month(&self.achieved_on, "Date")?;
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Skills + aliases
// ---------------------------------------------------------------------------

pub const SKILL_CATEGORIES: &[&str] =
    &["language", "framework", "tool", "database", "cloud", "devops", "soft", "other"];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillAlias {
    pub id: i64,
    pub alias: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Skill {
    pub id: i64,
    pub canonical_name: String,
    pub category: String,
    #[serde(default)]
    pub aliases: Vec<SkillAlias>,
}

impl VaultEntity for Skill {
    const TABLE: &'static str = "skills";
    const ORDER_BY: &'static str = "canonical_name COLLATE NOCASE ASC";
    const SEARCH_COLS: &'static [&'static str] = &["canonical_name", "category"];
    const INSERT_COLS: &'static [&'static str] = &["canonical_name", "category"];

    fn id(&self) -> i64 {
        self.id
    }

    fn from_row(row: &Row) -> rusqlite::Result<Self> {
        Ok(Skill {
            id: row.get(0)?,
            canonical_name: row.get(1)?,
            category: row.get(2)?,
            aliases: Vec::new(),
        })
    }

    fn values(&self) -> Vec<FieldVal> {
        vec![
            FieldVal::Text(self.canonical_name.clone()),
            FieldVal::Text(self.category.clone()),
        ]
    }

    fn validate(&self) -> Result<(), String> {
        require("Skill name", &self.canonical_name)?;
        if !SKILL_CATEGORIES.contains(&self.category.as_str()) {
            return Err(format!("Unknown category '{}'", self.category));
        }
        Ok(())
    }

    fn enrich(conn: &Connection, rows: &mut [Self]) -> rusqlite::Result<()> {
        if rows.is_empty() {
            return Ok(());
        }
        let mut stmt =
            conn.prepare("SELECT id, skill_id, alias FROM skill_aliases ORDER BY alias")?;
        let mut map: std::collections::HashMap<i64, Vec<SkillAlias>> = std::collections::HashMap::new();
        let pairs = stmt.query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, String>(2)?,
            ))
        })?;
        for triple in pairs {
            let (alias_id, skill_id, alias) = triple?;
            map.entry(skill_id).or_default().push(SkillAlias { id: alias_id, alias });
        }
        for skill in rows.iter_mut() {
            if let Some(aliases) = map.remove(&skill.id) {
                skill.aliases = aliases;
            }
        }
        Ok(())
    }
}

pub fn add_skill_alias(conn: &Connection, skill_id: i64, alias: &str) -> Result<(), String> {
    let alias = alias.trim();
    if alias.is_empty() {
        return Err("Alias is required".to_string());
    }
    let exists: i64 = sql_err(
        conn.query_row("SELECT COUNT(*) FROM skills WHERE id = ?1", [skill_id], |r| r.get(0)),
    )?;
    if exists == 0 {
        return Err("Skill not found".to_string());
    }
    conn.execute(
        "INSERT INTO skill_aliases (skill_id, alias) VALUES (?1, ?2)",
        params![skill_id, alias],
    )
    .map_err(|e| {
        if e.to_string().contains("UNIQUE") {
            format!("'{alias}' is already an alias")
        } else {
            e.to_string()
        }
    })?;
    Ok(())
}

pub fn delete_skill_alias(conn: &Connection, alias_id: i64) -> Result<(), String> {
    sql_err(conn.execute("DELETE FROM skill_aliases WHERE id = ?1", [alias_id]))?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Profile (single active row)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub full_name: String,
    pub headline: String,
    pub email: String,
    pub phone: String,
    pub location: String,
    pub website: String,
    pub github: String,
    pub linkedin: String,
    pub summary: String,
}

const PROFILE_COLS: &[&str] = &[
    "full_name",
    "headline",
    "email",
    "phone",
    "location",
    "website",
    "github",
    "linkedin",
    "summary",
];

pub fn get_profile(conn: &Connection) -> Result<Option<Profile>, String> {
    let sql = format!("SELECT {} FROM profiles ORDER BY id LIMIT 1", PROFILE_COLS.join(", "));
    let mut stmt = sql_err(conn.prepare(&sql))?;
    match stmt.query_row([], |row| {
        Ok(Profile {
            full_name: row.get(0)?,
            headline: row.get(1)?,
            email: row.get(2)?,
            phone: row.get(3)?,
            location: row.get(4)?,
            website: row.get(5)?,
            github: row.get(6)?,
            linkedin: row.get(7)?,
            summary: row.get(8)?,
        })
    }) {
        Ok(p) => Ok(Some(p)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

pub fn upsert_profile(conn: &Connection, profile: &Profile) -> Result<Profile, String> {
    for (label, value) in [
        ("Name", profile.full_name.as_str()),
        ("Email", profile.email.as_str()),
    ] {
        require(label, value)?;
    }
    valid_url(&profile.website, "Website")?;
    valid_url(&profile.github, "GitHub URL")?;
    valid_url(&profile.linkedin, "LinkedIn URL")?;

    let values: Vec<Value> = PROFILE_COLS
        .iter()
        .map(|col| Value::Text(profile_field(profile, col)))
        .collect();
    let assignments = PROFILE_COLS
        .iter()
        .enumerate()
        .map(|(i, col)| format!("{col} = ?{}", i + 1))
        .collect::<Vec<_>>()
        .join(", ");
    let existing: i64 =
        sql_err(conn.query_row("SELECT COUNT(*) FROM profiles", [], |r| r.get(0)))?;
    let tx = sql_err(conn.unchecked_transaction())?;
    if existing > 0 {
        let sql = format!(
            "UPDATE profiles SET {}, updated_at = datetime('now') WHERE id = (SELECT MIN(id) FROM profiles)",
            assignments
        );
        sql_err(tx.execute(&sql, params_from_iter(values.iter())))?;
    } else {
        let cols = PROFILE_COLS.join(", ");
        let placeholders =
            (1..=PROFILE_COLS.len()).map(|i| format!("?{i}")).collect::<Vec<_>>().join(", ");
        let sql = format!("INSERT INTO profiles ({cols}) VALUES ({placeholders})");
        sql_err(tx.execute(&sql, params_from_iter(values.iter())))?;
    }
    sql_err(tx.commit())?;
    Ok(get_profile(conn)?.expect("profile row just written"))
}

fn profile_field(profile: &Profile, column: &str) -> String {
    match column {
        "full_name" => profile.full_name.clone(),
        "headline" => profile.headline.clone(),
        "email" => profile.email.clone(),
        "phone" => profile.phone.clone(),
        "location" => profile.location.clone(),
        "website" => profile.website.clone(),
        "github" => profile.github.clone(),
        "linkedin" => profile.linkedin.clone(),
        "summary" => profile.summary.clone(),
        _ => String::new(),
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::apply_migrations;

    fn mem_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        apply_migrations(&conn).unwrap();
        conn
    }

    fn skill(conn: &Connection, name: &str) -> Skill {
        vault_create(
            conn,
            &Skill {
                id: 0,
                canonical_name: name.to_string(),
                category: "language".to_string(),
                aliases: vec![],
            },
        )
        .unwrap()
    }

    #[test]
    fn project_crud_with_skill_links() {
        let conn = mem_db();
        let python = skill(&conn, "Python");
        let sql_skill = skill(&conn, "SQL");

        let created = vault_create(
            &conn,
            &Project {
                id: 0,
                title: "PyKV".to_string(),
                description: "In-memory key-value store".to_string(),
                start_date: Some("2025-03".to_string()),
                end_date: None,
                is_current: true,
                url: String::new(),
                repo_url: "https://github.com/me/pykv".to_string(),
                skills: vec![
                    SkillRef { skill_id: python.id, canonical_name: String::new(), confidence: 4 },
                    SkillRef { skill_id: sql_skill.id, canonical_name: String::new(), confidence: 2 },
                ],
            },
        )
        .unwrap();

        assert!(created.id > 0);
        assert_eq!(created.skills.len(), 2);
        assert_eq!(created.skills[0].canonical_name, "Python");
        assert_eq!(created.skills[0].confidence, 4);

        // Update: change title and drop one skill.
        let mut updated = created.clone();
        updated.title = "PyKV ".to_string();
        updated.skills = vec![SkillRef {
            skill_id: sql_skill.id,
            canonical_name: String::new(),
            confidence: 5,
        }];
        let updated = vault_update(&conn, &updated).unwrap();
        assert_eq!(updated.skills.len(), 1);
        assert_eq!(updated.skills[0].skill_id, sql_skill.id);
        assert_eq!(updated.skills[0].confidence, 5);

        // Delete cascades links via trigger.
        vault_delete::<Project>(&conn, created.id).unwrap();
        let orphans: i64 = conn
            .query_row("SELECT COUNT(*) FROM entity_skills", [], |r| r.get(0))
            .unwrap();
        assert_eq!(orphans, 0);
    }

    #[test]
    fn validation_rejects_bad_records() {
        let conn = mem_db();
        let base = |title: &str, start: Option<String>, end: Option<String>| Project {
            id: 0,
            title: title.to_string(),
            description: String::new(),
            start_date: start,
            end_date: end,
            is_current: false,
            url: String::new(),
            repo_url: String::new(),
            skills: vec![],
        };

        assert!(vault_create(&conn, &base("", Some("2025-01".into()), None)).is_err());
        assert!(vault_create(&conn, &base("X", Some("March 2025".into()), None)).is_err());
        assert!(vault_create(&conn, &base("X", Some("2025-03".into()), Some("2024-01".into())))
            .is_err());
        assert!(vault_create(&conn, &base("X", None, None)).is_ok());

        let mut bad_url = base("X", None, None);
        bad_url.url = "github.com/me".to_string();
        assert!(vault_create(&conn, &bad_url).is_err());
    }

    #[test]
    fn skill_aliases_roundtrip() {
        let conn = mem_db();
        let js = skill(&conn, "JavaScript");
        add_skill_alias(&conn, js.id, "JS").unwrap();
        assert!(add_skill_alias(&conn, js.id, "JS").is_err()); // duplicate
        assert!(add_skill_alias(&conn, 999, "NOPE").is_err()); // missing skill

        let skills = vault_list::<Skill>(&conn).unwrap();
        assert_eq!(skills[0].aliases.len(), 1);
        assert_eq!(skills[0].aliases[0].alias, "JS");
    }

    #[test]
    fn confidence_is_bounded() {
        let conn = mem_db();
        let s = skill(&conn, "Rust");
        let mut p = Project {
            id: 0,
            title: "Kairo".to_string(),
            description: String::new(),
            start_date: None,
            end_date: None,
            is_current: false,
            url: String::new(),
            repo_url: String::new(),
            skills: vec![SkillRef { skill_id: s.id, canonical_name: String::new(), confidence: 9 }],
        };
        assert!(vault_create(&conn, &p).is_err());
        p.skills[0].confidence = 3;
        assert!(vault_create(&conn, &p).is_ok());
    }

    #[test]
    fn profile_upsert_keeps_single_row() {
        let conn = mem_db();
        assert!(get_profile(&conn).unwrap().is_none());

        let mut profile = Profile {
            full_name: "J".to_string(),
            headline: String::new(),
            email: "j@example.com".to_string(),
            phone: String::new(),
            location: String::new(),
            website: String::new(),
            github: String::new(),
            linkedin: String::new(),
            summary: String::new(),
        };
        upsert_profile(&conn, &profile).unwrap();
        profile.headline = "Backend engineer".to_string();
        let saved = upsert_profile(&conn, &profile).unwrap();
        assert_eq!(saved.headline, "Backend engineer");

        let count: i64 =
            conn.query_row("SELECT COUNT(*) FROM profiles", [], |r| r.get(0)).unwrap();
        assert_eq!(count, 1);
        assert!(upsert_profile(
            &conn,
            &Profile {
                full_name: String::new(),
                headline: String::new(),
                email: String::new(),
                phone: String::new(),
                location: String::new(),
                website: String::new(),
                github: String::new(),
                linkedin: String::new(),
                summary: String::new(),
            }
        )
        .is_err());
    }

    #[test]
    fn experience_and_education_crud() {
        let conn = mem_db();
        let exp = vault_create(
            &conn,
            &Experience {
                id: 0,
                organization: "Acme".to_string(),
                role: "Intern".to_string(),
                description: "Built internal tools".to_string(),
                start_date: Some("2025-06".to_string()),
                end_date: Some("2025-09".to_string()),
                is_current: false,
                location: "Remote".to_string(),
                skills: vec![],
            },
        )
        .unwrap();
        assert_eq!(exp.role, "Intern");

        let edu = vault_create(
            &conn,
            &Education {
                id: 0,
                institution: "IIT".to_string(),
                degree: "B.Tech".to_string(),
                field_of_study: "CSE".to_string(),
                description: String::new(),
                start_date: Some("2022-08".to_string()),
                end_date: Some("2026-05".to_string()),
                is_current: false,
            },
        )
        .unwrap();
        let list = vault_list::<Education>(&conn).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, edu.id);
    }
}
