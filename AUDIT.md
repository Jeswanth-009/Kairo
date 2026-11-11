# Kairo v5 — Full Application Audit

**Date:** 2026-11-02 · **Code state:** `main` @ `450a8ee` (version 5.0.1) · **Mode:** read-only audit; the HIGH fixes from §3 (items 1–4) and security S1 were applied immediately after the audit was written and are marked below.

## Coverage

Every layer was read end-to-end with file:line evidence:

- **Backend (Rust/Tauri 2):** all 115 registered Tauri commands across 16 command modules; 17 SQLite repository modules; all 16 migrations; every domain module (`ai.rs`, `composer.rs`, `matching.rs`, `jd.rs`, `tailor.rs`, `latex.rs` + `latex_templates.rs`, `imports.rs`, `interview.rs`, `text.rs`, `logging.rs`); `tauri.conf.json`, capabilities, CSP; `Cargo.toml` dependencies.
- **Frontend (React/TypeScript):** ~20.3k lines — 10 routes/screens, 7 Zustand stores, all feature folders (`dashboard`, `onboarding`, `vault`, `jobs`, `resume-studio`, `applications`, `settings`, `design`, `imports`), all shared components, the Tauri bridge (`src/lib/ipc.ts`), PDF rendering, plan autosave, and mock/demo isolation (`src/dev`, `mock.html`).
- **UI/UX per screen:** loading/empty/error states, form validation, destructive-action confirmations, accessibility (ARIA, focus management, contrast), long-content handling, consistency.
- **Infrastructure:** 3 GitHub workflows, Dependabot, eslint/tsconfig/vite/vitest configs, all scripts, the website and browser demo, npm + Rust dependencies (475 crates), documentation vs code, repo hygiene.
- **Tests:** 9 frontend test files (44 cases), 2 Rust integration test files, inline Rust unit tests — mapped against what they actually cover.

The four highest-severity findings were independently re-verified by direct file read during review.

## Verdict

This is an unusually disciplined codebase for its size. **No SQL injection, no path traversal, no shell injection, and no secret-leakage paths were found.** The backup/restore pipeline is a hardened, adversarially tested state machine; secrets live in the OS keyring and are redacted from logs; the AI claim-gate pipeline enforces human review at the API level. The real issues cluster in four places: the **build-time Tectonic supply chain** (no checksum, unpinned), **frontend state/lifecycle bugs in the flagship screens** (stuck dialogs, pdfjs leak, re-render storms), **release engineering** (unsigned Windows-only distribution, v5.0.1 never tagged/published), and **large untested areas** (import extraction, all stores, `ai.rs`).

**Totals: 30 bug fixes · 11 security items · 10 feature TODOs · 9 improvement tracks.**

---

## 1. Architecture as built

Three clean layers with no leakage:

1. `src-tauri/src/commands/*.rs` — thin IPC boundary. Every command: acquire `DbState` lock → call one `db::` function → map errors to `String`. No business logic here.
2. `src-tauri/src/db/*.rs` — 17 repositories plus orchestrators that span domains (`db/pdf.rs` compile/promote pipeline, `db/versions.rs` snapshots, `db/backup.rs` restore state machine, `db/dedup.rs` startup merge).
3. Pure domain modules — never touch the DB; `db/*` calls into them, never the reverse.

**State management:** exactly one SQLite connection in `DbState(pub Mutex<Connection>)` (`src-tauri/src/db/mod.rs:32`), WAL + `foreign_keys=ON`; all commands serialize on this mutex, with the lock deliberately dropped around network/Tectonic calls. Per-job export locks (`ExportLocks`), a cooperative `TailorCancel` flag, and an `AppDataDir` root complete managed state.

**Error strategy:** uniform `Result<T, String>` everywhere; mutex poisoning is converted to `"database lock poisoned"` per command; a global panic hook logs then unwinds.

**Startup tasks (all failure-tolerant):** restore-crash recovery, duplicate-vault merge, 30-day trash expiry + orphan `pdf/job_*` GC.

**Logging:** JSON lines under `AppData/logs/kairo.log`, 1 MB rotation keeping 2 generations, key-name-based secret redaction (`src-tauri/src/logging.rs:121-129`).

**Tauri config:** CSP `default-src 'self'` with no script loosening; asset protocol scoped `$APPDATA/**`; capabilities grant only `core:default`; single window; NSIS bundle; Tectonic sidecar as `externalBin`.

