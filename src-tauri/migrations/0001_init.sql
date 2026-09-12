-- 0001_init: Kairo foundation schema.
-- Creates the meta key/value table used for diagnostics and the DB smoke test.
-- Real career entities (profiles, projects, experiences, ...) arrive as later
-- numbered migrations. Never edit an already-shipped migration (spec §4.2).

CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_created_at', datetime('now'));
