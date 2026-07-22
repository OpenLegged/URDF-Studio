import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const repoRoot = process.cwd();

test('runtime source satisfies the canonical Google-style checker', () => {
  const result = spawnSync(
    process.execPath,
    [path.join(repoRoot, 'scripts/tools/google_style_audit.mjs'), '--check'],
    { cwd: repoRoot, encoding: 'utf8' },
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
});
