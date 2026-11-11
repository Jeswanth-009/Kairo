#!/usr/bin/env node
// Builds the Tauri v2 updater manifest (`latest.json`) from the NSIS installer
// and its minisign signature produced by `tauri build` when
// `bundle.createUpdaterArtifacts` is enabled. Release CI uploads the manifest
// next to the installer; the app's updater plugin fetches it from the
// `releases/latest/download/latest.json` endpoint pinned in tauri.conf.json.
//
// Without a signature the script fails: an unsigned manifest would make the
// updater offer an update the app itself refuses to install (the plugin
// verifies the artifact against the pubkey in tauri.conf.json). The release
// workflow only calls this when TAURI_SIGNING_PRIVATE_KEY is present.
//
// Usage: node scripts/make-updater-manifest.mjs <nsis-dir> <version> <notes-file>
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [dir, version, notesFile] = process.argv.slice(2);
if (!dir || !version) {
  console.error("usage: make-updater-manifest.mjs <nsis-dir> <version> [notes-file]");
  process.exit(2);
}

const setup = readdirSync(dir).find((f) => f.endsWith(".exe"));
if (!setup) {
  console.error(`no .exe installer found in ${dir}`);
  process.exit(1);
}
const sigFile = `${setup}.sig`;
let signature;
try {
  signature = readFileSync(join(dir, sigFile), "utf8").trim();
} catch {
  console.error(`missing ${sigFile} — the bundle was built without TAURI_SIGNING_PRIVATE_KEY`);
  process.exit(1);
}

const installer = readFileSync(join(dir, setup));
const digest = createHash("sha256").update(installer).digest("hex");

const notes = notesFile ? readFileSync(notesFile, "utf8").trim() : "";

const manifest = {
  version,
  notes,
  pub_date: new Date().toISOString(),
  platforms: {
    "windows-x86_64": {
      signature,
      url: `https://github.com/Jeswanth-009/Kairo/releases/download/v${version}/${encodeURIComponent(setup)}`,
    },
  },
};

writeFileSync(join(dir, "latest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`latest.json written for v${version} (${setup}, sha256 ${digest.slice(0, 16)}…)`);
