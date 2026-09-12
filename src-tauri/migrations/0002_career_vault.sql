-- 0002_career_vault: normalized career record tables (Phase 1 · spec §4.1).
-- Dates are stored as ISO "YYYY-MM" (month precision) or NULL when not set.
-- Empty optional strings are stored as '' (not NULL) to keep mapping uniform.

CREATE TABLE IF NOT EXISTS profiles (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    full_name  TEXT NOT NULL DEFAULT '',
    headline   TEXT NOT NULL DEFAULT '',
    email      TEXT NOT NULL DEFAULT '',
    phone      TEXT NOT NULL DEFAULT '',
    location   TEXT NOT NULL DEFAULT '',
    website    TEXT NOT NULL DEFAULT '',
    github     TEXT NOT NULL DEFAULT '',
    linkedin   TEXT NOT NULL DEFAULT '',
    summary    TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS projects (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    start_date  TEXT,
    end_date    TEXT,
    is_current  INTEGER NOT NULL DEFAULT 0,
    url         TEXT NOT NULL DEFAULT '',
    repo_url    TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS experiences (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    organization TEXT NOT NULL,
    role         TEXT NOT NULL,
    description  TEXT NOT NULL DEFAULT '',
    start_date   TEXT,
    end_date     TEXT,
    is_current   INTEGER NOT NULL DEFAULT 0,
    location     TEXT NOT NULL DEFAULT '',
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS education (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    institution    TEXT NOT NULL,
    degree         TEXT NOT NULL,
    field_of_study TEXT NOT NULL DEFAULT '',
    description    TEXT NOT NULL DEFAULT '',
    start_date     TEXT,
    end_date       TEXT,
    is_current     INTEGER NOT NULL DEFAULT 0,
    created_at     TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS certifications (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    title         TEXT NOT NULL,
    issuer        TEXT NOT NULL,
    description   TEXT NOT NULL DEFAULT '',
    issue_date    TEXT,
    expiry_date   TEXT,
    credential_id TEXT NOT NULL DEFAULT '',
    url           TEXT NOT NULL DEFAULT '',
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS achievements (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT NOT NULL,
    issuer      TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    achieved_on TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS skills (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    canonical_name TEXT NOT NULL UNIQUE,
    category       TEXT NOT NULL DEFAULT 'other'
                   CHECK (category IN ('language','framework','tool','database','cloud','devops','soft','other')),
    created_at     TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS skill_aliases (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    skill_id INTEGER NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
    alias    TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS entity_skills (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type TEXT NOT NULL CHECK (entity_type IN ('project','experience')),
    entity_id   INTEGER NOT NULL,
    skill_id    INTEGER NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
    confidence  INTEGER NOT NULL DEFAULT 3 CHECK (confidence BETWEEN 0 AND 5),
    UNIQUE (entity_type, entity_id, skill_id)
);

CREATE INDEX IF NOT EXISTS idx_entity_skills_entity ON entity_skills (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_aliases_skill ON skill_aliases (skill_id);

-- entity_skills.entity_id is polymorphic, so cascade cleanup via triggers.
CREATE TRIGGER IF NOT EXISTS trg_projects_cleanup AFTER DELETE ON projects BEGIN
    DELETE FROM entity_skills WHERE entity_type = 'project' AND entity_id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_experiences_cleanup AFTER DELETE ON experiences BEGIN
    DELETE FROM entity_skills WHERE entity_type = 'experience' AND entity_id = OLD.id;
END;
