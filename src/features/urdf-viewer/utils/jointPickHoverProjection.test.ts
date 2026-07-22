import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import {
  findCandidateNearPointer,
  isPointerInsideProjectedLoop,
  isPointerInsideProjectedRegion,
  worldRadiusForPixels,
} from './jointPickHoverProjection.ts';

function buildCamera(): THREE.OrthographicCamera {
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  camera.position.set(0, 0, 5);
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  return camera;
}

const VIEWPORT = { width: 1000, height: 1000 };

test('findCandidateNearPointer selects a visible candidate by screen-space radius', () => {
  const camera = buildCamera();
  const center = { id: 'center', pointWorld: new THREE.Vector3(0, 0, 0) };
  const offset = { id: 'offset', pointWorld: new THREE.Vector3(0.4, 0, 0) };

  assert.equal(
    findCandidateNearPointer({
      candidates: [center, offset],
      pointer: new THREE.Vector2(0.015, 0),
      camera,
      viewport: VIEWPORT,
      radiusPx: 10,
    }),
    center,
  );
  assert.equal(
    findCandidateNearPointer({
      candidates: [center, offset],
      pointer: new THREE.Vector2(0.08, 0),
      camera,
      viewport: VIEWPORT,
      radiusPx: 10,
    }),
    null,
  );
});

test('isPointerInsideProjectedRegion keeps a planar candidate alive over negative space', () => {
  const camera = buildCamera();
  const outerLoop = [
    new THREE.Vector3(-0.6, -0.6, 0),
    new THREE.Vector3(0.6, -0.6, 0),
    new THREE.Vector3(0.6, 0.6, 0),
    new THREE.Vector3(-0.6, 0.6, 0),
  ];
  const holeLoop = [
    new THREE.Vector3(-0.15, -0.15, 0),
    new THREE.Vector3(0.15, -0.15, 0),
    new THREE.Vector3(0.15, 0.15, 0),
    new THREE.Vector3(-0.15, 0.15, 0),
  ];

  assert.equal(
    isPointerInsideProjectedRegion(
      [outerLoop, holeLoop],
      new THREE.Vector2(0, 0),
      camera,
      VIEWPORT,
    ),
    true,
    'the outer boundary should retain hover while the pointer crosses a hole',
  );
  assert.equal(
    isPointerInsideProjectedRegion(
      [outerLoop, holeLoop],
      new THREE.Vector2(0.9, 0.9),
      camera,
      VIEWPORT,
    ),
    false,
  );
  assert.equal(
    isPointerInsideProjectedLoop(holeLoop, new THREE.Vector2(0, 0), camera, VIEWPORT),
    true,
  );
  assert.equal(
    isPointerInsideProjectedLoop(holeLoop, new THREE.Vector2(0.4, 0.4), camera, VIEWPORT),
    false,
  );
});

test('worldRadiusForPixels keeps marker size stable for orthographic and perspective cameras', () => {
  const orthographic = buildCamera();
  assert.ok(
    Math.abs(worldRadiusForPixels(new THREE.Vector3(), orthographic, VIEWPORT.height, 10) - 0.02)
      < 1e-6,
  );

  const perspective = new THREE.PerspectiveCamera(90, 1, 0.1, 100);
  perspective.position.set(0, 0, 5);
  perspective.lookAt(0, 0, 0);
  perspective.updateProjectionMatrix();
  perspective.updateMatrixWorld(true);
  assert.ok(
    Math.abs(worldRadiusForPixels(new THREE.Vector3(), perspective, VIEWPORT.height, 10) - 0.1)
      < 1e-6,
  );
});
