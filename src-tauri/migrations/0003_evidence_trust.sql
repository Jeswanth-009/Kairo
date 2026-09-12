-- 0003_evidence_trust: proof for claims (Phase 2 · spec §5, §4.1).
-- Evidence attaches proof to any career record. Canonical bullets are approved
-- factual language for projects/experiences, each traceable to evidence rows.
-- Claim rules are explicit allowed/forbidden boundaries; a rule with NULL
-- entity_type/entity_id is global.

CREATE TABLE IF NOT EXISTS evidence (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type TEXT NOT NULL
                CHECK (entity_type IN ('project','experience','education','certification','achievement')),
    entity_id   INTEGER NOT NULL,
    kind        TEXT NOT NULL DEFAULT 'other'
                CHECK (kind IN ('repository','document','certificate','metric','note','link','other')),
    title       TEXT NOT NULL,
    reference   TEXT NOT NULL DEFAULT '',
    note        TEXT NOT NULL DEFAULT '',
    verified    INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_evidence_entity ON evidence (entity_type, entity_id);

CREATE TABLE IF NOT EXISTS canonical_bullets (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type TEXT NOT NULL CHECK (entity_type IN ('project','experience')),
    entity_id   INTEGER NOT NULL,
    text        TEXT NOT NULL,
    approved    INTEGER NOT NULL DEFAULT 0,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_bullets_entity ON canonical_bullets (entity_type, entity_id);

CREATE TABLE IF NOT EXISTS bullet_evidence (
    bullet_id   INTEGER NOT NULL REFERENCES canonical_bullets(id) ON DELETE CASCADE,
    evidence_id INTEGER NOT NULL REFERENCES evidence(id) ON DELETE CASCADE,
    PRIMARY KEY (bullet_id, evidence_id)
);

CREATE TABLE IF NOT EXISTS claim_rules (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type TEXT CHECK (entity_type IS NULL OR
                entity_type IN ('project','experience','education','certification','achievement','skill')),
    entity_id   INTEGER,
    rule_type   TEXT NOT NULL CHECK (rule_type IN ('forbidden_claim','allowed_claim')),
    pattern     TEXT NOT NULL,
    note        TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Cascade cleanup for polymorphic parents (bullet_evidence cascades via FK).
CREATE TRIGGER IF NOT EXISTS trg_projects_trust_cleanup AFTER DELETE ON projects BEGIN
    DELETE FROM evidence WHERE entity_type = 'project' AND entity_id = OLD.id;
    DELETE FROM canonical_bullets WHERE entity_type = 'project' AND entity_id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_experiences_trust_cleanup AFTER DELETE ON experiences BEGIN
    DELETE FROM evidence WHERE entity_type = 'experience' AND entity_id = OLD.id;
    DELETE FROM canonical_bullets WHERE entity_type = 'experience' AND entity_id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_education_trust_cleanup AFTER DELETE ON education BEGIN
    DELETE FROM evidence WHERE entity_type = 'education' AND entity_id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_certifications_trust_cleanup AFTER DELETE ON certifications BEGIN
    DELETE FROM evidence WHERE entity_type = 'certification' AND entity_id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_achievements_trust_cleanup AFTER DELETE ON achievements BEGIN
    DELETE FROM evidence WHERE entity_type = 'achievement' AND entity_id = OLD.id;
END;
