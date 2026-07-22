import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { detectCircleFaceFromHit, kasaCircleFit } from './circleFaceDetect.ts';
import { getFaceCenter, getFaceNormal } from './meshSnapPoints.ts';

function assertNearlyEqual(actual: number, expected: number, tolerance = 1e-5, message?: string) {
  assert.ok(Math.abs(actual - expected) <= tolerance, message ?? `${actual} !== ${expected}`);
}

function assertVecNearlyEqual(
  actual: THREE.Vector3,
  expected: THREE.Vector3,
  tolerance = 1e-5,
  message?: string,
) {
  assert.ok(actual.distanceTo(expected) <= tolerance, message ?? `${actual.toArray()} !== ${expected.toArray()}`);
}

function circlePoints(radius: number, centerX: number, centerY: number, count: number, noise = 0) {
  return Array.from({ length: count }, (_, index) => {
    const angle = (Math.PI * 2 * index) / count;
    const offset = noise * Math.sin(index * 1.7);
    return {
      x: centerX + (radius + offset) * Math.cos(angle),
      y: centerY + (radius + offset) * Math.sin(angle),
    };
  });
}

function findFaceIndex(
  geometry: THREE.BufferGeometry,
  predicate: (normal: THREE.Vector3, center: THREE.Vector3) => boolean,
): number {
  const faceCount = (geometry.getIndex()?.count ?? 0) / 3;
  for (let faceIndex = 0; faceIndex < faceCount; faceIndex += 1) {
    const normal = getFaceNormal(geometry, faceIndex);
    const center = getFaceCenter(geometry, faceIndex);
    if (normal && center && predicate(normal, center)) {
      return faceIndex;
    }
  }
  assert.fail('No matching face found');
}

function ellipseFanGeometry(radiusX: number, radiusZ: number, segments: number): THREE.BufferGeometry {
  const vertices = [0, 0, 0];
  for (let i = 0; i < segments; i += 1) {
    const angle = (Math.PI * 2 * i) / segments;
    vertices.push(radiusX * Math.cos(angle), 0, radiusZ * Math.sin(angle));
  }
  const indices: number[] = [];
  for (let i = 1; i <= segments; i += 1) {
    const next = i === segments ? 1 : i + 1;
    indices.push(0, i, next);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vertices), 3));
  geometry.setIndex(indices);
  return geometry;
}

test('kasaCircleFit fits exact and noisy circles', () => {
  const exact = kasaCircleFit(circlePoints(2, 1, -0.5, 24));
  assert.ok(exact);
  assertNearlyEqual(exact!.center.x, 1);
  assertNearlyEqual(exact!.center.y, -0.5);
  assertNearlyEqual(exact!.radius, 2);

  const noisy = kasaCircleFit(circlePoints(3, -1, 0.25, 48, 0.01));
  assert.ok(noisy);
  assertNearlyEqual(noisy!.center.x, -1, 0.01);
  assertNearlyEqual(noisy!.center.y, 0.25, 0.01);
  assertNearlyEqual(noisy!.radius, 3, 0.01);
});

test('kasaCircleFit rejects degenerate point sets', () => {
  assert.equal(kasaCircleFit([{ x: 0, y: 0 }, { x: 1, y: 0 }]), null);
  assert.equal(kasaCircleFit([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }]), null);
});

test('detectCircleFaceFromHit detects a cylinder cap circle', () => {
  const geometry = new THREE.CylinderGeometry(2, 2, 3, 48);
  const topFace = findFaceIndex(
    geometry,
    (normal, center) => Math.abs(normal.y) > 0.9 && center.y > 1,
  );

  const result = detectCircleFaceFromHit(geometry, topFace);
  assert.ok(result);
  assertVecNearlyEqual(result!.center, new THREE.Vector3(0, 1.5, 0), 1e-4);
  assertNearlyEqual(result!.radius, 2, 1e-4);
  assert.ok(Math.abs(result!.normal.y) > 0.9);
  assert.ok(result!.rmsRatio < 1e-4);
});

test('detectCircleFaceFromHit returns null for cylinder side faces and box faces', () => {
  const cylinder = new THREE.CylinderGeometry(1, 1, 2, 32);
  const sideFace = findFaceIndex(cylinder, (normal) => Math.abs(normal.y) < 0.1);
  assert.equal(detectCircleFaceFromHit(cylinder, sideFace), null);

  const box = new THREE.BoxGeometry(1, 1, 1);
  assert.equal(detectCircleFaceFromHit(box, 0), null);
});

test('detectCircleFaceFromHit rejects non-circular coplanar regions by RMS', () => {
  const ellipse = ellipseFanGeometry(2, 1, 32);
  assert.equal(detectCircleFaceFromHit(ellipse, 0), null);
});

test('detectCircleFaceFromHit detects STL-style non-indexed cylinder caps', () => {
  const geometry = new THREE.CylinderGeometry(1, 1, 2, 24).toNonIndexed();
  const capFace = Array.from({ length: geometry.getAttribute('position').count / 3 }, (_, index) => index)
    .find((faceIndex) => {
      const normal = getFaceNormal(geometry, faceIndex);
      const center = getFaceCenter(geometry, faceIndex);
      return normal && center && Math.abs(normal.y) > 0.9 && center.y > 0.5;
    });
  assert.notEqual(capFace, undefined);

  const result = detectCircleFaceFromHit(geometry, capFace!);
  assert.ok(result);
  assertVecNearlyEqual(result!.center, new THREE.Vector3(0, 1, 0), 1e-4);
  assertNearlyEqual(result!.radius, 1, 1e-4);
});

test('detectCircleFaceFromHit reuses the geometry topology cache', () => {
  const geometry = new THREE.CylinderGeometry(1, 1, 2, 32);
  const capFace = findFaceIndex(
    geometry,
    (normal, center) => Math.abs(normal.y) > 0.9 && center.y > 0.5,
  );

  assert.ok(detectCircleFaceFromHit(geometry, capFace));
  const cache = geometry.userData.__planarRegionTopologyCache;
  assert.ok(cache);
  assert.equal(Object.keys(geometry.userData).includes('__planarRegionTopologyCache'), false);
  assert.ok(detectCircleFaceFromHit(geometry, capFace));
  assert.equal(geometry.userData.__planarRegionTopologyCache, cache);

  geometry.getAttribute('position').needsUpdate = true;
  assert.ok(detectCircleFaceFromHit(geometry, capFace));
  assert.notEqual(geometry.userData.__planarRegionTopologyCache, cache);
});
