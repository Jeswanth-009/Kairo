# Kairo

Local-first Windows career intelligence workspace. Store verified career evidence once; for every
opportunity, select the strongest relevant proof, improve the wording without changing the facts,
review every change, and produce a reproducible application artifact.

**Status: Phase 0 — Foundation** (Tauri shell, routing, design tokens, SQLite + migrations, typed
invoke layer, DB smoke test).

## Stack

- UI: Tauri 2 · React 18 · TypeScript · Vite · Tailwind CSS v4 (brand tokens in `src/styles/global.css`) · Zustand · react-router
- Native: Rust domain modules (`src-tauri/src/…`) exposed as typed Tauri commands
- Persistence: SQLite (bundled, WAL) with numbered, transactional migrations in `src-tauri/migrations/`
- PDF (later phases): Resume JSON → controlled LaTeX template → Tectonic

## Layout

```
src/                     React app (app shell, features/, stores/, lib/, components/)
src-tauri/
  src/commands/          Tauri command boundary (diagnostics, db smoke test; more later)
  src/db/                Connection management + migration runner (+ unit tests)
  migrations/            Numbered SQL migrations — never edit a shipped one
  capabilities/          Minimal Tauri permission set
scripts/                 Icon generation (PIL source → `npx tauri icon`)
```

## Run

```bash
npm install
npm run tauri dev     # dev app window (vite on :5173 + cargo)
npm run build         # frontend type-check + production bundle
cargo test            # in src-tauri/ — db migration + smoke tests
```

## Toolchain note (this machine)

MSVC Build Tools could not be installed (UAC elevation declined), so Rust uses the
`x86_64-pc-windows-gnu` toolchain with a portable [llvm-mingw](https://github.com/mstorsjo/llvm-mingw)
extracted to `~/.kairo-dev/llvm-mingw-20260908-ucrt-x86_64` (no admin required). Every shell that
runs cargo/tauri needs:

```bash
export PATH="$HOME/.cargo/bin:$HOME/.kairo-dev/llvm-mingw-20260908-ucrt-x86_64/bin:$PATH"
```

If MSVC becomes available later: `rustup default stable-msvc`, install VS Build Tools with the
"C++ desktop" workload, and drop the PATH override — nothing in the repo changes.

## Phase plan

0 Foundation → 1 Career Vault → 2 Evidence & trust → 3 Imports → 4 JD analyzer → 5 Matching →
6 Constraint composer → 7 Grounded AI tailoring → 8 Resume Studio → 9 PDF → 10 Versions →
11 Applications → 12 Interview prep → 13 Dashboard → 14 Hardening.

Rule of thumb: the AI layer starts only after the Vault (source of truth) is comfortable with real
data, and every generated claim must stay traceable to approved evidence.
