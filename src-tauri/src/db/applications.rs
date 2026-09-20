//! Application tracker (Phase 11 · spec §9.3). Manual by design: the user
//! records every application and updates every status by hand.

use super::vault::sql_err;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

pub const STATUSES: &[&str] = &[
    "wishlist",
    "preparing",
    "applied",
    "oa",
    "interview",
    "final",
    "offer",
    "rejected",
    "withdrawn",
];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Application {
    pub id: i64,
    pub job_id: Option<i64>,
    pub resume_version_id: Option<i64>,
    pub company: String,
    pub role: String,
    pub url: String,
    pub status: String,
    pub applied_date: Option<String>,
    pub next_action: String,
    pub notes: String,
}

const COLS: &str =
    "id, job_id, resume_version_id, company, role, url, status, applied_date, next_action, notes";

fn from_row(row: &rusqlite::Row) -> rusqlite::Result<Application> {
    Ok(Application {
        id: row.get(0)?,
        job_id: row.get(1)?,
        resume_version_id: row.get(2)?,
        company: row.get(3)?,
        role: row.get(4)?,
        url: row.get(5)?,
        status: row.get(6)?,
        applied_date: row.get(7)?,
        next_action: row.get(8)?,
        notes: row.get(9)?,
    })
}

impl Application {
    pub fn validate(&self) -> Result<(), String> {
        if self.company.trim().is_empty() {
            return Err("Company is required".to_string());
        }
        if self.role.trim().is_empty() {
            return Err("Role is required".to_string());
        }
        if !STATUSES.contains(&self.status.as_str()) {
            return Err(format!("Unknown status '{}'", self.status));
        }
        if !self.url.is_empty() && !self.url.starts_with("http") {
            return Err("URL must start with http:// or https://".to_string());
        }
        Ok(())
    }
}

pub fn list_applications(conn: &Connection) -> Result<Vec<Application>, String> {
    let sql = format!(
        "SELECT {COLS} FROM applications \
         ORDER BY CASE status
             WHEN 'applied' THEN 0 WHEN 'oa' THEN 1 WHEN 'interview' THEN 2 WHEN 'final' THEN 3
             WHEN 'preparing' THEN 4 WHEN 'offer' THEN 5 WHEN 'wishlist' THEN 6
             ELSE 7 END, updated_at DESC, id DESC"
    );
    let mut stmt = sql_err(conn.prepare(&sql))?;
    let mapped = sql_err(stmt.query_map([], from_row))?;
    sql_err(mapped.collect::<rusqlite::Result<Vec<_>>>())
}

pub fn get_application(conn: &Connection, id: i64) -> Result<Application, String> {
    let sql = format!("SELECT {COLS} FROM applications WHERE id = ?1");
    let mut stmt = sql_err(conn.prepare(&sql))?;
    sql_err(stmt.query_row([id], from_row))
}

fn insert(conn: &Connection, app: &Application) -> Result<i64, String> {
    sql_err(conn.execute(
        "INSERT INTO applications (job_id, resume_version_id, company, role, url, status, applied_date, next_action, notes) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            app.job_id,
            app.resume_version_id,
            app.company,
            app.role,
            app.url,
            app.status,
            app.applied_date,
            app.next_action,
            app.notes
        ],
    ))?;
    Ok(conn.last_insert_rowid())
}

pub fn create_application(conn: &Connection, app: &Application) -> Result<Application, String> {
    app.validate()?;
    let id = insert(conn, app)?;
    get_application(conn, id)
}

pub fn update_application(conn: &Connection, app: &Application) -> Result<Application, String> {
    app.validate()?;
    let changed = sql_err(conn.execute(
        "UPDATE applications SET job_id = ?1, resume_version_id = ?2, company = ?3, role = ?4, \
           url = ?5, status = ?6, applied_date = ?7, next_action = ?8, notes = ?9, \
           updated_at = datetime('now') WHERE id = ?10",
        params![
            app.job_id,
            app.resume_version_id,
            app.company,
            app.role,
            app.url,
            app.status,
            app.applied_date,
            app.next_action,
            app.notes,
            app.id
        ],
    ))?;
    if changed == 0 {
        return Err("Application not found".to_string());
    }
    get_application(conn, app.id)
}

pub fn set_status(conn: &Connection, id: i64, status: &str) -> Result<Application, String> {
    if !STATUSES.contains(&status) {
        return Err(format!("status must be one of: {}", STATUSES.join(", ")));
    }
    let changed = sql_err(conn.execute(
        "UPDATE applications SET status = ?1, updated_at = datetime('now') WHERE id = ?2",
        params![status, id],
    ))?;
    if changed == 0 {
        return Err("Application not found".to_string());
    }
    get_application(conn, id)
}

pub fn delete_application(conn: &Connection, id: i64) -> Result<(), String> {
    let changed = sql_err(conn.execute("DELETE FROM applications WHERE id = ?1", [id]))?;
    if changed == 0 {
        return Err("Application not found".to_string());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mem() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        // applications table needs jobs/resume_versions for FKs only when set;
        // create minimal parents for FK test.
        conn.execute_batch(
            "CREATE TABLE jobs (id INTEGER PRIMARY KEY);
             CREATE TABLE resume_versions (id INTEGER PRIMARY KEY);
             CREATE TABLE applications (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                job_id INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
                resume_version_id INTEGER REFERENCES resume_versions(id) ON DELETE SET NULL,
                company TEXT NOT NULL,
                role TEXT NOT NULL,
                url TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'wishlist'
                  CHECK (status IN ('wishlist','preparing','applied','oa','interview','final','offer','rejected','withdrawn')),
                applied_date TEXT,
                next_action TEXT NOT NULL DEFAULT '',
                notes TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
             );
             INSERT INTO jobs (id) VALUES (7);
             INSERT INTO resume_versions (id) VALUES (3);",
        )
        .unwrap();
        conn
    }

    fn app(company: &str, status: &str) -> Application {
        Application {
            id: 0,
            job_id: None,
            resume_version_id: None,
            company: company.to_string(),
            role: "Backend Engineer".to_string(),
            url: String::new(),
            status: status.to_string(),
            applied_date: None,
            next_action: "follow up".to_string(),
            notes: String::new(),
        }
    }

    #[test]
    fn crud_and_status_pipeline() {
        let conn = mem();
        let created = create_application(&conn, &app("NimbusPay", "applied")).unwrap();
        assert!(created.id > 0);

        // Pipeline order: applied before oa etc. in list ordering.
        let _ = create_application(&conn, &app("Other", "wishlist")).unwrap();
        let list = list_applications(&conn).unwrap();
        assert_eq!(list[0].status, "applied");

        let moved = set_status(&conn, created.id, "interview").unwrap();
        assert_eq!(moved.status, "interview");
        assert!(set_status(&conn, created.id, "nonsense").is_err());

        // FK: valid job link works, bad one fails.
        let mut linked = app("Linked", "wishlist");
        linked.job_id = Some(7);
        assert!(create_application(&conn, &linked).is_ok());
        linked.job_id = Some(999);
        assert!(create_application(&conn, &linked).is_err());

        delete_application(&conn, created.id).unwrap();
        assert!(get_application(&conn, created.id).is_err());
    }

    #[test]
    fn validation_rejects_bad_input() {
        let conn = mem();
        assert!(create_application(&conn, &app("", "applied")).is_err());
        assert!(create_application(&conn, &app("X", "ghost_status")).is_err());
        let mut bad_url = app("X", "wishlist");
        bad_url.url = "example.com".to_string();
        assert!(create_application(&conn, &bad_url).is_err());
    }
}
