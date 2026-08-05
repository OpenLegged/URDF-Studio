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

test('source editor chunk is warmed up instead of fetched on user interaction', () => {
  const overlays = readFileSync(
    path.join(repoRoot, 'src/app/components/AppLayoutOverlays.tsx'),
    'utf8',
  );
  const editor = readFileSync(
    path.join(repoRoot, 'src/features/code-editor/components/SourceCodeEditor.tsx'),
    'utf8',
  );
  const loader = readFileSync(
    path.join(repoRoot, 'src/app/utils/sourceCodeEditorLoader.ts'),
    'utf8',
  );
  const appLayout = readFileSync(path.join(repoRoot, 'src/app/AppLayout.tsx'), 'utf8');

  // Monaco is heavy enough to keep out of the entry bundle, so exactly one
  // dynamic boundary is allowed and it must live in the loader.
  assert.match(loader, /import\s*\(\s*['"]@\/features\/code-editor['"]\s*\)/);
  assert.doesNotMatch(
    `${overlays}\n${editor}`,
    /import\s*\(\s*['"](?:@\/features\/code-editor|@monaco-editor\/react|monaco-editor\/)/,
    'only the loader may open a dynamic boundary; a nested one would split the chunk again',
  );

  // The boundary only stays invisible while the chunk is prefetched ahead of
  // the click, so the preload hook and its wiring are part of the contract.
  assert.match(loader, /export const preloadSourceCodeEditorRuntime\b/);
  assert.match(appLayout, /preloadRuntime:\s*preloadSourceCodeEditorRuntime/);

  // Inside the chunk Monaco stays a static import, and the overlay keeps the
  // Suspense boundary that covers the one frame before the chunk resolves.
  assert.match(editor, /import MonacoEditor from '@monaco-editor\/react'/);
  assert.match(overlays, /<Suspense\b/);
  assert.doesNotMatch(`${overlays}\n${editor}\n${loader}`, /source-code-editor-retry/);
});
