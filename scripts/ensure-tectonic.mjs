#!/usr/bin/env node
// Downloads the pinned platform Tectonic binary into `src-tauri/binaries/` so
// the Tauri `externalBin` (sidecar) bundler always finds it. The binary is
// never committed — release CI and local builds fetch it with this script,
// which `beforeDevCommand` / `beforeBuildCommand` run automatically.
//
// The sidecar is executable code shipped inside every installer, so this
// script never resolves "latest": the version is pinned and every download
// is verified against the committed digests in scripts/tectonic-checksums.json
// before extraction. A cached binary is re-verified against its recorded hash
// so a truncated or tampered file is never bundled. To upgrade Tectonic, add
// the new release's asset digests to the checksums file (the GitHub release
// API exposes them as each asset's `digest`) and bump PINNED_VERSION in the
// same commit.
//
// Triple resolution order: $TAURI_TARGET_TRIPLE → `rustc -vV` host triple →
// x86_64-pc-windows-msvc. Set TAURI_TARGET_TRIPLE when cross-compiling.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
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

const PINNED_VERSION = "0.17.0";
const CHECKSUMS = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "tectonic-checksums.json"), "utf8"),
);
if (CHECKSUMS.version !== PINNED_VERSION) {
  console.error(
    `[tectonic] checksum file version ${CHECKSUMS.version} does not match pinned ${PINNED_VERSION} — update them together`,
  );
  process.exit(1);
}

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

function sha256File(path) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("data", (c) => hash.update(c));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
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
const destHashPath = `${dest}.sha256`;

// Revalidate a cached sidecar before trusting it: binaries/ persists between
// CI runs and on dev machines, and a corrupted file must never be bundled.
if (existsSync(dest)) {
  const recorded = existsSync(destHashPath) ? readFileSync(destHashPath, "utf8").trim() : null;
  if (recorded) {
    const actual = await sha256File(dest);
    if (actual === recorded) {
      console.log(`[tectonic] already present and verified: ${dest}`);
      process.exit(0);
    }
    console.warn(`[tectonic] cached binary hash mismatch — re-downloading`);
  } else {
    console.warn(`[tectonic] cached binary has no recorded hash — re-downloading`);
  }
  rmSync(dest, { force: true });
  rmSync(destHashPath, { force: true });
}

const ext = process.platform === "win32" ? "zip" : "tar.gz";
const archiveName = `tectonic-${PINNED_VERSION}-${triple}.${ext}`;
const expectedArchiveHash = CHECKSUMS.assets[archiveName];
if (!expectedArchiveHash) {
  console.error(
    `[tectonic] no committed checksum for ${archiveName} — add the digest to scripts/tectonic-checksums.json or fix TAURI_TARGET_TRIPLE`,
  );
  process.exit(1);
}

// Plain download endpoint: no GitHub API rate limits, fixed version.
const url = `https://github.com/${REPO}/releases/download/tectonic@${PINNED_VERSION}/${archiveName}`;

const archive = join(tmpdir(), archiveName);
const extractDir = join(tmpdir(), `kairo-tectonic-${triple}`);
console.log(`[tectonic] downloading pinned v${PINNED_VERSION} for ${triple}…`);
for (let attempt = 1; ; attempt++) {
  try {
    await downloadTo(url, archive);
    break;
  } catch (e) {
    if (attempt >= 3) {
      console.error(`[tectonic] download failed after ${attempt} attempts: ${e.message}`);
      process.exit(1);
    }
    const wait = attempt * 5000;
    console.warn(`[tectonic] download failed (${e.message}); retry ${attempt}/2 in ${wait / 1000}s…`);
    await new Promise((r) => setTimeout(r, wait));
  }
}

const archiveHash = await sha256File(archive);
if (archiveHash !== expectedArchiveHash) {
  rmSync(archive, { force: true });
  console.error(
    `[tectonic] REFUSING to install: downloaded archive hash ${archiveHash} does not match the committed checksum ${expectedArchiveHash}`,
  );
  process.exit(1);
}
console.log(`[tectonic] archive checksum verified`);

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
writeFileSync(destHashPath, `${await sha256File(dest)}\n`, "utf8");
rmSync(archive, { force: true });
rmSync(extractDir, { recursive: true, force: true });
console.log(`[tectonic] ready: ${dest}`);
