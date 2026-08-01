import test from 'node:test';
import assert from 'node:assert/strict';

import {
  hasWorkspacePointerDragExceededThreshold,
  shouldSuppressWorkspacePointerMissAfterDrag,
  WORKSPACE_POINTER_MISS_DRAG_THRESHOLD_PX,
} from './workspacePointerMissPolicy.ts';

test('suppresses workspace pointer-missed after pointer travel exceeds the click threshold', () => {
  assert.equal(
    shouldSuppressWorkspacePointerMissAfterDrag({
      startX: 10,
      startY: 20,
      endX: 25,
      endY: 20,
    }),
    true,
  );
});

test('forwards workspace pointer-missed when pointer travel stays within the click threshold', () => {
  assert.equal(
    shouldSuppressWorkspacePointerMissAfterDrag({
      startX: 10,
      startY: 20,
      endX: 14,
      endY: 23,
    }),
    false,
  );
});

test('detects pointer drags beyond the shared workspace drag threshold', () => {
  assert.equal(WORKSPACE_POINTER_MISS_DRAG_THRESHOLD_PX, 6);
  assert.equal(
    hasWorkspacePointerDragExceededThreshold({
      startX: 100,
      startY: 100,
      endX: 100 + WORKSPACE_POINTER_MISS_DRAG_THRESHOLD_PX + 1,
      endY: 100,
    }),
    true,
  );
  assert.equal(
    hasWorkspacePointerDragExceededThreshold({
      startX: 100,
      startY: 100,
      endX: 105,
      endY: 105,
    }),
    true,
  );
});

test('treats sub-threshold jitter and exact-threshold travel as a stationary press', () => {
  assert.equal(
    hasWorkspacePointerDragExceededThreshold({
      startX: 100,
      startY: 100,
      endX: 102,
      endY: 100,
    }),
    false,
  );
  // The comparison is strict: exactly threshold px of travel is still a press.
  assert.equal(
    hasWorkspacePointerDragExceededThreshold({
      startX: 100,
      startY: 100,
      endX: 100 + WORKSPACE_POINTER_MISS_DRAG_THRESHOLD_PX,
      endY: 100,
    }),
    false,
  );
  assert.equal(
    hasWorkspacePointerDragExceededThreshold({
      startX: 100,
      startY: 100,
      endX: 100,
      endY: 100,
    }),
    false,
  );
});

test('supports custom drag thresholds for non-default interaction policies', () => {
  assert.equal(
    hasWorkspacePointerDragExceededThreshold({
      startX: 0,
      startY: 0,
      endX: 4,
      endY: 0,
      thresholdPx: 3,
    }),
    true,
  );
  assert.equal(
    hasWorkspacePointerDragExceededThreshold({
      startX: 0,
      startY: 0,
      endX: 4,
      endY: 0,
      thresholdPx: 10,
    }),
    false,
  );
});
