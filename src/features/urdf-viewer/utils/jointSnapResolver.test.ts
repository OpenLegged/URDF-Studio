import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { DEFAULT_LINK, type AssemblyState } from '@/types';
import { getFaceCenter, getFaceNormal } from '@/core/geometry/meshSnapPoints';
import { createAssemblySceneProjection } from '@/core/robot';

import { chooseSnapCandidate, resolveJointSnapFromHit, type ResolvedJointSnapCandidate } from './jointSnapResolver.ts';

function assertVecNearlyEqual(
  actual: THREE.Vector3,
  expected: THREE.Vector3,
  tolerance = 1e-4,
  message?: string,
) {
  assert.ok(
    actual.distanceTo(expected) < tolerance,
    message ?? `${actual.toArray()} !== ${expected.toArray()}`,
  );
}

function candidate(kind: ResolvedJointSnapCandidate['kind'], pointWorld: THREE.Vector3): ResolvedJointSnapCandidate {
  return {
    id: `${kind}:test`,
    kind,
    pointWorld,
    poseWorld: new THREE.Matrix4().setPosition(pointWorld),
  };
}

function buildCamera(): THREE.OrthographicCamera {
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  camera.position.set(0, 0, 5);
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  return camera;
}

function buildRuntime(): { robot: THREE.Group; mesh: THREE.Mesh; orphan: THREE.Mesh } {
  const robot = new THREE.Group();

  const link = new THREE.Group();
  (link as THREE.Object3D & { isURDFLink?: boolean }).isURDFLink = true;
  link.name = 'comp_a_base_link';
  link.position.set(10, 0, 0);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.BufferAttribute(new Float32Array([0, 0, 0, 2, 0, 0, 0, 2, 0]), 3),
  );
  const mesh = new THREE.Mesh(geometry);
  link.add(mesh);
  robot.add(link);

  const orphan = new THREE.Mesh(geometry);
  robot.add(orphan);

  robot.updateMatrixWorld(true);
  return { robot, mesh, orphan };
}

function buildNonIndexedRectangleRuntime(): THREE.Mesh {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.BufferAttribute(new Float32Array([
      0, 0, 0, 2, 0, 0, 2, 2, 0,
      0, 0, 0, 2, 2, 0, 0, 2, 0,
    ]), 3),
  );
  const robot = new THREE.Group();
  const link = new THREE.Group();
  (link as THREE.Object3D & { isURDFLink?: boolean }).isURDFLink = true;
  link.name = 'comp_a_base_link';
  link.position.set(10, 0, 0);
  const mesh = new THREE.Mesh(geometry);
  link.add(mesh);
  robot.add(link);
  robot.updateMatrixWorld(true);
  return mesh;
}

function findFaceIndex(
  geometry: THREE.BufferGeometry,
  predicate: (normal: THREE.Vector3, center: THREE.Vector3) => boolean,
): number {
  const faceCount = (geometry.getIndex()?.count ?? geometry.getAttribute('position')?.count ?? 0) / 3;
  for (let faceIndex = 0; faceIndex < faceCount; faceIndex += 1) {
    const normal = getFaceNormal(geometry, faceIndex);
    const center = getFaceCenter(geometry, faceIndex);
    if (normal && center && predicate(normal, center)) {
      return faceIndex;
    }
  }
  assert.fail('No matching face found');
}

function buildTransformedNonIndexedCylinderRuntime(): { mesh: THREE.Mesh; topFace: number; sideFace: number } {
  const robot = new THREE.Group();
  const link = new THREE.Group();
  (link as THREE.Object3D & { isURDFLink?: boolean }).isURDFLink = true;
  link.name = 'comp_a_base_link';
  link.position.set(-10, -4, -3);

  const geometry = new THREE.CylinderGeometry(1, 1, 2, 32).toNonIndexed();
  const topFace = findFaceIndex(
    geometry,
    (normal, center) => Math.abs(normal.y) > 0.9 && center.y > 0.5,
  );
  const sideFace = findFaceIndex(
    geometry,
    (normal, center) => Math.abs(normal.y) < 0.1 && center.x > 0.5,
  );
  const mesh = new THREE.Mesh(geometry);
  mesh.scale.set(2, 3, 0.5);
  link.add(mesh);
  robot.add(link);
  robot.updateMatrixWorld(true);
  return { mesh, topFace, sideFace };
}

