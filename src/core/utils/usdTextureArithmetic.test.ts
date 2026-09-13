import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { applyUsdTextureArithmetic, getUsdTextureArithmeticSummary } from './usdTextureArithmetic';

const input = { sourceOutput: 'rgb', sampleScale: [1, 1, 1, 1], sampleBias: [0.001, 0.02, 0.01, 0] };
const compile = (material: THREE.Material) => {
  const shader = { uniforms: {}, vertexShader: '', fragmentShader: '#include <map_fragment>' } as Parameters<THREE.Material['onBeforeCompile']>[0];
  material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
  return shader;
};

test('USD RGB arithmetic patches decoded samples before multiplication without touching alpha', () => {
  const material = new THREE.MeshPhysicalMaterial({ map: new THREE.Texture() });
  applyUsdTextureArithmetic(material, { mapPath: input });
  const shader = compile(material);
  assert.ok(shader.fragmentShader.indexOf('sRGBTransferEOTF') < shader.fragmentShader.indexOf('sampledDiffuseColor.rgb ='));
  assert.ok(shader.fragmentShader.indexOf('sampledDiffuseColor.rgb =') < shader.fragmentShader.indexOf('diffuseColor *= sampledDiffuseColor'));
  assert.doesNotMatch(shader.fragmentShader, /sampledDiffuseColor\.a\s*=/);
  assert.deepEqual(shader.uniforms.usdMapSampleBias.value.toArray(), input.sampleBias);
  assert.equal(getUsdTextureArithmeticSummary(material)?.compiled, true);
});

test('USD arithmetic keeps existing hooks/cache keys and installs once, updates/reset safely', () => {
  const material = new THREE.MeshStandardMaterial({ map: new THREE.Texture() });
  let calls = 0;
  const hook: THREE.Material['onBeforeCompile'] = (shader) => { calls += 1; shader.fragmentShader += '\n// existing'; };
  const key = () => 'existing-cache';
  material.onBeforeCompile = hook;
  material.customProgramCacheKey = key;
  applyUsdTextureArithmetic(material, { mapPath: input });
  const installed = material.onBeforeCompile;
  applyUsdTextureArithmetic(material, { mapPath: input });
  assert.equal(material.onBeforeCompile, installed);
  const shader = compile(material);
  assert.equal(calls, 1);
  assert.match(material.customProgramCacheKey(), /existing-cache/);
  assert.equal(shader.fragmentShader.split('sampledDiffuseColor.rgb =').length, 2);
  applyUsdTextureArithmetic(material, { mapPath: { ...input, sampleBias: [0.01, 0, 0, 0] } });
  assert.equal(shader.uniforms.usdMapSampleBias.value.x, 0.01);
  applyUsdTextureArithmetic(material, null);
  assert.equal(material.onBeforeCompile, hook);
  assert.equal(material.customProgramCacheKey, key);
  assert.equal(getUsdTextureArithmeticSummary(material), null);
});

test('material clones retain arithmetic with independent uniforms and a shared unchanged texture', () => {
  const texture = new THREE.Texture();
  const material = new THREE.MeshStandardMaterial({ map: texture });
  applyUsdTextureArithmetic(material, { mapPath: input });
  const clone = material.clone();
  const a = compile(material);
  const b = compile(clone);
  assert.notEqual(a.uniforms.usdMapSampleBias.value, b.uniforms.usdMapSampleBias.value);
  applyUsdTextureArithmetic(clone, { mapPath: { ...input, sampleBias: [0, 0, 0.03, 0] } });
  assert.equal(a.uniforms.usdMapSampleBias.value.z, 0.01);
  assert.equal(b.uniforms.usdMapSampleBias.value.z, 0.03);
  assert.equal(clone.map, texture);
  assert.deepEqual(texture.userData, {});
});

test('unimplemented slots/output selectors retain explicit diagnostics without shader arithmetic', () => {
  const material = new THREE.MeshStandardMaterial({ map: new THREE.Texture() });
  const original = material.onBeforeCompile;
  applyUsdTextureArithmetic(material, { roughnessMapPath: input, mapPath: { ...input, sourceOutput: 'r' } });
  assert.equal(material.onBeforeCompile, original);
  assert.deepEqual(getUsdTextureArithmeticSummary(material)?.slots.map((entry) => entry.status), ['unsupported-output', 'unsupported-slot']);
});

test('removed map and foreign shader without map fragment cannot be reported compiled', () => {
  const material = new THREE.MeshStandardMaterial({ map: new THREE.Texture() });
  applyUsdTextureArithmetic(material, { mapPath: input });
  material.onBeforeCompile({ uniforms: {}, vertexShader: '', fragmentShader: 'void main() {}' } as Parameters<THREE.Material['onBeforeCompile']>[0], {} as THREE.WebGLRenderer);
  assert.equal(getUsdTextureArithmeticSummary(material)?.compiled, false);
  assert.equal(getUsdTextureArithmeticSummary(material)?.shaderStatus, 'map-fragment-missing');
  material.map = null;
  applyUsdTextureArithmetic(material, { mapPath: input });
  assert.equal(getUsdTextureArithmeticSummary(material)?.compiled, false);
  assert.equal(getUsdTextureArithmeticSummary(material)?.slots[0].status, 'map-not-assigned');
});

test('different original shader hooks and custom keys never share arithmetic programs', () => {
  const a = new THREE.MeshStandardMaterial({ map: new THREE.Texture() });
  const b = new THREE.MeshStandardMaterial({ map: new THREE.Texture() });
  a.onBeforeCompile = (shader) => { shader.fragmentShader += '\n// hook a'; };
  b.onBeforeCompile = (shader) => { shader.fragmentShader += '\n// hook b'; };
  applyUsdTextureArithmetic(a, { mapPath: input });
  applyUsdTextureArithmetic(b, { mapPath: input });
  assert.notEqual(a.customProgramCacheKey(), b.customProgramCacheKey());
  applyUsdTextureArithmetic(a, null);
  applyUsdTextureArithmetic(b, null);
  a.customProgramCacheKey = () => 'custom-a';
  b.customProgramCacheKey = () => 'custom-b';
  applyUsdTextureArithmetic(a, { mapPath: input });
  applyUsdTextureArithmetic(b, { mapPath: input });
  assert.notEqual(a.customProgramCacheKey(), b.customProgramCacheKey());
});
