//! Job Workspace persistence (Phase 4). Jobs ride the shared VaultEntity CRUD
//! engine; requirements get their own scoped repository. The raw JD is stored
//! verbatim and never modified after creation.

use rusqlite::types::Value;
use rusqlite::{params, params_from_iter, Connection, Row};
use serde::{Deserialize, Serialize};

use super::vault::{sql_err, FieldVal, VaultEntity};

// ---------------------------------------------------------------------------
// Job
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Job {
    pub id: i64,
    pub company: String,
    pub role_title: String,
    pub url: String,
    pub raw_jd: String,
    pub seniority: String,
    pub domain: String,
    /// Enriched on read: number of reviewed requirements.
    #[serde(default)]
    pub requirement_count: i64,
}

impl VaultEntity for Job {
    const TABLE: &'static str = "jobs";
    const ORDER_BY: &'static str = "id DESC";
    const SEARCH_COLS: &'static [&'static str] = &["company", "role_title"];
    const INSERT_COLS: &'static [&'static str] = &[
        "company",
        "role_title",
        "url",
        "raw_jd",
        "seniority",
        "domain",
    ];

    fn id(&self) -> i64 {
        self.id
    }

    fn from_row(row: &Row) -> rusqlite::Result<Self> {
        Ok(Job {
            id: row.get(0)?,
            company: row.get(1)?,
            role_title: row.get(2)?,
            url: row.get(3)?,
            raw_jd: row.get(4)?,
            seniority: row.get(5)?,
            domain: row.get(6)?,
            requirement_count: 0,
        })
    }

    fn values(&self) -> Vec<FieldVal> {
        vec![
            FieldVal::Text(self.company.clone()),
            FieldVal::Text(self.role_title.clone()),
            FieldVal::Text(self.url.clone()),
            FieldVal::Text(self.raw_jd.clone()),
            FieldVal::Text(self.seniority.clone()),
            FieldVal::Text(self.domain.clone()),
        ]
    }

    fn validate(&self) -> Result<(), String> {
        if self.raw_jd.trim().len() < 30 {
            return Err(
                "The job description text looks too short — paste the full posting".to_string(),
            );
        }
        if !self.url.trim().is_empty()
            && !self.url.starts_with("http://")
            && !self.url.starts_with("https://")
        {
            return Err("URL must start with http:// or https://".to_string());
        }
        Ok(())
    }

    fn enrich(conn: &Connection, rows: &mut [Self]) -> rusqlite::Result<()> {
        let ids: Vec<i64> = rows.iter().map(|j| j.id).collect();
        let counts = requirement_count_map(conn, &ids)?;
        for job in rows.iter_mut() {
            job.requirement_count = counts.get(&job.id).copied().unwrap_or(0);
        }
        Ok(())
    }
}

fn requirement_count_map(
    conn: &Connection,
    ids: &[i64],
) -> rusqlite::Result<std::collections::HashMap<i64, i64>> {
    let mut map = std::collections::HashMap::new();
    if ids.is_empty() {
        return Ok(map);
    }
    // ?1..?n only; no extra prefix parameter here.
    let placeholders = (1..=ids.len())
        .map(|i| format!("?{i}"))
        .collect::<Vec<_>>()
        .join(", ");
    let sql = format!(
        "SELECT job_id, COUNT(*) FROM job_requirements WHERE job_id IN ({placeholders}) GROUP BY job_id"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params_from_iter(ids.iter()), |row| {
        Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?))
    })?;
    for row in rows {
        let (job_id, count) = row?;
        map.insert(job_id, count);
    }
    Ok(map)
}

// ---------------------------------------------------------------------------
// Requirements
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JobRequirement {
    pub id: i64,
    pub job_id: i64,
    pub kind: String,
    pub raw_text: String,
    pub normalized_key: String,
    pub importance: f64,
    pub user_confirmed: bool,
}

const REQ_COLS: &str = "id, job_id, kind, raw_text, normalized_key, importance, user_confirmed";

