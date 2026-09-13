import assert from 'node:assert/strict';
import test from 'node:test';

import { VISUALIZER_UNIFIED_GIZMO_SIZE } from '../../unified-transform-controls/gizmoCore';
import { resolveLocalTransformGizmoSizing } from './localTransformGizmoSizing';

test('origin transform gizmo uses local edit scale instead of the visualizer baseline', () => {
  const origin = resolveLocalTransformGizmoSizing('origin');
  const collision = resolveLocalTransformGizmoSizing('collision');

  assert.equal(origin.translateSize, VISUALIZER_UNIFIED_GIZMO_SIZE * 0.56);
  assert.equal(origin.rotateSize, VISUALIZER_UNIFIED_GIZMO_SIZE * 0.46);
  assert.equal(origin.translateSize, collision.translateSize);
  assert.equal(origin.rotateSize, collision.rotateSize);
  assert.ok(origin.translateSize < VISUALIZER_UNIFIED_GIZMO_SIZE * 0.7);
  assert.ok(origin.rotateSize < VISUALIZER_UNIFIED_GIZMO_SIZE * 0.6);
  assert.equal(origin.showRotateFreeHandles, true);
});

test('joint transform gizmo keeps single-axis rotation handles compact', () => {
  const joint = resolveLocalTransformGizmoSizing('joint');

  assert.equal(joint.translateSize, VISUALIZER_UNIFIED_GIZMO_SIZE * 0.68);
  assert.equal(joint.rotateSize, VISUALIZER_UNIFIED_GIZMO_SIZE * 0.57);
  assert.equal(joint.showRotateFreeHandles, false);
});
