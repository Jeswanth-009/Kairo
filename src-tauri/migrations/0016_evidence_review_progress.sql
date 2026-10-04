-- 0016 · evidence decisions, review state, and stage progress.
-- evidence_selections: the user's Use/Dismiss decision per (requirement,
-- record) pair in the Evidence stage — the "why is this in my resume"
-- ledger. decisions never invent content; they only point at real records.
-- jobs.active_stage: the stage a returning user resumes in.
-- resume_plans.reviewed_*: the exact artifact (by pdf hash) the user marked
-- reviewed; saving a version requires this to match the current artifact.

CREATE TABLE IF NOT EXISTS evidence_selections (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id         INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    requirement_id INTEGER NOT NULL REFERENCES job_requirements(id) ON DELETE CASCADE,
    entity_type    TEXT NOT NULL,
    entity_id      INTEGER NOT NULL,
    decision       TEXT NOT NULL CHECK (decision IN ('use','dismiss')),
    created_at     TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (requirement_id, entity_type, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_evidence_selections_job ON evidence_selections (job_id);

ALTER TABLE jobs ADD COLUMN active_stage TEXT NOT NULL DEFAULT 'role';
ALTER TABLE resume_plans ADD COLUMN reviewed_pdf_hash TEXT;
ALTER TABLE resume_plans ADD COLUMN reviewed_at TEXT;