fn requirement_from_row(row: &Row) -> rusqlite::Result<JobRequirement> {
    Ok(JobRequirement {
        id: row.get(0)?,
        job_id: row.get(1)?,
        kind: row.get(2)?,
        raw_text: row.get(3)?,
        normalized_key: row.get(4)?,
        importance: row.get(5)?,
        user_confirmed: row.get::<_, i64>(6)? != 0,
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JobWithRequirements {
    pub job: Job,
    pub requirements: Vec<JobRequirement>,
}

fn valid_kind(kind: &str) -> Result<(), String> {
    if matches!(
        kind,
        "required_skill" | "preferred_skill" | "responsibility"
    ) {
        Ok(())
    } else {
        Err(format!("Unknown requirement kind '{kind}'"))
    }
}

fn validate_requirement(req: &JobRequirement) -> Result<(), String> {
    valid_kind(&req.kind)?;
    if req.raw_text.trim().is_empty() {
        return Err("Requirement text is required".to_string());
    }
    if !(0.0..=1.0).contains(&req.importance) {
        return Err("Importance must be between 0 and 1".to_string());
    }
    Ok(())
}

pub fn list_requirements(conn: &Connection, job_id: i64) -> Result<Vec<JobRequirement>, String> {
    let sql = format!(
        "SELECT {REQ_COLS} FROM job_requirements WHERE job_id = ?1 ORDER BY \
         CASE kind WHEN 'required_skill' THEN 0 WHEN 'preferred_skill' THEN 1 ELSE 2 END, id"
    );
    let mut stmt = sql_err(conn.prepare(&sql))?;
    let mapped = sql_err(stmt.query_map([job_id], requirement_from_row))?;
    sql_err(mapped.collect::<rusqlite::Result<Vec<_>>>())
}

fn insert_requirement(conn: &Connection, req: &JobRequirement) -> Result<i64, String> {
    validate_requirement(req)?;
    sql_err(conn.execute(
        "INSERT INTO job_requirements (job_id, kind, raw_text, normalized_key, importance, user_confirmed) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            req.job_id,
            req.kind,
            req.raw_text,
            req.normalized_key,
            req.importance,
            req.user_confirmed as i64
        ],
    ))?;
    Ok(conn.last_insert_rowid())
}

/// Creates the job plus its reviewed requirement set in one transaction.
pub fn create_job_with_requirements(
    conn: &Connection,
    job: &Job,
    requirements: &[JobRequirement],
) -> Result<JobWithRequirements, String> {
    job.validate()?;
    for req in requirements {
        validate_requirement(req)?;
    }
    let cols = Job::INSERT_COLS.join(", ");
    let placeholders = (1..=Job::INSERT_COLS.len())
        .map(|i| format!("?{i}"))
        .collect::<Vec<_>>()
        .join(", ");
    let sql = format!("INSERT INTO jobs ({cols}) VALUES ({placeholders})");
    let values: Vec<Value> = job.values().iter().map(|v| v.to_value()).collect();

    let tx = sql_err(conn.unchecked_transaction())?;
    sql_err(tx.execute(&sql, params_from_iter(values.iter())))?;
    let job_id = tx.last_insert_rowid();
    for req in requirements {
        let mut r = req.clone();
        r.job_id = job_id;
        insert_requirement(&tx, &r)?;
    }
    sql_err(tx.commit())?;

    let mut saved = vec![vault_get_job(conn, job_id)?];
    sql_err(Job::enrich(conn, &mut saved))?;
    Ok(JobWithRequirements {
        job: saved.remove(0),
        requirements: list_requirements(conn, job_id)?,
    })
}

fn vault_get_job(conn: &Connection, id: i64) -> Result<Job, String> {
    let sql = format!(
        "SELECT id, {} FROM {} WHERE id = ?1",
        Job::INSERT_COLS.join(", "),
        Job::TABLE
    );
    let mut stmt = sql_err(conn.prepare(&sql))?;
    sql_err(stmt.query_row([id], Job::from_row))
}

pub fn get_job_enriched(conn: &Connection, id: i64) -> Result<Job, String> {
    let mut rows = vec![super::vault::vault_get::<Job>(conn, id)?];
    sql_err(Job::enrich(conn, &mut rows))?;
    Ok(rows.remove(0))
}

pub fn update_job(conn: &Connection, job: &Job) -> Result<Job, String> {
    let updated = super::vault::vault_update::<Job>(conn, job)?;
    let mut rows = vec![updated];
    sql_err(Job::enrich(conn, &mut rows))?;
    Ok(rows.remove(0))
}

pub fn update_requirement(
    conn: &Connection,
    req: &JobRequirement,
) -> Result<JobRequirement, String> {
    validate_requirement(req)?;
    let sql = "UPDATE job_requirements SET kind = ?1, raw_text = ?2, normalized_key = ?3, \
               importance = ?4, user_confirmed = ?5, updated_at = datetime('now') WHERE id = ?6";
    let changed = sql_err(conn.execute(
        sql,
        params![
            req.kind,
            req.raw_text,
            req.normalized_key,
            req.importance,
            req.user_confirmed as i64,
            req.id
        ],
    ))?;
    if changed == 0 {
        return Err("Requirement not found".to_string());
    }
    let sql_get = format!("SELECT {REQ_COLS} FROM job_requirements WHERE id = ?1");
    let mut stmt = sql_err(conn.prepare(&sql_get))?;
    sql_err(stmt.query_row([req.id], requirement_from_row))
}

pub fn add_requirement(conn: &Connection, req: &JobRequirement) -> Result<JobRequirement, String> {
    let id = insert_requirement(conn, req)?;
    let sql_get = format!("SELECT {REQ_COLS} FROM job_requirements WHERE id = ?1");
    let mut stmt = sql_err(conn.prepare(&sql_get))?;
    sql_err(stmt.query_row([id], requirement_from_row))
}

pub fn delete_requirement(conn: &Connection, id: i64) -> Result<(), String> {
    let changed = sql_err(conn.execute("DELETE FROM job_requirements WHERE id = ?1", [id]))?;
    if changed == 0 {
        return Err("Requirement not found".to_string());
    }
    Ok(())
}

pub fn delete_job(conn: &Connection, id: i64) -> Result<(), String> {
    let changed = sql_err(conn.execute("DELETE FROM jobs WHERE id = ?1", [id]))?;
    if changed == 0 {
        return Err("Job not found".to_string());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::apply_migrations;
    use crate::jd::parse_jd;

    fn mem_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        apply_migrations(&conn).unwrap();
        conn
    }

    fn job_fixture() -> Job {
        Job {
            id: 0,
            company: "NimbusPay".to_string(),
            role_title: "Senior Backend Engineer".to_string(),
            url: String::new(),
            raw_jd: "A sufficiently long job description body goes here for validation."
                .to_string(),
            seniority: "Senior".to_string(),
            domain: "Fintech".to_string(),
            requirement_count: 0,
        }
    }

    fn req_fixture(job_id: i64, kind: &str, text: &str) -> JobRequirement {
        JobRequirement {
            id: 0,
            job_id,
            kind: kind.to_string(),
            raw_text: text.to_string(),
            normalized_key: String::new(),
            importance: 0.8,
            user_confirmed: true,
        }
    }

    #[test]
    fn job_with_requirements_roundtrip_and_cascade() {
        let conn = mem_db();
        let created = create_job_with_requirements(
            &conn,
            &job_fixture(),
            &[
                req_fixture(0, "required_skill", "Strong Python"),
                req_fixture(0, "preferred_skill", "Kafka experience"),
                req_fixture(0, "responsibility", "Own service reliability"),
            ],
        )
        .unwrap();

        assert!(created.job.id > 0);
        assert_eq!(created.job.requirement_count, 3);
        assert_eq!(created.requirements.len(), 3);
        // Ordered: required first, then preferred, then responsibilities.
        assert_eq!(created.requirements[0].raw_text, "Strong Python");
        assert_eq!(created.requirements[2].kind, "responsibility");

        // Update a requirement kind.
        let mut req = created.requirements[1].clone();
        req.kind = "required_skill".to_string();
        let updated = update_requirement(&conn, &req).unwrap();
        assert_eq!(updated.kind, "required_skill");

        // Delete job cascades requirements.
        delete_job(&conn, created.job.id).unwrap();
        let left: i64 = conn
            .query_row("SELECT COUNT(*) FROM job_requirements", [], |r| r.get(0))
            .unwrap();
        assert_eq!(left, 0);
    }

    #[test]
    fn job_validation_rejects_short_jd_and_bad_importance() {
        let conn = mem_db();
        let mut job = job_fixture();
        job.raw_jd = "too short".to_string();
        assert!(create_job_with_requirements(&conn, &job, &[]).is_err());

        job.raw_jd = job_fixture().raw_jd;
        let mut bad = req_fixture(0, "required_skill", "X");
        bad.importance = 1.5;
        assert!(create_job_with_requirements(&conn, &job, &[bad]).is_err());
    }

    #[test]
    fn parsed_extraction_saves_as_reviewed() {
        let conn = mem_db();
        let extraction = parse_jd(crate::jd::SAMPLE_JD);
        assert!(!extraction.requirements.is_empty());

        let job = Job {
            company: extraction.company.clone(),
            role_title: extraction.role.clone(),
            ..job_fixture()
        };
        let requirements: Vec<JobRequirement> = extraction
            .requirements
            .iter()
            .map(|d| JobRequirement {
                id: 0,
                job_id: 0,
                kind: serde_json::to_value(d.kind)
                    .unwrap()
                    .as_str()
                    .unwrap()
                    .to_string(),
                raw_text: d.raw_text.clone(),
                normalized_key: d.raw_text.to_lowercase(),
                importance: d.importance,
                user_confirmed: true,
            })
            .collect();
        let created = create_job_with_requirements(&conn, &job, &requirements).unwrap();
        assert_eq!(created.requirements.len(), extraction.requirements.len());
        assert!(created.requirements.iter().all(|r| r.user_confirmed));
    }
}
