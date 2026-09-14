import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveJointDragRuntimeStep } from './jointDragRuntimeStep';

test('resolveJointDragRuntimeStep applies active closed-loop drags locally while accumulating values', () => {
  const first = resolveJointDragRuntimeStep({
    fallbackRuntimeValue: 0.2,
    delta: 0.1,
    jointType: 'revolute',
    deferRuntimeUpdate: true,
  });

  assert.equal(first.changed, true);
  assert.equal(first.shouldApplyRuntimeUpdate, true);
  assert.ok(Math.abs(first.nextRuntimeValue - 0.3) < 1e-12);

  const second = resolveJointDragRuntimeStep({
    currentRuntimeValue: first.nextRuntimeValue,
    fallbackRuntimeValue: 0.2,
    delta: 0.15,
    jointType: 'revolute',
    deferRuntimeUpdate: true,
  });

  assert.equal(second.changed, true);
  assert.equal(second.shouldApplyRuntimeUpdate, true);
  assert.ok(Math.abs(second.nextRuntimeValue - 0.45) < 1e-12);
});

test('resolveJointDragRuntimeStep keeps normal direct drags applying runtime immediately', () => {
  const step = resolveJointDragRuntimeStep({
    fallbackRuntimeValue: 0.2,
    delta: 0.1,
    jointType: 'revolute',
  });

  assert.equal(step.changed, true);
  assert.equal(step.shouldApplyRuntimeUpdate, true);
  assert.ok(Math.abs(step.nextRuntimeValue - 0.3) < 1e-12);
});
