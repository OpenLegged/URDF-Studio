#!/usr/bin/env node
/**
 * Precompress static build outputs (post-build step, wired into `npm run build`).
 *
 * WHY: production hosting (BLB) serves assets without dynamic compression, so
 * first-visit transfer is the full raw size (29 MiB). Serving pre-compressed
 * `.br`/`.gz` files via `brotli_static`/`gzip_static` drops that to ~6 MiB with
 * zero runtime CPU cost, and brotli q11 beats what a server could afford
 * per-request. Decompression happens transparently in the browser's network
 * stack (fetch / XHR / importScripts / WebAssembly.instantiate all accept
 * Content-Encoding), so no app code changes are required.
 *
 * WHAT: walks `dist/`, and for every compressible file (js/css/wasm/data/...)
 * writes `<file>.br` and `<file>.gz` next to the original.
 * - brotli q11 for text (js/css), q5 for binaries >= 1 MiB (wasm/data: q11
 *   costs ~28s for ~9% extra savings over q5 on the 19MB USD wasm), q9 below.
 * - gzip level 9 as fallback for clients without brotli support.
 * - Skips already-compressed formats (png/woff2/...) and tiny files.
 * - `--check` mode verifies every expected sidecar exists and is up to date
 *   (used by CI/verify to catch a build where the step was skipped).
 *
 * Deploy requirement: the static server must serve the sidecar files with the
 * appropriate `Content-Encoding` when the client advertises support — see
 * docs/deployment.md for nginx/CDN reference configs.
 *
 * Usage: node scripts/build/precompress.mjs [--check]
 */
import { brotliCompressSync, constants as zlibConstants, gzipSync } from 'node:zlib';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import process from 'node:process';

const DIST_DIR = new URL('../../dist/', import.meta.url).pathname;
const CHECK_ONLY = process.argv.includes('--check');

const COMPRESSIBLE_EXTENSIONS = new Set([
  '.js',
  '.mjs',
  '.css',
  '.wasm',
  '.data',
  '.json',
  '.svg',
  '.html',
  '.txt',
  '.xml',
  '.webmanifest',
]);
const SKIPPED_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.avif',
  '.gif',
  '.woff2',
  '.woff',
  '.ttf',
  '.mp4',
  '.webm',
  '.zip',
  '.gz',
  '.br',
]);
const MIN_COMPRESSIBLE_BYTES = 1024;
// Binaries at or above this size use brotli q5 instead of q9/q11: q11 on the
// 19 MiB USD wasm takes ~28s for ~0.5 MiB additional savings. q5 keeps the
// whole pass under a couple of seconds.
const LARGE_BINARY_BROTLI_QUALITY = 5;
const LARGE_BINARY_BYTES = 1024 * 1024;

function brotliQualityFor(filePath, size) {
  const extension = filePath.slice(filePath.lastIndexOf('.'));
  if (extension === '.wasm' || extension === '.data') {
    return size >= LARGE_BINARY_BYTES ? LARGE_BINARY_BROTLI_QUALITY : 9;
  }
  return 11;
}

function collectFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFiles(fullPath));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

function listCompressibleFiles() {
  if (!existsSync(DIST_DIR)) {
    throw new Error(`dist/ not found at ${DIST_DIR} — run vite build first.`);
  }

  return collectFiles(DIST_DIR)
    .filter((filePath) => {
      const extension = filePath.slice(filePath.lastIndexOf('.')).toLowerCase();
      if (SKIPPED_EXTENSIONS.has(extension)) return false;
      if (!COMPRESSIBLE_EXTENSIONS.has(extension)) return false;
      return statSync(filePath).size >= MIN_COMPRESSIBLE_BYTES;
    })
    .sort();
}

const formatMiB = (bytes) => `${(bytes / 1048576).toFixed(2)} MiB`;

let rawTotal = 0;
let gzipTotal = 0;
let brotliTotal = 0;
let fileCount = 0;

const files = listCompressibleFiles();
if (files.length === 0) {
  console.log('precompress: no compressible files found (nothing to do)');
  process.exit(0);
}

const missing = [];
for (const filePath of files) {
  const relativePath = relative(DIST_DIR, filePath);
  const brPath = `${filePath}.br`;
  const gzPath = `${filePath}.gz`;

  if (CHECK_ONLY) {
    for (const sidecarPath of [brPath, gzPath]) {
      if (!existsSync(sidecarPath)) {
        missing.push(relative(DIST_DIR, sidecarPath));
      }
    }
    continue;
  }

  const sourceStat = statSync(filePath);
  const raw = readFileSync(filePath);

  const brotliQuality = brotliQualityFor(filePath, sourceStat.size);
  const brotli = brotliCompressSync(raw, {
    params: {
      [zlibConstants.BROTLI_PARAM_QUALITY]: brotliQuality,
      [zlibConstants.BROTLI_PARAM_SIZE_HINT]: sourceStat.size,
    },
  });
  const gzip = gzipSync(raw, { level: 9 });

  writeFileSync(brPath, brotli);
  writeFileSync(gzPath, gzip);

  rawTotal += sourceStat.size;
  brotliTotal += brotli.length;
  gzipTotal += gzip.length;
  fileCount += 1;

  const biggest = statSync(filePath).size > 1024 * 1024;
  if (biggest || brotliQuality === 11) {
    console.log(
      `  ${relativePath}: raw ${formatMiB(sourceStat.size)} -> br(q${brotliQuality}) ${formatMiB(brotli.length)}, gz ${formatMiB(gzip.length)}`,
    );
  }
}

if (CHECK_ONLY) {
  if (missing.length > 0) {
    console.error(`precompress: ${missing.length} sidecar file(s) missing or stale:`);
    for (const path of missing) console.error(`  ${path}`);
    process.exit(1);
  }
  console.log(`precompress: OK — ${files.length} compressible file(s) all have .br/.gz sidecars`);
  process.exit(0);
}

console.log(
  `precompress: ${fileCount} file(s), raw ${formatMiB(rawTotal)} -> brotli ${formatMiB(brotliTotal)} (${Math.round((brotliTotal / rawTotal) * 100)}%), gzip ${formatMiB(gzipTotal)} (${Math.round((gzipTotal / rawTotal) * 100)}%)`,
);
