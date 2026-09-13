import assert from 'node:assert/strict';
import test from 'node:test';

import { determineCriticalDeferredAssetNames } from './criticalDeferredAssets.ts';

test('opaque USD packages hydrate runtime textures and MDL modules inside their bundle', () => {
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
      { name: 'packages/demo/materials/Templates/GlassWithVolume.MDL' },
      { name: 'packages/other/materials/OmniPBR.mdl' },
      { name: 'packages/other/textures/albedo.png' },
    ],
    [],
    {},
  );

  assert.deepEqual(Array.from(criticalNames).sort(), [
    'packages/demo/materials/OmniPBR.mdl',
    'packages/demo/materials/Templates/GlassWithVolume.MDL',
    'packages/demo/textures/albedo.png',
    'packages/demo/textures/normal.exr',
  ]);
});


test('USD MDL dependencies stay critical when an existing robot material already needs a texture', () => {
  const criticalNames = determineCriticalDeferredAssetNames(
    { name: 'demo/scene.usd', content: '', format: 'usd' },
    {
      status: 'ready', format: 'usd', resolvedUrdfContent: null, resolvedUrdfSourceFilePath: null,
      robotData: {
        name: 'demo', rootLinkId: 'root', links: {}, joints: {},
        materials: { surface: { texture: 'demo/albedo.png', color: '#ffffff' } },
      },
    },
    [{ name: 'demo/albedo.png' }, { name: 'demo/Surface.mdl' }],
    [], {},
  );
  assert.deepEqual([...criticalNames].sort(), ['demo/Surface.mdl', 'demo/albedo.png']);
});