function buildOversizedPlaneRuntime(): THREE.Mesh {
  const segmentCount = 25001;
  const positions: number[] = [];
  for (let segment = 0; segment <= segmentCount; segment += 1) {
    positions.push(segment, 0, 0, segment, 1, 0);
  }
  const indices: number[] = [];
  for (let segment = 0; segment < segmentCount; segment += 1) {
    const bottom = segment * 2;
    indices.push(bottom, bottom + 2, bottom + 3, bottom, bottom + 3, bottom + 1);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  geometry.setIndex(indices);

  const robot = new THREE.Group();
  const link = new THREE.Group();
  (link as THREE.Object3D & { isURDFLink?: boolean }).isURDFLink = true;
  link.name = 'comp_a_base_link';
  const mesh = new THREE.Mesh(geometry);
  link.add(mesh);
  robot.add(link);
  robot.updateMatrixWorld(true);
  return mesh;
}

function buildSlantedScaledPlaneRuntime(): THREE.Mesh {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.BufferAttribute(
      new Float32Array([
        0, 0, 0,
        1, -1, 0,
        2, 0, -2,
        0, 0, 0,
        2, 0, -2,
        1, 1, -2,
      ]),
      3,
    ),
  );

  const robot = new THREE.Group();
  const link = new THREE.Group();
  (link as THREE.Object3D & { isURDFLink?: boolean }).isURDFLink = true;
  link.name = 'comp_a_base_link';
  link.position.set(-3, -4, -5);
  const mesh = new THREE.Mesh(geometry);
  mesh.scale.set(2, 3, 0.5);
  mesh.rotation.z = 0.3;
  link.add(mesh);
  robot.add(link);
  robot.updateMatrixWorld(true);
  return mesh;
}

function buildCylinderRuntime(): { mesh: THREE.Mesh; topFace: number; sideFace: number } {
  const robot = new THREE.Group();
  const link = new THREE.Group();
  (link as THREE.Object3D & { isURDFLink?: boolean }).isURDFLink = true;
  link.name = 'comp_a_base_link';
  link.position.set(10, 0, 0);

  const geometry = new THREE.CylinderGeometry(1, 1, 2, 32);
  const topFace = findFaceIndex(
    geometry,
    (normal, center) => Math.abs(normal.y) > 0.9 && center.y > 0.5,
  );
  const sideFace = findFaceIndex(
    geometry,
    (normal, center) => Math.abs(normal.y) < 0.1 && center.x > 0.5,
  );
  const mesh = new THREE.Mesh(geometry);
  link.add(mesh);
  robot.add(link);
  robot.updateMatrixWorld(true);
  return { mesh, topFace, sideFace };
}

const ASSEMBLY_STATE = {
  name: 'workspace',
  transform: {
    position: { x: 0, y: 0, z: 0 },
    rotation: { r: 0, p: 0, y: 0 },
  },
  components: {
    comp_a: {
      id: 'comp_a',
      name: 'A',
      sourceFile: 'a.urdf',
      transform: {
        position: { x: 0, y: 0, z: 0 },
        rotation: { r: 0, p: 0, y: 0 },
      },
      visible: true,
      robot: {
        name: 'A',
        rootLinkId: 'comp_a_base_link',
        links: {
          comp_a_base_link: {
            ...structuredClone(DEFAULT_LINK),
            id: 'comp_a_base_link',
            name: 'base_link',
          },
        },
        joints: {},
      },
    },
  },
  bridges: {},
} satisfies AssemblyState;
const SCENE_PROJECTION = createAssemblySceneProjection(ASSEMBLY_STATE);

test('resolveJointSnapFromHit maps a hit back to its component link and world frame', () => {
  const { mesh } = buildRuntime();

  const result = resolveJointSnapFromHit(
    { object: mesh, faceIndex: 0, point: new THREE.Vector3(10.5, 0.3, 0) },
    SCENE_PROJECTION,
    ['surface', 'faceCenter'],
  );

  assert.ok(result);
  assert.equal(result!.componentId, 'comp_a');
  assert.equal(result!.linkId, 'comp_a_base_link');
  assertVecNearlyEqual(
    new THREE.Vector3().setFromMatrixPosition(result!.linkWorldMatrix),
    new THREE.Vector3(10, 0, 0),
  );

  const kinds = result!.candidates.map((candidate) => candidate.kind).sort();
  assert.deepEqual(kinds, ['faceCenter', 'surface']);

  const faceCenter = result!.candidates.find((candidate) => candidate.kind === 'faceCenter');
  assertVecNearlyEqual(faceCenter!.pointWorld, new THREE.Vector3(10 + 2 / 3, 2 / 3, 0));
  assert.equal(result!.recommended, result!.chosen);
  assert.equal(result!.region.trianglesWorld.length, 3);
  assert.equal(result!.region.boundaryLoops.length, 1);
  assertVecNearlyEqual(result!.region.centerWorld, new THREE.Vector3(10 + 2 / 3, 2 / 3, 0));
  assert.equal(result!.region.featureKind, 'planar');
  assert.equal(result!.region.truncated, false);
});

