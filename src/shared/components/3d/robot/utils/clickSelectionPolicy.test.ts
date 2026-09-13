import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_SELECT_CLICK_DRAG_THRESHOLD_PX,
  isPointerInteractionWithinClickThreshold,
  resolveDeferredSelectionHoverState,
  shouldFinalizePointerInteraction,
  shouldDeferSelectionUntilPointerUp,
} from './clickSelectionPolicy';

test('select mode defers selection until pointer up', () => {
  assert.equal(shouldDeferSelectionUntilPointerUp('select'), true);
  assert.equal(shouldDeferSelectionUntilPointerUp('select', true), false);
  assert.equal(shouldDeferSelectionUntilPointerUp('select', false, false, true), false);
  assert.equal(shouldDeferSelectionUntilPointerUp('view'), false);
  assert.equal(shouldDeferSelectionUntilPointerUp('view', false, true), true);
  assert.equal(shouldDeferSelectionUntilPointerUp('view', false, true, true), false);
  assert.equal(shouldDeferSelectionUntilPointerUp('translate'), false);
  assert.equal(shouldDeferSelectionUntilPointerUp('rotate'), false);
  assert.equal(shouldDeferSelectionUntilPointerUp('universal'), false);
  assert.equal(shouldDeferSelectionUntilPointerUp('measure'), false);
});

test('pointer motion inside threshold is treated as a click', () => {
  assert.equal(
    isPointerInteractionWithinClickThreshold({
      startX: 10,
      startY: 20,
      endX: 10 + DEFAULT_SELECT_CLICK_DRAG_THRESHOLD_PX,
      endY: 20,
    }),
    true,
  );

  assert.equal(
    isPointerInteractionWithinClickThreshold({
      startX: 10,
      startY: 20,
      endX: 14,
      endY: 23,
    }),
    true,
  );
});

test('pointer motion beyond threshold is treated as a drag', () => {
  assert.equal(
    isPointerInteractionWithinClickThreshold({
      startX: 10,
      startY: 20,
      endX: 10 + DEFAULT_SELECT_CLICK_DRAG_THRESHOLD_PX + 1,
      endY: 20,
    }),
    false,
  );

  assert.equal(
    isPointerInteractionWithinClickThreshold({
      startX: 10,
      startY: 20,
      endX: 20,
      endY: 30,
    }),
    false,
  );
});

test('pointer finalization only runs when the viewer actually owns an active interaction', () => {
  assert.equal(
    shouldFinalizePointerInteraction({
      interactionStarted: false,
      dragging: false,
      hasPendingSelection: false,
    }),
    false,
  );

  assert.equal(
    shouldFinalizePointerInteraction({
      interactionStarted: true,
      dragging: false,
      hasPendingSelection: false,
    }),
    true,
  );

  assert.equal(
    shouldFinalizePointerInteraction({
      interactionStarted: false,
      dragging: true,
      hasPendingSelection: false,
    }),
    true,
  );

  assert.equal(
    shouldFinalizePointerInteraction({
      interactionStarted: false,
      dragging: false,
      hasPendingSelection: true,
    }),
    true,
  );
});

test('deferred selection keeps hover stable until pointer up, even after the gesture crosses drag threshold', () => {
  assert.deepEqual(
    resolveDeferredSelectionHoverState({
      hasPendingSelection: true,
      alreadyExceededClickThreshold: false,
      startX: 10,
      startY: 20,
      endX: 14,
      endY: 23,
    }),
    {
      pointerExceededClickThreshold: false,
      shouldClearHover: false,
    },
  );

  assert.deepEqual(
    resolveDeferredSelectionHoverState({
      hasPendingSelection: true,
      alreadyExceededClickThreshold: false,
      startX: 10,
      startY: 20,
      endX: 10 + DEFAULT_SELECT_CLICK_DRAG_THRESHOLD_PX + 1,
      endY: 20,
    }),
    {
      pointerExceededClickThreshold: true,
      shouldClearHover: false,
    },
  );

  assert.deepEqual(
    resolveDeferredSelectionHoverState({
      hasPendingSelection: true,
      alreadyExceededClickThreshold: true,
      startX: 10,
      startY: 20,
      endX: 40,
      endY: 50,
    }),
    {
      pointerExceededClickThreshold: true,
      shouldClearHover: false,
    },
  );
});
