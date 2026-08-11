import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { JSDOM } from 'jsdom';

import {
  fitPrimitiveFromPoints,
  fitPrimitiveFromObject3D,
  resolveMJCFMeshBackedPrimitiveGeoms,
} from './mjcfMeshBackedPrimitiveResolver.ts';
import { parseMJCFModel } from './mjcfModel.ts';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.DOMParser = dom.window.DOMParser as typeof DOMParser;

function createBasis(axis: THREE.Vector3): { u: THREE.Vector3; v: THREE.Vector3 } {
  const reference =
    Math.abs(axis.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
  const u = new THREE.Vector3().crossVectors(reference, axis).normalize();
  const v = new THREE.Vector3().crossVectors(axis, u).normalize();
  return { u, v };
}

function pushPoint(points: Array<{ x: number; y: number; z: number }>, point: THREE.Vector3): void {
  points.push({ x: point.x, y: point.y, z: point.z });
}

function generateCylinderPoints(
  center: THREE.Vector3,
  axis: THREE.Vector3,
  radius: number,
  segmentLength: number,
): Array<{ x: number; y: number; z: number }> {
  const normalizedAxis = axis.clone().normalize();
  const { u, v } = createBasis(normalizedAxis);
  const points: Array<{ x: number; y: number; z: number }> = [];

  for (let ring = 0; ring <= 8; ring += 1) {
    const t = -segmentLength / 2 + (segmentLength * ring) / 8;
    for (let segment = 0; segment < 24; segment += 1) {
      const angle = (segment / 24) * Math.PI * 2;
      const point = center
        .clone()
        .addScaledVector(normalizedAxis, t)
        .addScaledVector(u, Math.cos(angle) * radius)
        .addScaledVector(v, Math.sin(angle) * radius);
      pushPoint(points, point);
    }
  }

  return points;
}

function generateCapsulePoints(
  center: THREE.Vector3,
  axis: THREE.Vector3,
  radius: number,
  segmentLength: number,
): Array<{ x: number; y: number; z: number }> {
  const normalizedAxis = axis.clone().normalize();
  const { u, v } = createBasis(normalizedAxis);
  const points = generateCylinderPoints(center, normalizedAxis, radius, segmentLength);
  const capCenters = [
    center.clone().addScaledVector(normalizedAxis, -segmentLength / 2),
    center.clone().addScaledVector(normalizedAxis, segmentLength / 2),
  ];

  capCenters.forEach((capCenter, capIndex) => {
    for (let lat = 0; lat <= 5; lat += 1) {
      const polar = (lat / 5) * (Math.PI / 2);
      const axisOffset = Math.sin(polar) * radius * (capIndex === 0 ? -1 : 1);
      const radial = Math.cos(polar) * radius;

      for (let segment = 0; segment < 24; segment += 1) {
        const angle = (segment / 24) * Math.PI * 2;
        const point = capCenter
          .clone()
          .addScaledVector(normalizedAxis, axisOffset)
          .addScaledVector(u, Math.cos(angle) * radial)
          .addScaledVector(v, Math.sin(angle) * radial);
        pushPoint(points, point);
      }
    }
  });

  return points;
}

function generateBoxCornerPoints(
  center: THREE.Vector3,
  size: THREE.Vector3,
): Array<{ x: number; y: number; z: number }> {
  const half = size.clone().multiplyScalar(0.5);
  const points: Array<{ x: number; y: number; z: number }> = [];

  for (const signX of [-1, 1]) {
    for (const signY of [-1, 1]) {
      for (const signZ of [-1, 1]) {
        pushPoint(
          points,
          new THREE.Vector3(
            center.x + half.x * signX,
            center.y + half.y * signY,
            center.z + half.z * signZ,
          ),
        );
      }
    }
  }

  return points;
}

function assertVectorClose(
  actual: readonly number[],
  expected: readonly number[],
  tolerance: number,
): void {
  assert.equal(actual.length, expected.length);
  actual.forEach((value, index) => {
    assert.ok(
      Math.abs(value - expected[index]!) <= tolerance,
      `index ${index}: expected ${expected[index]}, got ${value}`,
    );
  });
}

test('fits a mesh-backed cylinder point cloud with stable radius and centerline length', () => {
  const center = new THREE.Vector3(0.25, -0.4, 0.8);
  const axis = new THREE.Vector3(0.4, 0.9, -0.15).normalize();
  const radius = 0.12;
  const segmentLength = 1.4;
  const fit = fitPrimitiveFromPoints(
    generateCylinderPoints(center, axis, radius, segmentLength),
    'cylinder',
  );

  assert.ok(fit);
  assert.ok(Math.abs(fit.radius - radius) <= 1e-3, `expected radius ${radius}, got ${fit.radius}`);
  assert.ok(
    Math.abs(fit.segmentLength - segmentLength) <= 2e-3,
    `expected length ${segmentLength}, got ${fit.segmentLength}`,
  );
  assertVectorClose(fit.center, [center.x, center.y, center.z], 2e-3);

  const actualAxis = new THREE.Vector3(fit.axis[0], fit.axis[1], fit.axis[2]).normalize();
  assert.ok(
    Math.abs(actualAxis.dot(axis)) >= 0.999,
    `expected axis ${axis.toArray()}, got ${actualAxis.toArray()}`,
  );
});

test('fits a mesh-backed capsule point cloud and converts total length into MuJoCo segment length', () => {
  const center = new THREE.Vector3(-0.3, 0.6, 0.2);
  const axis = new THREE.Vector3(0.2, -0.5, 0.84).normalize();
  const radius = 0.08;
  const segmentLength = 0.36;
  const fit = fitPrimitiveFromPoints(
    generateCapsulePoints(center, axis, radius, segmentLength),
    'capsule',
  );

  assert.ok(fit);
  assert.ok(Math.abs(fit.radius - radius) <= 5e-3, `expected radius ${radius}, got ${fit.radius}`);
  assert.ok(
    Math.abs(fit.segmentLength - segmentLength) <= 1.5e-2,
    `expected length ${segmentLength}, got ${fit.segmentLength}`,
  );
  assertVectorClose(fit.center, [center.x, center.y, center.z], 5e-3);

  const actualAxis = new THREE.Vector3(fit.axis[0], fit.axis[1], fit.axis[2]).normalize();
  assert.ok(
    Math.abs(actualAxis.dot(axis)) >= 0.995,
    `expected axis ${axis.toArray()}, got ${actualAxis.toArray()}`,
  );
});

test('fits mesh-backed capsules with AABB semantics when compiler fitaabb is enabled', () => {
  const center = new THREE.Vector3(0.0011089, -0.000417, -0.0013828);
  const size = new THREE.Vector3(0.0266654, 0.0250001, 0.08993);
  const fit = fitPrimitiveFromPoints(generateBoxCornerPoints(center, size), 'capsule', 'aabb');

  assert.ok(fit);
  assert.ok(
    Math.abs(fit.radius - 0.0133327) <= 1e-6,
    `expected radius 0.0133327, got ${fit.radius}`,
  );
  assert.ok(
    Math.abs(fit.segmentLength - 0.0632646) <= 1e-6,
    `expected segmentLength 0.0632646, got ${fit.segmentLength}`,
  );
  assertVectorClose(fit.center, [center.x, center.y, center.z], 1e-6);
  assertVectorClose(fit.axis, [0, 0, 1], 1e-6);
});

test('fits mesh-backed capsules from the axis-aligned bounding box when fitaabb is enabled', () => {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.08, 0.04, 0.04),
    new THREE.MeshBasicMaterial(),
  );

  const fit = fitPrimitiveFromObject3D(mesh, 'capsule', { fitaabb: true });

  assert.ok(fit);
  assertVectorClose(fit.center, [0, 0, 0], 1e-6);
  const actualAxis = new THREE.Vector3(fit.axis[0], fit.axis[1], fit.axis[2]).normalize();
  assert.ok(
    Math.abs(actualAxis.dot(new THREE.Vector3(1, 0, 0))) >= 0.999999,
    `expected x-axis alignment, got ${actualAxis.toArray()}`,
  );
  assert.ok(Math.abs(fit.radius - 0.02) <= 1e-6, `expected radius 0.02, got ${fit.radius}`);
  assert.ok(
    Math.abs(fit.segmentLength - 0.04) <= 1e-6,
    `expected segment length 0.04, got ${fit.segmentLength}`,
  );
});

