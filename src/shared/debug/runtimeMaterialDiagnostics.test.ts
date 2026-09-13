import assert from 'node:assert/strict';
import test from 'node:test';
import { Color, MeshPhysicalMaterial, Texture, Vector2 } from 'three';
import { summarizeRuntimeMaterialDiagnostics } from './runtimeMaterialDiagnostics';

test('diagnostics read assigned texture images and physical material fields', () => {
  const material = new MeshPhysicalMaterial({
    normalScale: new Vector2(1, -1), aoMapIntensity: 0,
    ior: 1.52, transmission: 1, thickness: 0, specularIntensity: 0.7,
    specularColor: new Color().setRGB(0.2, 0.3, 0.4),
  });
  material.map = new Texture();
  material.map.source.data = { src: 'blob:actual-base', naturalWidth: 2048, naturalHeight: 1024 };
  material.normalMap = new Texture();
  material.normalMap.name = '/actual/normal.png';
  material.normalMap.source.data = { width: 4, height: 2 };
  material.userData.requestedMap = '/wrong/requested.png';
  const result = summarizeRuntimeMaterialDiagnostics(material);
  assert.equal(result.baseColorTexture?.sourceUrl, 'blob:actual-base');
  assert.equal(result.baseColorTexture?.name, null);
  assert.equal(result.baseColorTexture?.width, 2048);
  assert.equal(result.normalTexture?.name, '/actual/normal.png');
  assert.equal(result.normalTexture?.sourceUrl, null);
  assert.deepEqual(result.normalScale, [1, -1]);
  assert.equal(result.aoMapIntensity, 0);
  assert.equal(result.ior, 1.52);
  assert.equal(result.transmission, 1);
  assert.equal(result.thickness, 0);
  assert.equal(result.specularIntensity, 0.7);
  assert.deepEqual(result.specularColorLinear, [0.2, 0.3, 0.4]);
  assert.equal(result.roughnessTexture, null);
  material.map.dispose(); material.normalMap.dispose(); material.dispose();
});

test('missing or nonfinite physical observations stay unknown', () => {
  const result = summarizeRuntimeMaterialDiagnostics({
    ior: Number.NaN, normalScale: { x: 1, y: Infinity },
  });
  assert.equal(result.ior, null);
  assert.equal(result.normalScale, null);
  assert.equal(result.specularIntensity, null);
  assert.equal(result.baseColorTexture, null);
});
