#!/usr/bin/env node
// Downloads the platform Tectonic binary into `src-tauri/binaries/` so the
// Tauri `externalBin` (sidecar) bundler always finds it. The binary is never
// committed — release CI and local builds fetch it with this script, which
// `beforeDevCommand` / `beforeBuildCommand` run automatically.
//
// Triple resolution order: $TAURI_TARGET_TRIPLE → `rustc -vV` host triple →
// x86_64-pc-windows-msvc. Set TAURI_TARGET_TRIPLE when cross-compiling.
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { get } from "node:https";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BIN_DIR = join(ROOT, "src-tauri", "binaries");
const REPO = "tectonic-typesetting/tectonic";
const EXE = process.platform === "win32" ? ".exe" : "";

function hostTriple() {
  if (process.env.TAURI_TARGET_TRIPLE) return process.env.TAURI_TARGET_TRIPLE;
  try {
    const out = execFileSync("rustc", ["-vV"], { encoding: "utf8" });
    const m = out.match(/^host:\s*(.+)$/m);
    if (m) return m[1].trim();
  } catch {
    /* rustc missing — fall through to the common default */
  }
  return "x86_64-pc-windows-msvc";
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    get(url, { headers: { "User-Agent": "kairo-build" } }, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`GitHub API returned HTTP ${res.statusCode} for ${url}`));
        return;
      }
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(e);
        }
      });
    }).on("error", reject);
  });
}

function downloadTo(url, dest) {
  return new Promise((resolve, reject) => {
    get(url, { headers: { "User-Agent": "kairo-build" } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        downloadTo(new URL(res.headers.location, url).href, dest).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }
      pipeline(res, createWriteStream(dest)).then(resolve, reject);
    }).on("error", reject);
  });
}

const triple = hostTriple();
const dest = join(BIN_DIR, `tectonic-${triple}${EXE}`);
if (existsSync(dest)) {
  console.log(`[tectonic] already present: ${dest}`);
  process.exit(0);
}

console.log(`[tectonic] fetching binary for ${triple}…`);
let release;
// GitHub API rate limits (403) hit CI occasionally; retry with backoff
// before giving up so a transient hiccup doesn't fail the whole job.
for (let attempt = 1; attempt <= 4; attempt++) {
  try {
    release = await fetchJson(`https://api.github.com/repos/${REPO}/releases/latest`);
    break;
  } catch (e) {
    if (attempt === 4) {
      console.error(`[tectonic] could not query releases: ${e.message}`);
      console.error("[tectonic] continuing without the sidecar — tests that need Tectonic will skip.");
      process.exit(0);
    }
    const wait = attempt * 5000;
    console.warn(`[tectonic] release query failed (${e.message}); retry ${attempt}/3 in ${wait / 1000}s…`);
    await new Promise((r) => setTimeout(r, wait));
  }
}

const ext = process.platform === "win32" ? "zip" : "tar.gz";
// Tags look like `tectonic@0.17.0` while assets drop the prefix:
// `tectonic-0.17.0-x86_64-pc-windows-msvc.zip`.
const version = String(release.tag_name).replace(/^tectonic@/, "");
const asset = (release.assets ?? []).find(
  (a) => a.name === `tectonic-${version}-${triple}.${ext}`,
);
if (!asset) {
  console.error(`[tectonic] no release asset tectonic-${version}-${triple}.${ext}`);
  console.error("[tectonic] install Tectonic manually and set the path in Kairo Settings.");
  process.exit(1);
}

const archive = join(tmpdir(), asset.name);
const extractDir = join(tmpdir(), `kairo-tectonic-${triple}`);
console.log(`[tectonic] downloading ${asset.name} (${Math.round(asset.size / 1e6)} MB)…`);
await downloadTo(asset.browser_download_url, archive);
rmSync(extractDir, { recursive: true, force: true });
mkdirSync(extractDir, { recursive: true });
// Windows ships bsdtar at an absolute path (GNU tar from a dev shell would
// misread `C:\...` as a remote host); macOS tar is bsdtar and handles zip.
const tar =
  process.platform === "win32" ? join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe") : "tar";
execFileSync(tar, ["-xf", archive, "-C", extractDir], { stdio: "inherit" });

// The archive contains the binary either at the root or under a folder.
let binaryPath = null;
const walk = (dir) => {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p);
    else if (entry === `tectonic${EXE}`) binaryPath = p;
  }
};
walk(extractDir);
if (!binaryPath) {
  console.error("[tectonic] archive did not contain a tectonic binary");
  process.exit(1);
}

mkdirSync(BIN_DIR, { recursive: true });
copyFileSync(binaryPath, dest);
if (process.platform !== "win32") chmodSync(dest, 0o755);
rmSync(archive, { force: true });
rmSync(extractDir, { recursive: true, force: true });
console.log(`[tectonic] ready: ${dest}`);
