import assert from 'node:assert/strict';
import test from 'node:test';

import { determineCriticalDeferredAssetNames } from './criticalDeferredAssets.ts';

test('opaque USD packages hydrate only renderer-supported textures inside their bundle', () => {
  const criticalNames = determineCriticalDeferredAssetNames(
    {
      name: 'packages/demo/usd/scene.usd',
      content: 'PXR-USDC\u0000binary',
      format: 'usd',
    },
    null,
    [
      { name: 'packages/demo/textures/albedo.png' },
      { name: 'packages/demo/textures/normal.exr' },
      { name: 'packages/demo/point_cloud.ply' },
      { name: 'packages/demo/materials/OmniPBR.mdl' },
      { name: 'packages/other/textures/albedo.png' },
    ],
    [],
    {},
  );

  assert.deepEqual(Array.from(criticalNames).sort(), [
    'packages/demo/textures/albedo.png',
    'packages/demo/textures/normal.exr',
  ]);
});
