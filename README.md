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

No admin-elevated MSVC install was possible, so Rust uses the official `stable-msvc` toolchain with a
**portable MSVC + Windows SDK** (official Microsoft packages, extracted to the user profile by
[mmozeiko/portable-msvc.py](https://gist.github.com/mmozeiko/7f3162ec2988e81e56d5c4e22cde9977)) at
`~/.kairo-dev/msvc`. Every shell that runs cargo/tauri must first activate it:

```bash
. ~/.kairo-dev/msvc-env.sh   # sets PATH, INCLUDE, LIB, and CC/CXX=cl.exe
npm run tauri dev
```

The `CC=cl.exe` override matters: without it the `cc` crate falls back to msys64's `gcc` (on the
system PATH) for bundled SQLite. If a normal admin VS Build Tools install happens later, this env
file can simply be deleted — nothing in the repo depends on it.

## Phase plan

0 Foundation → 1 Career Vault → 2 Evidence & trust → 3 Imports → 4 JD analyzer → 5 Matching →
6 Constraint composer → 7 Grounded AI tailoring → 8 Resume Studio → 9 PDF → 10 Versions →
11 Applications → 12 Interview prep → 13 Dashboard → 14 Hardening.

Rule of thumb: the AI layer starts only after the Vault (source of truth) is comfortable with real
data, and every generated claim must stay traceable to approved evidence.
