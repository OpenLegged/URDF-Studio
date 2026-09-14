import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import * as THREE from 'three';

import { createGeometryMesh } from './mjcfGeometry';
import { buildMJCFHierarchy, type MJCFHierarchyGeom } from './mjcfHierarchyBuilder';
import { disposeTransientObject3D } from './mjcfLoadLifecycle';
import { canonicalizeMjcfFromToGeom, createMuJoCoFromToQuaternion } from './mjcfMath';
import { parseMJCF } from './mjcfParser';
import { normalizeVector3OrNull } from './mjcfUtilsHelpers';

const { window } = new JSDOM();
globalThis.DOMParser = window.DOMParser;
globalThis.XMLSerializer = window.XMLSerializer;

function parseRobot(body: string) {
  const robot = parseMJCF(`<mujoco model="precise_import"><compiler angle="radian"/>
    <worldbody>${body}</worldbody></mujoco>`);
  assert.ok(robot, 'expected a valid MJCF fixture');
  return robot;
}

test('MJCF import keeps tiny joint anchors and rebases geometry and inertia around them', () => {
  const robot = parseRobot(`<body name="base">
    <joint name="pivot" type="hinge" pos="1e-12 0 0"/>
    <geom type="box" size="0.1 0.1 0.1" pos="1e-12 0 0"/>
    <inertial mass="1" pos="1e-12 0 0" diaginertia="1 1 1"/>
  </body>`);

  assert.equal(robot.joints.pivot.origin.xyz.x, 1e-12);
  assert.equal(robot.links.base.visual.origin.xyz.x, 0);
  assert.equal(robot.links.base.inertial?.origin?.xyz.x, 0);
});

for (const transform of ['pos="1e-12 0 0"', 'euler="1e-12 0 0"']) {
  test(`MJCF import keeps a root body with tiny ${transform}`, () => {
    const robot = parseRobot(`<body name="base" ${transform}>
      <geom type="box" size="0.1 0.1 0.1"/>
    </body>`);
    assert.equal(robot.rootLinkId, 'world');
    const joint = Object.values(robot.joints).find((candidate) => candidate.childLinkId === 'base');
    assert.ok(joint, 'expected a joint carrying the authored root transform');
    if (transform.startsWith('pos')) assert.equal(joint.origin.xyz.x, 1e-12);
    else assert.equal(joint.origin.rpy.r, 1e-12);
  });
}

for (const length of [1e-8, 1e-200]) {
  test(`MJCF fromto pose preserves direction and length at scale ${length}`, () => {
    const canonical = canonicalizeMjcfFromToGeom({
      type: 'cylinder', size: [0.01], fromto: [0, 0, 0, length, 0, 0],
    });
    assert.ok(canonical);
    assert.equal(canonical.size[1], length / 2);
    const [w, x, y, z] = canonical.quat;
    const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(new THREE.Quaternion(x, y, z, w));
    assert.ok(direction.distanceTo(new THREE.Vector3(1, 0, 0)) < 1e-15);
  });
}

test('MJCF fromto preserves nearly opposite directions and the exact opposite +X convention', () => {
  const exact = createMuJoCoFromToQuaternion(new THREE.Vector3(0, 0, 1));
  assert.deepEqual(exact.toArray(), [1, 0, 0, 0]);
  assert.deepEqual(createMuJoCoFromToQuaternion(new THREE.Vector3()).toArray(), [0, 0, 0, 1]);
  const authoredDirection = new THREE.Vector3(1e-8, 0, 1).normalize();
  const quaternion = createMuJoCoFromToQuaternion(authoredDirection);
  const actual = new THREE.Vector3(0, 0, -1).applyQuaternion(quaternion);
  assert.ok(actual.distanceTo(authoredDirection) < 1e-15);
});

test('MJCF rendered fromto geometry uses the same orientation for tiny nonzero segments', async () => {
  const geometry = await createGeometryMesh({
    type: 'cylinder', size: [0.01], fromto: [0, 0, 0, 1e-8, 0, 0],
  }, new Map(), {}, new Map());
  assert.ok(geometry);
  try {
    const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(geometry.quaternion);
    assert.ok(direction.distanceTo(new THREE.Vector3(1, 0, 0)) < 1e-15);
  } finally {
    disposeTransientObject3D(geometry);
  }
});

async function buildAlphaScene(alphas: number[], cubeTexture = false) {
  const geoms: MJCFHierarchyGeom[] = alphas.map((alpha, index) => ({
    name: `visual_${index}`, type: 'box', size: [0.1, 0.1, 0.1], pos: [index, 0, 0],
    material: 'shared_material', rgba: [0.8, 0.6, 0.4, alpha], hasExplicitRgba: false,
    contype: 0, conaffinity: 0,
  }));
  const rootGroup = new THREE.Group();
  const hierarchy = await buildMJCFHierarchy({
    bodies: [{ name: 'base', pos: [0, 0, 0], geoms, joints: [], children: [] }],
    rootGroup, meshMap: new Map(), assets: {}, meshCache: new Map(),
    textureMap: new Map(cubeTexture ? [['cube_texture', {
      name: 'cube_texture', type: 'cube', builtin: 'flat', rgb1: [1, 1, 1], width: 2, height: 2,
    }]] : []),
    materialMap: new Map([['shared_material', {
      name: 'shared_material', rgba: [0.1, 0.2, 0.3, 1], texture: cubeTexture ? 'cube_texture' : undefined,
    }]]),
    compilerSettings: {
      angleUnit: 'radian', assetdir: '', meshdir: '', texturedir: '', eulerSequence: 'xyz',
      autolimits: false, fitaabb: false, inertiafromgeom: 'auto',
    },
  });
  await hierarchy.deferredTextureApplicationsReady;
  const materials: THREE.MeshStandardMaterial[] = [];
  rootGroup.traverse((child) => {
    if (!(child instanceof THREE.Mesh) || !child.userData.isVisualMesh) return;
    const entries = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of entries) {
      if (material instanceof THREE.MeshStandardMaterial) materials.push(material);
    }
  });
  return { rootGroup, materials };
}

