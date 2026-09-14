import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const repoRoot = process.cwd();
const googleStyleChecker = path.join(repoRoot, 'scripts/tools/google_style_audit.mjs');
const dependencyChecker = path.join(repoRoot, 'scripts/tools/dependency_boundaries.mjs');

async function withFixture(files, callback) {
  const fixtureRoot = await mkdtemp(path.join(tmpdir(), 'urdf-studio-quality-gate-'));
  try {
    for (const [relativePath, contents] of Object.entries(files)) {
      const absolutePath = path.join(fixtureRoot, relativePath);
      await mkdir(path.dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, contents, 'utf8');
    }
    await callback(fixtureRoot);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
}

function runChecker(checkerPath, cwd, args) {
  return spawnSync(process.execPath, [checkerPath, ...args], {
    cwd,
    encoding: 'utf8',
  });
}

const emptyDependencyBaseline = JSON.stringify({
  knownCycles: [],
  knownFeatureDeepImports: [],
});

test('google style check rejects stale active baseline allowances', async () => {
  await withFixture(
    {
      'src/example.ts': 'export const value = 1;\n',
      'baseline.json': JSON.stringify({
        rules: {
          'function-too-long': { max: 1 },
        },
      }),
    },
    async (fixtureRoot) => {
      const result = runChecker(googleStyleChecker, fixtureRoot, [
        '--check',
        '--baseline',
        'baseline.json',
        '--json',
      ]);

      assert.equal(result.status, 1, result.stderr || result.stdout);
      const report = JSON.parse(result.stdout);
      assert.equal(report.summary.find((rule) => rule.id === 'function-too-long')?.stale, true);
    },
  );
});

test('dependency check keeps types as a leaf layer', async () => {
  await withFixture(
    {
      'src/core/value.ts': 'export const value = 1;\n',
      'src/types/model.ts':
        "import { value } from '@/core/value';\nexport type Model = typeof value;\n",
      'scripts/tools/dependency_boundaries_baseline.json': emptyDependencyBaseline,
    },
    async (fixtureRoot) => {
      const result = runChecker(dependencyChecker, fixtureRoot, ['--check', '--json']);

      assert.equal(result.status, 1, result.stderr || result.stdout);
      const report = JSON.parse(result.stdout);
      assert.match(report.boundaryViolations[0]?.reason ?? '', /types.*leaf/i);
    },
  );
});

test('dependency check rejects require calls in ESM product source', async () => {
  await withFixture(
    {
      'src/core/consumer.ts':
        "const { value } = require('@/shared/value');\nexport const result = value;\n",
      'src/shared/value.ts': 'export const value = 1;\n',
      'scripts/tools/dependency_boundaries_baseline.json': emptyDependencyBaseline,
    },
    async (fixtureRoot) => {
      const result = runChecker(dependencyChecker, fixtureRoot, ['--check', '--json']);

      assert.equal(result.status, 1, result.stderr || result.stdout);
      const report = JSON.parse(result.stdout);
      assert.match(report.boundaryViolations[0]?.reason ?? '', /require.*ESM/i);
    },
  );
});

test('publishable dependency check traces application state through a shared adapter', async () => {
  await withFixture({
    'src/lib/index.ts': "export { value } from '@/shared/adapter';",
    'src/shared/adapter.ts': "export { value } from '@/store/state';",
    'src/store/state.ts': 'export const value = 1;',
    'scripts/tools/dependency_boundaries_baseline.json': emptyDependencyBaseline,
  }, async (fixtureRoot) => {
    const result = runChecker(dependencyChecker, fixtureRoot, ['--check', '--json']);
    assert.equal(result.status, 1, result.stderr || result.stdout);
    const report = JSON.parse(result.stdout);
    assert.deepEqual(report.publishableBoundaryViolations, [{
      entry: 'src/lib/index.ts',
      target: 'src/store/state.ts',
      dependencyPath: ['src/lib/index.ts', 'src/shared/adapter.ts', 'src/store/state.ts'],
    }]);
  });
});

test('worker URLs do not create false ESM cycles through shared worker algorithms', async () => {
  await withFixture({
    'src/lib/index.ts': "export { preview } from '@/shared/preview';",
    'src/shared/preview.ts': "import { workerUrl } from './bridge'; export const preview = () => workerUrl;",
    'src/shared/bridge.ts': "export const workerUrl = new URL('./preview.worker.ts', import.meta.url);",
    'src/shared/preview.worker.ts': "import { preview } from './preview'; export const result = preview();",
    'scripts/tools/dependency_boundaries_baseline.json': emptyDependencyBaseline,
  }, async (fixtureRoot) => {
    const result = runChecker(dependencyChecker, fixtureRoot, ['--check', '--json']);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const report = JSON.parse(result.stdout);
    assert.deepEqual(report.publishableBoundaryViolations, []);
    assert.deepEqual(report.newCycles, []);
  });
});

test('publishable dependency check includes worker module URL dependencies', async () => {
  await withFixture({
    'src/lib/index.ts': "export { workerUrl } from '@/shared/loader';",
    'src/shared/loader.ts': "export const workerUrl = new URL('../features/alpha/runtime.worker.ts', import.meta.url);",
    'src/features/alpha/runtime.worker.ts': 'export const value = 1;',
    'scripts/tools/dependency_boundaries_baseline.json': emptyDependencyBaseline,
  }, async (fixtureRoot) => {
    const result = runChecker(dependencyChecker, fixtureRoot, ['--check', '--json']);
    assert.equal(result.status, 1, result.stderr || result.stdout);
    assert.deepEqual(JSON.parse(result.stdout).publishableBoundaryViolations, [{
      entry: 'src/lib/index.ts',
      target: 'src/features/alpha/runtime.worker.ts',
      dependencyPath: [
        'src/lib/index.ts',
        'src/shared/loader.ts',
        'src/features/alpha/runtime.worker.ts',
      ],
    }]);
  });
});

test('publishable dependency check accepts shared rendering built on core and types', async () => {
  await withFixture({
    'src/lib/index.ts': "export { value } from '@/shared/renderer';",
    'src/shared/renderer.ts': "export { value } from '@/core/value';",
    'src/core/value.ts': "export { value } from '@/types/value';",
    'src/types/value.ts': 'export const value = 1;',
    'scripts/tools/dependency_boundaries_baseline.json': emptyDependencyBaseline,
  }, async (fixtureRoot) => {
    const result = runChecker(dependencyChecker, fixtureRoot, ['--check', '--json']);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.deepEqual(JSON.parse(result.stdout).publishableBoundaryViolations, []);
  });
});
