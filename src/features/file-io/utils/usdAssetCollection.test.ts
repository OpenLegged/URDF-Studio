import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { createUsdBaseMaterial } from './usdMaterialNormalization.ts';
import { collectUsdSerializationContext } from './usdSerializationContext.ts';
import { applyUsdMaterialMetadata } from './usdSceneSerialization.ts';
import { collectUsdExportAssetFiles } from './usdAssetCollection.ts';
import { createUsdAssetRegistry } from './usdAssetRegistry.ts';

const TEXTURE_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFAAH/e+m+7wAAAABJRU5ErkJggg==';

const createTexturedTriangleGeometry = () => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3),
  );
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1], 2));
  return geometry;
};

test('collectUsdExportAssetFiles deduplicates texture assets and reports assets-phase progress', async () => {
  const root = new THREE.Group();
  root.name = 'demo_robot';

  const mesh = new THREE.Mesh(createTexturedTriangleGeometry(), createUsdBaseMaterial('#ffffff'));
  mesh.name = 'mesh';
  mesh.userData.usdDisplayColor = '#ffffff';
  applyUsdMaterialMetadata(mesh, { texture: 'textures/checker.png' });

  const primitive = new THREE.Object3D();
  primitive.name = 'box';
  primitive.userData.usdGeomType = 'Cube';
  applyUsdMaterialMetadata(primitive, { texture: 'textures/checker.png' });

  root.add(mesh, primitive);

  const context = await collectUsdSerializationContext(root, {
    rootPrimName: 'demo_robot',
  });
  const { registry } = createUsdAssetRegistry({
    'textures/checker.png': TEXTURE_DATA_URL,
  });

  const progressEvents: Array<{ phase: string; completed: number; total: number; label?: string }> =
    [];
  const assets = await collectUsdExportAssetFiles({
    sceneRoot: root,
    context,
    registry,
    onProgress: (progress) => {
      progressEvents.push({ ...progress });
    },
  });

  assert.deepEqual(Array.from(assets.keys()), ['assets/checker.png']);
  assert.equal(assets.get('assets/checker.png')?.type, 'image/png');
  assert.deepEqual(
    progressEvents.map((event) => [event.phase, event.completed, event.total, event.label ?? null]),
    [
      ['assets', 0, 1, null],
      ['assets', 1, 1, 'checker.png'],
    ],
  );
});

