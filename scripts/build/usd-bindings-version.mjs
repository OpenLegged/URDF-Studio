#!/usr/bin/env node
// Keep all Emscripten artifacts on one content-derived cache key.
// Usage: node scripts/build/usd-bindings-version.mjs [--check] [--root <repo>]
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DEFAULT_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const BINDINGS_FILES = [
  'emHdBindings.js',
  'emHdBindings.wasm',
  'emHdBindings.worker.js',
  'emHdBindings.data',
];
const CACHE_KEY_PATTERN = /export const USD_BINDINGS_CACHE_KEY = '([^']+)';/;

export function computeUsdBindingsVersion(bindingsDirectory) {
  const hash = createHash('sha256');
  for (const filename of BINDINGS_FILES) {
    const contents = readFileSync(join(bindingsDirectory, filename));
    hash.update(`${filename}\0${contents.length}\0`);
    hash.update(contents);
  }
  return hash.digest('hex').slice(0, 20);
}

export function syncUsdBindingsVersion({ root = DEFAULT_ROOT, check = false } = {}) {
  const cacheKey = computeUsdBindingsVersion(join(root, 'public/usd/bindings'));
  const sourcePath = join(root, 'src/lib/robot-parser/usd/usdBindingsAssetPaths.ts');
  const source = readFileSync(sourcePath, 'utf8');
  const match = source.match(CACHE_KEY_PATTERN);
  if (!match) {
    throw new Error(`USD_BINDINGS_CACHE_KEY literal not found in ${sourcePath}`);
  }
  if (match[1] === cacheKey) {
    return { cacheKey, updated: false };
  }
  if (check) {
    throw new Error(
      `USD bindings cache key is stale (${match[1]} -> ${cacheKey}). Run npm run usd:bindings:version and commit the updated key with the bindings.`,
    );
  }
  writeFileSync(
    sourcePath,
    source.replace(CACHE_KEY_PATTERN, `export const USD_BINDINGS_CACHE_KEY = '${cacheKey}';`),
  );
  return { cacheKey, updated: true };
}

function main(args) {
  let root = DEFAULT_ROOT;
  let check = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--check') {
      check = true;
    } else if (argument === '--root' && args[index + 1] && !args[index + 1].startsWith('--')) {
      root = resolve(args[++index]);
    } else {
      throw new Error(`Unknown or incomplete option: ${argument}`);
    }
  }
  const { cacheKey, updated } = syncUsdBindingsVersion({ root, check });
  console.log(`USD bindings cache key ${updated ? 'updated' : 'verified'}: ${cacheKey}`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