test('fits fitaabb bounds from all mesh vertices, including vertices not referenced by faces', () => {
  const geometry = new THREE.BoxGeometry(0.08, 0.04, 0.04);
  const sourcePositions = geometry.getAttribute('position');
  assert.ok(sourcePositions);

  const positions = new Float32Array(sourcePositions.array.length + 3);
  positions.set(sourcePositions.array as ArrayLike<number>, 0);
  positions.set([0.08, 0, 0], sourcePositions.array.length);
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));

  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  const fit = fitPrimitiveFromObject3D(mesh, 'capsule', { fitaabb: true });

  assert.ok(fit);
  assertVectorClose(fit.center, [0.02, 0, 0], 1e-6);
  const actualAxis = new THREE.Vector3(fit.axis[0], fit.axis[1], fit.axis[2]).normalize();
  assert.ok(
    Math.abs(actualAxis.dot(new THREE.Vector3(1, 0, 0))) >= 0.999999,
    `expected x-axis alignment, got ${actualAxis.toArray()}`,
  );
  assert.ok(Math.abs(fit.radius - 0.02) <= 1e-6, `expected radius 0.02, got ${fit.radius}`);
  assert.ok(
    Math.abs(fit.segmentLength - 0.08) <= 1e-6,
    `expected segment length 0.08, got ${fit.segmentLength}`,
  );
});