test('resolveJointSnapFromHit prefers smart face candidates over raw surface hits', () => {
  const { mesh } = buildRuntime();

  const result = resolveJointSnapFromHit(
    { object: mesh, faceIndex: 0, point: new THREE.Vector3(10.5, 0.3, 0) },
    SCENE_PROJECTION,
    ['surface', 'faceCenter'],
  );

  assert.equal(result!.chosen.kind, 'faceCenter');
  assertVecNearlyEqual(result!.chosen.pointWorld, new THREE.Vector3(10 + 2 / 3, 2 / 3, 0));
});

test('resolved region ids are stable until geometry or world transform changes', () => {
  const { mesh } = buildRuntime();
  const hitPoint = new THREE.Vector3(10.5, 0.3, 0);
  const first = resolveJointSnapFromHit(
    { object: mesh, faceIndex: 0, point: hitPoint },
    SCENE_PROJECTION,
    null,
  );
  const repeated = resolveJointSnapFromHit(
    { object: mesh, faceIndex: 0, point: hitPoint },
    SCENE_PROJECTION,
    null,
  );

  assert.equal(repeated!.region.id, first!.region.id);

  mesh.position.x = 0.25;
  mesh.parent!.updateMatrixWorld(true);
  const moved = resolveJointSnapFromHit(
    { object: mesh, faceIndex: 0, point: hitPoint.clone().add(new THREE.Vector3(0.25, 0, 0)) },
    SCENE_PROJECTION,
    null,
  );
  assert.notEqual(moved!.region.id, first!.region.id);
});

test('chooseSnapCandidate uses screen radius and priority while ignoring surface as an active snap', () => {
  const camera = buildCamera();
  const hitPoint = new THREE.Vector3(0, 0, 0);
  const chosen = chooseSnapCandidate(
    [
      candidate('surface', hitPoint.clone()),
      candidate('bboxCenter', new THREE.Vector3(0.2, 0, 0)),
      candidate('faceCenter', new THREE.Vector3(0.05, 0, 0)),
    ],
    hitPoint,
    { camera, domSize: { width: 1000, height: 1000 } },
  );

  assert.equal(chosen.kind, 'faceCenter');
});

test('chooseSnapCandidate keeps the planar region center active across the whole hovered face', () => {
  const camera = buildCamera();
  const hitPoint = new THREE.Vector3(0.9, 0, 0);
  const chosen = chooseSnapCandidate(
    [candidate('surface', hitPoint.clone()), candidate('faceCenter', new THREE.Vector3(0, 0, 0))],
    hitPoint,
    { camera, domSize: { width: 1000, height: 1000 } },
  );

  assert.equal(chosen.kind, 'faceCenter');
});

test('chooseSnapCandidate only activates a circular hole center near its marker', () => {
  const camera = buildCamera();
  const faceCenter = candidate('faceCenter', new THREE.Vector3(0, 0, 0));
  const holeCenter = {
    ...candidate('circleCenter', new THREE.Vector3(0.5, 0, 0)),
    isHole: true,
  };
  const options = { camera, domSize: { width: 1000, height: 1000 } };

  assert.equal(
    chooseSnapCandidate(
      [candidate('surface', new THREE.Vector3(-0.8, 0, 0)), faceCenter, holeCenter],
      new THREE.Vector3(-0.8, 0, 0),
      options,
    ).kind,
    'faceCenter',
  );
  assert.equal(
    chooseSnapCandidate(
      [candidate('surface', new THREE.Vector3(0.49, 0, 0)), faceCenter, holeCenter],
      new THREE.Vector3(0.49, 0, 0),
      options,
    ).kind,
    'circleCenter',
  );
});

