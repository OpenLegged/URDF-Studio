import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { applyVisualMaterialOverrideToObject } from './visualMaterialOverrides';
import type { UsdSceneMaterialRecord } from '@/types/usdMaterial';

// Real-entry regression for the sourceColorSpace=auto grayscale fix: the
// native driver records `resolvedColorSpace: 'raw'` for single-channel
// grayscale base-color maps, and the runtime must show them linear without
// mutating the shared cache texture other materials still hold.
//
// These cases run against `applyVisualMaterialOverrideToObject` with the
// texture already in the shared cache — the same path production robot loads
// take (buildRuntimeRobotFromState passes visualMaterialOverrideCache and
// textureCache here) — so a green result means the color space actually
// reaches `material.map`, not just the resolve() helper.

interface Fixture {
  textureCache: Map<string, THREE.Texture>;
  object: THREE.Mesh;
  initialMaterial: THREE.MeshStandardMaterial;
  assignedTextures: Set<THREE.Texture>;
}

function createFixture(cacheEntries: Array<[string, THREE.Texture]>): Fixture {
  const textureCache = new Map<string, THREE.Texture>(cacheEntries);
  // Mirrors the production loader default for color slots: the cache holds
  // SRGB textures before any per-slot metadata is considered.
  const initialMaterial = new THREE.MeshStandardMaterial({ color: '#ffffff' });
  const object = new THREE.Mesh(new THREE.BufferGeometry(), initialMaterial);
  return { textureCache, object, initialMaterial, assignedTextures: new Set() };
}

// material.dispose() does not dispose its textures, so every texture the
// override assigned plus the cache entries go through one merged set; the
// initial material is disposed too because the override replaces it in place
// without releasing it.
function disposeFixture(fixture: Fixture): void {
  fixture.object.geometry.dispose();
  fixture.initialMaterial.dispose();
  const material = fixture.object.material;
  if (material !== fixture.initialMaterial) {
    if (Array.isArray(material)) {
      material.forEach((entry) => entry.dispose());
    } else {
      material.dispose();
    }
  }
  const textures = new Set<THREE.Texture>([
    ...fixture.assignedTextures,
    ...fixture.textureCache.values(),
  ]);
  textures.forEach((texture) => texture.dispose());
}

function applyMapSlotOverride(
  fixture: Fixture,
  material: UsdSceneMaterialRecord,
): THREE.MeshStandardMaterial {
  applyVisualMaterialOverrideToObject(
    fixture.object,
    { usdMaterial: material },
    undefined,
    undefined,
    fixture.textureCache,
  );
  const applied = fixture.object.material;
  assert.ok(applied instanceof THREE.MeshStandardMaterial);
  if (applied.map) {
    fixture.assignedTextures.add(applied.map);
  }
  return applied;
}

test('resolvedColorSpace raw assigns a linear clone of the cached map texture', (t) => {
  const cachedTexture = new THREE.Texture();
  cachedTexture.colorSpace = THREE.SRGBColorSpace;
  const fixture = createFixture([['img/grayscale.png', cachedTexture]]);
  t.after(() => disposeFixture(fixture));

  const applied = applyMapSlotOverride(fixture, {
    materialId: '/materials/mat_gray',
    mapPath: 'img/grayscale.png',
    textureInputs: { mapPath: { resolvedColorSpace: 'raw' } },
  });

  const map = applied.map;
  assert.ok(map, 'the override must assign the cached texture to material.map');
  assert.equal(map.colorSpace, THREE.LinearSRGBColorSpace);
  assert.notEqual(map, cachedTexture, 'the linear slot must not point at the shared cache instance');
  assert.equal(cachedTexture.colorSpace, THREE.SRGBColorSpace, 'the shared cache texture must stay untouched');
});

test('authored sourceColorSpace wins over resolvedColorSpace', (t) => {
  const cachedTexture = new THREE.Texture();
  cachedTexture.colorSpace = THREE.SRGBColorSpace;
  const fixture = createFixture([['img/both.png', cachedTexture]]);
  t.after(() => disposeFixture(fixture));

  const applied = applyMapSlotOverride(fixture, {
    materialId: '/materials/mat_authored',
    mapPath: 'img/both.png',
    textureInputs: { mapPath: { sourceColorSpace: 'sRGB', resolvedColorSpace: 'raw' } },
  });

  assert.ok(applied.map);
  assert.equal(applied.map.colorSpace, THREE.SRGBColorSpace);
  assert.notEqual(applied.map, cachedTexture);
  assert.equal(cachedTexture.colorSpace, THREE.SRGBColorSpace);
});

test('resolvedColorSpace srgb keeps sharing the cache texture without clone', (t) => {
  const cachedTexture = new THREE.Texture();
  cachedTexture.colorSpace = THREE.SRGBColorSpace;
  const fixture = createFixture([['img/color.png', cachedTexture]]);
  t.after(() => disposeFixture(fixture));

  const applied = applyMapSlotOverride(fixture, {
    materialId: '/materials/mat_color',
    mapPath: 'img/color.png',
    textureInputs: { mapPath: { resolvedColorSpace: 'srgb' } },
  });

  assert.ok(applied.map);
  // srgb matches the loader default, so no clone and no colorSpace write:
  // the dominant 8-bit RGB/RGBA corpus must not regress to per-material clones.
  assert.equal(applied.map, cachedTexture);
  assert.equal(cachedTexture.colorSpace, THREE.SRGBColorSpace);
});
