import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveHoverMoveEventName } from './hoverMoveEventName';

test('resolveHoverMoveEventName prefers pointermove when PointerEvent is available', () => {
  const eventName = resolveHoverMoveEventName({ PointerEvent: function PointerEvent() {} });
  assert.equal(eventName, 'pointermove');
});

test('resolveHoverMoveEventName falls back to mousemove when PointerEvent is missing', () => {
  const eventName = resolveHoverMoveEventName({});
  assert.equal(eventName, 'mousemove');
});

test('resolveHoverMoveEventName falls back to mousemove when window is unavailable', () => {
  const eventName = resolveHoverMoveEventName(undefined);
  assert.equal(eventName, 'mousemove');
});
