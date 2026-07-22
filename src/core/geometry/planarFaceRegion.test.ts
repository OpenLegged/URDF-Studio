import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { detectCylinderFaceRegion } from './cylinderFaceRegion.ts';
import { detectPlanarFaceRegion } from './planarFaceRegion.ts';

function assertVecNearlyEqual(
  actual: THREE.Vector3,
  expected: THREE.Vector3,
  tolerance = 1e-5,
  message?: string,
) {
  assert.ok(
    actual.distanceTo(expected) <= tolerance,
    message ?? `${actual.toArray()} !== ${expected.toArray()}`,
  );
}

function geometryFromTriangles(triangles: number[][]): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.BufferAttribute(new Float32Array(triangles.flat()), 3),
  );
  return geometry;
}

function nonIndexedRectangle(options: { reverseSecondFace?: boolean; seamOffset?: number } = {}) {
  const seamOffset = options.seamOffset ?? 0;
  const first = [
    0, 0, 0,
    4, 0, 0,
    4, 2, 0,
  ];
  const second = options.reverseSecondFace
    ? [0 + seamOffset, 0, 0, 0, 2, 0, 4 + seamOffset, 2, 0]
    : [0 + seamOffset, 0, 0, 4 + seamOffset, 2, 0, 0, 2, 0];
  return geometryFromTriangles([first, second]);
}

test('detectPlanarFaceRegion welds non-indexed triangles and uses the area-weighted region center', () => {
  const region = detectPlanarFaceRegion(nonIndexedRectangle(), 0);

  assert.ok(region);
  assert.deepEqual(region!.faceIndices, [0, 1]);
  assertVecNearlyEqual(region!.center, new THREE.Vector3(2, 1, 0));
  assertVecNearlyEqual(region!.normal, new THREE.Vector3(0, 0, 1));
  assert.equal(region!.triangles.length, 6);
  assert.equal(region!.boundaryLoops.length, 1);
  assert.equal(region!.boundaryLoops[0].points.length, 4);
});

test('detectPlanarFaceRegion tolerates STL-style seams and inconsistent triangle winding', () => {
  const region = detectPlanarFaceRegion(
    nonIndexedRectangle({ reverseSecondFace: true, seamOffset: 1e-6 }),
    0,
  );

  assert.ok(region);
  assert.deepEqual(region!.faceIndices, [0, 1]);
  assertVecNearlyEqual(region!.center, new THREE.Vector3(2, 1, 0), 2e-6);
});

test('detectPlanarFaceRegion absorbs small STL plane noise without crossing a crease', () => {
  const noisyPlane = geometryFromTriangles([
    [0, 0, 0, 4, 0, 0, 4, 2, 4e-6],
    [0, 0, 0, 4, 2, 4e-6, 0, 2, -3e-6],
    [4, 0, 0, 5, 0, 0, 4, 2, 0.2],
  ]);

  const region = detectPlanarFaceRegion(noisyPlane, 0);

  assert.ok(region);
  assert.deepEqual(region!.faceIndices, [0, 1]);
});

test('detectPlanarFaceRegion does not merge disconnected coplanar islands', () => {
  const geometry = geometryFromTriangles([
    [-5, -2, 0, -3, -2, 0, -3, 0, 0],
    [-5, -2, 0, -3, 0, 0, -5, 0, 0],
    [2, 2, 0, 4, 2, 0, 4, 4, 0],
    [2, 2, 0, 4, 4, 0, 2, 4, 0],
  ]);

  const region = detectPlanarFaceRegion(geometry, 0);

  assert.ok(region);
  assert.deepEqual(region!.faceIndices, [0, 1]);
  assertVecNearlyEqual(region!.center, new THREE.Vector3(-4, -1, 0));
});

