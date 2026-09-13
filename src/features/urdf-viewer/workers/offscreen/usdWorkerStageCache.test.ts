import test from 'node:test';
import assert from 'node:assert/strict';
import { createUsdWorkerStageCache } from './usdWorkerStageCache.ts';
import type { PreparedUsdStageOpenData } from '@/lib/robot-parser/usd/usdStageOpenPreparation';

const sourceFile = { name: 'robot.usda', content: '#usda 1.0', format: 'usd' as const };
const prepared: PreparedUsdStageOpenData = {
  stageSourcePath: '/robot.usda',
  preloadFiles: [],
  criticalDependencyPaths: [],
};

test('stage-open context and prepared hit state survive later loads until worker disposal', async () => {
  let cleared = 0;
  const owner = createUsdWorkerStageCache({
    loadPrepared: async () => prepared,
    clearPrepared: () => {
      cleared += 1;
    },
  });
  const first = owner.prepare({
    sourceFile,
    stageOpenContextKey: 'context',
    stageOpenContext: {
      availableFiles: [],
      assets: {},
    },
  });
  assert.equal(first.cacheHit, false);
  assert.equal(await first.load(), prepared);
  const second = owner.prepare({ sourceFile, stageOpenContextKey: 'context' });
  assert.equal(second.context.source, 'worker-cache');
  assert.equal(second.cacheHit, true);
  assert.equal(cleared, 0);
  owner.dispose();
  assert.equal(cleared, 1);
  assert.throws(
    () => owner.prepare({ sourceFile, stageOpenContextKey: 'context' }),
    /missing cached/,
  );
});

test('failed preparation stays retryable and does not publish a prepared cache hit', async () => {
  let attempts = 0;
  const owner = createUsdWorkerStageCache({
    loadPrepared: async () => {
      if (++attempts === 1) throw new Error('invalid source');
      return prepared;
    },
    clearPrepared: () => {},
  });
  await assert.rejects(owner.prepare({ sourceFile }).load(), /invalid source/);
  const retry = owner.prepare({ sourceFile });
  assert.equal(retry.cacheHit, false);
  await retry.load();
  assert.equal(owner.prepare({ sourceFile }).cacheHit, true);
});