test('resolves mesh-backed primitive geoms into fromto capsules in body space', async () => {
  const parsedModel: any = {
    modelName: 'mesh-backed-capsule',
    compilerSettings: {
      angleUnit: 'radian',
      meshdir: '',
      texturedir: '',
      eulerSequence: 'xyz',
    },
    defaults: {
      root: {
        body: {},
        geom: {},
        joint: {},
        inertial: {},
        mesh: {},
        material: {},
        texture: {},
      },
      classesByQName: new Map(),
      qnamesByClassName: new Map(),
    },
    meshMap: new Map([['link1', { name: 'link1', file: 'link1.obj' }]]),
    materialMap: new Map(),
    textureMap: new Map(),
    actuatorMap: new Map(),
    connectConstraints: [],
    worldBody: {
      name: 'world',
      pos: [0, 0, 0],
      geoms: [],
      joints: [],
      children: [
        {
          name: 'link1',
          pos: [0, 0, 0],
          geoms: [
            {
              name: 'link1::geom[0]',
              sourceName: null,
              type: 'capsule',
              mesh: 'link1',
              pos: [1, 2, 3],
              quat: [0, 0, 1, 0],
            },
          ],
          joints: [],
          children: [],
        },
      ],
    },
  };
  const resolvedCount = await resolveMJCFMeshBackedPrimitiveGeoms(parsedModel, {
    assets: {},
    fitPrimitiveFromMeshAsset: async () => ({
      center: [0.5, 0, 0],
      axis: [0, 0, 1],
      radius: 0.2,
      segmentLength: 1,
    }),
  });

  assert.equal(resolvedCount, 1);

  const geom = parsedModel.worldBody.children[0]?.geoms[0];
  assert.ok(geom);
  assert.equal(geom.mesh, undefined);
  assert.equal(geom.pos, undefined);
  assert.equal(geom.quat, undefined);
  assert.deepEqual(geom.size, [0.2]);
  assert.ok(geom.fromto);
  assertVectorClose(geom.fromto!, [0.5, 2, 3.5, 0.5, 2, 2.5], 1e-6);
});

test('matches MuJoCo mesh scale, refpos, and refquat ordering when fitting a primitive center', async () => {
  const parsedModel = parseMJCFModel(`
    <mujoco model="mesh-transform-truth">
      <compiler fitaabb="true" />
      <asset>
        <mesh
          name="fit_mesh"
          vertex="-0.1 -0.2 -0.5  -0.1 -0.2 0.5  -0.1 0.2 -0.5  -0.1 0.2 0.5
                  0.1 -0.2 -0.5   0.1 -0.2 0.5   0.1 0.2 -0.5   0.1 0.2 0.5"
          scale="2 3 4"
          refpos="1 2 3"
          refquat="0 0 0 1"
        />
      </asset>
      <worldbody>
        <body name="base">
          <geom name="fitted" type="cylinder" mesh="fit_mesh" />
        </body>
      </worldbody>
    </mujoco>
  `);
  assert.ok(parsedModel);

  const resolvedCount = await resolveMJCFMeshBackedPrimitiveGeoms(parsedModel, { assets: {} });

  assert.equal(resolvedCount, 1);
  const geom = parsedModel.worldBody.children[0]?.geoms[0];
  assert.ok(geom?.fromto);
  const fittedCenter = [
    (geom.fromto[0] + geom.fromto[3]) / 2,
    (geom.fromto[1] + geom.fromto[4]) / 2,
    (geom.fromto[2] + geom.fromto[5]) / 2,
  ];

  // MuJoCo 3.8 compiles this exact mesh to geom_pos/mesh_pos = [2, 6, -12].
  // The equivalent authored-frame operation is S * (Q^-1 * (center - refpos)).
  assertVectorClose(fittedCenter, [2, 6, -12], 1e-6);
  assertVectorClose(geom.size, [0.6], 1e-6);
  assert.ok(
    Math.abs(
      new THREE.Vector3(...geom.fromto.slice(3)).distanceTo(
        new THREE.Vector3(...geom.fromto.slice(0, 3)),
      ) - 4,
    ) <= 1e-6,
  );
});

test('aborts mesh-backed primitive fitting before mutating canonical source geoms', async () => {
  const parsedModel = parseMJCFModel(`
    <mujoco model="aborted-fit">
      <asset><mesh name="fit_mesh" vertex="0 0 0  1 0 0  0 1 0" /></asset>
      <worldbody><body name="base"><geom type="capsule" mesh="fit_mesh" /></body></worldbody>
    </mujoco>
  `);
  assert.ok(parsedModel);
  const geom = parsedModel.worldBody.children[0]?.geoms[0];
  assert.ok(geom);

  await assert.rejects(
    resolveMJCFMeshBackedPrimitiveGeoms(parsedModel, {
      assets: {},
      abortSignal: { aborted: true },
    }),
    { name: 'MJCFLoadAbortedError' },
  );
  assert.equal(geom.mesh, 'fit_mesh');
  assert.equal(geom.fromto, undefined);
  assert.deepEqual(geom.size, []);
});
