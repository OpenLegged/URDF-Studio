import assert from 'node:assert/strict';
import test from 'node:test';

import {
  formatRadiansForDisplay,
  parseRadiansDisplayValue,
} from './rotationFormat.ts';

test('formatRadiansForDisplay prefers pi fractions for common authored angles', () => {
  assert.equal(formatRadiansForDisplay(-Math.PI / 2), '-π/2');
  assert.equal(formatRadiansForDisplay(Math.PI / 4), 'π/4');
  assert.equal(formatRadiansForDisplay(Math.PI), 'π');
});

test('formatRadiansForDisplay falls back to trimmed decimals for arbitrary radians', () => {
  assert.equal(formatRadiansForDisplay(0.3), '0.3');
});

test('formatRadiansForDisplay shows tiny focused radians without masking them as zero', () => {
  assert.equal(formatRadiansForDisplay(1e-18), '0');
  assert.equal(formatRadiansForDisplay(1e-18, { activeFocus: true }), '1e-18');
  assert.equal(formatRadiansForDisplay(1e-7, { activeFocus: true }), '1e-7');
});

test('parseRadiansDisplayValue accepts pi, pai, and multiplied pi drafts', () => {
  assert.ok(Math.abs((parseRadiansDisplayValue('-pai/2') ?? 0) + Math.PI / 2) < 1e-7);
  assert.ok(Math.abs((parseRadiansDisplayValue('3pi/4') ?? 0) - (3 * Math.PI) / 4) < 1e-7);
  assert.ok(Math.abs((parseRadiansDisplayValue('2*pi') ?? 0) - 2 * Math.PI) < 1e-7);
});

test('parseRadiansDisplayValue preserves plain numeric input and rejects invalid drafts', () => {
  assert.equal(parseRadiansDisplayValue('0.25'), 0.25);
  assert.equal(parseRadiansDisplayValue('1e-18'), 1e-18);
  assert.equal(parseRadiansDisplayValue('-0'), 0);
  assert.equal(parseRadiansDisplayValue('pi/0'), null);
  assert.equal(parseRadiansDisplayValue('pi//2'), null);
});