test('chooseSnapCandidate only activates a low-confidence polygon circle near its marker', () => {
  const camera = buildCamera();
  const faceCenter = candidate('faceCenter', new THREE.Vector3(0, 0, 0));
  const polygonCenter = {
    ...candidate('circleCenter', new THREE.Vector3(0.5, 0, 0)),
    confidence: 0.6,
  };
  const options = { camera, domSize: { width: 1000, height: 1000 } };

  assert.equal(
    chooseSnapCandidate(
      [candidate('surface', new THREE.Vector3(-0.8, 0, 0)), faceCenter, polygonCenter],
      new THREE.Vector3(-0.8, 0, 0),
      options,
    ).kind,
    'faceCenter',
  );
  assert.equal(
    chooseSnapCandidate(
      [candidate('surface', new THREE.Vector3(0.49, 0, 0)), faceCenter, polygonCenter],
      new THREE.Vector3(0.49, 0, 0),
      options,
    ).kind,
    'circleCenter',
  );
});

test('default STL candidates use the welded logical boundary instead of the internal seam', () => {
  const mesh = buildNonIndexedRectangleRuntime();
  const hitPoint = new THREE.Vector3(11, 1, 0);
  const result = resolveJointSnapFromHit(
    { object: mesh, faceIndex: 0, point: hitPoint },
    SCENE_PROJECTION,
    null,
  );

  assert.ok(result);
  assert.equal(result!.region.featureKind, 'planar');
  assert.ok(result!.candidates.some((entry) => entry.kind === 'geometryCenter'));
  const edge = result!.candidates.find((entry) => entry.kind === 'edgeMidpoint');
  assert.ok(edge);
  assert.notDeepEqual(edge!.pointWorld.toArray(), hitPoint.toArray());
  assert.ok(
    [
      new THREE.Vector3(11, 0, 0),
      new THREE.Vector3(12, 1, 0),
      new THREE.Vector3(11, 2, 0),
      new THREE.Vector3(10, 1, 0),
    ]
      .some((expected) => edge!.pointWorld.distanceTo(expected) < 1e-6),
  );
});

test('chooseSnapCandidate can override to a free surface point', () => {
  const hitPoint = new THREE.Vector3(0, 0, 0);
  const chosen = chooseSnapCandidate(
    [
      candidate('surface', hitPoint.clone()),
      candidate('faceCenter', new THREE.Vector3(0.05, 0, 0)),
    ],
    hitPoint,
    { freePointOverride: true },
  );

  assert.equal(chosen.kind, 'surface');
  assertVecNearlyEqual(chosen.pointWorld, hitPoint);
});

test('resolveJointSnapFromHit adds and chooses circle center candidates', () => {
  const { mesh, topFace } = buildCylinderRuntime();

  const result = resolveJointSnapFromHit(
    { object: mesh, faceIndex: topFace, point: new THREE.Vector3(10.6, 1, 0.2) },
    SCENE_PROJECTION,
    null,
  );

  assert.ok(result);
  assert.equal(result!.chosen.kind, 'circleCenter');
  assert.ok(result!.candidates.some((candidate) => candidate.kind === 'circleCenter'));
  assertVecNearlyEqual(result!.chosen.pointWorld, new THREE.Vector3(10, 1, 0));
  assert.equal(result!.chosen.id, 'circleCenter:0');
  assert.equal(result!.region.boundaryLoops[0].circle?.candidateId, 'circleCenter:0');
});

test('resolveJointSnapFromHit fits a stable cylinder axis from a side hit', () => {
  const { mesh, sideFace } = buildCylinderRuntime();
  const localHit = getFaceCenter(mesh.geometry, sideFace)!;
  const hitPoint = localHit.clone().applyMatrix4(mesh.matrixWorld);

  const result = resolveJointSnapFromHit(
    { object: mesh, faceIndex: sideFace, point: hitPoint },
    SCENE_PROJECTION,
    null,
  );

  assert.ok(result);
  assert.equal(result!.region.featureKind, 'cylindrical');
  assert.equal(result!.chosen.kind, 'cylinderAxis');
  assert.equal(result!.region.cylinderAxis?.candidateId, 'cylinderAxis');
  assertVecNearlyEqual(result!.chosen.pointWorld, new THREE.Vector3(10, 0, 0));
  assertVecNearlyEqual(
    new THREE.Vector3().setFromMatrixColumn(result!.chosen.poseWorld, 2),
    new THREE.Vector3(0, 1, 0),
  );
});

test('cylinder axis direction remains correct under non-uniform scaling', () => {
  const { mesh, sideFace } = buildTransformedNonIndexedCylinderRuntime();
  const hitPoint = getFaceCenter(mesh.geometry, sideFace)!.applyMatrix4(mesh.matrixWorld);
  const result = resolveJointSnapFromHit(
    { object: mesh, faceIndex: sideFace, point: hitPoint },
    SCENE_PROJECTION,
    null,
  );

  assert.ok(result);
  assert.equal(result!.chosen.kind, 'cylinderAxis');
  assertVecNearlyEqual(result!.chosen.pointWorld, new THREE.Vector3(-10, -4, -3));
  assertVecNearlyEqual(
    new THREE.Vector3().setFromMatrixColumn(result!.chosen.poseWorld, 2),
    new THREE.Vector3(0, 1, 0),
  );
});

