-- 0004_jobs: Job Workspace tables (Phase 4 · spec §4.1, §6).
-- The raw JD is stored verbatim and never edited. Requirements are the
-- user-reviewed model that matching (Phase 5) runs against.

CREATE TABLE IF NOT EXISTS jobs (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    company    TEXT NOT NULL DEFAULT '',
    role_title TEXT NOT NULL DEFAULT '',
    url        TEXT NOT NULL DEFAULT '',
    raw_jd     TEXT NOT NULL,
    seniority  TEXT NOT NULL DEFAULT '',
    domain     TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS job_requirements (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id         INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    kind           TEXT NOT NULL CHECK (kind IN ('required_skill','preferred_skill','responsibility')),
    raw_text       TEXT NOT NULL,
    normalized_key TEXT NOT NULL DEFAULT '',
    importance     REAL NOT NULL DEFAULT 0.5 CHECK (importance BETWEEN 0 AND 1),
    user_confirmed INTEGER NOT NULL DEFAULT 0,
    created_at     TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_job_requirements_job ON job_requirements (job_id);
