-- Phase "rebuild the first-use experience": imported records must show their
-- provenance honestly. Every vault record carries:
--   origin      — 'manual' (authored in Kairo) or 'imported' (from a resume)
--   edited_at   — set by trigger when an imported record's content changes
--   verified_at — set only by an explicit "verified by you" action
-- "Evidence attached" stays derived from the existing evidence count.
ALTER TABLE projects       ADD COLUMN origin TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE projects       ADD COLUMN edited_at TEXT;
ALTER TABLE projects       ADD COLUMN verified_at TEXT;
ALTER TABLE experiences    ADD COLUMN origin TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE experiences    ADD COLUMN edited_at TEXT;
ALTER TABLE experiences    ADD COLUMN verified_at TEXT;
ALTER TABLE education      ADD COLUMN origin TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE education      ADD COLUMN edited_at TEXT;
ALTER TABLE education      ADD COLUMN verified_at TEXT;
ALTER TABLE certifications ADD COLUMN origin TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE certifications ADD COLUMN edited_at TEXT;
ALTER TABLE certifications ADD COLUMN verified_at TEXT;
ALTER TABLE achievements   ADD COLUMN origin TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE achievements   ADD COLUMN edited_at TEXT;
ALTER TABLE achievements   ADD COLUMN verified_at TEXT;

-- An imported record whose content the user changes becomes "Edited by you"
-- (first edit wins; further edits keep the original timestamp). Manual
-- records never grow the flag, and origin/verified_at/edited_at changes
-- alone do not count as edits.
CREATE TRIGGER projects_edited_flag AFTER UPDATE ON projects
WHEN NEW.origin = 'imported' AND NEW.edited_at IS NULL
 AND (NEW.title IS NOT OLD.title OR NEW.description IS NOT OLD.description
   OR NEW.start_date IS NOT OLD.start_date OR NEW.end_date IS NOT OLD.end_date
   OR NEW.is_current IS NOT OLD.is_current OR NEW.url IS NOT OLD.url
   OR NEW.repo_url IS NOT OLD.repo_url)
BEGIN
  UPDATE projects SET edited_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TRIGGER experiences_edited_flag AFTER UPDATE ON experiences
WHEN NEW.origin = 'imported' AND NEW.edited_at IS NULL
 AND (NEW.organization IS NOT OLD.organization OR NEW.role IS NOT OLD.role
   OR NEW.description IS NOT OLD.description OR NEW.start_date IS NOT OLD.start_date
   OR NEW.end_date IS NOT OLD.end_date OR NEW.is_current IS NOT OLD.is_current
   OR NEW.location IS NOT OLD.location)
BEGIN
  UPDATE experiences SET edited_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TRIGGER education_edited_flag AFTER UPDATE ON education
WHEN NEW.origin = 'imported' AND NEW.edited_at IS NULL
 AND (NEW.institution IS NOT OLD.institution OR NEW.degree IS NOT OLD.degree
   OR NEW.field_of_study IS NOT OLD.field_of_study OR NEW.description IS NOT OLD.description
   OR NEW.start_date IS NOT OLD.start_date OR NEW.end_date IS NOT OLD.end_date
   OR NEW.is_current IS NOT OLD.is_current)
BEGIN
  UPDATE education SET edited_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TRIGGER certifications_edited_flag AFTER UPDATE ON certifications
WHEN NEW.origin = 'imported' AND NEW.edited_at IS NULL
 AND (NEW.title IS NOT OLD.title OR NEW.issuer IS NOT OLD.issuer
   OR NEW.description IS NOT OLD.description OR NEW.issue_date IS NOT OLD.issue_date
   OR NEW.expiry_date IS NOT OLD.expiry_date OR NEW.credential_id IS NOT OLD.credential_id
   OR NEW.url IS NOT OLD.url)
BEGIN
  UPDATE certifications SET edited_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TRIGGER achievements_edited_flag AFTER UPDATE ON achievements
WHEN NEW.origin = 'imported' AND NEW.edited_at IS NULL
 AND (NEW.title IS NOT OLD.title OR NEW.issuer IS NOT OLD.issuer
   OR NEW.description IS NOT OLD.description OR NEW.achieved_on IS NOT OLD.achieved_on)
BEGIN
  UPDATE achievements SET edited_at = datetime('now') WHERE id = NEW.id;
END;
