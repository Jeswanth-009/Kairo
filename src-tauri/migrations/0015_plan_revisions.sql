-- Phase "reliability": plans carry a monotonic revision so the UI can prove
-- which saved draft a PDF was compiled from, and jobs gain a kind so a
-- general (no-job) resume can flow through the same editor.
ALTER TABLE resume_plans ADD COLUMN plan_revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE resume_plans ADD COLUMN artifact_plan_revision INTEGER;
ALTER TABLE jobs ADD COLUMN kind TEXT NOT NULL DEFAULT 'role';
