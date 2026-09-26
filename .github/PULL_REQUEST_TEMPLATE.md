<!-- Title: one line summarizing the change, imperative mood (e.g. "fix: ..."). -->

## What & why

<!-- What does this PR change, and why? Link the issue: "Fixes #123". -->

## How it was tested

<!-- Kairo's bar: every claim is tested. Pick what applies. -->

- [ ] `cd src-tauri && cargo test` passes locally (add tests for new domain logic)
- [ ] `npm run build` passes (type-check + bundle)
- [ ] Determinism: pure modules produce byte-identical output (new/changed outputs have a test)
- [ ] No fabrication: user-facing wording only reorganizes or rephrases verified evidence
- [ ] Migrations are append-only (existing migration files untouched; new ones numbered +1)
- [ ] Domain logic stays pure (no DB/Tauri access outside `src-tauri/src/db/` and `commands/`)

## Screenshots / evidence

<!-- For UI changes: before/after screenshots. For bug fixes: repro → fix. -->

## Checklist

- [ ] `CHANGELOG.md` updated for user-visible changes
- [ ] Docs (README / module doc comments) updated if behavior or architecture changed
- [ ] No new secrets, personal data, or machine-specific paths in tracked files
