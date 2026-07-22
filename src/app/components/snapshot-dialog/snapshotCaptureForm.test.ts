import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_SNAPSHOT_CAPTURE_OPTIONS } from '@/shared/components/3d/scene/snapshotConfig.ts';
import {
  createDefaultSnapshotCaptureOptions,
  resolveSnapshotCompressionControlValue,
  updateSnapshotCaptureOptions,
} from './snapshotCaptureForm.ts';

test('snapshot capture form creates an isolated default options value', () => {
  const first = createDefaultSnapshotCaptureOptions();
  const second = createDefaultSnapshotCaptureOptions();

  assert.deepEqual(first, DEFAULT_SNAPSHOT_CAPTURE_OPTIONS);
  assert.notEqual(first, second);
});

test('switching a transparent snapshot to jpeg restores an opaque background', () => {
  const next = updateSnapshotCaptureOptions(
    {
      ...createDefaultSnapshotCaptureOptions(),
      backgroundStyle: 'transparent',
    },
    { imageFormat: 'jpeg' },
  );

  assert.equal(next.imageFormat, 'jpeg');
  assert.equal(next.backgroundStyle, DEFAULT_SNAPSHOT_CAPTURE_OPTIONS.backgroundStyle);
});

test('snapshot compression control selects quality tiers for lossy formats and effort for png', () => {
  assert.equal(
    resolveSnapshotCompressionControlValue({
      ...createDefaultSnapshotCaptureOptions(),
      imageFormat: 'webp',
      imageQuality: 75,
    }),
    80,
  );
  assert.equal(
    resolveSnapshotCompressionControlValue({
      ...createDefaultSnapshotCaptureOptions(),
      imageFormat: 'png',
      pngOptimizeLevel: 3,
    }),
    3,
  );
});
