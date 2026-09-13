-- 0010_applications: manual application tracker (Phase 11 · spec §9.3).
-- Manual by design: no email scraping, no auto-detection. Each application may
-- link the job workspace and the exact resume version that was submitted.

CREATE TABLE IF NOT EXISTS applications (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id            INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
    resume_version_id INTEGER REFERENCES resume_versions(id) ON DELETE SET NULL,
    company           TEXT NOT NULL,
    role              TEXT NOT NULL,
    url               TEXT NOT NULL DEFAULT '',
    status            TEXT NOT NULL DEFAULT 'wishlist'
                      CHECK (status IN ('wishlist','preparing','applied','oa','interview','final','offer','rejected','withdrawn')),
    applied_date      TEXT,
    next_action       TEXT NOT NULL DEFAULT '',
    notes             TEXT NOT NULL DEFAULT '',
    created_at        TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_applications_job ON applications (job_id);
