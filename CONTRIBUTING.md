# Contributing to Kairo

Kairo is a local-first desktop app. Contributions should make a job seeker's next step clearer, improve the accuracy of their saved facts, or make the exported resume more dependable.

## Start locally

Install Node.js 20+, Rust, and a working C/C++ linker for your Rust target. On Windows, the app also needs WebView2 and the Tectonic sidecar for real PDF exports. Then run:

```bash
npm install
npm run tauri dev
```

`npm run dev` opens a browser preview with mock data. It is useful for layout work; verify data and PDF changes in the desktop app.

## Where things live

| Area | Location |
| --- | --- |
| App shell and routes | `src/app/` |
| User journeys and screen components | `src/features/` |
| Shared controls and design tokens | `src/components/`, `src/styles/global.css` |
| IPC and frontend types | `src/lib/ipc.ts`, `src/lib/types.ts` |
| Desktop commands | `src-tauri/src/commands/` |
| Database and migrations | `src-tauri/src/db/` |
| Matching, composition, claim checks, PDF rendering | `src-tauri/src/matching.rs`, `composer.rs`, `tailor.rs`, `latex.rs` |
| Brand sources and usage | `brand/README.md`, `public/brand/` |

## Before opening a pull request

1. Describe the user problem and the behavior you changed. Include screenshots for visible UI changes and a sample PDF for renderer changes.
2. Run `npm run verify` and `cargo test` in `src-tauri`. On Windows, see the test manifest command in the README. Run `cargo fmt --all -- --check` and `cargo clippy --all-targets -- -D warnings` for Rust changes.
3. Add a test when a change fixes a data-loss, trust, matching, or PDF regression. Keep tests focused on observable behavior.
4. Update the README when installation, supported platforms, data sent to AI, or known limitations change.

Please avoid claims such as “verified” or “factually accurate” for imported or generated text unless a user has actually confirmed it. AI suggestions must remain visible, reviewable, and optional. Avoid adding network calls to the offline core journey.

## Database changes

Add a forward migration in `src-tauri/src/db/`. Preserve old data and include a migration test for a previous database version. Review how the change interacts with backups, soft deletion, and restored artifact paths.

## Reporting a problem

Include the platform, app version, steps to reproduce, expected and actual behavior, and whether the issue happens without an AI provider. Remove personal resume content, API keys, and private job details from logs or screenshots before posting them publicly.
