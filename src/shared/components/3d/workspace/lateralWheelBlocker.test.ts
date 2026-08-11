import test from 'node:test';
import assert from 'node:assert/strict';

import { shouldBlockLateralWheel } from './lateralWheelBlocker';

test('shouldBlockLateralWheel blocks horizontal-dominant wheels', () => {
  assert.equal(shouldBlockLateralWheel(100, 0), true);
  assert.equal(shouldBlockLateralWheel(-100, 0), true);
  assert.equal(shouldBlockLateralWheel(100, 40), true);
  assert.equal(shouldBlockLateralWheel(-60, 30), true);
});

test('shouldBlockLateralWheel passes vertical wheels through (OrbitControls zoom)', () => {
  assert.equal(shouldBlockLateralWheel(0, 100), false);
  assert.equal(shouldBlockLateralWheel(0, -100), false);
  assert.equal(shouldBlockLateralWheel(10, 100), false);
});

test('shouldBlockLateralWheel passes equal-magnitude diagonal wheels through', () => {
  // Ambiguous diagonal pinch must not lose its vertical (zoom) component.
  assert.equal(shouldBlockLateralWheel(50, 50), false);
  assert.equal(shouldBlockLateralWheel(-50, -50), false);
});