## 2. Inventory

### 2.1 All 115 registered Tauri commands (`src-tauri/src/lib.rs:69-185`; no dead handlers)

| Module | Count | Commands |
|---|---|---|
| `db_commands` | 2 | `get_diagnostics`, `db_smoke_test` |
| `vault_commands` | 28 | macro-generated CRUD for projects/experiences/education/certifications/achievements/skills (soft delete → trash); `get_profile`, `upsert_profile`, `add_skill_alias`, `delete_skill_alias` |
| `trust_commands` | 12 | CRUD for evidence, canonical bullets (evidence-link replacement + cross-entity guard), claim rules |
| `import_commands` | 4 | `parse_resume_text`, `parse_certificate_text` (1M-char cap), `github_repo_candidate` (spawn_blocking), `import_resume_batch` (single transaction with re-import merge) |
| `job_commands` | 11 | job CRUD (soft delete), `create_job_with_requirements` (dedupe-reopen), requirement CRUD, `parse_jd`, `set_job_active_stage` |
| `match_commands` | 6 | `run_job_match`, `get_match`, `is_match_stale`, evidence-selection list/set/delete |
| `composer_commands` | 4 | `run_composer`, `save_plan` (monotonic `plan_revision`), `get_plan`, `estimate_plan_lines` |
| `ai_commands` | 12 | config get/save (key → OS keyring), test connection, list models, `tailor_suggest`, `tailor_plan_batch` (batched call + per-bullet fallback), `tailor_cancel`, suggestion list/set/delete, `claim_changes`, `tailor_save_manual_edit` |
| `pdf_commands` | 11 | `export_pdf` (staged compile + revision CAS promote), artifact get/status, open/reveal (job + version), scoped byte reads, save-to-downloads (sanitized, `.part` atomic) |
| `version_commands` | 4 | `save_resume_version` (fingerprint + hash + review gates), `mark_artifact_reviewed`, list/get version |
| `applications_commands` | 5 | application CRUD + `set_application_status` (9-value whitelist) |
| `interview_commands` | 1 | `generate_interview_prep` (deterministic, no AI) |
| `dashboard_commands` | 1 | `get_dashboard` |
| `backup_commands` | 4 | list/create/restore backup, open backups dir |
| `trash_commands` | 3 | `trash_list` (UNION over 7 tables), restore, purge |
| `origin_commands` | 7 | mark/unmark verified, onboarding status/state, home overview |

### 2.2 Migrations (16)

`0001` meta k/v · `0002` career vault (7 record tables, CHECKs, cleanup triggers, indexes) · `0003` evidence/trust (evidence, canonical bullets, claim rules) · `0004` jobs + requirements · `0005` match results/reports · `0006` resume plans · `0007` tailor suggestions (status CHECK; `bullet_id` deliberately FK-less — plan bullets are snapshots) · `0008` artifact columns · `0009` resume versions (UNIQUE(job_id, version_number)) · `0010` applications · `0011` artifact template/paper · `0012` soft delete (partial indexes) · `0013` artifact fingerprints · `0014` record origin + first-edit-wins triggers · `0015` plan revisions + job kind · `0016` evidence selections + review gates.

Schema gaps (low): `evidence_selections.entity_type` has no CHECK constraint (validated in code at `db/matching.rs:326-329`); `match_results.score` is a dead column (always 0.0, `db/matching.rs:235`).

### 2.3 Frontend routes

| Route | Component | Purpose |
|---|---|---|
| `/` | `DashboardPage` | Home: next action, attention list, stats, proof queue, activity |
| `/onboarding` | `OnboardingPage` (1,669 ln) | Guided first run, resumable via backend state |
| `/story` | `VaultPage` | 5 record tabs + profile + import + inspector + trash |
| `/skills` | `SkillsPage` → `SkillsTab` | Skill library, aliases, categories |
| `/jobs` | `JobsPage` | Workspace list, repeat-posting detection, trash |
| `/jobs/:jobId` | `JobWorkspacePage` | 5-stage workspace (Role/Evidence/Resume/Review/Applied) |
| `/jobs/:jobId/resume` | `ResumeStudioPage` (1,737 ln) | Content curation, autosave, PDF preview, versions, AI overlay |
| `/applications` | `ApplicationsPage` | Pipeline tracker with status tabs |
| `/settings` | `SettingsPage` | AI provider, appearance, backup/restore, diagnostics |
| `/design` | `DesignPage` | Design-system gallery (ships in prod) |

