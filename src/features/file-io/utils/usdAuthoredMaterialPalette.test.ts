import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { createUsdBaseMaterial } from './usdMaterialNormalization.ts';
import {
  __usdAuthoredMaterialPaletteInternals,
  applyUsdAuthoredMaterialPalette,
} from './usdAuthoredMaterialPalette.ts';

const createTriangleGeometry = () => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3),
  );
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

test('applyUsdAuthoredMaterialPalette matches authored materials by normalized source material name', () => {
  const metalMesh = new THREE.Mesh(createTriangleGeometry(), createUsdBaseMaterial('#ffffff'));
  metalMesh.name = 'metal';
  metalMesh.userData.usdSourceMaterialName = '磨砂铝合金.008';

  const rubberMesh = new THREE.Mesh(createTriangleGeometry(), createUsdBaseMaterial('#ffffff'));
  rubberMesh.name = 'rubber';
  rubberMesh.userData.usdSourceMaterialName = '灰色硅胶.009';

  const root = new THREE.Group();
  root.add(metalMesh, rubberMesh);

  applyUsdAuthoredMaterialPalette(root, [
    {
      name: '磨砂铝合金_008-effect',
      color: '#d8d8d8',
      colorRgba: [0.85, 0.85, 0.85, 1],
    },
    {
      name: '灰色硅胶_009-effect',
      color: '#a5ada5',
      colorRgba: [0.6500053, 0.68, 0.6500053, 1],
    },
  ]);

  assertColorTupleClose(
    metalMesh.userData.usdAuthoredColor,
    [0.6920710568590398, 0.6920710568590398, 0.6920710568590398],
  );
  assertColorTupleClose(
    rubberMesh.userData.usdAuthoredColor,
    [0.3800631936621355, 0.4200332886741209, 0.3800631936621355],
  );
  assert.deepEqual(metalMesh.userData.usdMaterial?.colorRgba, [0.85, 0.85, 0.85, 1]);
  assert.deepEqual(rubberMesh.userData.usdMaterial?.colorRgba, [0.6500053, 0.68, 0.6500053, 1]);
});

test('applyUsdAuthoredMaterialPalette falls back to source material index when material names are unavailable', () => {
  const texturedMaterial = createUsdBaseMaterial('#ffffff');
  texturedMaterial.name = 'slot_0';
  texturedMaterial.map = new THREE.Texture();

  const mesh = new THREE.Mesh(createTriangleGeometry(), texturedMaterial);
  mesh.userData.usdSourceMaterialIndex = 1;

  applyUsdAuthoredMaterialPalette(mesh, [
    {
      name: 'base',
      color: '#000000',
      colorRgba: [0, 0, 0, 1],
    },
    {
      name: 'accent',
      color: '#ffffff',
      colorRgba: [1, 1, 1, 1],
      texture: 'textures/accent.png',
    },
  ]);

  assert.equal(mesh.userData.usdMaterial?.texture, 'textures/accent.png');
  assert.deepEqual(mesh.userData.usdAuthoredColor, [1, 1, 1]);
  assert.equal((mesh.material as THREE.MeshStandardMaterial).map, null);
});

test('applyUsdAuthoredMaterialPalette preserves per-slot metadata for multi-material meshes', () => {
  const firstMaterial = createUsdBaseMaterial('#ffffff');
  firstMaterial.name = 'shell';
  const secondMaterial = createUsdBaseMaterial('#ffffff');
  secondMaterial.name = 'logo';

  const geometry = createTriangleGeometry();
  geometry.clearGroups();
  geometry.addGroup(0, 3, 0);
  geometry.addGroup(0, 3, 1);

  const mesh = new THREE.Mesh(geometry, [firstMaterial, secondMaterial]);

  applyUsdAuthoredMaterialPalette(mesh, [
    {
      name: 'shell',
      color: '#000000',
      colorRgba: [0, 0, 0, 1],
    },
    {
      name: 'logo',
      color: '#ffffff',
      colorRgba: [1, 1, 1, 1],
    },
  ]);

  assert.deepEqual(mesh.userData.usdMaterialPalette, [
    {
      materialIndex: 0,
      usdAuthoredColor: [0, 0, 0],
      usdDisplayColor: '#000000',
      usdMaterial: {
        color: '#000000',
        colorRgba: [0, 0, 0, 1],
      },
      usdOpacity: 1,
      usdSourceMaterialName: 'shell',
    },
    {
      materialIndex: 1,
      usdAuthoredColor: [1, 1, 1],
      usdDisplayColor: '#ffffff',
      usdMaterial: {
        color: '#ffffff',
        colorRgba: [1, 1, 1, 1],
      },
      usdOpacity: 1,
      usdSourceMaterialName: 'logo',
    },
  ]);
});

test('normalizeMaterialIdentifier ignores common Collada and URDF material suffixes', () => {
  assert.equal(
    __usdAuthoredMaterialPaletteInternals.normalizeMaterialIdentifier('logo_001-effect'),
    'logo001',
  );
  assert.equal(
    __usdAuthoredMaterialPaletteInternals.normalizeMaterialIdentifier('logo.001-material'),
    'logo001',
  );
});
