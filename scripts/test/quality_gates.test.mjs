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
