-- 0006_composer: deterministic resume plans (Phase 6 · spec §7).
-- resume_plans keys off job_id (spec §4.1: job_id, config_json, plan_json).
-- Plan items reference Vault IDs; text snapshots in the plan are conveniences
-- for rendering, not the source of truth.

CREATE TABLE IF NOT EXISTS resume_plans (
    job_id           INTEGER PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
    config_json      TEXT NOT NULL,
    plan_json        TEXT NOT NULL,
    composer_version INTEGER NOT NULL,
    created_at       TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
