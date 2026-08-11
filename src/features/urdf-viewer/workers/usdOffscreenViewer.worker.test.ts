import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const workerSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'usdOffscreenViewer.worker.ts'),
  'utf8',
);

test('USD offscreen worker keeps a newer stage when an older generation finishes later', () => {
  const loadCommitStart = workerSource.indexOf('loadedStageGlobals = {');
  const staleCheckStart = workerSource.indexOf(
    'if (!isLoadGenerationActive(loadGeneration)) {',
    loadCommitStart,
  );
  const staleCheckEnd = workerSource.indexOf('if (!loadState?.driver)', staleCheckStart);
  const commitStart = workerSource.indexOf('commitCurrentWorkerStageGlobals(loadState.driver);');
  const catchStart = workerSource.indexOf('} catch (error) {', commitStart);
  const catchStaleCheckStart = workerSource.indexOf(
    'if (!isLoadGenerationActive(loadGeneration)) {',
    catchStart,
  );
  const catchDisposeStart = workerSource.indexOf('disposeStageResources();', catchStaleCheckStart);

  assert.ok(loadCommitStart > 0, 'the worker must capture load-owned globals after loadUsdStage');
  assert.ok(staleCheckStart > loadCommitStart, 'stale generation must be checked after capture');
  assert.ok(commitStart > staleCheckEnd, 'global commit must happen only after stale generation check');

  const staleBlock = workerSource.slice(loadCommitStart, staleCheckEnd);
  assert.match(staleBlock, /driver:\s*loadState\?\.driver/, 'stale cleanup must own loadState.driver');
  assert.match(staleBlock, /disposeAbandonedWorkerStageGlobals/, 'stale load must clean local resources');
  assert.match(staleBlock, /restoreCommittedWorkerStageGlobals/, 'stale load must restore the active stage');
  assert.doesNotMatch(
    staleBlock,
    /disposeStageResources/,
    'stale load must not dispose the active stage resources',
  );

  assert.ok(
    catchStaleCheckStart > catchStart && catchDisposeStart > catchStaleCheckStart,
    'catch path must reject stale generations before global stage disposal',
  );
});
