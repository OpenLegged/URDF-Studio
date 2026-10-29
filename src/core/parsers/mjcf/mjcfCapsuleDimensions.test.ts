import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { JSDOM } from 'jsdom';
import * as THREE from 'three';

import { GeometryType } from '@/types';
import { createGeometryMesh } from './mjcfGeometry';
import { generateMujocoXML } from './mjcfGenerator';
import { disposeTransientObject3D } from './mjcfLoadLifecycle';
import { parseMJCF } from './mjcfParser';

const dom = new JSDOM();
globalThis.DOMParser = dom.window.DOMParser as typeof DOMParser;
after(() => dom.window.close());

function parsePrimitive(type: 'capsule' | 'cylinder', size?: string) {
  return parseMJCF(`<mujoco model="capsule_dimensions">
    <worldbody><body name="base">
      <inertial pos="0 0 0" mass="1" diaginertia="1 1 1" />
      <geom type="${type}" ${size === undefined ? '' : `size="${size}"`} />
    </body></worldbody>
  </mujoco>`);
}

for (const [size, bodyLength] of [['0.08 0', 0], ['0.08 0.02', 0.04], ['0.08', 0.2]] as const) {
  test(`MJCF capsule size ${size} imports straight length ${bodyLength}`, () => {
    const robot = parsePrimitive('capsule', size);
    for (const category of ['visual', 'collision'] as const) {
      assert.equal(robot.links.base[category].type, GeometryType.CAPSULE);
      assert.deepEqual(robot.links.base[category].dimensions, { x: 0.08, y: bodyLength, z: 0 });
    }
  });
}

test('MJCF capsule with no size retains its existing parser defaults', () => {
  assert.deepEqual(parsePrimitive('capsule').links.base.visual.dimensions, { x: 0.05, y: 0, z: 0 });
});

test('MJCF capsule zero straight length survives generation and reimport', () => {
  const robot = parsePrimitive('capsule', '0.08 0.06');
  for (const category of ['visual', 'collision'] as const) {
    const geometry = robot.links.base[category];
    geometry.dimensions = { ...geometry.dimensions, y: 0 };
  }
  const source = generateMujocoXML(robot, { preserveNumericPrecision: true });
  const document = new DOMParser().parseFromString(source, 'text/xml');
  const geoms = [...document.querySelectorAll('geom[type="capsule"]')];
  assert.equal(geoms.length, 2);
  geoms.forEach((geom) => assert.equal(geom.getAttribute('size'), '0.08 0'));
  const reimported = parseMJCF(source);
  for (const category of ['visual', 'collision'] as const) {
    assert.deepEqual(reimported.links.base[category].dimensions, { x: 0.08, y: 0, z: 0 });
  }
});

for (const [size, diameter, totalLength] of [
  [[0.08, 0], 0.16, 0.16],
  [[0.08, 0.02], 0.16, 0.2],
  [[0.08], 0.16, 0.36],
  [undefined, 0.1, 0.3],
] as const) {
  test(`native MJCF capsule size ${size} renders total length ${totalLength}`, async () => {
    const object = await createGeometryMesh(
      { type: 'capsule', size: size ? [...size] : undefined }, new Map(), {}, new Map(),
    );
    assert.ok(object);
    try {
      const bounds = new THREE.Box3().setFromObject(object).getSize(new THREE.Vector3());
      [diameter, diameter, totalLength].forEach((expected, axis) => {
        assert.ok(Math.abs(bounds.getComponent(axis) - expected) < 1e-6);
      });
    } finally {
      disposeTransientObject3D(object);
    }
  });
}

test('MJCF cylinder retains its existing zero half-height fallback', async () => {
  assert.equal(parsePrimitive('cylinder', '0.08 0').links.base.visual.dimensions.y, 0.2);
  const object = await createGeometryMesh({ type: 'cylinder', size: [0.08, 0] }, new Map(), {}, new Map());
  assert.ok(object);
  try {
    const bounds = new THREE.Box3().setFromObject(object).getSize(new THREE.Vector3());
    assert.ok(Math.abs(bounds.z - 0.2) < 1e-6);
  } finally {
    disposeTransientObject3D(object);
  }
});
