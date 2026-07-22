import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resolveCoordinateAxesDimensions,
  ThickerAxes,
  WorldOriginAxes,
} from './CoordinateAxes.tsx';
import {
  normalizeOriginAxesSize,
  resolveOriginAxesSizeMax,
} from './coordinateAxesSizing.ts';

test('ThickerAxes can render with default opacity-dependent depthWrite resolution', () => {
  assert.doesNotThrow(() => {
    ThickerAxes({});
  });
});

test('ThickerAxes accepts interactive hover and selection affordance props', () => {
  assert.doesNotThrow(() => {
    ThickerAxes({
      interactive: true,
      hovered: true,
      selected: true,
    });
  });
});

test('slim profile reduces the joint-pick frame shaft and arrowhead dimensions', () => {
  const standard = resolveCoordinateAxesDimensions(0.05, 'standard');
  const slim = resolveCoordinateAxesDimensions(0.05, 'slim');

  assert.equal(slim.axisLength, standard.axisLength);
  assert.equal(standard.shaftRadius, 0.0055);
  assert.equal(standard.headRadius, 0.0055 * 2.6);
  assert.equal(standard.headLength, 0.0055 * 4.5);
  assert.equal(slim.shaftRadius, 0.05 * 0.03);
  assert.equal(slim.headRadius, 0.05 * 0.065);
  assert.equal(slim.headLength, 0.05 * 0.14);
  assert.ok(slim.shaftRadius < standard.shaftRadius);
  assert.ok(slim.headRadius < standard.headRadius);
  assert.ok(slim.headLength < standard.headLength);
});

test('WorldOriginAxes can render with default props', () => {
  assert.doesNotThrow(() => {
    WorldOriginAxes({});
  });
});

test('origin axes size limits scale with model extent', () => {
  assert.equal(resolveOriginAxesSizeMax(null), 0.5);
  assert.equal(resolveOriginAxesSizeMax(0.1), 0.5);
  assert.equal(resolveOriginAxesSizeMax(0.6), 0.5);
  assert.equal(resolveOriginAxesSizeMax(10), 2);
});

test('normalizeOriginAxesSize clamps to the active size limit', () => {
  assert.equal(normalizeOriginAxesSize(0.5, 0.07, 0.08), 0.08);
  assert.equal(normalizeOriginAxesSize(0.001, 0.07, 0.08), 0.01);
  assert.equal(normalizeOriginAxesSize('bad', 0.04, 0.08), 0.04);
  assert.equal(normalizeOriginAxesSize('bad', 0.07, 0.03), 0.03);
});
