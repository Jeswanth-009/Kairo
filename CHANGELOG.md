# Changelog

All notable changes to Kairo are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/) and versions follow
[Semantic Versioning](https://semver.org/).

## [4.0.0] — 2026-09-22

The v4 overhaul: a hard crash fix in the import pipeline, the official v4
brand identity, a premium "Midnight Sunrise" theme, and a reliability sweep.

### Fixed — vault paste crash (v4 regression class)
- Pasting a document containing unspaced em/en dashes (`2024–2025`,
  `June–July 2025`) into the Vault import or the Jobs JD dialog crashed the
  entire app: byte-offset slicing after `to_lowercase()`/`find()` landed
  inside multi-byte UTF-8 characters and the panic unwound through the
  Windows event loop. All slicing is now char-boundary-safe
  (`text.rs` helpers: `find_ci`, `rfind_ci`, `strip_ci_prefix`)
- Import and GitHub commands are `async` — parsing and blocking network I/O
  (AI provider calls, Tectonic PDF compiles) no longer run on the main
  thread, so a panic can never cross the FFI boundary and the UI never
  freezes during a 240 s AI timeout
- Rust panic hook records every panic into `kairo.log`; a React
  ErrorBoundary plus global `error`/`unhandledrejection` handlers keep the
  window usable instead of collapsing to a blank screen
- Oversized pastes are rejected with a clear message (1 M character cap,
  frontend and backend) instead of being shipped over IPC unbounded
- Regression tests for unspaced dashes, case-expanding characters (`İ`),
  multi-byte certificate text and ~750-line documents (112 backend tests)

### Added — narrative document import
- The vault importer now understands narrative story dumps (numbered
  "N. Project" headings with `Period:`/`Stack:`/`What it demonstrates`
  metadata) in addition to resumes — one such paste extracts every project
  as a reviewable candidate with its demonstrated skills

### Added — v4 brand identity
- `brand/` source-of-truth folder with the 16 official logo assets and a
  usage manifest; `scripts/process_brand.py` generates optimized
  derivatives (rounded transparent-corner marks, lockups, wave banner,
  favicon PNG/ICO)
- New app icon (glowing petal-K on midnight tile) across window, taskbar,
  installer and store assets
- In-app brand mark now uses the official artwork, theme-aware (glowing
  midnight tile on dark, white tile on light)
- Branded boot splash with the night-sky lockup; Dashboard brand footer
  with the "Progress Builds Possibilities." wave banner; Settings → About
  shows the horizontal lockup

### Changed — Midnight Sunrise theme
- Design tokens match the official palette exactly (Midnight `#0B1020`,
  Kairo Blue `#2563EB`, Violet `#8B5CF6`, Dawn `#F6C177`, Sky `#93C5FD`,
  Light `#F8FAFC`, Slate `#475569`, Yellow `#FDE68A`)
- Self-hosted Inter variable font (offline-safe); refined type rendering
- Dark is now the default theme on first launch; the light theme stays one
  click away, and Settings → Appearance offers an explicit Light/Dark
  control (choice persists)
- Every raw Tailwind palette class in feature screens migrated to semantic
  tokens; status pills, badges, buttons, toasts and skeletons share one
  token system; midnight-tinted elevation shadows and a brand glow shadow
- Sidebar: aurora glow, gradient active pill with brand glow, refined
  wordmark; TopBar: frosted-glass blur with token status pill

### Security & reliability sweep
- Blocking network/subprocess commands audited and moved off the main
  thread (`ai_test_connection`, `ai_list_models`, `tailor_suggest`,
  `export_pdf`, `github_repo_candidate`)

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
