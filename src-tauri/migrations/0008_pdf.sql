-- 0008_pdf: compiled PDF artifacts (Phase 9 · spec §9.1).
-- The plan is the input; the .tex and .pdf paths plus compile metadata are
-- persisted so the artifact can be re-opened and the compile reproduced.

ALTER TABLE resume_plans ADD COLUMN pdf_path TEXT;
ALTER TABLE resume_plans ADD COLUMN tex_path TEXT;
ALTER TABLE resume_plans ADD COLUMN page_count INTEGER;
ALTER TABLE resume_plans ADD COLUMN compiled_at TEXT;
