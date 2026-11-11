# Releasing Kairo

How a release is cut, what ships with it, and how users verify it.

## What a release contains

Tagging `v*` (e.g. `v5.1.0`) triggers `.github/workflows/release.yml`, which
builds the NSIS installer on Windows and publishes a GitHub Release with:

- `Kairo_<version>_x64-setup.exe` — the installer (includes the Tectonic sidecar).
- `SHA256SUMS.txt` — SHA-256 digests of the installer, for manual verification.
- `latest.json` — the in-app updater manifest (signature inline). Only present
  when the release was signed with the real key; see below.

Users verify a download with `sha256sum` / `Get-FileHash` against
`SHA256SUMS.txt`. In-app updates go further: the updater plugin verifies the
artifact's minisign signature against the public key pinned in
`tauri.conf.json` before installing anything.

## The updater signing key

Update artifacts are signed with a minisign keypair. The **public key is
committed** in `tauri.conf.json` (`plugins.updater.pubkey`); the **private key
lives outside the repository**:

- Local copy: `~/.kairo/updater.key` (generated with
  `npx tauri signer generate -w ~/.kairo/updater.key`).
- CI reads it from the repository secret `TAURI_SIGNING_PRIVATE_KEY` — the
  file's full contents, including the `untrusted comment:` line. The key was
  generated with an empty password, so no `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
  is needed.

Losing the private key means future updates cannot be signed; users would then
have to reinstall manually from a new release. Rotating the key means
committing the new public key to `tauri.conf.json` **in the release being
upgraded to** — the already-installed app verifies with the key it has, so
publish the new pubkey in the same release that ships the first update signed
by it.

### What happens without the secret

The release workflow still succeeds: it falls back to an ephemeral key so the
bundle step passes, prints a warning, and **omits `latest.json`** from the
release. The installer and checksums are published as usual; the in-app
"Check for updates" button reports a check failure until a signed release
exists. Never trust a `.sig` file from a release built this way.

## Cutting a release

1. Bump `version` in `package.json`, `src-tauri/Cargo.toml`, and
   `src-tauri/tauri.conf.json` (and `src-tauri/Cargo.lock` via
   `cargo update -p kairo`), plus `package-lock.json`.
2. Add a Keep-a-Changelog section — `## [X.Y.Z] — date`. The release body is
   extracted from it; a missing section falls back to a one-liner.
3. Run the local gates: `npm run verify` and, in `src-tauri/`,
   `cargo fmt --check && cargo clippy --all-targets --locked -- -D warnings && cargo test --locked`.
4. Commit, push, wait for CI to go green on `main`.
5. Tag and push the tag: `git tag vX.Y.Z && git push origin vX.Y.Z`.
   The release workflow does the rest.

## Building an installer locally

`npm run tauri build` now creates updater artifacts, which requires the
signing key: set `TAURI_SIGNING_PRIVATE_KEY_PATH=$HOME/.kairo/updater.key`
(or the content via `TAURI_SIGNING_PRIVATE_KEY`) before building. Without it
the bundler refuses to produce a bundle, because the configured public key
demands a signature. `npm run tauri dev` is unaffected — development builds
do not bundle.

## Not yet: Authenticode

The installer itself is not Authenticode-signed (SmartScreen may warn on first
run). That requires a purchased code-signing certificate; the Tauri updater
signature and the published checksums are the verification paths until then.
