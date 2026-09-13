import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeUsdMdlPreset } from './usdMdlPreset';

function preset() {
  return {
    family: 'OmniPBR', status: 'resolved', sourceAsset: 'Materials/Aluminum.mdl',
    subIdentifier: 'Aluminum',
    inputs: {
      roughness: 0, normal_factor: 1, enable_opacity: false,
      diffuse_tint: [1, 1, 1],
      diffuse_texture: { assetPath: '../textures/diffuse.png', sourceColorSpace: 'sRGB' },
    },
    unsupportedInputs: [] as string[],
  };
}

test('native MDL diagnostic values preserve finite zero, false, arrays and asset metadata independently', () => {
  const raw = preset();
  const normalized = normalizeUsdMdlPreset(raw);
  assert.deepEqual(normalized, raw);
  assert.ok(normalized);
  assert.notEqual(normalized.inputs, raw.inputs);
  assert.notEqual(normalized.inputs.diffuse_tint, raw.inputs.diffuse_tint);
  assert.notEqual(normalized.inputs.diffuse_texture, raw.inputs.diffuse_texture);
  raw.inputs.diffuse_tint[0] = 0.2;
  raw.inputs.diffuse_texture.assetPath = 'changed.png';
  assert.deepEqual(normalized.inputs.diffuse_tint, [1, 1, 1]);
  assert.deepEqual(normalized.inputs.diffuse_texture, { assetPath: '../textures/diffuse.png', sourceColorSpace: 'sRGB' });
});

test('partial and unsupported presets remain incomplete, including an unrecognized family', () => {
  for (const [family, status] of [['OmniPBR', 'partial'], ['GlassWithVolume', 'partial'], ['', 'unsupported']]) {
    const raw = { ...preset(), family, status, unsupportedInputs: ['connected_roughness'] };
    assert.deepEqual(normalizeUsdMdlPreset(raw), raw);
  }
});

test('native MDL contract rejects unknown connections and extra fields without promoting resolved status', () => {
  const raw = preset();
  for (const candidate of [
    { ...raw, extraUnresolvedConnection: '/Looks/Shader.output' },
    { ...raw, unsupportedInputs: ['roughness'] },
    { ...raw, family: '', status: 'resolved' },
    { ...raw, family: 'Unknown' },
    { ...raw, status: 'success' },
    { ...raw, inputs: { diffuse_color: { connection: '/Looks/Shader.outputs:rgb' } } },
    { ...raw, inputs: { diffuse_texture: { assetPath: 'x.png', sourceColorSpace: 'raw', connection: '/unknown' } } },
    { ...raw, inputs: { diffuse_texture: { assetPath: 'x.png', sourceColorSpace: 'automatic' } } },
  ]) assert.equal(normalizeUsdMdlPreset(candidate), null);
});

test('native MDL diagnostic bounds reject oversized, sparse, unsafe and nonfinite values', () => {
  const raw = preset();
  for (const invalid of [NaN, Infinity, -Infinity, [0, NaN], [1, '2'], Array(3), null, '0.5', Array(17).fill(0)]) {
    assert.equal(normalizeUsdMdlPreset({ ...raw, inputs: { invalid } }), null);
  }
  for (const candidate of [
    { ...raw, sourceAsset: 'a'.repeat(4097) },
    { ...raw, subIdentifier: 'a'.repeat(4097) },
    { ...raw, inputs: Object.fromEntries(Array.from({ length: 129 }, (_, index) => [`input${index}`, 0])) },
    { ...raw, inputs: { ['x'.repeat(257)]: 0 } },
    { ...raw, inputs: JSON.parse('{"__proto__":0}') },
    { ...raw, status: 'partial', unsupportedInputs: Array(2) },
    { ...raw, status: 'partial', unsupportedInputs: Array(129).fill('unknown') },
  ]) assert.equal(normalizeUsdMdlPreset(candidate), null);
});
