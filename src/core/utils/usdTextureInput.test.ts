import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import type { UsdMaterialTextureInput } from '@/types/usdMaterial';
import {
  USD_COLOR_TEXTURE_INPUT_SLOTS,
  applyUsdTextureInputToTexture,
  cloneUsdSlotTexture,
  getUsdTextureInputSlot,
  normalizeUsdTextureInputs,
  resolveUsdTextureColorSpace,
  usdTextureInputHasUvTransform,
  usdTextureInputRequiresSlotState,
} from './usdTextureInput';

// Column-major 3x3 matrix of the native UsdTransform2d composition
// result = in * scale * rotate(degrees, CCW) * translation.
// scale (2,1), rotation 90, translation (0.25, 0.5): the native driver builds
// col0 = [c*s0, s*s0, 0] = [0, 2, 0], col1 = [-s*s1, c*s1, 0] = [-1, 0, 0],
// col2 = [t.x, t.y, 1], i.e. [0, 2, 0, -1, 0, 0, 0.25, 0.5, 1].
const NONUNIFORM_SRT_UV_TRANSFORM = [0, 2, 0, -1, 0, 0, 0.25, 0.5, 1] as const;

function applyMatrixToUv(matrix: THREE.Matrix3, u: number, v: number): [number, number] {
  const vector = new THREE.Vector3(u, v, 1).applyMatrix3(matrix);
  return [vector.x, vector.y];
}

test('applyUsdTextureInputToTexture applies the USD S-R-T order for nonuniform scale plus rotation', () => {
  const texture = new THREE.Texture();
  texture.matrixAutoUpdate = true;

  applyUsdTextureInputToTexture(texture, 'mapPath', {
    uvTransform: NONUNIFORM_SRT_UV_TRANSFORM,
  });

  assert.equal(texture.matrixAutoUpdate, false);
  // in=(0.5, 0.5): scale -> (1.0, 0.5); 90deg CCW rotation -> (-0.5, 1.0);
  // translation -> (-0.25, 1.5). Three.setUvTransform composes in a different
  // order and would disagree here, which is why the explicit matrix is used.
  assert.deepEqual(applyMatrixToUv(texture.matrix, 0.5, 0.5), [-0.25, 1.5]);
  assert.deepEqual(applyMatrixToUv(texture.matrix, 0, 0), [0.25, 0.5]);
});

test('applyUsdTextureInputToTexture resets inherited cache state with an explicit identity matrix', () => {
  const sharedTexture = new THREE.Texture();
  sharedTexture.repeat.set(4, 2);
  sharedTexture.matrixAutoUpdate = true;
  sharedTexture.matrix.setUvTransform(0.1, 0.2, 2, 3, Math.PI / 6, 0.5, 0.5);

  const clone = cloneUsdSlotTexture(sharedTexture, 'mapPath', {
    uvTransform: [1, 0, 0, 0, 1, 0, 0, 0, 1],
  });

  assert.equal(clone.matrixAutoUpdate, false);
  // clone() copies repeat/matrix from the source; an authored identity must
  // override that state instead of being treated as "nothing to do", otherwise
  // unit-scale materials inherit another material's transform.
  assert.deepEqual(clone.matrix.elements, [1, 0, 0, 0, 1, 0, 0, 0, 1]);
  assert.equal(clone.source, sharedTexture.source);
  assert.notEqual(clone, sharedTexture);
});

test('shared image clones keep independent transforms for two materials', () => {
  const sharedTexture = new THREE.Texture();
  const firstClone = cloneUsdSlotTexture(sharedTexture, 'mapPath', {
    uvTransform: NONUNIFORM_SRT_UV_TRANSFORM,
  });
  const secondClone = cloneUsdSlotTexture(sharedTexture, 'mapPath', {
    uvTransform: [4.5, 0, 0, 0, 3, 0, 0, 0, 1],
  });

  assert.deepEqual(applyMatrixToUv(firstClone.matrix, 0.5, 0.5), [-0.25, 1.5]);
  assert.deepEqual(applyMatrixToUv(secondClone.matrix, 0.5, 0.5), [2.25, 1.5]);
  assert.equal(sharedTexture.matrixAutoUpdate, true);
  assert.deepEqual(
    sharedTexture.matrix.elements,
    [1, 0, 0, 0, 1, 0, 0, 0, 1],
  );
});

