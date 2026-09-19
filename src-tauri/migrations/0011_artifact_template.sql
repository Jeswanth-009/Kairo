-- Remember which template/paper each compiled artifact used, so the UI can
-- tell when the picked template no longer matches the compiled PDF.
ALTER TABLE resume_plans ADD COLUMN artifact_template_id TEXT NOT NULL DEFAULT '';
ALTER TABLE resume_plans ADD COLUMN artifact_paper TEXT NOT NULL DEFAULT '';
