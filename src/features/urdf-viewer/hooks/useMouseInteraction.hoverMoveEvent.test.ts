import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveHoverMoveEventName } from '@/shared/components/3d/robot/utils/hoverMoveEventName';

test('resolveHoverMoveEventName prefers pointermove when PointerEvent exists', () => {
  const windowLike = {
    PointerEvent: function PointerEventMock() {},
  } as { PointerEvent?: unknown };

  assert.equal(resolveHoverMoveEventName(windowLike), 'pointermove');
});

test('resolveHoverMoveEventName falls back to mousemove when PointerEvent is missing', () => {
  const windowLike = {} as { PointerEvent?: unknown };

  assert.equal(resolveHoverMoveEventName(windowLike), 'mousemove');
});

test('resolveHoverMoveEventName falls back to mousemove for nullish window', () => {
  assert.equal(resolveHoverMoveEventName(undefined), 'mousemove');
  assert.equal(resolveHoverMoveEventName(null), 'mousemove');
});
