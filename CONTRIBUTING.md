# Contributing to Kairo

Thanks for your interest in improving Kairo! This guide gets you from clone to
a running dev environment and explains the conventions the codebase follows.

## Prerequisites (Windows)

| Tool | Notes |
|---|---|
| Node.js 18+ | For the React/Vite frontend |
| Rust stable (MSVC toolchain) | `rustup` with the `stable-msvc` target |
| Visual Studio Build Tools | "Desktop development with C++" workload — provides `cl.exe`, which bundled SQLite compiles with |
| Tectonic | LaTeX engine used for PDF export — `winget install Tectonic.Typesetting`. The app also finds it via `PATH` or `Settings` override. First compile downloads the TeX bundle (~100 MB, once). |
| Ollama (optional) | Only for local AI tailoring — no API key needed |

## Setup

```bash
git clone https://github.com/Jeswanth-009/Kairo.git
cd Kairo
npm install
npm run tauri dev
```

`npm run tauri dev` starts the Vite dev server (:5173) and compiles/launches
the Rust shell. On machines where MSVC isn't on `PATH`, `dev.ps1` activates a
portable toolchain — see the script for the paths it expects.

### Browser-only development

The frontend can run without the Rust backend against fixture data:

```bash
npm run dev
# open http://localhost:5173/mock.html
```

`mock.html` installs an in-memory Tauri IPC shim (`src/dev/`) — useful for UI
work; data is fake and nothing persists.

## Testing & verification

```bash
cd src-tauri
cargo test          # Rust unit + integration tests
cargo fmt --check   # formatting gate (run `cargo fmt` to apply)
cargo clippy --all-targets -- -D warnings

cd ..
npm run lint        # ESLint (react-hooks rules on; a few warnings tolerated)
npm test            # vitest unit tests (pure logic + dev-harness parsers)
npm run build       # TypeScript type-check + production bundle
```

CI runs all of these on every push/PR. Please make sure they are green
before opening a PR. Prettier (`.prettierrc.json`, `npm run format`) is
available but not enforced — don't reformat unrelated code in a PR.

## Architecture conventions

These keep the project coherent — please follow them:

- **IPC boundary**: the frontend never calls `invoke()` directly. Everything
  goes through the typed wrapper in `src/lib/ipc.ts`; payload shapes live in
  `src/lib/types.ts` and mirror the Rust structs (camelCase serde). New
  commands need a `#[tauri::command]` in `src-tauri/src/commands/` plus
  registration in `src-tauri/src/lib.rs`.
- **Determinism**: composer/matching outputs must stay deterministic — same
  input ⇒ byte-identical output. No clocks, no RNG, no LLM in the solver.
- **Zero fabrication**: resume wording may only reorganize evidence-backed
  facts. The validation gates in `src-tauri/src/tailor.rs` enforce this;
  don't weaken them.
- **UI kit**: build pages from the primitives in `src/components/ui/`
  (Button, Tabs, Badge, Card, …) and the semantic tokens in
  `src/styles/global.css` — not raw slate/white utility classes — so both
  light and dark themes keep working.
- **Migrations are append-only**: never edit a shipped migration; add a new
  numbered one and register it in `src-tauri/src/db/mod.rs`.

## Commit style

Short, imperative, conventional-ish subjects: `feat(studio): …`,
`fix(composer): …`, `docs: …`. One logical change per commit.

## Reporting issues

Use the issue templates. For security concerns, see
[SECURITY.md](SECURITY.md) — please don't open public issues for
vulnerabilities.
