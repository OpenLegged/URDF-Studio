import assert from 'node:assert/strict';
import test from 'node:test';

import { formatUsdFloat, formatUsdTuple } from './usdTextFormatting.ts';

test('USD numeric text preserves finite values across fixed and exponential magnitudes', () => {
  for (const value of [Math.PI / 6, 0.00000123456789, 1e-10, 1.2345678901234568e-20, 1.2345678901234568e30]) {
    assert.equal(Number(formatUsdFloat(value)), value);
  }
  assert.equal(formatUsdTuple([1e-10, Math.PI / 6]), '(1e-10, 0.5235987755982988)');
  assert.equal(formatUsdFloat(-0), '0');
  assert.equal(formatUsdFloat(Infinity), '0');
});
