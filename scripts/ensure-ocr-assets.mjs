#!/usr/bin/env node
// Stages the OCR runtime assets into `public/ocr/` so scanned-PDF OCR works
// fully offline: the tesseract.js worker, the WASM core builds, and the
// English language data. The desktop app's CSP allows no CDN traffic, so the
// default "fetch from unpkg/jsdelivr" behaviour would fail silently —
// everything the worker needs must ship inside the bundle.
//
// Worker + core files are copied straight from node_modules (versions are
// pinned by package-lock.json). The language data is not distributed on npm;
// it is downloaded from the tessdata_fast repository and verified against the
// committed digest in scripts/ocr-checksums.json — same scheme as
// ensure-tectonic.mjs. `public/ocr/` is gitignored; run this before dev/build
// (tauri.conf.json does it automatically).
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync } from "node:fs";
import { createWriteStream } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { get } from "node:https";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "public", "ocr");
const coreDir = join(root, "node_modules", "tesseract.js-core");
const workerFile = join(root, "node_modules", "tesseract.js", "dist", "worker.min.js");

// LSTM builds only: createWorker runs with OEM LSTM (the default), so the
// legacy `tesseract-core` (trainables) builds are never fetched. SIMD is
// ubiquitous on Windows 10+; the plain-lstm pair stays as the fallback.
const CORE_FILES = [
  "tesseract-core-simd-lstm.wasm.js",
  "tesseract-core-simd-lstm.wasm",
  "tesseract-core-lstm.wasm.js",
  "tesseract-core-lstm.wasm",
];

const CHECKSUMS = JSON.parse(readFileSync(join(root, "scripts", "ocr-checksums.json"), "utf8"));

mkdirSync(outDir, { recursive: true });

// --- worker + core from node_modules ---------------------------------------
if (!existsSync(workerFile)) {
  console.error("tesseract.js is not installed — run `npm ci` first");
  process.exit(1);
}
copyFileSync(workerFile, join(outDir, "worker.min.js"));
for (const name of CORE_FILES) {
  const src = join(coreDir, name);
  if (!existsSync(src)) {
    console.error(`missing core asset ${name} — tesseract.js-core is not installed`);
    process.exit(1);
  }
  copyFileSync(src, join(outDir, name));
}
console.log("OCR worker and core copied from node_modules");

// --- language data: download + verify ---------------------------------------
// tessdata_fast ships plain (uncompressed) .traineddata files; the worker is
// configured with gzip: false to match.
const langFile = join(outDir, "eng.traineddata");
const expected = CHECKSUMS["eng.traineddata"];
if (!expected) {
  console.error("eng.traineddata has no pinned digest in scripts/ocr-checksums.json");
  process.exit(1);
}

const sha256 = (file) =>
  createHash("sha256").update(readFileSync(file)).digest("hex");

if (existsSync(langFile) && sha256(langFile) === expected.sha256) {
  console.log("eng.traineddata already present and verified");
  process.exit(0);
}
if (existsSync(langFile)) {
  console.log("eng.traineddata digest mismatch — re-downloading");
}

function download(url, redirectsLeft = 4) {
  return new Promise((resolve, reject) => {
    get(url, { headers: { "User-Agent": "kairo-ensure-ocr-assets" } }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        if (redirectsLeft === 0) {
          reject(new Error("too many redirects fetching traineddata"));
          return;
        }
        res.resume();
        resolve(download(res.headers.location, redirectsLeft - 1));
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`traineddata download failed: HTTP ${res.statusCode}`));
        return;
      }
      resolve(res);
    }).on("error", reject);
  });
}

const res = await download(expected.url);
const tmpFile = `${langFile}.download`;
await new Promise((resolve, reject) => {
  const stream = createWriteStream(tmpFile);
  res.pipe(stream);
  res.on("error", reject);
  stream.on("error", reject);
  stream.on("finish", resolve);
});

const actual = sha256(tmpFile);
if (actual !== expected.sha256) {
  console.error(`eng.traineddata digest mismatch: got ${actual.slice(0, 16)}…, expected ${expected.sha256.slice(0, 16)}…`);
  process.exit(1);
}
renameSync(tmpFile, langFile);
console.log("eng.traineddata downloaded and verified");
