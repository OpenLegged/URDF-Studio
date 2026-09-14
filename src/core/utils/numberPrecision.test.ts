import assert from 'node:assert/strict';
import test from 'node:test';

import { formatNumberWithMaxDecimals } from './numberPrecision.ts';

test('integer formatting retains significant trailing zeros, including a rounding carry', () => {
  for (const [value, expected] of [[0, '0'], [10, '10'], [-20, '-20'], [99.6, '100']] as const) {
    assert.equal(formatNumberWithMaxDecimals(value, 0), expected);
  }
});

test('large scientific values retain exponent zeros', () => {
  for (const value of [1e30, -1e30, 1.25e30, 1e100]) {
    assert.equal(Number(formatNumberWithMaxDecimals(value)), value);
  }
});

test('fraction formatting trims only fractional zeros and normalizes negative zero', () => {
  assert.equal(formatNumberWithMaxDecimals(120.3400, 4), '120.34');
  assert.equal(formatNumberWithMaxDecimals(120, 4), '120');
  assert.equal(formatNumberWithMaxDecimals(-0.000001, 4), '0');
  assert.equal(formatNumberWithMaxDecimals(Infinity), '');
});
