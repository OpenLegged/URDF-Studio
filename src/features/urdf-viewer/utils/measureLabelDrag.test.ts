import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveMeasureLabelDragOffset } from './measureLabelDrag.ts';

test('resolves a measurement label drag as a screen-space offset', () => {
  assert.deepEqual(
    resolveMeasureLabelDragOffset({ x: 12, y: -4 }, { x: 100, y: 80 }, { x: 136, y: 61 }),
    { x: 48, y: -23 },
  );
});

test('compensates for the CSS scale applied by a transformed 3D label', () => {
  assert.deepEqual(
    resolveMeasureLabelDragOffset(
      { x: 0, y: 0 },
      { x: 100, y: 80 },
      { x: 140, y: 50 },
      { x: 2, y: 1.5 },
    ),
    { x: 20, y: -20 },
  );
});