test('applyUsdTextureInputToTexture maps USD wrap tokens and authored color spaces', () => {
  const texture = new THREE.Texture();
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.colorSpace = THREE.LinearSRGBColorSpace;

  applyUsdTextureInputToTexture(texture, 'mapPath', {
    wrapS: 'repeat',
    wrapT: 'mirroredRepeat',
    sourceColorSpace: 'sRGB',
  });

  assert.equal(texture.wrapS, THREE.RepeatWrapping);
  assert.equal(texture.wrapT, THREE.MirroredRepeatWrapping);
  assert.equal(texture.colorSpace, THREE.SRGBColorSpace);
});

test('resolveUsdTextureColorSpace treats authored tokens as authoritative and keeps data-slot auto unspecified', () => {
  assert.equal(resolveUsdTextureColorSpace('roughnessMapPath', { sourceColorSpace: 'sRGB' }), THREE.SRGBColorSpace);
  assert.equal(resolveUsdTextureColorSpace('mapPath', { sourceColorSpace: 'raw' }), THREE.LinearSRGBColorSpace);
  // Color slots with auto follow the 8-bit RGB/RGBA corpus truth (sRGB).
  assert.equal(resolveUsdTextureColorSpace('mapPath', {}), THREE.SRGBColorSpace);
  assert.equal(resolveUsdTextureColorSpace('emissiveMapPath', null), THREE.SRGBColorSpace);
  // Data slots keep the caller's decode state under auto: USD decides by image
  // metadata, which this helper cannot inspect, so no forced value is returned.
  assert.equal(resolveUsdTextureColorSpace('roughnessMapPath', {}), null);
  assert.equal(resolveUsdTextureColorSpace('normalMapPath', null), null);
  assert.ok(USD_COLOR_TEXTURE_INPUT_SLOTS.has('specularColorMapPath'));
  assert.ok(!USD_COLOR_TEXTURE_INPUT_SLOTS.has('alphaMapPath'));
});

test('normalizeUsdTextureInputs keeps valid slots and drops malformed entries', () => {
  const normalized = normalizeUsdTextureInputs({
    mapPath: {
      uvTransform: [0, 1, 0, -1, 0, 0, 0.25, 0.5, 1],
      uvPrimvar: 'st',
      wrapS: 'repeat',
      wrapT: 'black',
    },
    roughnessMapPath: { uvTransform: [1, 0, 0, 0, 1, 0, 0, 0, 1] },
    normalMapPath: { uvTransform: [1, 'x', 0, 0, 1, 0, 0, 0, 1] },
    emissiveMapPath: { uvPrimvar: '  ' },
    bogusSlot: { uvPrimvar: 'st' },
  });

  assert.deepEqual(Object.keys(normalized ?? {}), ['mapPath', 'roughnessMapPath']);
  assert.equal(normalized?.mapPath?.uvPrimvar, 'st');
  assert.equal(normalized?.mapPath?.wrapT, 'black');
  assert.ok(usdTextureInputHasUvTransform(normalized?.roughnessMapPath));
  assert.equal(getUsdTextureInputSlot(normalized, 'normalMapPath'), null);
  assert.equal(normalizeUsdTextureInputs(null), null);
  assert.equal(normalizeUsdTextureInputs({}), null);
  assert.equal(normalizeUsdTextureInputs([1, 2]), null);
});

test('resolveUsdTextureColorSpace classifies auto color slots by the native resolved hint', () => {
  // The native driver resolves sourceColorSpace=auto from the image header
  // (gamma hint, channel count, bit depth) and records the outcome. A
  // single-channel 8-bit grayscale base-color map resolves to raw (linear),
  // matching Hio_StbImage::IsColorSpaceSRGB for auto inputs.
  assert.equal(
    resolveUsdTextureColorSpace('mapPath', { sourceColorSpace: 'auto', resolvedColorSpace: 'raw' }),
    THREE.LinearSRGBColorSpace,
  );
  assert.equal(
    resolveUsdTextureColorSpace('emissiveMapPath', { sourceColorSpace: 'auto', resolvedColorSpace: 'srgb' }),
    THREE.SRGBColorSpace,
  );
  // Authored tokens stay authoritative over the resolved hint.
  assert.equal(
    resolveUsdTextureColorSpace('mapPath', { sourceColorSpace: 'raw', resolvedColorSpace: 'srgb' }),
    THREE.LinearSRGBColorSpace,
  );
  assert.equal(
    resolveUsdTextureColorSpace('mapPath', { sourceColorSpace: 'sRGB', resolvedColorSpace: 'raw' }),
    THREE.SRGBColorSpace,
  );
});

