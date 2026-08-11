import test from 'node:test';
import assert from 'node:assert/strict';

import type { UsdOffscreenViewerWorkerResponse } from '@/features/editor/usd_hydration';
import { getUsdStageLoadDebugHistoryForFile } from '@/shared/debug/usdStageLoadDebug.ts';
import { handleUsdHydrationWorkerEvent } from './usdHydrationWorkerEvents.ts';

test('handleUsdHydrationWorkerEvent records worker load-debug entries', () => {
  const previousWindow = globalThis.window;
  const targetWindow = {
    location: {
      search: '?regressionDebug=1',
    },
  } as Window;
  Object.defineProperty(globalThis, 'window', {
    value: targetWindow,
    configurable: true,
  });

  try {
    handleUsdHydrationWorkerEvent({
      type: 'load-debug',
      entry: {
        sourceFileName: 'robots/go2/go2.usda',
        step: 'load-usd-stage',
        status: 'resolved',
        timestamp: 1234,
        durationMs: 567,
        detail: {
          rendererMode: 'offscreen-worker',
          stageSourcePath: '/robots/go2/go2.usda',
        },
      },
    } satisfies UsdOffscreenViewerWorkerResponse);

    assert.deepEqual(getUsdStageLoadDebugHistoryForFile(targetWindow, 'robots/go2/go2.usda'), [
      {
        sourceFileName: 'robots/go2/go2.usda',
        step: 'load-usd-stage',
        status: 'resolved',
        timestamp: 1234,
        durationMs: 567,
        detail: {
          rendererMode: 'offscreen-worker',
          stageSourcePath: '/robots/go2/go2.usda',
        },
      },
    ]);
  } finally {
    if (previousWindow === undefined) {
      delete (globalThis as { window?: Window }).window;
    } else {
      Object.defineProperty(globalThis, 'window', {
        value: previousWindow,
        configurable: true,
      });
    }
  }
});

test('handleUsdHydrationWorkerEvent forwards document-load events to the provided callback', () => {
  const committedEvents: unknown[] = [];

  handleUsdHydrationWorkerEvent(
    {
      type: 'document-load',
      sessionId: 1,
      event: {
        status: 'loading',
        phase: 'checking-path',
        message: null,
        progressMode: 'indeterminate',
        progressPercent: null,
        loadedCount: null,
        totalCount: null,
      },
    } satisfies UsdOffscreenViewerWorkerResponse,
    {
      commitHydrationLoadEvent: (event) => {
        committedEvents.push(event);
      },
    },
  );

  assert.equal(committedEvents.length, 1);
});
