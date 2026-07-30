import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSnapshotFileName,
  normalizeSnapshotCaptureOptions,
  normalizeSnapshotAspectRatioPreset,
  normalizeSnapshotPngOptimizeLevel,
  resolveSnapshotAspectRatio,
  resolveSnapshotLongEdgeDimensions,
} from './snapshotConfig.ts';
import type { WorkspaceCameraSnapshot } from '../workspace/workspaceCameraSnapshot';

test('buildSnapshotFileName puts the product name first and sanitizes the robot name', () => {
  assert.equal(
    buildSnapshotFileName('arm:demo', 'jpeg', new Date(2026, 6, 28, 14, 5, 9)),
    'URDF_Studio_arm_demo_20260728_140509.jpg',
  );
});

test('normalizeSnapshotCaptureOptions defaults the export background to studio', () => {
  const options = normalizeSnapshotCaptureOptions();

  assert.equal(options.backgroundStyle, 'studio');
  assert.equal(options.imageQuality, 96);
  assert.equal(options.detailLevel, 'high');
  assert.equal(options.environmentPreset, 'city');
  assert.equal(options.shadowStyle, 'balanced');
  assert.equal(options.groundStyle, 'shadow');
  assert.equal(options.dofMode, 'off');
  assert.equal(options.hideGrid, true);
  assert.equal(options.aspectRatioPreset, 'viewport');
});

test('normalizeSnapshotCaptureOptions keeps transparent backgrounds for alpha-capable formats', () => {
  const options = normalizeSnapshotCaptureOptions({
    imageFormat: 'png',
    backgroundStyle: 'transparent',
  });

  assert.equal(options.backgroundStyle, 'transparent');
});

test('normalizeSnapshotCaptureOptions falls back from transparent backgrounds for jpeg', () => {
  const options = normalizeSnapshotCaptureOptions({
    imageFormat: 'jpeg',
    backgroundStyle: 'transparent',
  });

  assert.equal(options.backgroundStyle, 'studio');
});

test('normalizeSnapshotCaptureOptions ignores requested DOF because snapshot depth of field is disabled', () => {
  const options = normalizeSnapshotCaptureOptions({
    imageFormat: 'png',
    backgroundStyle: 'dark',
    dofMode: 'hero',
  });

  assert.equal(options.backgroundStyle, 'dark');
  assert.equal(options.dofMode, 'off');
});

test('normalizeSnapshotCaptureOptions clamps lossy image quality into the supported range', () => {
  const tooLow = normalizeSnapshotCaptureOptions({
    imageFormat: 'webp',
    imageQuality: 12,
  });
  const tooHigh = normalizeSnapshotCaptureOptions({
    imageFormat: 'jpeg',
    imageQuality: 180,
  });

  assert.equal(tooLow.imageQuality, 60);
  assert.equal(tooHigh.imageQuality, 100);
});

test('normalizeSnapshotCaptureOptions defaults and clamps the PNG optimize level', () => {
  assert.equal(normalizeSnapshotCaptureOptions().pngOptimizeLevel, 2);
  assert.equal(normalizeSnapshotCaptureOptions({ pngOptimizeLevel: 1 }).pngOptimizeLevel, 1);
  // Out-of-range / non-finite values fall back to the default tier.
  assert.equal(normalizeSnapshotCaptureOptions({ pngOptimizeLevel: 6 }).pngOptimizeLevel, 2);
  assert.equal(normalizeSnapshotCaptureOptions({ pngOptimizeLevel: 0 }).pngOptimizeLevel, 2);
});

test('normalizeSnapshotPngOptimizeLevel rounds into the exposed tiers', () => {
  assert.equal(normalizeSnapshotPngOptimizeLevel(undefined), 2);
  assert.equal(normalizeSnapshotPngOptimizeLevel(3), 3);
  assert.equal(normalizeSnapshotPngOptimizeLevel(2.4), 2);
  assert.equal(normalizeSnapshotPngOptimizeLevel(Number.NaN), 2);
  assert.equal(normalizeSnapshotPngOptimizeLevel(99), 2);
});

test('normalizeSnapshotCaptureOptions preserves supported aspect ratio presets', () => {
  assert.equal(
    normalizeSnapshotCaptureOptions({ aspectRatioPreset: '1:1' }).aspectRatioPreset,
    '1:1',
  );
  assert.equal(
    normalizeSnapshotCaptureOptions({ aspectRatioPreset: '9:16' }).aspectRatioPreset,
    '9:16',
  );
  assert.equal(
    normalizeSnapshotCaptureOptions({ aspectRatioPreset: 'bogus' as never }).aspectRatioPreset,
    'viewport',
  );
  assert.equal(normalizeSnapshotAspectRatioPreset(undefined), 'viewport');
});

test('resolveSnapshotAspectRatio maps fixed presets and falls back to the viewport ratio', () => {
  assert.equal(resolveSnapshotAspectRatio('viewport', 1.25), 1.25);
  assert.equal(resolveSnapshotAspectRatio('viewport', 0), 16 / 9);
  assert.equal(resolveSnapshotAspectRatio('4:3', 2), 4 / 3);
  assert.equal(resolveSnapshotAspectRatio('9:16', 2), 9 / 16);
});

test('resolveSnapshotLongEdgeDimensions derives dimensions from a fixed aspect ratio', () => {
  assert.deepEqual(resolveSnapshotLongEdgeDimensions(3840, 16 / 9), {
    width: 3840,
    height: 2160,
  });
  assert.deepEqual(resolveSnapshotLongEdgeDimensions(3840, 9 / 16), {
    width: 2160,
    height: 3840,
  });
  assert.deepEqual(resolveSnapshotLongEdgeDimensions(1920, 1), {
    width: 1920,
    height: 1920,
  });
});

test('normalizeSnapshotCaptureOptions preserves a frozen camera snapshot for export', () => {
  const cameraSnapshot: WorkspaceCameraSnapshot = {
    kind: 'perspective',
    position: { x: 2, y: 3, z: 4 },
    quaternion: { x: 0, y: 0.5, z: 0, w: 0.8660254037844386 },
    up: { x: 0, y: 1, z: 0 },
    zoom: 1.2,
    target: { x: 0.5, y: -0.25, z: 1 },
    aspectRatio: 1.6,
    fov: 50,
    near: 0.1,
    far: 1000,
  };

  const options = normalizeSnapshotCaptureOptions({
    longEdgePx: 3840,
    cameraSnapshot,
  });

  assert.equal(options.longEdgePx, 3840);
  assert.deepEqual(options.cameraSnapshot, cameraSnapshot);
});