### 2.4 Zustand stores

`appStore` (diagnostics) · `jobsStore` (jobs, requirement/match/selection/pdfStatus caches, applications) · `vaultStore` (6 record arrays, profile, evidence caches) · `themeStore` (localStorage `kairo.theme`) · `toastStore` · `topBarStore` (page→shell channel) · `uiStore` (cross-page intents). No sensitive data persisted client-side. Plan autosave is a module-singleton queue (`src/lib/planAutosave.ts`), fully unit-tested.

---

## 3. FIXES NEEDED (bugs & code quality)

### HIGH

1. **Stuck "Saving…" dialog after first successful save** — `src/features/vault/RecordInspector.tsx:443-449` (EvidenceDialog), `:701-719` (BulletDialog), `:982-988` (RuleDialog). `save()` does `setSaving(true)` and only resets it in the `catch` — no `finally`. On success the parent closes the dialog with `saving` still `true`; the component stays mounted and the open-effect resets values/error but not `saving`. Reopening "Add proof"/"Add resume point"/"Add rule" shows a permanently disabled "Saving…" button until the tab is remounted. Blocks the core attach-proof loop. (Contrast: `ProfileDialog.tsx:78-80` and `RecordDialog.tsx:241-243` do it correctly.)
2. **pdfjs document leak** — `src/features/resume-studio/PdfViewer.tsx:94-126`. The `PDFDocumentProxy` from `pdfjsLib.getDocument(...).promise` is stored in state and never `destroy()`ed — not on unmount, not on `jobId` change, not when the preview tab switches. Every preview open leaks the parsed document and its worker-held data. Per-page render tasks *are* cancelled correctly (`:67-70`); the doc-level leak dominates.
3. **App-wide re-render storms from whole-store subscriptions** — `src/app/App.tsx:61` (`const topBar = useTopBarStore()`) re-renders the entire shell (Suspense, Routes, every mounted page) on every topBar change; `ResumeStudioPage` publishes save-state on every autosave transition (`:724-739`), so the whole app re-renders twice per autosave. `src/features/vault/VaultPage.tsx:37` subscribes the whole vault store including `evidenceCache/bulletsCache/rulesCache`, so every proof/bullet edit inside the inspector re-renders the whole grid. Fix is mechanical: slice selectors.
4. **Dead, divergent, booby-trapped feature code** — `src/features/jobs/PlanTab.tsx` (308 ln) and `src/features/jobs/ResumeTab.tsx` (234 ln) are imported by nothing. Their `TEMPLATES` list duplicates `ResumeStudioPage.tsx:65-73` with different descriptions, and `ResumeTab`'s compile flow calls `exportPdf(jobId, templateId, null)`, bypassing the autosave-flush/revision contract the Studio enforces — rewiring it would reintroduce the stale-export bug. Delete both.
5. **v5.0.1 exists only in files** — `package.json:10`, `src-tauri/Cargo.toml:3`, `src-tauri/tauri.conf.json:4`, and `CHANGELOG.md:7` all say 5.0.1, but `git tag` stops at `v5.0.0`. The website's version fetch and GitHub "latest" therefore still serve 5.0.0 to users. Tag and publish (or revert the version files).

### MEDIUM

