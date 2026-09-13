-- 0007_tailor: grounded AI rewrite suggestions (Phase 7 · spec §7.3-7.4).
-- Suggestions never replace canonical bullets: acceptance is explicit and the
-- canonical bullet stays the source of truth. status ∈ pending/accepted/rejected.

CREATE TABLE IF NOT EXISTS tailor_suggestions (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id         INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    bullet_id      INTEGER NOT NULL,
    original_text  TEXT NOT NULL,
    suggested_text TEXT NOT NULL,
    status         TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','accepted','rejected')),
    validation     TEXT NOT NULL DEFAULT '{}',
    model          TEXT NOT NULL DEFAULT '',
    created_at     TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tailor_job ON tailor_suggestions (job_id);
