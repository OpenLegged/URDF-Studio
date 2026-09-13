import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import {
  shouldBlockBackgroundInteractionForGizmoHit,
  shouldPreserveSelectionForGizmoPointerDown,
} from './raycast';

function createGizmoHit(axis: string | null): THREE.Object3D {
  const controls = new THREE.Group() as THREE.Group & {
    axis: string | null;
    dragging: boolean;
    isTransformControlsGizmo?: boolean;
  };
  controls.isTransformControlsGizmo = true;
  controls.axis = axis;
  controls.dragging = false;

  const hitObject = new THREE.Mesh();
  controls.add(hitObject);
  return hitObject;
}

function createVisibleHandleHit(axis: string): THREE.Object3D {
  const hitObject = createGizmoHit(null);
  hitObject.userData = {
    urdfAxis: axis,
    urdfVisibleHandleTarget: true,
  };
  return hitObject;
}

function createVisibleSurfaceHit(axis: string): THREE.Object3D {
  const hitObject = createGizmoHit(null);
  hitObject.userData = {
    urdfAxis: axis,
    urdfVisibleGizmoSurface: true,
  };
  return hitObject;
}

test('shouldBlockBackgroundInteractionForGizmoHit blocks hover only for visible gizmo handles', () => {
  assert.equal(shouldBlockBackgroundInteractionForGizmoHit(createGizmoHit('X')), true);
  assert.equal(shouldBlockBackgroundInteractionForGizmoHit(createVisibleHandleHit('Y')), true);
  assert.equal(shouldBlockBackgroundInteractionForGizmoHit(createVisibleSurfaceHit('Z')), false);
  assert.equal(shouldBlockBackgroundInteractionForGizmoHit(createGizmoHit(null)), false);
  assert.equal(shouldBlockBackgroundInteractionForGizmoHit(new THREE.Mesh()), false);
});

test('shouldPreserveSelectionForGizmoPointerDown preserves selection only for visible handles', () => {
  assert.equal(shouldPreserveSelectionForGizmoPointerDown(createGizmoHit('X')), true);
  assert.equal(shouldPreserveSelectionForGizmoPointerDown(createVisibleHandleHit('Z')), true);
  assert.equal(shouldPreserveSelectionForGizmoPointerDown(createVisibleSurfaceHit('X')), false);
  assert.equal(shouldPreserveSelectionForGizmoPointerDown(createGizmoHit(null)), false);
  assert.equal(shouldPreserveSelectionForGizmoPointerDown(new THREE.Mesh()), false);
});
