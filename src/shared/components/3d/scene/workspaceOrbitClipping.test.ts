import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import {
  DEFAULT_WORKSPACE_ORBIT_CLIPPING,
  syncWorkspaceClipPlanes,
  syncWorkspacePerspectiveClipPlanes,
} from './workspaceOrbitClipping.ts';

test('syncWorkspacePerspectiveClipPlanes tightens perspective clip planes for close inspection', () => {
  const camera = new THREE.PerspectiveCamera(60, 1, 5, 50);
  camera.position.set(0.24, 0.24, 0.24);

  const controls = {
    target: new THREE.Vector3(0, 0, 0),
  };

  const changed = syncWorkspacePerspectiveClipPlanes(camera, controls);

  assert.equal(changed, true);

  const distance = camera.position.distanceTo(controls.target);
  const expectedNear = THREE.MathUtils.clamp(
    distance * DEFAULT_WORKSPACE_ORBIT_CLIPPING.nearFactor,
    DEFAULT_WORKSPACE_ORBIT_CLIPPING.minNear,
    DEFAULT_WORKSPACE_ORBIT_CLIPPING.maxNear,
  );
  const expectedFar = Math.max(
    expectedNear + 10,
    THREE.MathUtils.clamp(
      distance * DEFAULT_WORKSPACE_ORBIT_CLIPPING.farFactor,
      DEFAULT_WORKSPACE_ORBIT_CLIPPING.minFar,
      DEFAULT_WORKSPACE_ORBIT_CLIPPING.maxFar,
    ),
  );

  assert.equal(camera.near, expectedNear);
  assert.equal(camera.far, expectedFar);
  assert.ok(camera.near <= 0.01, 'expected near plane to stay conservative for close zooms');
});

test('syncWorkspacePerspectiveClipPlanes keeps shallow zoom depth ranges tight', () => {
  const camera = new THREE.PerspectiveCamera(60, 1, 5, 50);
  camera.position.set(0.1, 0, 0);

  const controls = {
    target: new THREE.Vector3(0, 0, 0),
  };

  const changed = syncWorkspacePerspectiveClipPlanes(camera, controls);

  assert.equal(changed, true);
  assert.equal(camera.near, DEFAULT_WORKSPACE_ORBIT_CLIPPING.minNear);
  assert.equal(camera.far, DEFAULT_WORKSPACE_ORBIT_CLIPPING.minFar);
  assert.ok(
    camera.far / camera.near <= 20_000,
    'expected min zoom depth ratio to stay within the z-fighting budget',
  );
});

test('syncWorkspacePerspectiveClipPlanes keeps close-inspection targets beyond the near plane', () => {
  const camera = new THREE.PerspectiveCamera(60, 1, 5, 50);
  camera.position.set(DEFAULT_WORKSPACE_ORBIT_CLIPPING.minDistance, 0, 0);

  const controls = {
    target: new THREE.Vector3(0, 0, 0),
  };

  syncWorkspacePerspectiveClipPlanes(camera, controls);

  const targetDistance = camera.position.distanceTo(controls.target);
  assert.ok(camera.near < targetDistance);
  assert.equal(
    camera.near,
    DEFAULT_WORKSPACE_ORBIT_CLIPPING.minDistance * 0.1,
  );
  assert.equal(camera.far, DEFAULT_WORKSPACE_ORBIT_CLIPPING.minFar);
});

test('syncWorkspacePerspectiveClipPlanes keeps zoomed-out depth precision usable', () => {
  const camera = new THREE.PerspectiveCamera(60, 1, 5, 50);
  camera.position.set(2, -2, 2);

  const controls = {
    target: new THREE.Vector3(0, 0, 0),
  };

  const changed = syncWorkspacePerspectiveClipPlanes(camera, controls);

  assert.equal(changed, true);
  assert.ok(camera.near >= 0.03, 'expected zoomed-out near plane to rise with distance');
  assert.ok(camera.far <= 500, 'expected zoomed-out far plane to stay well below the old 900+ range');
  assert.ok(
    camera.far / camera.near <= 20_000,
    'expected zoomed-out depth ratio to stay within the z-fighting budget',
  );
});

test('syncWorkspacePerspectiveClipPlanes leaves orthographic cameras untouched', () => {
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.5, 500);
  const controls = {
    target: new THREE.Vector3(0, 0, 0),
  };

  const changed = syncWorkspacePerspectiveClipPlanes(camera, controls);

  assert.equal(changed, false);
  assert.equal(camera.near, 0.5);
  assert.equal(camera.far, 500);
});

test('syncWorkspaceClipPlanes keeps orthographic close-inspection targets beyond the near plane', () => {
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 5, 50);
  camera.position.set(DEFAULT_WORKSPACE_ORBIT_CLIPPING.minDistance, 0, 0);

  const controls = {
    target: new THREE.Vector3(0, 0, 0),
  };

  const changed = syncWorkspaceClipPlanes(camera, controls);

  const targetDistance = camera.position.distanceTo(controls.target);
  assert.equal(changed, true);
  assert.ok(camera.near < targetDistance);
  assert.equal(
    camera.near,
    DEFAULT_WORKSPACE_ORBIT_CLIPPING.minDistance * 0.1,
  );
  assert.equal(camera.far, DEFAULT_WORKSPACE_ORBIT_CLIPPING.minFar);
});

test('syncWorkspacePerspectiveClipPlanes limits the far plane to the visible scene bounds', () => {
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 5000);
  camera.position.set(5, 0, 0);

  const controls = {
    target: new THREE.Vector3(0, 0, 0),
  };
  const sceneBounds = new THREE.Box3(
    new THREE.Vector3(-1, -1, -1),
    new THREE.Vector3(1, 1, 1),
  );

  syncWorkspacePerspectiveClipPlanes(camera, controls, { sceneBounds });

  assert.ok(camera.far < 100, 'expected far plane to stay close to the visible scene');
  assert.ok(camera.far > 8, 'expected far plane to still include the full bounded scene');
});
