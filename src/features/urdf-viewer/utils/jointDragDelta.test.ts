import test from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveRevoluteDragDelta,
  resolveRevoluteDragStep,
  resolveRevoluteTangentAngleDelta,
} from './jointDragDelta.ts';

test('normalizes edge-on tangent travel by the dragged link lever radius', () => {
  const delta = resolveRevoluteTangentAngleDelta({
    tangentDistance: 0.02,
    startRadius: 0.2,
    endRadius: 0.2,
  });

  assert.ok(Math.abs(delta - 0.1) < 1e-12);
});

test('ignores edge-on tangent travel when no stable lever radius is available', () => {
  assert.equal(
    resolveRevoluteTangentAngleDelta({
      tangentDistance: 0.02,
      startRadius: 0,
      endRadius: Number.NaN,
    }),
    0,
  );
});

test('preserves the remainder of a fast drag instead of dropping it at the step limit', () => {
  const firstStep = resolveRevoluteDragStep({
    pendingDelta: 0,
    nextDelta: 0.6,
    maxStep: Math.PI / 8,
  });
  const secondStep = resolveRevoluteDragStep({
    pendingDelta: firstStep.pendingDelta,
    maxStep: Math.PI / 8,
  });

  assert.equal(firstStep.appliedDelta, Math.PI / 8);
  assert.ok(Math.abs(firstStep.appliedDelta + secondStep.appliedDelta - 0.6) < 1e-12);
  assert.equal(secondStep.pendingDelta, 0);
});

test('uses the projected plane angle when the camera is facing the joint plane', () => {
  assert.equal(
    resolveRevoluteDragDelta({
      worldDelta: 0.24,
      tangentDelta: -0.08,
      planeFacingRatio: 0.92,
    }),
    0.24,
  );
});

test('switches to tangent dragging when the joint plane is nearly edge-on', () => {
  assert.equal(
    resolveRevoluteDragDelta({
      worldDelta: 0.03,
      tangentDelta: -0.12,
      planeFacingRatio: 0.08,
    }),
    -0.12,
  );
});

test('falls back to the projected plane angle when tangent dragging is unavailable', () => {
  assert.equal(
    resolveRevoluteDragDelta({
      worldDelta: -0.18,
      tangentDelta: 0,
      planeFacingRatio: 0.04,
    }),
    -0.18,
  );
});

test('clamps the resolved delta after choosing the active drag mode', () => {
  assert.equal(
    resolveRevoluteDragDelta({
      worldDelta: 1,
      tangentDelta: -0.2,
      planeFacingRatio: 0.91,
      maxDelta: 0.3,
    }),
    0.3,
  );
});
