-- 0009_versions: immutable resume version snapshots (Phase 10 · spec §9.2).
-- One row per submission. Snapshots freeze every input that produced the PDF;
-- the compiled PDF itself is copied into a version-owned directory so later
-- re-compiles can never alter what was sent.

CREATE TABLE IF NOT EXISTS resume_versions (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id          INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    version_number  INTEGER NOT NULL,
    snapshot_json   TEXT NOT NULL,
    pdf_path        TEXT NOT NULL,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (job_id, version_number)
);

CREATE INDEX IF NOT EXISTS idx_resume_versions_job ON resume_versions (job_id);
