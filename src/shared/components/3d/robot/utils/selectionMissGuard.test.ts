import test from 'node:test';
import assert from 'node:assert/strict';

import {
  armSelectionMissGuard,
  disarmSelectionMissGuard,
  clearSelectionMissGuardTimer,
  scheduleSelectionMissGuardReset,
  shouldTreatPointerUpAsBackgroundMiss,
  shouldDisarmSelectionMissGuardOnPointerMove,
} from './selectionMissGuard';

test('arms the guard immediately after a successful scene pick', () => {
  const justSelectedRef = { current: false };

  armSelectionMissGuard(justSelectedRef);

  assert.equal(justSelectedRef.current, true);
});

test('resets the guard after the selection settle window elapses', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });

  const justSelectedRef = { current: false };
  const timerRef = { current: null as ReturnType<typeof setTimeout> | null };
  let resetCalls = 0;

  armSelectionMissGuard(justSelectedRef);
  scheduleSelectionMissGuardReset({
    justSelectedRef,
    timerRef,
    onReset: () => {
      resetCalls += 1;
    },
  });

  assert.equal(justSelectedRef.current, true);

  t.mock.timers.tick(99);
  assert.equal(justSelectedRef.current, true);
  assert.equal(resetCalls, 0);

  t.mock.timers.tick(1);
  assert.equal(justSelectedRef.current, false);
  assert.equal(resetCalls, 1);
  assert.equal(timerRef.current, null);
});

test('clears any pending timer without changing the current guard state', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });

  const justSelectedRef = { current: true };
  const timerRef = { current: null as ReturnType<typeof setTimeout> | null };

  scheduleSelectionMissGuardReset({ justSelectedRef, timerRef });
  assert.notEqual(timerRef.current, null);

  clearSelectionMissGuardTimer(timerRef);

  assert.equal(timerRef.current, null);
  assert.equal(justSelectedRef.current, true);
});

test('disarms the guard immediately when the next click is a background miss', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });

  const justSelectedRef = { current: false };
  const timerRef = { current: null as ReturnType<typeof setTimeout> | null };

  armSelectionMissGuard(justSelectedRef);
  scheduleSelectionMissGuardReset({ justSelectedRef, timerRef });

  disarmSelectionMissGuard(justSelectedRef, timerRef);

  assert.equal(justSelectedRef.current, false);
  assert.equal(timerRef.current, null);

  t.mock.timers.tick(100);
  assert.equal(justSelectedRef.current, false);
});

test('releases a stale selection guard once the pointer is idle and moves again', () => {
  const shouldDisarm = shouldDisarmSelectionMissGuardOnPointerMove({
    justSelected: true,
    pointerButtons: 0,
    dragging: false,
    hasPendingSelection: false,
    hasResetTimer: false,
  });

  assert.equal(shouldDisarm, true);
});

test('keeps the guard armed while a deferred pointer selection is still pending', () => {
  const shouldDisarm = shouldDisarmSelectionMissGuardOnPointerMove({
    justSelected: true,
    pointerButtons: 0,
    dragging: false,
    hasPendingSelection: true,
    hasResetTimer: false,
  });

  assert.equal(shouldDisarm, false);
});

test('keeps the guard armed while the normal settle timer is still pending', () => {
  const shouldDisarm = shouldDisarmSelectionMissGuardOnPointerMove({
    justSelected: true,
    pointerButtons: 0,
    dragging: false,
    hasPendingSelection: false,
    hasResetTimer: true,
  });

  assert.equal(shouldDisarm, false);
});

test('treats a pointer-up with no current-hit target as a background miss', () => {
  const shouldTreatAsBackgroundMiss = shouldTreatPointerUpAsBackgroundMiss({
    hasPendingSelection: false,
    dragging: false,
    interactionHitTarget: false,
    wasGizmoDrag: false,
  });

  assert.equal(shouldTreatAsBackgroundMiss, true);
});

test('does not treat a pointer-up after view dragging as a background miss', () => {
  const shouldTreatAsBackgroundMiss = shouldTreatPointerUpAsBackgroundMiss({
    hasPendingSelection: false,
    dragging: false,
    interactionHitTarget: false,
    wasGizmoDrag: false,
    pointerMovedBeyondClickThreshold: true,
  });

  assert.equal(shouldTreatAsBackgroundMiss, false);
});

test('does not treat a direct scene hit as a background miss on pointer-up', () => {
  const shouldTreatAsBackgroundMiss = shouldTreatPointerUpAsBackgroundMiss({
    hasPendingSelection: false,
    dragging: false,
    interactionHitTarget: true,
    wasGizmoDrag: false,
  });

  assert.equal(shouldTreatAsBackgroundMiss, false);
});
