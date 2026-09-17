import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const CORE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PRECOMPRESS_SCRIPT = path.join(CORE_ROOT, 'scripts/build/precompress.mjs');

function runPrecompress(distDir, ...args) {
  return spawnSync(process.execPath, [PRECOMPRESS_SCRIPT, ...args, '--dist', distDir], {
    cwd: CORE_ROOT,
    encoding: 'utf8',
  });
}

async function withDistFixture(callback) {
  const fixtureRoot = await mkdtemp(path.join(tmpdir(), 'urdf-studio-precompress-'));
  const distDir = path.join(fixtureRoot, 'dist');
  const sourcePath = path.join(distDir, 'assets/app.js');

  try {
    await mkdir(path.dirname(sourcePath), { recursive: true });
    await writeFile(sourcePath, `const marker = "original";\n${'x'.repeat(2048)}\n`);
    await callback({ distDir, sourcePath });
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
}

test('precompress check accepts sidecars that decode to the current source', async () => {
  await withDistFixture(async ({ distDir, sourcePath }) => {
    const generate = runPrecompress(distDir);
    assert.equal(generate.status, 0, generate.stderr || generate.stdout);

    const source = await readFile(sourcePath);
    assert.ok(source.length > 1024);

    const check = runPrecompress(distDir, '--check');
    assert.equal(check.status, 0, check.stderr || check.stdout);
    assert.match(check.stdout, /all have \.br\/\.gz sidecars/);
  });
});

test('precompress check rejects existing sidecars for stale source content', async () => {
  await withDistFixture(async ({ distDir, sourcePath }) => {
    const generate = runPrecompress(distDir);
    assert.equal(generate.status, 0, generate.stderr || generate.stdout);

    const original = await readFile(sourcePath, 'utf8');
    const changed = original.replace('original', 'modified');
    assert.equal(changed.length, original.length);
    await writeFile(sourcePath, changed);

    const check = runPrecompress(distDir, '--check');
    assert.equal(check.status, 1, check.stderr || check.stdout);
    assert.match(check.stderr, /assets\/app\.js\.br: content does not match source/);
    assert.match(check.stderr, /assets\/app\.js\.gz: content does not match source/);
  });
});

test('precompress check reports an unreadable compressed sidecar', async () => {
  await withDistFixture(async ({ distDir }) => {
    const generate = runPrecompress(distDir);
    assert.equal(generate.status, 0, generate.stderr || generate.stdout);
    await writeFile(path.join(distDir, 'assets/app.js.gz'), 'not a gzip stream');

    const check = runPrecompress(distDir, '--check');
    assert.equal(check.status, 1, check.stderr || check.stdout);
    assert.match(check.stderr, /assets\/app\.js\.gz: cannot decompress/);
  });
});
