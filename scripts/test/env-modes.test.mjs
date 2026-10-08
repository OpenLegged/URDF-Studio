import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { build, loadEnv } from 'vite';
import { assertEnvMode } from '../build/env-mode.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));

test('mode-local overrides stay in their mode and process values win', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'env-modes-'));
  const key = 'VITE_ENV_ORDER_PROBE';
  const previous = process.env[key];
  try {
    delete process.env[key];
    writeFileSync(path.join(dir, '.env'), `${key}=common\n`);
    writeFileSync(path.join(dir, '.env.dev'), `${key}=dev\n`);
    writeFileSync(path.join(dir, '.env.dev.local'), `${key}=personal-dev\n`);
    writeFileSync(path.join(dir, '.env.fat'), `${key}=fat\n`);
    writeFileSync(path.join(dir, '.env.production'), `${key}=production\n`);
    assert.equal(loadEnv('dev', dir, '')[key], 'personal-dev');
    assert.equal(loadEnv('fat', dir, '')[key], 'fat');
    assert.equal(loadEnv('production', dir, '')[key], 'production');
    writeFileSync(path.join(dir, '.env.fat.local'), `${key}=private-fat\n`);
    assert.equal(loadEnv('fat', dir, '')[key], 'private-fat');
    process.env[key] = 'injected';
    for (const mode of ['dev', 'fat', 'production']) assert.equal(loadEnv(mode, dir, '')[key], 'injected');
    writeFileSync(path.join(dir, '.env.local'), `${key}=wrong-environment\n`);
    assert.throws(() => assertEnvMode('production', dir), /Move .env.local/);
    assert.throws(() => assertEnvMode('unknown', dir), /Unsupported environment/);
  } finally {
    if (previous === undefined) delete process.env[key]; else process.env[key] = previous;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('each selected profile is bundled with production build semantics', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'env-bundle-'));
  try {
    const entry = path.join(dir, 'probe.js');
    writeFileSync(entry, 'globalThis.environmentProbe = { mode: import.meta.env.MODE, app: import.meta.env.VITE_APP_ENV, dev: import.meta.env.DEV, production: import.meta.env.PROD };');
    for (const mode of ['dev', 'fat', 'production']) {
      assertEnvMode(mode, root);
      const result = await build({ root: dir, envDir: root, configFile: false, mode, logLevel: 'silent',
        build: { write: false, minify: false, rollupOptions: { input: entry } } });
      const output = Array.isArray(result) ? result[0].output : result.output;
      const code = output.find((item) => item.type === 'chunk').code;
      const context = {};
      runInNewContext(code, context);
      assert.equal(context.environmentProbe.mode, mode);
      assert.equal(context.environmentProbe.app, mode);
      assert.equal(context.environmentProbe.dev, false);
      assert.equal(context.environmentProbe.production, true);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});


test('CLI wrappers reject environment overrides before starting Vite or build tasks', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'env-cli-'));
  const scriptDir = 'scripts/build';
  const marker = path.join(dir, 'vite-started');
  try {
    mkdirSync(path.join(dir, scriptDir), { recursive: true });
    mkdirSync(path.join(dir, 'dist'), { recursive: true });
    mkdirSync(path.join(dir, 'node_modules/vite/bin'), { recursive: true });
    for (const file of ['preview.mjs', 'build.mjs', 'env-mode.mjs']) {
      copyFileSync(path.join(root, scriptDir, file), path.join(dir, scriptDir, file));
    }
    writeFileSync(path.join(dir, 'dist/.build-environment.json'), JSON.stringify({ mode: 'fat' }));
    writeFileSync(path.join(dir, 'node_modules/vite/bin/vite.js'),
      "require('node:fs').writeFileSync('vite-started', 'true'); process.exit(17);\n");
    const flags = [
      ['--mode', 'production'], ['--mode=production'],
      ['-m', 'production'], ['-mproduction'], ['-m=production'],
      ['--mode', 'fat', '-m', 'production'],
    ];
    for (const args of flags) {
      for (const command of ['preview', 'build']) {
        const result = spawnSync(process.execPath, [path.join(dir, scriptDir, `${command}.mjs`), 'fat', ...args], {
          cwd: dir, encoding: 'utf8', timeout: 3000,
        });
        assert.equal(result.error, undefined, `${command} ${args.join(' ')}`);
        assert.equal(result.status, 1, `${command} ${args.join(' ')}`);
        assert.match(result.stderr, command === 'preview'
          ? /mode flags cannot override it/ : /Additional build arguments are unsupported/);
        assert.equal(existsSync(marker), false, 'Invalid arguments must never start Vite');
      }
    }
    const valid = spawnSync(process.execPath, [path.join(dir, scriptDir, 'preview.mjs'), '--host', '127.0.0.1'], {
      cwd: dir, encoding: 'utf8', timeout: 3000,
    });
    assert.equal(valid.error, undefined);
    assert.equal(valid.status, 17, 'An ordinary preview must reach the isolated fake Vite entry');
    assert.match(valid.stdout, /recorded fat build/);
    assert.equal(existsSync(marker), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
