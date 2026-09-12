-- 0005_match: matching results (Phase 5 · spec §4.1, §6).
-- match_results holds one explainable row per requirement; match_reports keeps
-- the full report snapshot (weights + version) for reproducibility.

CREATE TABLE IF NOT EXISTS match_results (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id         INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    requirement_id INTEGER NOT NULL REFERENCES job_requirements(id) ON DELETE CASCADE,
    coverage       TEXT NOT NULL CHECK (coverage IN ('covered','partial','missing')),
    score          REAL NOT NULL DEFAULT 0,
    explanation    TEXT NOT NULL DEFAULT '',
    entity_refs    TEXT NOT NULL DEFAULT '[]',
    matched_skills TEXT NOT NULL DEFAULT '[]',
    computed_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_match_results_job ON match_results (job_id);

CREATE TABLE IF NOT EXISTS match_reports (
    job_id            INTEGER PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
    report_json       TEXT NOT NULL,
    matching_version  INTEGER NOT NULL,
    computed_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