test('resolveUsdTextureColorSpace keeps the sRGB fallback when auto carries no resolved hint', () => {
  // Unresolvable headers (ICC/EXIF/palette images) record no resolved value;
  // the established 8-bit RGB/RGBA corpus fallback must not regress.
  assert.equal(resolveUsdTextureColorSpace('mapPath', { sourceColorSpace: 'auto' }), THREE.SRGBColorSpace);
  // Unknown resolved values are ignored rather than guessed. The odd hint
  // arrives through an untyped worker boundary, so the input is deliberately
  // untyped to prove the resolver rejects noise.
  const oddResolvedHint: unknown = JSON.parse(
    '{"sourceColorSpace":"auto","resolvedColorSpace":"odd"}',
  );
  assert.equal(
    resolveUsdTextureColorSpace('mapPath', oddResolvedHint as UsdMaterialTextureInput),
    THREE.SRGBColorSpace,
  );
  // A resolved hint without an authored auto token also classifies the slot:
  // the native side records the hint only after resolving auto.
  assert.equal(resolveUsdTextureColorSpace('mapPath', { resolvedColorSpace: 'raw' }), THREE.LinearSRGBColorSpace);
});

test('resolveUsdTextureColorSpace ignores resolved hints on data slots', () => {
  assert.equal(
    resolveUsdTextureColorSpace('roughnessMapPath', { sourceColorSpace: 'auto', resolvedColorSpace: 'raw' }),
    null,
  );
  assert.equal(
    resolveUsdTextureColorSpace('normalMapPath', { sourceColorSpace: 'auto', resolvedColorSpace: 'srgb' }),
    null,
  );
});

test('normalizeUsdTextureInputSlot passes resolvedColorSpace through and rejects noise', () => {
  const normalized = normalizeUsdTextureInputs({
    mapPath: { sourceColorSpace: 'auto', resolvedColorSpace: 'raw' },
    emissiveMapPath: { resolvedColorSpace: 'sRGB' },
  });
  assert.equal(normalized?.mapPath?.sourceColorSpace, 'auto');
  assert.equal(normalized?.mapPath?.resolvedColorSpace, 'raw');
  assert.equal(normalized?.emissiveMapPath?.resolvedColorSpace, 'srgb');
  assert.equal(
    normalizeUsdTextureInputs({ mapPath: { resolvedColorSpace: 42 } })?.mapPath?.resolvedColorSpace,
    undefined,
  );
  // A resolved hint alone is not authored USD slot state: it classifies the
  // color space at resolve time but must not force per-material cloning the
  // way an explicit sourceColorSpace token does.
  assert.equal(usdTextureInputRequiresSlotState({ resolvedColorSpace: 'raw' }), false);
});

test('applyUsdTextureInputToTexture sets the resolved linear color space on color slots', () => {
  const texture = new THREE.Texture();
  texture.colorSpace = THREE.SRGBColorSpace;
  applyUsdTextureInputToTexture(texture, 'mapPath', {
    sourceColorSpace: 'auto',
    resolvedColorSpace: 'raw',
  });
  assert.equal(texture.colorSpace, THREE.LinearSRGBColorSpace);
});

test('usdTextureInputRequiresSlotState treats an authored identity matrix as slot state', () => {
  assert.equal(usdTextureInputRequiresSlotState(null), false);
  assert.equal(usdTextureInputRequiresSlotState({}), false);
  assert.equal(usdTextureInputRequiresSlotState({ uvPrimvar: 'st' }), false);
  assert.equal(
    usdTextureInputRequiresSlotState({ uvTransform: [1, 0, 0, 0, 1, 0, 0, 0, 1] }),
    true,
  );
  assert.equal(usdTextureInputRequiresSlotState({ wrapS: 'repeat' }), true);
  assert.equal(usdTextureInputRequiresSlotState({ sourceColorSpace: 'raw' }), true);
});

test('sample arithmetic keeps finite float4 and output metadata independent of float2 UV parameters', () => {
  const normalized = normalizeUsdTextureInputs({ mapPath: {
    sourceOutput: 'rgb', sampleScale: new Float32Array([-1, 2, 0.5, 4]),
    sampleBias: [0.001, 0.02, 0.01, 0.4],
  }, roughnessMapPath: { sourceOutput: 'r', sampleScale: [1, 2], sampleBias: [0, 0, NaN, 0] } });
  assert.deepEqual(normalized?.mapPath?.sampleScale, [-1, 2, 0.5, 4]);
  assert.deepEqual(normalized?.mapPath?.sampleBias, [0.001, 0.02, 0.01, 0.4]);
  assert.deepEqual(normalized?.roughnessMapPath, { sourceOutput: 'r' });
  assert.equal(normalized?.mapPath?.uvTransform, undefined);
});
