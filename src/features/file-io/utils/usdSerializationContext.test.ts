import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { createUsdBaseMaterial } from './usdMaterialNormalization.ts';
import { collectUsdSerializationContext } from './usdSerializationContext.ts';

const createTriangleGeometry = () => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3),
  );
  return geometry;
};

const createTexturedTriangleGeometry = () => {
  const geometry = createTriangleGeometry();
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1], 2));
  return geometry;
};

const assertColorTupleClose = (
  actual: readonly number[] | undefined,
  expected: readonly number[],
  epsilon = 1e-9,
) => {
  assert.ok(actual, 'expected a color tuple');
  assert.equal(actual.length, expected.length);
  actual.forEach((value, index) => {
    assert.ok(
      Math.abs(value - expected[index]!) <= epsilon,
      `expected color channel ${index} to be ${expected[index]}, received ${value}`,
    );
  });
};

test('collectUsdSerializationContext deduplicates shared geometry and shared material appearances', async () => {
  const geometry = createTriangleGeometry();
  const firstMesh = new THREE.Mesh(geometry, createUsdBaseMaterial('#12ab34'));
  const secondMesh = new THREE.Mesh(geometry, createUsdBaseMaterial('#12ab34'));

  firstMesh.name = 'first';
  secondMesh.name = 'second';

  const root = new THREE.Group();
  root.name = 'demo_robot';
  root.add(firstMesh, secondMesh);

  const context = await collectUsdSerializationContext(root);

  assert.equal(context.materialRecords.length, 1);
  assert.equal(context.geometryRecords.length, 1);
  assert.equal(context.materialByObject.get(firstMesh), context.materialByObject.get(secondMesh));
  assert.equal(context.geometryByObject.get(firstMesh), context.geometryByObject.get(secondMesh));
  assert.equal(context.materialRecords[0]?.path, '/demo_robot/Looks/Material_0');
  assert.equal(context.geometryRecords[0]?.path, '/demo_robot/__MeshLibrary/Geometry_0');
});

test('collectUsdSerializationContext builds texture-aware material records from explicit USD display metadata', async () => {
  const mesh = new THREE.Mesh(createTexturedTriangleGeometry(), createUsdBaseMaterial('#ffffff'));
  mesh.name = 'textured';
  mesh.userData.usdDisplayColor = '#12ab3480';
  mesh.userData.usdMaterial = {
    texture: 'textures/checker.png',
  };

  const root = new THREE.Group();
  root.name = 'demo_robot';
  root.add(mesh);

  const context = await collectUsdSerializationContext(root);
  const materialRecord = context.materialByObject.get(mesh);

  assert.ok(materialRecord, 'expected material record for textured mesh');
  assert.equal(materialRecord?.appearance.texture?.sourcePath, 'textures/checker.png');
  assert.equal(materialRecord?.appearance.texture?.exportPath, 'checker.png');
  assert.equal(materialRecord?.appearance.opacity, 128 / 255);
  assert.equal(materialRecord?.appearance.color.getHexString(), '12ab34');
  assertColorTupleClose(
    materialRecord?.appearance.authoredColor,
    [0.00604883302038607, 0.407240211891531, 0.0343398068028541],
  );
});

test('collectUsdSerializationContext preserves already-authored USD linear colors', async () => {
  const mesh = new THREE.Mesh(createTriangleGeometry(), createUsdBaseMaterial('#ffffff'));
  mesh.name = 'imported_usd_mesh';
  mesh.userData.usdAuthoredColor = [0.2, 0.4, 0.6];
  mesh.userData.usdMaterial = {
    colorRgba: [1, 0, 0, 1],
  };

  const root = new THREE.Group();
  root.name = 'demo_robot';
  root.add(mesh);

  const context = await collectUsdSerializationContext(root);
  const materialRecord = context.materialByObject.get(mesh);

  assertColorTupleClose(materialRecord?.appearance.authoredColor, [0.2, 0.4, 0.6]);
  assertColorTupleClose(materialRecord?.appearance.color.toArray(), [0.2, 0.4, 0.6]);
});

test('collectUsdSerializationContext assigns distinct deterministic paths to colliding texture basenames', async () => {
  const firstMesh = new THREE.Mesh(
    createTexturedTriangleGeometry(),
    createUsdBaseMaterial('#ffffff'),
  );
  firstMesh.userData.usdMaterial = {
    texture: 'pkg_a/textures/coat.png',
  };
  const secondMesh = new THREE.Mesh(
    createTexturedTriangleGeometry(),
    createUsdBaseMaterial('#ffffff'),
  );
  secondMesh.userData.usdMaterial = {
    texture: 'pkg_b/textures/coat.png',
  };

  const root = new THREE.Group();
  root.name = 'demo_robot';
  root.add(firstMesh, secondMesh);

  const context = await collectUsdSerializationContext(root);
  const firstTexture = context.materialByObject.get(firstMesh)?.appearance.texture;
  const secondTexture = context.materialByObject.get(secondMesh)?.appearance.texture;

  assert.equal(context.materialRecords.length, 2);
  assert.deepEqual(
    [firstTexture?.exportPath, secondTexture?.exportPath],
    ['pkg_a/coat.png', 'pkg_b/coat.png'],
  );
  assert.notEqual(firstTexture?.exportPath, secondTexture?.exportPath);
});

test('collectUsdSerializationContext recovers anonymous embedded texture data URLs', async () => {
  const embeddedTextureUrl = 'data:image/png;base64,AAAA';
  const texture = new THREE.Texture();
  texture.image = { src: embeddedTextureUrl };
  const material = new THREE.MeshStandardMaterial({
    color: '#ffffff',
    map: texture,
  });
  const mesh = new THREE.Mesh(createTexturedTriangleGeometry(), material);
  const root = new THREE.Group();
  root.name = 'demo_robot';
  root.add(mesh);

  const context = await collectUsdSerializationContext(root);
  const textureRecord = context.materialByObject.get(mesh)?.appearance.texture;

  assert.equal(textureRecord?.sourcePath, embeddedTextureUrl);
  assert.match(textureRecord?.exportPath ?? '', /^external_[a-f0-9]{8}\.png$/);
});
