import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { DEFAULT_LINK, type UrdfVisual } from '@/types';
import { applyVisualMeshMaterialGroupsToObject } from '@/core/utils/meshMaterialGroups';
import { buildGeomSubsetDisplayColors, colorHexToVertexColor } from './usdExportMaterials';
import { buildObjBlobFromDescriptor } from './objGeometrySerializer';
import type { SnapshotMeshDescriptor } from './internalTypes';

for (const [rgba, rgb] of [['#cccccc4d', '#cccccc'], ['#c408', '#cc4400']]) {
  test(`USD vertex colors accept ${rgba} without passing alpha to Three.Color`, (context) => {
    const warning = context.mock.method(console, 'warn', () => {});
    const expected = new THREE.Color(rgb);
    assert.deepEqual(colorHexToVertexColor(rgba), [expected.r, expected.g, expected.b]);
    assert.equal(warning.mock.callCount(), 0);
  });
}

test('USD subset OBJ colors retain original RGBA material opacity', async (context) => {
  const warning = context.mock.method(console, 'warn', () => {});
  const visual: UrdfVisual = {
    ...DEFAULT_LINK.visual,
    color: '#cccccc4d',
    authoredMaterials: [{ color: '#cccccc4d', opacity: 0.3 }, { color: '#c408' }],
    meshMaterialGroups: [
      { meshKey: '0', start: 0, count: 3, materialIndex: 0 },
      { meshKey: '0', start: 3, count: 3, materialIndex: 1 },
    ],
  };
  const before = structuredClone(visual);
  const descriptor: SnapshotMeshDescriptor = {
    meshId: '/root/Part', resolvedPrimPath: '/root/Part', sectionName: 'visuals',
    ranges: { positions: { offset: 0, count: 18, stride: 3 } },
    geometry: { geomSubsetSections: [
      { start: 0, length: 3, materialId: '/Looks/translucent' },
      { start: 3, length: 3, materialId: '/Looks/tinted' },
    ] },
  };
  const output = buildObjBlobFromDescriptor({
    descriptor, meshId: descriptor.meshId ?? 'root', linkPath: '/root', linkId: 'root',
    role: 'visual', exportPath: 'root.obj', ordinal: 0,
    subsetDisplayColors: buildGeomSubsetDisplayColors(descriptor, visual),
  }, { positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1, 0, 1, 1]) });
  assert.ok(output);
  const objText = await output.blob.text();
  const vertex = objText.split('\n').find((line) => line.startsWith('v '));
  assert.ok(vertex);
  const rgb = vertex.split(/\s+/).slice(4).map(Number);
  // v-line colors are written as sRGB (readers linearize them on parse):
  // #cccccc linear 0.6038 encodes back to the sRGB 0.8 channel value.
  const expectedLinear = new THREE.Color('#cccccc');
  const expectedSrgbChannel = expectedLinear.clone().convertLinearToSRGB().r;
  rgb.forEach((channel) => assert.ok(Math.abs(channel - expectedSrgbChannel) < 1e-6,
    `v-line color must be sRGB-encoded ${expectedSrgbChannel}, got ${channel}`));
  const object = new OBJLoader().parse(objText);
  applyVisualMeshMaterialGroupsToObject(object, visual);
  const mesh = object.children.find((child): child is THREE.Mesh => child instanceof THREE.Mesh);
  assert.ok(mesh);
  try {
    assert.ok(Array.isArray(mesh.material));
    const [first, second] = mesh.material;
    assert.ok(first instanceof THREE.MeshPhongMaterial);
    assert.ok(second instanceof THREE.MeshPhongMaterial);
    assert.equal(first.color.getHexString(), 'cccccc');
    assert.equal(second.color.getHexString(), 'cc4400');
    assert.equal(first.opacity, 0.3);
    assert.equal(second.opacity, 0x88 / 255);
    assert.equal(first.transparent, true);
    assert.equal(second.transparent, true);
    // OBJLoader sets vertexColors on its own materials from the v lines; the
    // linearized buffer must equal the authored linear color exactly (the
    // sRGB write cancels the reader's sRGB->linear conversion).
    const bufferColor = mesh.geometry.getAttribute('color');
    assert.ok(bufferColor, 'OBJLoader must parse the v-line colors');
    assert.ok(Math.abs(bufferColor.getX(0) - expectedLinear.r) < 1e-4,
      `round-tripped vertex color must be linear ${expectedLinear.r}, got ${bufferColor.getX(0)}`);
    assert.deepEqual(visual, before, 'RGB vertex export must not strip alpha from authored materials');
    assert.equal(warning.mock.callCount(), 0);
  } finally {
    mesh.geometry.dispose();
    (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach((material) => material.dispose());
  }
});