test('MJCF material cache keeps distinct precise opacities while sharing equal values', async () => {
  const { rootGroup, materials } = await buildAlphaScene([0.123441, 0.123442, 0.123441]);
  try {
    assert.equal(materials.length, 3);
    assert.deepEqual(materials.map((material) => material.opacity), [0.123441, 0.123442, 0.123441]);
    assert.notEqual(materials[0], materials[1]);
    assert.equal(materials[0], materials[2]);
  } finally {
    disposeTransientObject3D(rootGroup);
  }
});

test('MJCF material inheritance preserves opacity values just below one', async () => {
  const { rootGroup, materials } = await buildAlphaScene([0.9999999999999999]);
  try {
    assert.equal(materials.length, 1);
    assert.equal(materials[0].opacity, 0.9999999999999999);
    assert.equal(materials[0].transparent, true);
  } finally {
    disposeTransientObject3D(rootGroup);
  }
});

test('MJCF cube material inheritance preserves opacity values just below one on every face', async () => {
  const { rootGroup, materials } = await buildAlphaScene([0.9999999999999999], true);
  try {
    assert.equal(materials.length, 6);
    for (const material of materials) {
      assert.equal(material.opacity, 0.9999999999999999);
      assert.equal(material.transparent, true);
    }
  } finally {
    disposeTransientObject3D(rootGroup);
  }
});

test('MJCF frame inheritance retains tiny geometry and inertial placements', () => {
  const robot = parseRobot(`<body name="base"><frame pos="1e-12 0 0">
    <geom type="box" size="0.1 0.1 0.1"/>
    <inertial mass="1" pos="0 0 0" diaginertia="1 1 1"/>
  </frame></body>`);
  assert.equal(robot.links.base.visual.origin.xyz.x, 1e-12);
  assert.equal(robot.links.base.inertial?.origin?.xyz.x, 1e-12);
});

test('MJCF frame inheritance retains tiny rotations', () => {
  const robot = parseRobot(`<body name="base"><frame euler="1e-12 0 0">
    <geom type="box" size="0.1 0.1 0.1" pos="0 1 0"/>
  </frame></body>`);
  assert.equal(robot.links.base.visual.origin.rpy.r, 1e-12);
  assert.equal(robot.links.base.visual.origin.xyz.z, 1e-12);
});

test('MJCF frame inheritance keeps tiny placement on a nested body', () => {
  const robot = parseRobot(`<frame pos="1e-12 0 0"><body name="base">
    <geom type="box" size="0.1 0.1 0.1"/>
  </body></frame>`);
  const joint = Object.values(robot.joints).find((candidate) => candidate.childLinkId === 'base');
  assert.ok(joint, 'expected the inherited body placement to retain the world root');
  assert.equal(joint.origin.xyz.x, 1e-12);
});

test('MJCF direction normalization handles the full finite scale range', () => {
  for (const scale of [Number.MIN_VALUE, 1e-200, 1e200, Number.MAX_VALUE]) {
    const normalized = normalizeVector3OrNull([scale, scale, scale]);
    assert.ok(normalized, `expected a direction at scale ${scale}`);
    assert.ok(normalized.distanceTo(new THREE.Vector3(1, 1, 1).normalize()) < 1e-15);
  }
});

test('MJCF direction normalization rejects zero and nonfinite directions', () => {
  for (const direction of [[0, -0, 0], [Infinity, 1, 0], [1, NaN, 0], [0, 0, -Infinity]]) {
    assert.equal(normalizeVector3OrNull(direction), null);
  }
});

for (const orientation of ['axisangle="0 1e-200 0 1.5707963267948966"', 'zaxis="1e-200 0 0"']) {
  test(`MJCF import preserves orientation from tiny nonzero ${orientation}`, () => {
    const robot = parseRobot(`<body name="base"><geom type="box" size="0.1 0.1 0.1" ${orientation}/></body>`);
    const { r, p, y } = robot.links.base.visual.origin.rpy;
    const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(r, p, y, 'ZYX'));
    const direction = new THREE.Vector3(0, 0, 1).applyQuaternion(rotation);
    assert.ok(direction.distanceTo(new THREE.Vector3(1, 0, 0)) < 1e-15);
  });
}

test('MJCF fromto preserves a lateral component too small to survive angle subtraction', () => {
  const quaternion = createMuJoCoFromToQuaternion(new THREE.Vector3(1e-18, 0, 1));
  const actual = new THREE.Vector3(0, 0, -1).applyQuaternion(quaternion);
  assert.ok(Math.abs(actual.x - 1e-18) < 1e-30);
  assert.equal(actual.y, 0);
  assert.equal(actual.z, 1);
});
