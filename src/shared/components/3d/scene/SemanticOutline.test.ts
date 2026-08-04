import assert from 'node:assert/strict';
import test from 'node:test';

import * as THREE from 'three';

import { isCameraPoseMoving, shouldRenderSemanticOutlineOverlay } from './SemanticOutline.tsx';

test('keeps semantic outlines out of a moving-camera render path when only hover targets exist', () => {
  // Hover-only outlines are suppressed during camera movement for performance —
  // the user is navigating, not picking.
  assert.equal(
    shouldRenderSemanticOutlineOverlay({
      hasTargets: true,
      cameraMoving: true,
      snapshotRenderActive: false,
    }),
    false,
  );
});

test('keeps selection outlines visible during camera movement', () => {
  // Selection is a persistent committed state.  Like Blender and Fusion 360,
  // the selection outline must remain visible even while the user orbits the
  // viewport — only transient hover outlines are suppressed.
  assert.equal(
    shouldRenderSemanticOutlineOverlay({
      hasTargets: true,
      cameraMoving: true,
      snapshotRenderActive: false,
      hasSelectionTargets: true,
    }),
    true,
  );
});

test('keeps semantic outlines on screen while an object drag moves the robot', () => {
  // Dragging a link to rotate its parent joint leaves the camera untouched, so
  // the hover/selection outline must survive the whole drag.
  assert.equal(
    shouldRenderSemanticOutlineOverlay({
      hasTargets: true,
      cameraMoving: false,
      snapshotRenderActive: false,
    }),
    true,
  );
});

test('restores semantic outlines for a settled interactive workspace', () => {
  assert.equal(
    shouldRenderSemanticOutlineOverlay({
      hasTargets: false,
      cameraMoving: false,
      snapshotRenderActive: false,
    }),
    false,
  );
  assert.equal(
    shouldRenderSemanticOutlineOverlay({
      hasTargets: true,
      cameraMoving: false,
      snapshotRenderActive: true,
    }),
    false,
  );
});

test('treats float rounding of an idle camera as still', () => {
  // Controls rewrite the camera transform every frame; the residual jitter must
  // not read as motion or the overlay would never come back after a camera move.
  const previousPosition = new THREE.Vector3(1, 2, 3);
  const previousQuaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.3, 0.4, 0.5));
  const quaternion = previousQuaternion.clone();
  quaternion.x += 1e-15;

  assert.equal(
    isCameraPoseMoving({
      position: previousPosition.clone().add(new THREE.Vector3(1e-15, -1e-15, 1e-15)),
      quaternion,
      zoom: 1,
      previousPosition,
      previousQuaternion,
      previousZoom: 1,
    }),
    false,
  );
});

test('reports real camera moves', () => {
  const previousPosition = new THREE.Vector3(1, 2, 3);
  const previousQuaternion = new THREE.Quaternion();

  assert.equal(
    isCameraPoseMoving({
      position: previousPosition.clone().add(new THREE.Vector3(0.01, 0, 0)),
      quaternion: previousQuaternion.clone(),
      zoom: 1,
      previousPosition,
      previousQuaternion,
      previousZoom: 1,
    }),
    true,
    'a camera dolly must suppress the overlay',
  );
  assert.equal(
    isCameraPoseMoving({
      position: previousPosition.clone(),
      quaternion: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0.01, 0)),
      zoom: 1,
      previousPosition,
      previousQuaternion,
      previousZoom: 1,
    }),
    true,
    'an orbit must suppress the overlay',
  );
  assert.equal(
    isCameraPoseMoving({
      position: previousPosition.clone(),
      quaternion: previousQuaternion.clone(),
      zoom: 1.2,
      previousPosition,
      previousQuaternion,
      previousZoom: 1,
    }),
    true,
    'an orthographic zoom must suppress the overlay',
  );
});