6. **Stringly-typed errors end-to-end** — every Rust command returns `Result<_, String>` and the frontend surfaces `String(e)` raw at ~35 call sites. No way to distinguish validation vs storage vs network, no actionable messaging, no retry classification. Introduce a typed error envelope at the `ipc.ts` boundary (biggest systemic UX lever).
7. **Stale "Applied" stage after tracking an application** — `workspaceSteps.tsx:411-552` (`ApplicationTab`) keeps its own applications copy, separate from the copy `JobWorkspacePage.tsx:75-81` puts in `jobsStore.applications`, and `ApplicationsPage` re-fetches a third copy. After `track()` succeeds and navigates away, the workspace shows the old stage until a full remount.
8. **jobsStore caches never evicted on delete** — `stores/jobsStore.ts:82-89`: `deleteJob` cleans only `reqCache`; `matchCache`, `matchStaleCache`, `selectionCache`, `pdfStatusCache` keep the deleted job's entries and grow unboundedly per job visited.
9. **Store mutated outside its actions** — `JobWorkspacePage.tsx:83-89` and `MatchTab.tsx:68-72, 87-90, 125, 137` call `useJobsStore.setState(...)` directly, bypassing actions and duplicating cache-write logic.
10. **Boot data refetched on every navigation** — `App.tsx:65-71` effect deps include `location.pathname`, re-running `getDiagnostics` + `getOnboardingStatus` (boot-time data) on every route change.
11. **Duplicate save indicators** — `ResumeStudioPage` publishes save state to the TopBar (`:724-739`) *and* renders `SaveStatusChip` in its own header (`:886`). Two different surfaces show "Saved".
12. **Sequential destructive batch with partial failure** — `VaultPage.tsx:168-181` and `SkillsTab.tsx:303-316` await `deleteRecord` one-by-one; a mid-loop failure leaves half the selection deleted, shows only the raw error, and gives no progress for large selections. Needs a backend batch endpoint (single transaction).
13. **TrashDialog failure masquerades as empty state** — `TrashDialog.tsx:26-30` toasts the error and sets `items = []`, so the dialog shows "Nothing here — deleted records will appear for 30 days" during a real failure.
14. **Disabled buttons with unexplained thresholds** — "Analyze description" disabled below 30 chars (`NewJobDialog.tsx:177`, `OnboardingPage.tsx:1305`), "Extract my facts" below 10 (`OnboardingPage.tsx:395`), 1M-char cap silent (`ImportDialog.tsx:275`). No visible hint why the primary button is dead.
15. **"Test connection" tests the saved config, not the form** — `SettingsPage.tsx:360-371, 440`: `aiTestConnection()` takes no args, so a user who edits Base URL and clicks Test gets a verdict about the old config.
16. **Repeated-posting detection is O(n²) in render** with a confusing banner (grammar off for N=2) and a filter label that flips between "Review repeats"/"Show all" — `JobsPage.tsx:64-81, 133-140`.
17. **"Clear all candidates" discards review work without confirmation** — `ImportDialog.tsx:380-386`; recoverable only by re-analyzing.
18. **Mock handler type lies** — `src/dev/mockIpc.ts:189` returns `{ok, violations}` typed as a `TailorSuggestion`; `save_plan` always returns `revision: 1` (autosave/flush semantics can't be exercised); `get_job` falls back to `jobs[0]` and hardcodes `requirementCount: 12` (`:90-93`); header comment says `?mock` but the entry is `mock.html` (`:5`).
19. **vitest.config.ts is dead config** — `environmentMatchGlobs` (`vitest.config.ts:9-12`) was removed in Vitest 3 (installed: 5.0.2), and the file is in no tsconfig project (`tsconfig.node.json:17` lists only `vite.config.ts`), so type errors there are invisible to `tsc -b`. The intended node-vs-jsdom test split silently never happens.
20. **Onboarding scrolls the wrong container** — `OnboardingPage.tsx:125` uses `window.scrollTo`, but the app's scroll container is `<main id="app-main">`; `scrollMainToTop()` already exists in `src/lib/dom.ts`. Step changes can land mid-page.

### LOW

21. **Dead branches and stale links** — `VaultPage` carries impossible `skills`-tab handling (`:156, 183, 253, 349, 353` — the tab list at `:27-33` has no skills entry); Dashboard proof rows link to `/vault` and the palette offers "Interview Prep" → `/interview` (both legacy redirects).
22. **Duplicated constants that diverge** — `KIND_LABELS` twice with different values (`JobWorkspacePage.tsx:25-29` vs `MatchTab.tsx:39-43`); `IMPORTANCE_OPTIONS` vs inline options; two relative-time formatters (`JobsPage.tsx:24-33` `fmtActivity` vs `src/lib/dateFmt.ts:29-44` `fmtAgo`) shown side-by-side in different lists.
23. **Toast failures are missable** — host is `role="status" aria-live="polite"` and errors auto-dismiss after 3.5 s (`Toast.tsx:24`, `toastStore.ts:24-27`); `ok`/`success` aliases duplicated (`:32-34`).
24. **Verify refetches the entire vault** — `RecordInspector.tsx:105` re-issues 7 IPC calls to refresh one badge.
25. **`parse_jd` lacks an input cap** — `src-tauri/src/commands/job_commands.rs:88-94` passes arbitrary text to the parser without the `MAX_IMPORT_CHARS` discipline used one module over (`import_commands.rs:17-28`).
26. **Windows reserved device names not blocked in download names** — `pdf_commands.rs:526-546` strips separators/null/leading dot but not `CON`, `NUL`, `COM1`, …
27. **Backup dir walk follows symlinked directories** — `db/backup.rs:285-308` recurses via `path.is_dir()`; a symlinked dir inside `pdf/` would be traversed (local-only, user-owned dir).
28. **DB mutex poisoning bricks all commands until restart** — a panic while holding the `DbState` mutex (e.g. `pdf_commands.rs:22` `.expect`) permanently poisons it; every subsequent command errors with "database lock poisoned". Panic sources are effectively unreachable, so low.
29. **Renderer-side import limits** — `extractFile.ts:234-243` decompresses DOCX via `unzipSync` with no cap (zip bomb → webview memory exhaustion); `extractPdfText` (`:197-232`) has no page/size cap. Local-file DoS in the renderer only.
30. **Fragile-but-correct byte arithmetic** — `latex.rs:169-181` `split_title_role` comment says "4 bytes" for a 5-byte separator; `idx + 4` happens to land boundary-safe. Document or rewrite.

---

## 4. SECURITY FIXES (priority order)

### HIGH

- **S1. Tectonic sidecar supply chain** — `scripts/ensure-tectonic.mjs:81-131`. The binary bundled into every installer is fetched from GitHub `releases/latest` (the pinned `0.17.0` is only a fallback when the API fails), over HTTPS but **with no checksum and no signature verification**; an already-present binary is never revalidated (`:81-84`). It auto-runs via `beforeDevCommand`/`beforeBuildCommand` (`tauri.conf.json:8,11`). A compromised upstream release — or a CI machine resolving "latest" on a different day — silently ships executable code to every user, and unpinned resolution breaks build reproducibility. Fix: pin the version and verify against a committed SHA-256 (two-line change).

### MEDIUM

- **S2. API key attachable to an arbitrary URL** — `ai_commands.rs:73-84` (`ai_list_models`) loads the real key from the keyring and sends it to any IPC-supplied `base_url`; `ai_save_config` (`:36-54`) accepts any URL, and all subsequent tailor traffic (key + resume content) goes there. `ureq` only speaks http/https so this is not a full SSRF, but any script running in the webview (XSS or a compromised dependency) has a one-call primitive to exfiltrate the credential and redirect all AI traffic. Fix: restrict to `https://` plus localhost, and validate list-models against the saved config.
- **S3. No security scanning in CI** — no `cargo audit`/`cargo-deny`, no `npm audit`/osv-scanner, no CodeQL in any workflow. Meanwhile rusqlite is locked at 0.32.1 (8 minors behind), ureq at 2.12 (one major behind), and 17 Dependabot branches sit unmerged. Known-CVE gating does not exist.
- **S4. Unsigned, checksum-less distribution** — `release.yml` uploads the bare NSIS exe; no Authenticode signing, no SHA256 sidecar assets, no Tauri updater artifacts. Users have no way to verify the installer and no update path.
  *Partially addressed:* releases now attach `SHA256SUMS.txt`, and the Tauri updater signs update artifacts with a minisign key (pubkey pinned in `tauri.conf.json`; private key held as the `TAURI_SIGNING_PRIVATE_KEY` GitHub secret — see `docs/RELEASING.md`). Authenticode signing still requires a purchased certificate and remains open.
- **S5. Asset-protocol scope too wide** — `tauri.conf.json:26-29` grants the webview `$APPDATA/**`, which includes the SQLite DB, logs, and the entire backups directory. The PDF viewer only needs `pdf/**`. Narrow it to shrink the XSS blast radius (CSP `connect-src 'self'` currently mitigates bulk exfiltration).

### LOW

- **S6.** Blocking network (up to 240 s) and Tectonic compiles run directly on async-runtime workers instead of `spawn_blocking` — `ai_commands.rs:207-214, 329-339`, `pdf_commands.rs:108-129` (contrast the correct `import_commands.rs:49`). Multi-minute stalls delay all async commands.
- **S7.** No timeout/kill on the Tectonic child process — `db/pdf.rs:639-684` waits indefinitely; a stalled first-run bundle download wedges the export and the per-job lock forever with no cancel path.
- **S8.** Claim-gate heuristics have known escapes — written-out numbers ("five million"), non-ASCII digits, technologies outside the Vault vocabulary, paraphrased forbidden claims (`tailor.rs:143-198`); and the manual-edit path stores edits as `accepted` without gate checks, with the overlay trusting manual rows whose stored validation failed (`db/tailor.rs:263-295, 155`). Defensible trust-the-human design (tested), but it is *the* bypass — surface a forced acknowledgment.
- **S9.** Renderer-side import caps (zip bomb, page count) — see fix #29.
- **S10.** GitHub Actions pinned by major tag, not commit SHA (`ci.yml`, `release.yml`, `website.yml`); Dependabot's action bumps unmerged.
- **S11.** Misc hardening: brittle `contains("HTTP 400")` retry condition (`ai.rs:230`); hash-then-copy TOCTOU window in version creation; restore holds the exclusive DB lock while extracting up to 2 GB.

**Explicitly checked and clean:** SQL injection (all identifiers whitelisted via `VaultEntity::TABLE`/`EntityKind::parse`/`TRASH_ARMS` constants; all values bound, including IN-lists built as `?1..?n`), path traversal (`scoped_artifact_path` canonicalizes both ends, `pdf_commands.rs:261-279`; restore names match a strict stamp pattern), shell injection (no shells anywhere; `explorer`/`open`/`xdg-open` via `.arg()`), LaTeX injection (`escape_latex` covers all ten specials + control chars; `latex_url` percent-encodes argument terminators; paper substitution whitelisted — all tested), zip bombs in restore (per-entry 512 MB / total 2 GB caps enforced on actually-read bytes), secret leakage (key never in SQLite, never returned to the frontend, redacted from logs), and transaction integrity (import batch, match persist, suggestion acceptance, dedup merge all single-tx with rollback tests).

---

## 5. FEATURES LEFT TO ADD / TODO

### HIGH

- **F1. macOS/Linux installers** — the core already compiles and tests on all three OSes in CI, but `bundle.targets` is `["nsis"]` and `release.yml` ships Windows only. README:96 admits the limit; the work is mostly release config.
- **F2. Signed releases + auto-updater** — no Authenticode certificate, no Tauri updater configured. Users have no in-app update path and no way to verify downloads.
  *Done (except Authenticode):* the Tauri updater plugin now checks `latest.json` from the GitHub release feed, verifies the minisign signature against the pinned pubkey, and installs from Settings → Software update. Release artifacts are signed in CI via the `TAURI_SIGNING_PRIVATE_KEY` secret; `SHA256SUMS.txt` accompanies every release for manual verification.
- **F3. OCR path for scanned PDFs** — import requires a text layer (README:97); scanned resumes currently dead-end with manual entry. Even a clear guided fallback ("your PDF has no text layer, here's what to do") would help.

### MEDIUM

- **F4. i18n framework** — the UI is 100% hardcoded English (hundreds of inline strings, English punctuation embedded in components, month names in `dateFmt.ts`). Blocker for any localization goal; fine to defer for a local-first personal tool.
- **F5. Backend batch operations** — one transaction per multi-delete with a progress surface (fixes #12 properly).
- **F6. Cancel for in-progress PDF export** — the tailor flow has `tailor_cancel`; export has no cancel path (ties into S7's timeout work).
- **F7. Usability-testing results** — `docs/usability-testing.md` has a real protocol with intentionally empty result tables; run it and fill it in.

### LOW

- **F8.** Website `robots.txt` / `sitemap.xml` / `404.html`.
- **F9.** Remove the unused android/ios icon trees under `src-tauri/icons/` (~30 files; mobile targets confirmed unused in `Cargo.toml:12-16` comments).
- **F10.** Optimize the multi-MB brand PNGs (`brand/hero-values-sunset.png` is 2.1 MB).

---

## 6. FUTURE IMPROVEMENTS (make the app better)

### HIGH

- **I1. Typed error taxonomy end-to-end** — Rust error enum → IPC envelope (code + message) → routed UI (actionable toasts, retry vs report dialogs). Fixes #6 systemically and upgrades every error surface at once.
- **I2. Test-coverage program** — the highest-risk untested code: `src/features/imports/extractFile.ts` (260 lines of baseline-clustering/column-detection/DOCX-zip heuristics feeding *every* import — zero tests; only the mock port is tested), all 7 Zustand stores, `ResumeStudioPage` (1,737 ln), `OnboardingPage` (1,669), `ImportDialog` (1,339), `RecordInspector` (1,039), `JobWorkspacePage`, `DashboardPage`, `workspaceSteps`, `SettingsPage`, `SkillsTab`, `MatchTab`, `ApplicationsPage`, `PdfViewer`, and the `ipc.ts`/`types.ts` contract. On the Rust side: `ai.rs` (network + secrets — zero tests of any kind), `latex_templates.rs` (the PR template's byte-determinism claim is unenforced here), `db/interview.rs`. Add `@vitest/coverage-v8` + thresholds so regressions are visible. **Also fix the flagship PDF test:** `src-tauri/tests/pdf_pipeline.rs:93-103` looks for tectonic in `$HOME` while ensure-tectonic installs to `src-tauri/binaries/` — the real-compile assertion is a silent no-op in CI and on most dev machines.
- **I3. Performance track** — selector-based store subscriptions (fix #3), raw `tauri::ipc::Response` bytes for PDFs instead of JSON number arrays (`ipc.ts:266-269` + `pdf_commands.rs:406-413` — several MB of JSON per preview open), pdfjs destroy lifecycle (fix #2).

### MEDIUM

- **I4. Accessibility pass** — implement the full ARIA tabs pattern (arrow keys, `aria-controls`/tabpanels) in `Tabs.tsx:22-90` and replace the role-less inline tab clones in `RecordInspector.tsx:141-164` / `ImportDialog.tsx:58-72`; replace the hand-rolled AI-writing overlay dialog (`ResumeStudioPage.tsx:1705-1734` — no focus trap, no focus restore; the shared `Dialog` already does both) with `Dialog`; give the command palette `aria-label` + `aria-activedescendant` + a focus trap; fix contrast (`text-muted/60` on the midnight hero ≈ 2.9:1 at `DashboardPage.tsx:373`; 21 uses of `text-[10px]` despite the design system's own rule at `global.css:239-241`); add `aria-label`s to the 5 placeholder-only search inputs.
- **I5. UX polish track** — explain disabled thresholds (#14), one save indicator (#11), applied-stage refresh (#7), repeated-posting rework (#16), honest error states (#13), confirm "clear all candidates" (#17).
- **I6. Dependency refresh** — merge the Dependabot backlog deliberately: rusqlite 0.32→0.40 (core data store, most important), ureq 2→3 (carries the AI HTTP path), TypeScript 5.6→current, Vite 6→7; plan the React 19 migration (currently held back with documented rationale in `dependabot.yml:23-33`).

### LOW

- **I7. CI hardening** — add `prettier --check`, `eslint-plugin-jsx-a11y` (a UI-heavy app with no a11y linting), a `tauri build` smoke test (bundle-breaking changes are currently first discovered on release day), unify Node 20 vs 22 (`.nvmrc`=20, `ci.yml:68`=22 labeled "Node 20"), pin actions by SHA, stop excluding `scripts/` from lint.
- **I8. Claim-check upgrades** — normalize written-out numbers, broaden the technology vocabulary, tighten forbidden-phrase matching (S8).
- **I9. Docs/SEO touch-ups** — CONTRIBUTING `npm install`→`npm ci` and `cargo test --locked`; bug-report template version placeholder "v3.0.0" is three majors stale; dead `dl-fact-version` sed target in `build-site.sh:18`; stale source-HTML versions in `website/index.html:79,291` (overridden at build time, but misleading between releases); README screenshot coupling to website assets.

---

## 7. Per-screen UX evaluation (summary)

**Generally strong:** skeletons on every async surface, dedicated `EmptyState` with CTAs, honest empty copy, error banners on Jobs/Vault/Skills, a bridge-unavailable screen on Dashboard, job-missing recovery in Studio, consistent `ConfirmDialog` on every destructive action (trash purge gets a double confirm), systematic truncation/overflow handling, global reduced-motion support, `IconButton` requires a label, correct Dialog esc-stack + focus trap + restore.

**Gaps (details in §3):** the stuck-save dialogs (#1), error-as-empty in TrashDialog (#13), unexplained disabled thresholds (#14), test-connection-vs-form mismatch (#15), repeated-posting confusion (#16), double save indicator (#11), ARIA tabs/overlay/palette/contrast issues (I4), and toast failure-visibility (#23).

## 8. Genuine strengths to preserve

- Parameterized SQL with whitelisted identifiers everywhere; IN-lists built as bound `?1..?n`.
- Transactions on every multi-write path; import-batch rollback is proven by injected-failure tests.
- The backup/restore state machine: hash-verified archive before anything live is touched, staged DB validated + migrated pre-swap, restore journal + pre-restore snapshot, crash recovery at next startup, hostile-archive/path-traversal/zip-bomb tests.
- Keyring secrets (Windows Credential Manager / Apple native / Linux keyutils) never returned to the frontend, never logged; corrupt AI config refuses to fall back to the OpenAI default so the stored key is never sent to an endpoint the user didn't choose (`db/tailor.rs:22-35`).
- Complete LaTeX escaping with tests, including argument-terminator-aware URL encoding.
- Staged PDF compiles with backup/rollback promotion, CAS on `plan_revision`, and a fingerprint system that correctly flags stale artifacts in the right precedence (hash → revision → template/paper → fingerprint).
- The AI claim-gate: citation requirements, numeric-diff detection, vocabulary diff, forbidden-claim rules — with rejected AI wording un-acceptable at the API level and mandatory human acceptance.
- The plan-autosave queue: serialized per-job writer, latest-snapshot-wins, failed saves stay dirty, flush refuses revisions on error — fully unit-tested.
- Correct mock/demo isolation: `mockIpc.ts` is tree-shaken from the Tauri bundle; the demo builds from a separate Vite config with relative base.
- Dependabot across all three ecosystems with a documented React-19 rationale; `--locked` everywhere in CI; clippy `-D warnings`.
- Documentation is honest and matches the code on every spot-checked claim (README limits, SECURITY.md, CONTRIBUTING/PR template rules).

## 9. Test coverage map

**Frontend (9 files / 44 cases):** `journeys.test.tsx` (5 E2E-style journeys with mocked IPC), `mockParsers.test.ts` (7), `origin.test.ts` (9), `planAutosave.test.ts` (10), `CommandPalette.test.tsx` (6), `TrashDialog.test.tsx` (4), `TailorTab.test.tsx` (2), `OnboardingPage.test.tsx` (2), `SaveStatusChip.test.tsx` (4). Everything else — see I2 for the untested list.

**Rust:** inline `#[cfg(test)]` units in nearly every domain/db module (backup alone has ~20 including hostile-archive and fail-point rollback tests); `tests/versions_flow.rs` runs everywhere; `tests/pdf_pipeline.rs` exercises a real Tectonic compile **but silently skips in CI** (wrong lookup path, see I2). No tests: `ai.rs`, `latex_templates.rs`, `db/interview.rs`, command wrappers (acceptable — thin).

## 10. Repo hygiene

- Tracked compiled artifact: `src-tauri/etc/tests-manifest.o` (documented in README:77-82 as a local-linking workaround, but generated output shouldn't be committed).
- `.zcodeignore` is tracked yet listed in `.gitignore:17`; `tmp_baseline/` (`:16`) is a personal-artifact entry.
- Build outputs (`dist/`, `site-dist/`, `src-tauri/target/`, `src-tauri/binaries/`) are correctly ignored and untracked. Repo pack is 1.92 MiB; no `.env` or databases tracked.
- Website is privacy-clean: zero third-party scripts, no analytics/CDN, self-hosted fonts, graceful GitHub-API fallback.
- 17 `dependabot/*` branches open on origin, never merged or dismissed (see S3/I6).

## 11. Recommended remediation order

1. **Now (this pass):** HIGH code fixes #1–#4, security S1 (pin + checksum Tectonic), write this report.
2. **Next batch:** #5 (tag/release v5.0.1), S2 (https-only AI base URL), S5 (asset scope), #19 (vitest config), #7/#8/#13 (state bugs), pdfjs raw-bytes IPC (I3).
3. **Then:** S3 (CI security scanning) + I7 (CI hardening), the pdf_pipeline CI fix (I2), a11y pass (I4).
4. **Ongoing:** test-coverage program (I2), dependency refresh (I6), typed error taxonomy (I1).
5. **Feature roadmap:** F2 (signing + updater) before public growth, F1 (mac/linux packages), then F3–F7.
