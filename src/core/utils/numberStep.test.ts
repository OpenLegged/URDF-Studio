import assert from 'node:assert/strict';
import test from 'node:test';

import { addNumberStep } from './numberStep.ts';

test('decimal stepping avoids common binary floating point tails', () => {
  assert.equal(addNumberStep(0.1, 0.2, 1), 0.3);
  assert.equal(addNumberStep(1, 0.1, 2), 1.2);
  assert.equal(addNumberStep(1.2, 0.1, -1), 1.1);
});

test('decimal stepping preserves high-precision user-entered offsets', () => {
  assert.equal(
    addNumberStep(0.12345678901234568, 0.1, 1),
    Number('0.22345678901234568'),
  );
  assert.equal(
    addNumberStep(0.12345678901234568, 0.00000000000000001, 1),
    Number('0.12345678901234569'),
  );
  assert.equal(
    addNumberStep(1.0000000000000002, 0.0000000000000001, 1),
    Number('1.0000000000000003'),
  );
});

test('decimal stepping handles scientific notation at small scales', () => {
  assert.equal(addNumberStep(1e-18, 1e-18, 1), 2e-18);
  assert.equal(addNumberStep(1e-8, 1e-9, -1), 9e-9);
  assert.equal(addNumberStep(1.23e-7, 4e-9, 2), 1.31e-7);
});

test('decimal stepping falls back for non-integer repeat counts', () => {
  assert.equal(addNumberStep(1, 0.1, 0.5), 1.05);
});
