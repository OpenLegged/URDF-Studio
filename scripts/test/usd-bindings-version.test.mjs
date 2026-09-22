import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { computeUsdBindingsVersion, syncUsdBindingsVersion } from '../build/usd-bindings-version.mjs';

const SCRIPT = fileURLToPath(new URL('../build/usd-bindings-version.mjs', import.meta.url));
const FILENAMES = ['emHdBindings.js', 'emHdBindings.wasm', 'emHdBindings.worker.js', 'emHdBindings.data'];

function createFixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'usd-bindings-version-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bindingsDirectory = join(root, 'public/usd/bindings');
  mkdirSync(bindingsDirectory, { recursive: true });
  for (const filename of FILENAMES) {
    writeFileSync(join(bindingsDirectory, filename), `fixture for ${filename}`);
  }
  const sourcePath = join(root, 'src/lib/robot-parser/usd/usdBindingsAssetPaths.ts');
  mkdirSync(dirname(sourcePath), { recursive: true });
  writeFileSync(sourcePath, "// surrounding code must survive\nexport const USD_BINDINGS_CACHE_KEY = 'stale';\n");
  return { root, bindingsDirectory, sourcePath };
}

function runCli(root, ...args) {
  return spawnSync(process.execPath, [SCRIPT, '--root', root, ...args], { encoding: 'utf8' });
}

test('every Emscripten artifact contributes to the deterministic bundle version', (t) => {
  const { bindingsDirectory } = createFixture(t);
  const originalVersion = computeUsdBindingsVersion(bindingsDirectory);
  assert.match(originalVersion, /^[a-f0-9]{20}$/);
  assert.equal(computeUsdBindingsVersion(bindingsDirectory), originalVersion);
  const changedVersions = new Set();
  for (const filename of FILENAMES) {
    const filePath = join(bindingsDirectory, filename);
    const original = readFileSync(filePath);
    writeFileSync(filePath, `${original}\nchanged`);
    const version = computeUsdBindingsVersion(bindingsDirectory);
    assert.notEqual(version, originalVersion, `${filename} must invalidate the bundle`);
    changedVersions.add(version);
    writeFileSync(filePath, original);
  }
  assert.equal(changedVersions.size, FILENAMES.length);
  assert.equal(computeUsdBindingsVersion(bindingsDirectory), originalVersion);
});

test('--check rejects a stale key without writing the source', (t) => {
  const { root, sourcePath } = createFixture(t);
  const original = readFileSync(sourcePath, 'utf8');
  const modifiedAt = statSync(sourcePath).mtimeMs;
  const result = runCli(root, '--check');
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /cache key is stale/);
  assert.match(result.stderr, /npm run usd:bindings:version/);
  assert.equal(readFileSync(sourcePath, 'utf8'), original);
  assert.equal(statSync(sourcePath).mtimeMs, modifiedAt);
});

test('updating the key preserves surrounding code and is idempotent', (t) => {
  const { root, bindingsDirectory, sourcePath } = createFixture(t);
  const version = computeUsdBindingsVersion(bindingsDirectory);
  const firstRun = runCli(root);
  assert.equal(firstRun.status, 0, firstRun.stderr);
  const updated = readFileSync(sourcePath, 'utf8');
  assert.equal(updated, `// surrounding code must survive\nexport const USD_BINDINGS_CACHE_KEY = '${version}';\n`);
  const fixedTime = new Date('2000-01-01T00:00:00Z');
  utimesSync(sourcePath, fixedTime, fixedTime);
  const modifiedAt = statSync(sourcePath).mtimeMs;
  const secondRun = runCli(root);
  assert.equal(secondRun.status, 0, secondRun.stderr);
  assert.equal(readFileSync(sourcePath, 'utf8'), updated);
  assert.equal(statSync(sourcePath).mtimeMs, modifiedAt);
  const check = runCli(root, '--check');
  assert.equal(check.status, 0, check.stderr);
  assert.equal(statSync(sourcePath).mtimeMs, modifiedAt);
});

test('a missing artifact fails instead of updating a partial bundle version', (t) => {
  const { root, bindingsDirectory, sourcePath } = createFixture(t);
  const original = readFileSync(sourcePath, 'utf8');
  rmSync(join(bindingsDirectory, 'emHdBindings.worker.js'));
  const result = runCli(root);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /emHdBindings\.worker\.js/);
  assert.equal(readFileSync(sourcePath, 'utf8'), original);
});

test('the checked-in cache key matches all repository bindings', () => {
  assert.deepEqual(syncUsdBindingsVersion({ check: true }), {
    cacheKey: computeUsdBindingsVersion(fileURLToPath(new URL('../../public/usd/bindings', import.meta.url))),
    updated: false,
  });
});

function runPackagePostbuild(root) {
  const packageDirectory = join(root, 'packages/robot-runtime');
  const scriptPath = join(packageDirectory, 'scripts/postbuild.mjs');
  mkdirSync(dirname(scriptPath), { recursive: true });
  mkdirSync(join(packageDirectory, 'dist'), { recursive: true });
  writeFileSync(join(packageDirectory, 'dist/index.js'), 'export {};\n');
  copyFileSync(
    fileURLToPath(new URL('../../packages/robot-runtime/scripts/postbuild.mjs', import.meta.url)),
    scriptPath,
  );
  return spawnSync(process.execPath, [scriptPath], { encoding: 'utf8' });
}

test('robot-runtime packages all four matching companions without extra source files', (t) => {
  const { root, bindingsDirectory } = createFixture(t);
  writeFileSync(join(bindingsDirectory, 'emHdBindings.wasm.gz'), 'obsolete compressed output');
  const result = runPackagePostbuild(root);
  assert.equal(result.status, 0, result.stderr);
  const output = join(root, 'packages/robot-runtime/dist/wasm');
  assert.deepEqual(readdirSync(output).sort(), [...FILENAMES].sort());
  for (const filename of FILENAMES) {
    assert.deepEqual(readFileSync(join(output, filename)), readFileSync(join(bindingsDirectory, filename)));
  }
});

test('robot-runtime rejects packaging when a required companion is missing', (t) => {
  const { root, bindingsDirectory } = createFixture(t);
  rmSync(join(bindingsDirectory, 'emHdBindings.data'));
  const result = runPackagePostbuild(root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /emHdBindings\.data/);
});
