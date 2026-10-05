<div align="center">

<img src="public/brand/lockup-horizontal-light-800.png" alt="Kairo — Your career. A brighter next step." width="420" />

# Kairo

A local-first desktop workspace for turning your career history into a role-specific resume. Review imported facts, choose relevant experience and skills, edit the draft, and inspect the PDF you actually send. Optional AI suggests wording that you approve.

[![CI](https://github.com/Jeswanth-009/Kairo/actions/workflows/ci.yml/badge.svg)](https://github.com/Jeswanth-009/Kairo/actions/workflows/ci.yml)
![license](https://img.shields.io/badge/license-MIT-10B981)
![platform](https://img.shields.io/badge/platform-Windows-64748B)

</div>

---

## What Kairo does

Kairo keeps projects, experience, education, skills, and achievements in a local SQLite database. Imported records are candidates until you review them. Each role has its own evidence choices, draft, PDF, versions, and application history.

1. **Import** an existing resume (PDF / DOCX / pasted text) — extracted facts are grouped for
   your review; the accepted set saves in one transaction (an interrupted import leaves zero
   partial records). Nothing is trusted automatically.
2. **Choose the shape** — tailor for a specific job (paste the description, confirm the
   requirements that matter) or compose a general resume with no posting at all.
   Repeated imports of the same posting reopen its existing workspace.
3. **See the evidence** — Kairo matches your saved history against each requirement and
   explains *why* a record was selected, with clear / partial / missing support. You decide per
   record: use it, dismiss it, edit the fact, or find another example. These choices affect the draft. Matching does not predict hiring outcomes.
4. **Build the draft** — select skills deliberately, edit and reorder content, and optionally ask an OpenAI-compatible provider for bullet rewrites. Each suggestion is shown beside the original and requires acceptance.
5. **Review the exact PDF** — the compiled document is shown with a checklist; "reviewed" is
   recorded against that file's hash, and saving a version requires you to have reviewed that
   specific revision.
6. **Track the application** — which version you actually sent, when, and what happened next.

With source experience saved, the guided first run composes and exports a real PDF inline, shows the still-unverified records, and offers *Save to Downloads* or *Customize in the editor*. Starting from scratch first asks you to add experience rather than exporting a blank resume. Leaving mid-flow resumes the step, reviewed draft, and workspace.

The interface is organised around these goals:

| Destination | Purpose |
|---|---|
| **Home** | Continue the most important unfinished action |
| **Workspaces** | Manage each role, its evidence, resume, and application |
| **My Story** | Review and improve reusable career history |
| **Skills** | Manage canonical skills and aliases separately from resume selection |
| **Applications** | Track what was submitted and what happened |
| **Settings** | Appearance, AI provider, backups, diagnostics |

Interview prep lives inside each job workspace, because its questions depend on that job.

## Design principles

- **Human review of claims.** Kairo keeps sources and provenance visible. AI rewrites pass automated claim checks and require acceptance; automated checks cannot prove that every statement is true.
- **Honest provenance.** Imported facts are labelled *Imported from resume* until you edit
  (*Edited by you*), attach evidence (*Evidence attached*), or explicitly verify them
  (*Verified by you*). Verification is always a deliberate human act.
- **Explainable selection.** The composer shows why each record was chosen — the matched
  requirement, the source record, and the strength of support.
- **Local-first.** Your data stays in a local SQLite database unless you explicitly use an external AI provider. Import, matching, editing, composition, and PDF export work without AI.
- **Reviewable PDFs.** Export is revision-checked end to end: the PDF records the saved-draft
  revision it was compiled from, edits after the export make the PDF visibly out of date, and
  overlapping exports of one workspace are serialized.

## Supported platforms

- **Windows 10/11** (NSIS installer; Tectonic sidecar bundled).
- macOS and Linux: the Rust core and frontend are cross-platform, but packaging and
  the Tectonic sidecar are currently Windows-first.

## Getting started (5 minutes)

1. Install Node.js **20+** and Rust (stable). On Windows, install the MSVC C++ Build Tools or an installed GNU Rust toolchain and MinGW linker; CI uses MSVC.
2. `npm install`
3. `npm run tauri dev` — the app launches; a blank slate opens the guided first-run flow:
   bring an existing resume, review and accept the extracted facts, choose *tailor for a job*
   or *general resume*, and export the first PDF without ever opening the advanced editor.
4. For production builds: `npm run tauri build` (requires the Tectonic sidecar —
   `npm run ensure-tectonic` fetches it, or the build script does automatically).

## Development

```bash
npm install
npm run dev          # frontend only (browser, with mock data)
npm run tauri dev    # full desktop app

npm run verify       # lint + test + build — the recommended local gate
npm test             # vitest only
cargo test           # Rust tests (in src-tauri)
cargo clippy --all-targets -- -D warnings
```

`npm run verify` is the check to run before pushing; CI enforces the same plus the full Rust
suite on three platforms. On Windows the local Rust test binary needs a comctl32 v6 manifest
(see `src-tauri/etc/` — without it `cargo test` exes fail to load with
`STATUS_ENTRYPOINT_NOT_FOUND`); run the suite locally with:

```bash
RUSTFLAGS="-C link-arg=<repo>/src-tauri/etc/tests-manifest.o" cargo test --lib
```

On PowerShell, the equivalent is:

```powershell
$env:RUSTFLAGS='-C link-arg=C:/path/to/Kairo/src-tauri/etc/tests-manifest.o'
cargo test --lib
```

CI additionally runs the integration tests (`tests/pdf_pipeline.rs`, `tests/versions_flow.rs`),
which skip automatically when Tectonic is unavailable.

## What AI gets (and what works without it)

Everything except wording suggestions works with **no AI provider configured** — import,
matching, composition, export, versions, applications and backups are all local and
deterministic. When you configure an OpenAI-compatible provider (OpenAI, Groq, a local
Ollama server), Kairo sends the selected role context, planned bullet text, and supporting record and evidence context needed for the rewrite. Review your provider's privacy terms before using a remote endpoint. The
API key is stored in the OS credential store, not the database.

### Architecture (short version)

- **Frontend:** React 18 + TypeScript + Tailwind v4 + Vite; zustand stores; Tauri IPC.
- **Backend:** Rust (Tauri 2) with a domain-module layout — matching, composer, tailor,
  imports — over a 16-migration SQLite schema (WAL, foreign keys, soft-delete trash,
  artifact fingerprints, plan revisions, record provenance, evidence decisions).
- **PDF:** headless Tectonic (LaTeX) compilation in a staging directory. The exporter checks the saved plan revision, keeps a copy of the previous files during promotion, and verifies artifact hashes when showing PDF status.
- **Trust model:** records carry origin, edited, and verified provenance; source passages and attached evidence provide review context. AI rewrites pass checks for unsupported technologies, metrics, and claims. The user remains responsible for factual review.

## Honest limitations

- Windows-first packaging; macOS/Linux are buildable but not installer-ready.
- Resume PDF extraction handles text-based PDFs; scanned/image exports need pasted text
  (onboarding keeps the manual-entry path open in every failure case).
- "Where is this fact used?" counts in My Story show evidence coverage and provenance; a
  per-job usage index ("which resumes include this record") is planned.
- AI features require an OpenAI-compatible provider (OpenAI, Groq, a local Ollama server);
  Kairo works fully without them.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, the code map, and review expectations. Good first tasks include additional resume-parser patterns, accessibility and contrast fixes, and focused journey tests.
