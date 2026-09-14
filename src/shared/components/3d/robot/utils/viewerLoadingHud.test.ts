import assert from 'node:assert/strict';
import test from 'node:test';

import { buildViewerLoadingHudState } from './viewerLoadingHud';

test('buildViewerLoadingHudState prefers normalized resource counts when available', () => {
  assert.deepEqual(
    buildViewerLoadingHudState({
      loadedCount: 3,
      totalCount: 8,
      fallbackDetail: 'Preparing scene…',
    }),
    {
      detail: '3 / 8',
      progress: 0.375,
      progressMode: 'count',
      statusLabel: '3 / 8',
    },
  );
});

test('buildViewerLoadingHudState falls back to a clamped percent when resource counts are unavailable', () => {
  assert.deepEqual(
    buildViewerLoadingHudState({
      phase: 'ready',
      progressMode: 'percent',
      progressPercent: 160,
      fallbackDetail: 'Preparing scene…',
    }),
    {
      detail: '100%',
      progress: 1,
      progressMode: 'percent',
      statusLabel: '100%',
    },
  );
});

test('buildViewerLoadingHudState keeps the fallback detail when no determinate progress is available', () => {
  assert.deepEqual(
    buildViewerLoadingHudState({
      phase: 'preparing-scene',
      progressMode: 'indeterminate',
      loadedCount: 0,
      totalCount: 0,
      fallbackDetail: 'Preparing scene…',
    }),
    {
      detail: 'Preparing scene…',
      progress: null,
      progressMode: 'indeterminate',
      statusLabel: null,
    },
  );
});
