import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { createDirectJointDragController, type DraggableRuntimeJoint } from './directJointDragController';

test('disposing an active direct joint drag clears target state and releases dragging UI', () => {
  const state = {
    isDraggingJoint: { current: false },
    dragJoint: { current: null as DraggableRuntimeJoint | null },
    runtimeValue: { current: null as number | null },
    hitDistance: { current: 0 },
    lastRay: { current: new THREE.Ray() },
  };
  const draggingChanges: boolean[] = [];
  const controller = createDirectJointDragController({
    state,
    robot: null,
    robotJoints: undefined,
    camera: new THREE.PerspectiveCamera(),
    renderer: {} as THREE.WebGLRenderer,
    throttleChanges: false,
    deferRuntimeUpdate: false,
    updatePointerFromLocalPoint: () => true,
    getCurrentRay: () => new THREE.Ray(),
    onChange: () => {},
    onCommit: () => {},
    onDraggingChange: (dragging) => draggingChanges.push(dragging),
    onActiveJointChange: () => {},
    invalidate: () => {},
  });
  const joint = new THREE.Object3D() as DraggableRuntimeJoint;
  joint.name = 'joint';
  joint.jointType = 'revolute';
  joint.angle = 0.4;

  controller.start(joint, 1, new THREE.Ray(), () => {});
  controller.dispose();

  assert.deepEqual(draggingChanges, [true, false]);
  assert.equal(state.isDraggingJoint.current, false);
  assert.equal(state.dragJoint.current, null);
  assert.equal(state.runtimeValue.current, null);
});
