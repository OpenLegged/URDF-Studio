import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createUsdAssetRegistry,
  createUsdTextureLoadingManager,
  resolveUsdAssetUrl,
} from './usdAssetRegistry.ts';

test('createUsdAssetRegistry resolves package-prefixed extra mesh files through stable aliases', () => {
  const extraMeshFiles = new Map([
    [
      'package://go2_description/dae/base.dae',
      new Blob(['<dae />'], { type: 'model/vnd.collada+xml' }),
    ],
  ]);

  const { registry, tempObjectUrls } = createUsdAssetRegistry({}, extraMeshFiles);

  assert.equal(tempObjectUrls.length, 1);

  const [objectUrl] = tempObjectUrls;
  assert.match(objectUrl, /^blob:/);
  assert.equal(resolveUsdAssetUrl('package://go2_description/dae/base.dae', registry), objectUrl);
  assert.equal(resolveUsdAssetUrl('dae/base.dae', registry), objectUrl);
  assert.equal(resolveUsdAssetUrl('base.dae', registry), objectUrl);

  URL.revokeObjectURL(objectUrl);
});

test('resolveUsdAssetUrl matches texture assets case-insensitively and preserves direct URLs', () => {
  const dataUrl = 'data:image/png;base64,AAAA';
  const { registry } = createUsdAssetRegistry({
    'Textures/Checker.PNG': dataUrl,
  });

  assert.equal(resolveUsdAssetUrl('textures/checker.png', registry), dataUrl);
  assert.equal(resolveUsdAssetUrl('checker.png', registry), dataUrl);
  assert.equal(resolveUsdAssetUrl('blob:temporary-asset', registry), 'blob:temporary-asset');
  assert.equal(
    resolveUsdAssetUrl('https://example.com/assets/checker.png', registry),
    'https://example.com/assets/checker.png',
  );
});

test('createUsdAssetRegistry does not let image aliases replace same-stem mesh assets', () => {
  const meshUrl = 'data:model/vnd.collada+xml;base64,PGNvbGxhZGEgLz4=';
  const textureUrl = 'data:image/png;base64,AAAA';
  const { registry } = createUsdAssetRegistry({
    'meshes/wing.dae': meshUrl,
    'textures/wing.png': textureUrl,
  });

  assert.equal(resolveUsdAssetUrl('meshes/wing.dae', registry), meshUrl);
  assert.equal(resolveUsdAssetUrl('textures/wing.png', registry), textureUrl);

  const { registry: textureOnlyRegistry } = createUsdAssetRegistry({
    'textures/sole.png': textureUrl,
  });
  assert.equal(resolveUsdAssetUrl('meshes/sole.dae', textureOnlyRegistry), null);

  const { registry: meshOnlyRegistry } = createUsdAssetRegistry({
    'meshes/sole.dae': meshUrl,
  });
  assert.equal(resolveUsdAssetUrl('textures/sole.png', meshOnlyRegistry), null);
});

test('createUsdAssetRegistry keeps KTX2 textures isolated from same-stem mesh aliases', () => {
  const meshUrl = 'data:model/vnd.collada+xml;base64,PGNvbGxhZGEgLz4=';
  const textureUrl = 'data:image/ktx2;base64,S1RYMg==';
  const { registry } = createUsdAssetRegistry({
    'meshes/shell.dae': meshUrl,
    'textures/shell.ktx2': textureUrl,
  });

  assert.equal(resolveUsdAssetUrl('meshes/shell.dae', registry), meshUrl);
  assert.equal(resolveUsdAssetUrl('../textures/shell.ktx2', registry), textureUrl);
});

test('createUsdTextureLoadingManager rewrites mapped URLs and leaves unknown URLs untouched', () => {
  const dataUrl = 'data:image/png;base64,BBBB';
  const { registry } = createUsdAssetRegistry({
    'textures/checker.png': dataUrl,
  });

  const manager = createUsdTextureLoadingManager(registry);

  assert.equal(manager.resolveURL('textures/checker.png'), dataUrl);
  assert.equal(manager.resolveURL('missing.png'), 'missing.png');
});

test('createUsdTextureLoadingManager remaps GLTF blob-relative sidecar assets', () => {
  const { registry, tempObjectUrls } = createUsdAssetRegistry(
    {},
    new Map([
      ['meshes/visual/link0.gltf', new Blob(['{}'], { type: 'model/gltf+json' })],
      [
        'meshes/visual/link0.bin',
        new Blob([new Uint8Array([0, 1, 2, 3])], { type: 'application/octet-stream' }),
      ],
      [
        'meshes/visual/link0_color.ktx2',
        new Blob([new Uint8Array([0xab, 0x4b, 0x54, 0x58])], { type: 'image/ktx2' }),
      ],
    ]),
  );
  const manager = createUsdTextureLoadingManager(registry);

  const meshUrl = resolveUsdAssetUrl('meshes/visual/link0.gltf', registry);
  const bufferUrl = resolveUsdAssetUrl('meshes/visual/link0.bin', registry);
  const textureUrl = resolveUsdAssetUrl('meshes/visual/link0_color.ktx2', registry);

  assert.ok(meshUrl);
  assert.ok(bufferUrl);
  assert.ok(textureUrl);
  assert.equal(manager.resolveURL(meshUrl), meshUrl);
  assert.equal(manager.resolveURL('blob:http://127.0.0.1:4173/link0.bin'), bufferUrl);
  assert.equal(
    manager.resolveURL('blob:http://127.0.0.1:4173/link0_color.ktx2'),
    textureUrl,
  );

  tempObjectUrls.forEach((url) => URL.revokeObjectURL(url));
});
