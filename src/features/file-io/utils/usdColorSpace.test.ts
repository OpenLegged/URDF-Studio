import assert from 'node:assert/strict';
import test from 'node:test';

import { clampUsdColorChannel, normalizeUsdAuthoredColorTuple } from './usdColorSpace.ts';

test('valid USD color and opacity channels retain values near zero and one', () => {
  assert.equal(clampUsdColorChannel(1e-8), 1e-8);
  assert.equal(clampUsdColorChannel(0.99999999), 0.99999999);
  assert.equal(clampUsdColorChannel(-1), 0);
  assert.equal(clampUsdColorChannel(2), 1);
});

test('authored bright colors retain their tint and precision', () => {
  const color: [number, number, number] = [0.90123456789, 0.905, 0.902];
  assert.deepEqual(normalizeUsdAuthoredColorTuple(color), color);
});
