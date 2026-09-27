-- Soft delete (Phase 15): rows marked with `deleted_at` are hidden from the
-- app but recoverable from "Recently Deleted" for 30 days. Children
-- (evidence, bullets, links, requirements) are untouched while a parent is
-- trashed; the existing cleanup triggers fire only when the trash entry is
-- purged for good.
ALTER TABLE projects       ADD COLUMN deleted_at TEXT;
ALTER TABLE experiences    ADD COLUMN deleted_at TEXT;
ALTER TABLE education      ADD COLUMN deleted_at TEXT;
ALTER TABLE certifications ADD COLUMN deleted_at TEXT;
ALTER TABLE achievements   ADD COLUMN deleted_at TEXT;
ALTER TABLE skills         ADD COLUMN deleted_at TEXT;
ALTER TABLE jobs           ADD COLUMN deleted_at TEXT;

CREATE INDEX idx_projects_deleted_at       ON projects       (deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX idx_experiences_deleted_at    ON experiences    (deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX idx_education_deleted_at      ON education      (deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX idx_certifications_deleted_at ON certifications (deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX idx_achievements_deleted_at   ON achievements   (deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX idx_skills_deleted_at         ON skills         (deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX idx_jobs_deleted_at           ON jobs           (deleted_at) WHERE deleted_at IS NOT NULL;