test('detectPlanarFaceRegion extracts concentric circular outer and hole boundaries', () => {
  const geometry = new THREE.RingGeometry(1, 2, 48).toNonIndexed();
  const region = detectPlanarFaceRegion(geometry, 0);

  assert.ok(region);
  assert.equal(region!.boundaryLoops.length, 2);
  assert.equal(region!.outerBoundaryLoopIndex, 0);
  assert.equal(region!.boundaryLoops[0].isHole, false);
  assert.equal(region!.boundaryLoops[1].isHole, true);
  assert.equal(region!.circleCandidates.length, 2);
  for (const candidate of region!.circleCandidates) {
    assertVecNearlyEqual(candidate.center, new THREE.Vector3(0, 0, 0), 1e-4);
    assert.ok(candidate.confidence > 0.99);
  }
  assert.ok(region!.circleCandidates.some((candidate) => Math.abs(candidate.radius - 1) < 1e-4));
  assert.ok(region!.circleCandidates.some((candidate) => Math.abs(candidate.radius - 2) < 1e-4));
});

test('detectPlanarFaceRegion rejects elliptical boundary loops as circle candidates', () => {
  const geometry = new THREE.RingGeometry(1, 2, 48).toNonIndexed();
  geometry.scale(2, 1, 1);

  const region = detectPlanarFaceRegion(geometry, 0);

  assert.ok(region);
  assert.equal(region!.circleCandidates.length, 0);
});

test('circle fitting marks six/seven-sided faces low-confidence and eight-sided faces high-confidence', () => {
  const hexagon = detectPlanarFaceRegion(new THREE.CircleGeometry(1, 6).toNonIndexed(), 0);
  const heptagon = detectPlanarFaceRegion(new THREE.CircleGeometry(1, 7).toNonIndexed(), 0);
  const octagon = detectPlanarFaceRegion(new THREE.CircleGeometry(1, 8).toNonIndexed(), 0);

  assert.ok(hexagon);
  assert.equal(hexagon!.circleCandidates.length, 1);
  assert.ok(hexagon!.circleCandidates[0].confidence < 0.8);
  assert.ok(heptagon);
  assert.equal(heptagon!.circleCandidates.length, 1);
  assert.ok(heptagon!.circleCandidates[0].confidence < 0.85);
  assert.ok(octagon);
  assert.equal(octagon!.circleCandidates.length, 1);
  assert.ok(octagon!.circleCandidates[0].confidence > 0.95);
});

test('detectCylinderFaceRegion fits a non-indexed cylinder side with mixed winding', () => {
  const geometry = new THREE.CylinderGeometry(2, 2, 6, 16, 1, true).toNonIndexed();
  const position = geometry.getAttribute('position') as THREE.BufferAttribute;
  for (let faceIndex = 1; faceIndex < position.count / 3; faceIndex += 2) {
    const first = new THREE.Vector3().fromBufferAttribute(position, faceIndex * 3);
    const second = new THREE.Vector3().fromBufferAttribute(position, faceIndex * 3 + 1);
    position.setXYZ(faceIndex * 3, second.x, second.y, second.z);
    position.setXYZ(faceIndex * 3 + 1, first.x, first.y, first.z);
  }
  position.needsUpdate = true;

  const cylinder = detectCylinderFaceRegion(geometry, 0);

  assert.ok(cylinder);
  assert.equal(cylinder!.radialFaceCount, 16);
  assert.ok(cylinder!.coverageRadians >= THREE.MathUtils.degToRad(300));
  assert.ok(cylinder!.rmsRatio < 0.03);
  assert.ok(Math.abs(cylinder!.radius - 2) < 1e-4);
  assert.ok(Math.abs(cylinder!.height - 6) < 1e-4);
  assert.ok(Math.abs(cylinder!.axis.y) > 0.999);
  assertVecNearlyEqual(cylinder!.center, new THREE.Vector3(0, 0, 0), 1e-4);
});

test('detectCylinderFaceRegion rejects low-sided prisms and partial arcs', () => {
  const hexagonal = new THREE.CylinderGeometry(1, 1, 2, 6, 1, true).toNonIndexed();
  assert.equal(detectCylinderFaceRegion(hexagonal, 0), null);

  const partial = new THREE.CylinderGeometry(1, 1, 2, 16, 1, true, 0, Math.PI).toNonIndexed();
  assert.equal(detectCylinderFaceRegion(partial, 0), null);
});

test('detectPlanarFaceRegion returns null when the connected face budget is exceeded', () => {
  assert.equal(detectPlanarFaceRegion(nonIndexedRectangle(), 0, { maxFaces: 1 }), null);
});
