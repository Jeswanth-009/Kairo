# Security Policy

## Reporting a vulnerability

Please report security issues privately via
[GitHub Security Advisories](https://github.com/Jeswanth-009/Kairo/security/advisories/new)
("Report a vulnerability") rather than a public issue. Include a description,
steps to reproduce, and the affected version. You can expect an initial
response within 7 days.

## Scope & design notes

Kairo is a **local-first desktop app**: the SQLite database, LaTeX build
directories, backups and logs all live under the OS app-data directory, and
nothing leaves the machine except:

- AI tailoring requests, sent only to the base URL the user configures
  (OpenAI-compatible endpoint, or a local Ollama/LM Studio server);
- GitHub import fetches of a repository URL the user explicitly enters.

**API keys** are stored in the OS credential store (Windows Credential
Manager via the `keyring` crate) — never in the database, never in plan or
log files, and never echoed back to the UI. Log lines are redacted for
keys that look secret-bearing (`src-tauri/src/logging.rs`).

Things explicitly out of scope for "vulnerability":

- The user compiling and running modified code themselves.
- A malicious local process reading the app-data directory — that threat
  model belongs to the OS account, not this app.

## Supported versions

Only the latest release receives security fixes.
