# Changelog

All notable changes to Kairo are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/) and versions follow
[Semantic Versioning](https://semver.org/).

## [3.0.0] — 2026-09-21

The first public release. Everything from the internal 0.x/1.x phases
(0–14: Vault, evidence trust model, matching, planning, tailoring, PDF
export, versions, applications, interview prep, backups, dashboard) plus the
v3 overhaul:

### Resume output
- All three LaTeX templates (Jake, Expressive, PlushCV) compile reliably
  under Tectonic/XeTeX; the old pdfTeX-only preambles that crashed the engine
  are gone
- Bullets are generated from newline-separated record descriptions when no
  canonical bullets exist — no more run-on paragraphs or empty sections
- Human dates (`Aug 2022 – May 2026`), grouped skills by category, contact
  location rendering, page-break protection, Unicode/Greek sanitization
- Contact links keep working for addresses containing `_ % # &` (raw
  percent-encoded `\href` targets, escaped display text)
- Accepted AI tailor suggestions are overlaid into the exported PDF — the
  preview and the PDF agree
- Letter and A4 paper sizes; multi-page resumes (target 1–3 pages)

### Resume Studio
- Rebuilt as a three-zone workspace: content curation, live PDF preview
  (continuous multi-page, fit-width, zoom), template & export rail
- Template choice and paper size persist across restarts
- Templates record which one compiled the current artifact; the UI flags
  stale previews and offers a one-click recompile
- Sync from Vault: re-composes while preserving manual exclusions, ordering
  and custom skills; searchable vault-skill picker; contact-details editor
  (GitHub, LinkedIn, …) that updates the Vault and the plan together

### AI providers
- Works with local models out of the box: Ollama and LM Studio presets, no
  API key required, model list fetched from the provider, 240 s timeout for
  cold starts, lenient JSON parsing (thinking-model output tolerated,
  automatic retry without `response_format`)

### Desktop UI
- Unified design system: one Tabs/Badge/IconButton/Skeleton kit, semantic
  tokens, lucide icons, dark mode with a persisted toggle
- Dialogs re-sync on open (no stale or blank edit forms), stacked-dialog Esc
  handling, skeleton loading and honest error states across pages
- Job-switch race guards in the workspace and Studio

### Security & reliability
- PDF file reads scoped to the app data directory; asset protocol scope and
  CSP narrowed; OS-open uses no shell (no command injection)
- Corrupt resume-version snapshots no longer crash the Versions tab
- Restore always takes an automatic pre-restore safety snapshot
- Manual wording edits are transactional; requirement/applications status
  inputs are validated

### Open source
- MIT license, CONTRIBUTING/SECURITY policies, issue templates, CI
  (Rust tests + frontend build) and a tag-driven release pipeline

## [1.0.0] — internal

Feature-complete through phase 14; never publicly released.