test('collectUsdExportAssetFiles keeps asset collection complete and progress monotonic when fetchConcurrency is greater than one', async () => {
  const root = new THREE.Group();
  root.name = 'demo_robot';

  const firstMesh = new THREE.Mesh(
    createTexturedTriangleGeometry(),
    createUsdBaseMaterial('#ffffff'),
  );
  firstMesh.name = 'first_mesh';
  firstMesh.userData.usdDisplayColor = '#ffffff';
  applyUsdMaterialMetadata(firstMesh, { texture: 'textures/a.png' });

  const secondMesh = new THREE.Mesh(
    createTexturedTriangleGeometry(),
    createUsdBaseMaterial('#ffffff'),
  );
  secondMesh.name = 'second_mesh';
  secondMesh.userData.usdDisplayColor = '#ffffff';
  applyUsdMaterialMetadata(secondMesh, { texture: 'textures/b.png' });

  const primitive = new THREE.Object3D();
  primitive.name = 'box';
  primitive.userData.usdGeomType = 'Cube';
  primitive.userData.usdDisplayColor = '#ffffff';
  applyUsdMaterialMetadata(primitive, { texture: 'textures/c.png' });

  root.add(firstMesh, secondMesh, primitive);

  const context = await collectUsdSerializationContext(root, {
    rootPrimName: 'demo_robot',
  });
  const { registry } = createUsdAssetRegistry({
    'textures/a.png': 'https://example.test/assets/a.png',
    'textures/b.png': 'https://example.test/assets/b.png',
    'textures/c.png': 'https://example.test/assets/c.png',
  });
  const originalFetch = globalThis.fetch;
  const progressEvents: Array<{ phase: string; completed: number; total: number; label?: string }> =
    [];
  let activeFetches = 0;
  let maxConcurrentFetches = 0;
  const responseBodies = new Map<string, string>([
    ['https://example.test/assets/a.png', 'asset-a'],
    ['https://example.test/assets/b.png', 'asset-b'],
    ['https://example.test/assets/c.png', 'asset-c'],
  ]);
  const responseDelays = new Map<string, number>([
    ['https://example.test/assets/a.png', 40],
    ['https://example.test/assets/b.png', 5],
    ['https://example.test/assets/c.png', 25],
  ]);

  globalThis.fetch = (async (input: string | URL | Request) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

    activeFetches += 1;
    maxConcurrentFetches = Math.max(maxConcurrentFetches, activeFetches);

    try {
      await new Promise((resolve) => setTimeout(resolve, responseDelays.get(url) ?? 0));
      const body = responseBodies.get(url);
      assert.ok(body, `unexpected fetch URL: ${url}`);

      return new Response(body, {
        status: 200,
        headers: { 'Content-Type': 'image/png' },
      });
    } finally {
      activeFetches -= 1;
    }
  }) as typeof fetch;

  try {
    const assets = await collectUsdExportAssetFiles({
      sceneRoot: root,
      context,
      registry,
      onProgress: (progress) => {
        progressEvents.push({ ...progress });
      },
      fetchConcurrency: 2,
    } as Parameters<typeof collectUsdExportAssetFiles>[0]);

    assert.ok(maxConcurrentFetches >= 2, 'expected asset fetches to overlap when concurrency > 1');
    assert.deepEqual(Array.from(assets.keys()).sort(), [
      'assets/a.png',
      'assets/b.png',
      'assets/c.png',
    ]);
    const assetPaths = ['assets/a.png', 'assets/b.png', 'assets/c.png'] as const;
    const assetTypes = assetPaths.map((path) => assets.get(path)?.type ?? null);
    const assetBodies = await Promise.all(
      assetPaths.map(async (path) => await assets.get(path)!.text()),
    );

    assert.deepEqual(assetTypes, ['image/png', 'image/png', 'image/png']);
    assert.deepEqual(assetBodies, ['asset-a', 'asset-b', 'asset-c']);
    assert.equal(progressEvents[0]?.completed, 0);
    assert.equal(progressEvents[0]?.total, 3);
    assert.equal(progressEvents.at(-1)?.completed, 3);
    assert.equal(progressEvents.at(-1)?.total, 3);

    for (let index = 1; index < progressEvents.length; index += 1) {
      assert.ok(
        progressEvents[index]!.completed >= progressEvents[index - 1]!.completed,
        'progress.completed must be monotonic even when fetches resolve out of order',
      );
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('collectUsdExportAssetFiles rejects when a required texture asset is missing', async () => {
  const root = new THREE.Group();
  root.name = 'demo_robot';

  const mesh = new THREE.Mesh(createTexturedTriangleGeometry(), createUsdBaseMaterial('#ffffff'));
  mesh.name = 'mesh';
  mesh.userData.usdDisplayColor = '#ffffff';
  applyUsdMaterialMetadata(mesh, { texture: 'textures/missing.png' });
  root.add(mesh);

  const context = await collectUsdSerializationContext(root, {
    rootPrimName: 'demo_robot',
  });
  const { registry } = createUsdAssetRegistry({});

  await assert.rejects(
    collectUsdExportAssetFiles({
      sceneRoot: root,
      context,
      registry,
    }),
    /Texture asset not found for: textures\/missing\.png/,
  );
});

test('collectUsdExportAssetFiles preserves distinct same-basename textures', async () => {
  const firstMesh = new THREE.Mesh(
    createTexturedTriangleGeometry(),
    createUsdBaseMaterial('#ffffff'),
  );
  applyUsdMaterialMetadata(firstMesh, { texture: 'pkg_a/textures/coat.png' });
  const secondMesh = new THREE.Mesh(
    createTexturedTriangleGeometry(),
    createUsdBaseMaterial('#ffffff'),
  );
  applyUsdMaterialMetadata(secondMesh, { texture: 'pkg_b/textures/coat.png' });

  const root = new THREE.Group();
  root.name = 'demo_robot';
  root.add(firstMesh, secondMesh);

  const context = await collectUsdSerializationContext(root);
  const { registry } = createUsdAssetRegistry({
    'pkg_a/textures/coat.png': 'data:image/png;base64,QQ==',
    'pkg_b/textures/coat.png': 'data:image/png;base64,Qg==',
  });
  const assets = await collectUsdExportAssetFiles({
    sceneRoot: root,
    context,
    registry,
  });

  assert.deepEqual(Array.from(assets.keys()).sort(), [
    'assets/pkg_a/coat.png',
    'assets/pkg_b/coat.png',
  ]);
  assert.equal(await assets.get('assets/pkg_a/coat.png')?.text(), 'A');
  assert.equal(await assets.get('assets/pkg_b/coat.png')?.text(), 'B');
});

test('collectUsdExportAssetFiles preserves KTX2 texture payloads and extensions', async () => {
  const mesh = new THREE.Mesh(createTexturedTriangleGeometry(), createUsdBaseMaterial('#ffffff'));
  applyUsdMaterialMetadata(mesh, { texture: 'textures/shell.ktx2' });

  const root = new THREE.Group();
  root.name = 'demo_robot';
  root.add(mesh);

  const context = await collectUsdSerializationContext(root);
  const { registry } = createUsdAssetRegistry({
    'textures/shell.ktx2': 'data:image/ktx2;base64,S1RYMg==',
  });
  const assets = await collectUsdExportAssetFiles({
    sceneRoot: root,
    context,
    registry,
  });

  assert.deepEqual(Array.from(assets.keys()), ['assets/shell.ktx2']);
  assert.equal(await assets.get('assets/shell.ktx2')?.text(), 'KTX2');
});

test('collectUsdExportAssetFiles packages anonymous embedded texture data URLs', async () => {
  const texture = new THREE.Texture();
  texture.image = { src: TEXTURE_DATA_URL };
  const material = new THREE.MeshStandardMaterial({
    color: '#ffffff',
    map: texture,
  });
  const mesh = new THREE.Mesh(createTexturedTriangleGeometry(), material);
  const root = new THREE.Group();
  root.name = 'demo_robot';
  root.add(mesh);

  const context = await collectUsdSerializationContext(root);
  const { registry } = createUsdAssetRegistry({});
  const assets = await collectUsdExportAssetFiles({
    sceneRoot: root,
    context,
    registry,
  });
  const [assetPath] = Array.from(assets.keys());

  assert.match(assetPath ?? '', /^assets\/external_[a-f0-9]{8}\.png$/);
  assert.equal(assets.get(assetPath)?.type, 'image/png');
});
