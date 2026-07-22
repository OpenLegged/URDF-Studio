import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import {
  collectSnapCandidatesFromFace,
  getFaceCenter,
  getFaceNormal,
  getGeometryCenter,
  getNearestEdgeMidpointOnFace,
  getNearestVertexInRadius,
  getNearestVertexOnFace,
} from './meshSnapPoints.ts';

function vec(x: number, y: number, z: number): THREE.Vector3 {
  return new THREE.Vector3(x, y, z);
}

function assertVecNearlyEqual(actual: THREE.Vector3, expected: THREE.Vector3, message?: string) {
  assert.ok(actual.distanceTo(expected) < 1e-6, message ?? `${actual.toArray()} !== ${expected.toArray()}`);
}

function triangleGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array([0, 0, 0, 2, 0, 0, 0, 2, 0]);
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  return geometry;
}

test('getFaceCenter returns the triangle centroid', () => {
  assertVecNearlyEqual(getFaceCenter(triangleGeometry(), 0)!, vec(2 / 3, 2 / 3, 0));
});

test('getFaceNormal returns the geometric normal', () => {
  assertVecNearlyEqual(getFaceNormal(triangleGeometry(), 0)!, vec(0, 0, 1));
});

test('getNearestVertexOnFace picks the closest triangle vertex', () => {
  const geometry = triangleGeometry();
  assertVecNearlyEqual(getNearestVertexOnFace(geometry, 0, vec(0.1, 0.1, 0))!, vec(0, 0, 0));
  assertVecNearlyEqual(getNearestVertexOnFace(geometry, 0, vec(1.9, 0.1, 0))!, vec(2, 0, 0));
});

test('getNearestEdgeMidpointOnFace picks the closest edge midpoint', () => {
  assertVecNearlyEqual(getNearestEdgeMidpointOnFace(triangleGeometry(), 0, vec(1, -0.1, 0))!, vec(1, 0, 0));
});

test('getNearestVertexInRadius respects the radius', () => {
  const geometry = triangleGeometry();
  assertVecNearlyEqual(getNearestVertexInRadius(geometry, vec(0, 0, 0), 0.5)!, vec(0, 0, 0));
  assert.equal(getNearestVertexInRadius(geometry, vec(5, 5, 5), 0.5), null);
});

test('collectSnapCandidatesFromFace honors the filter and attaches the face normal', () => {
  const candidates = collectSnapCandidatesFromFace(triangleGeometry(), 0, vec(0.1, 0.1, 0), ['faceCenter']);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].kind, 'faceCenter');
  assertVecNearlyEqual(candidates[0].pointLocal, vec(2 / 3, 2 / 3, 0));
  assertVecNearlyEqual(candidates[0].normalLocal!, vec(0, 0, 1));
});

test('collectSnapCandidatesFromFace returns all face kinds when filter is null', () => {
  const candidates = collectSnapCandidatesFromFace(triangleGeometry(), 0, vec(0.1, 0.1, 0), null);
  const kinds = candidates.map((candidate) => candidate.kind).sort();
  assert.deepEqual(kinds, ['edgeMidpoint', 'faceCenter', 'surface', 'vertex']);
});

test('getGeometryCenter uses the volume centroid for a closed mesh with mixed winding', () => {
  const geometry = new THREE.BoxGeometry(2, 4, 6).toNonIndexed();
  geometry.translate(3, -2, 5);
  const position = geometry.getAttribute('position') as THREE.BufferAttribute;
  for (let faceIndex = 1; faceIndex < position.count / 3; faceIndex += 2) {
    const first = new THREE.Vector3().fromBufferAttribute(position, faceIndex * 3);
    const second = new THREE.Vector3().fromBufferAttribute(position, faceIndex * 3 + 1);
    position.setXYZ(faceIndex * 3, second.x, second.y, second.z);
    position.setXYZ(faceIndex * 3 + 1, first.x, first.y, first.z);
  }
  position.needsUpdate = true;

  const result = getGeometryCenter(geometry);

  assert.ok(result);
  assert.equal(result!.kind, 'volumeCentroid');
  assertVecNearlyEqual(result!.pointLocal, vec(3, -2, 5));
});

test('getGeometryCenter falls back to the bounding box for an open mesh', () => {
  const geometry = triangleGeometry();
  const result = getGeometryCenter(geometry);

  assert.ok(result);
  assert.equal(result!.kind, 'boundingBox');
  assertVecNearlyEqual(result!.pointLocal, vec(1, 1, 0));
});
