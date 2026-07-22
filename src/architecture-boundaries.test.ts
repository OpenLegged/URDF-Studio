import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const repoRoot = process.cwd();

test('runtime dependencies satisfy the canonical architecture checker', () => {
  const result = spawnSync(
    process.execPath,
    [path.join(repoRoot, 'scripts/tools/dependency_boundaries.mjs'), '--check'],
    { cwd: repoRoot, encoding: 'utf8' },
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test('urdf-viewer root entrypoint does not expose internal utility barrels', () => {
  const entrypoint = readFileSync(path.join(repoRoot, 'src/features/urdf-viewer/index.ts'), 'utf8');

  assert.doesNotMatch(entrypoint, /export\s+\*\s+from\s+['"]\.\/utils['"]/);
  assert.doesNotMatch(entrypoint, /export\s+\*\s+from\s+['"]\.\/hooks['"]/);
});

test('source editor has no user-interaction dynamic module boundary', () => {
  const overlays = readFileSync(
    path.join(repoRoot, 'src/app/components/AppLayoutOverlays.tsx'),
    'utf8',
  );
  const editor = readFileSync(
    path.join(repoRoot, 'src/features/code-editor/components/SourceCodeEditor.tsx'),
    'utf8',
  );
  const warmup = readFileSync(
    path.join(repoRoot, 'src/app/utils/sourceCodeEditorLoader.ts'),
    'utf8',
  );
  const sourceEditorGraph = `${overlays}\n${editor}\n${warmup}`;

  assert.match(
    overlays,
    /import\s*\{[\s\S]*?SourceCodeEditor[\s\S]*?from '@\/features\/code-editor'/,
  );
  assert.match(editor, /import MonacoEditor from '@monaco-editor\/react'/);
  assert.doesNotMatch(
    sourceEditorGraph,
    /import\s*\(\s*['"](?:@\/features\/code-editor|@monaco-editor\/react|monaco-editor\/)/,
  );
  assert.doesNotMatch(sourceEditorGraph, /source-code-editor-retry/);
});