test('resolveJointSnapFromHit returns a world-space region for non-indexed geometry in negative space', () => {
  const { mesh, topFace } = buildTransformedNonIndexedCylinderRuntime();
  const result = resolveJointSnapFromHit(
    { object: mesh, faceIndex: topFace, point: new THREE.Vector3(-9, -1, -3) },
    SCENE_PROJECTION,
    null,
  );

  assert.ok(result);
  assert.equal(result!.chosen.kind, 'circleCenter');
  assertVecNearlyEqual(result!.chosen.pointWorld, new THREE.Vector3(-10, -1, -3));
  assertVecNearlyEqual(result!.region.centerWorld, new THREE.Vector3(-10, -1, -3), 1e-3);
  assert.ok(result!.region.trianglesWorld.length > 3);
  assert.equal(result!.region.boundaryLoops.length, 1);
  assert.ok(result!.region.boundaryLoops[0].pointsWorld.every((point) => point.x < -7.9));

  const poseZ = new THREE.Vector3().setFromMatrixColumn(result!.chosen.poseWorld, 2);
  assertVecNearlyEqual(poseZ, result!.region.normalWorld);
});

test('resolveJointSnapFromHit applies inverse-transpose normals under non-uniform transforms', () => {
  const mesh = buildSlantedScaledPlaneRuntime();
  const localHit = new THREE.Vector3(0.5, -0.25, -0.25);
  const worldHit = localHit.clone().applyMatrix4(mesh.matrixWorld);
  const result = resolveJointSnapFromHit(
    { object: mesh, faceIndex: 0, point: worldHit },
    SCENE_PROJECTION,
    null,
  );

  assert.ok(result);
  const localNormal = getFaceNormal(mesh.geometry, 0)!;
  const expectedWorldNormal = localNormal
    .clone()
    .applyMatrix3(new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld))
    .normalize();
  assertVecNearlyEqual(result!.region.normalWorld, expectedWorldNormal);
  assertVecNearlyEqual(
    new THREE.Vector3().setFromMatrixColumn(result!.chosen.poseWorld, 2),
    expectedWorldNormal,
  );
});

test('free-point override keeps the smart candidate available as recommended', () => {
  const { mesh, topFace } = buildCylinderRuntime();
  const hitPoint = new THREE.Vector3(10.6, 1, 0.2);
  const result = resolveJointSnapFromHit(
    { object: mesh, faceIndex: topFace, point: hitPoint },
    SCENE_PROJECTION,
    null,
    { freePointOverride: true },
  );

  assert.equal(result!.chosen.kind, 'surface');
  assert.equal(result!.recommended.kind, 'circleCenter');
  assertVecNearlyEqual(result!.chosen.pointWorld, hitPoint);
});

test('face-budget overflow falls back only to the hit surface in the default profile', () => {
  const mesh = buildOversizedPlaneRuntime();
  const hitPoint = new THREE.Vector3(0.25, 0.25, 0);
  const result = resolveJointSnapFromHit(
    { object: mesh, faceIndex: 0, point: hitPoint },
    SCENE_PROJECTION,
    null,
  );

  assert.ok(result);
  assert.equal(result!.region.isFallback, true);
  assert.equal(result!.region.featureKind, 'surface');
  assert.equal(result!.region.truncated, true);
  assert.deepEqual(result!.candidates.map((entry) => entry.kind), ['surface']);
  assert.equal(result!.chosen.kind, 'surface');
  assert.equal(result!.recommended.kind, 'surface');
  assertVecNearlyEqual(result!.chosen.pointWorld, hitPoint);
});

test('resolveJointSnapFromHit returns null for hits without a link ancestor or face', () => {
  const { mesh, orphan } = buildRuntime();

  assert.equal(
    resolveJointSnapFromHit({ object: orphan, faceIndex: 0, point: new THREE.Vector3() }, SCENE_PROJECTION, null),
    null,
  );
  assert.equal(
    resolveJointSnapFromHit({ object: mesh, faceIndex: null, point: new THREE.Vector3() }, SCENE_PROJECTION, null),
    null,
  );
});
