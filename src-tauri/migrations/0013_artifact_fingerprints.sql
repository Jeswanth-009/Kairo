-- Phase "make versions exact": every export records a fingerprint of the
-- exact inputs that produced the PDF (post-overlay plan + template + paper)
-- and the SHA-256 of the generated file. Version saves compare against these
-- and refuse to snapshot a PDF that no longer matches the current plan.
ALTER TABLE resume_plans ADD COLUMN compiled_fingerprint TEXT;
ALTER TABLE resume_plans ADD COLUMN pdf_hash TEXT;
ALTER TABLE resume_versions ADD COLUMN fingerprint TEXT;
ALTER TABLE resume_versions ADD COLUMN pdf_hash TEXT;
