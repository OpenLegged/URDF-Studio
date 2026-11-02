import test from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveEffectiveInteractionSubType,
  resolveTopLayerInteractionSubTypeFromHits,
  resolveTopLayerInteractionSubType,
  shouldBlockOrbitForGeometryHit,
  shouldDisableOrbitForDirectJointDrag,
  shouldStartJointDragFromGeometryHit,
} from './interactionMode.ts';

test('keeps visual interaction when link mode visuals are visible', () => {
  assert.deepEqual(
    resolveEffectiveInteractionSubType('link', true, true),
    { subType: 'visual', didFallback: false },
  );
});

test('falls back to collision interaction when link mode visuals are hidden but collisions are visible', () => {
  assert.deepEqual(
    resolveEffectiveInteractionSubType('link', false, true),
    { subType: 'collision', didFallback: true },
  );
});

test('falls back to visual interaction when collision mode colliders are hidden but visuals are visible', () => {
  assert.deepEqual(
    resolveEffectiveInteractionSubType('collision', true, false),
    { subType: 'visual', didFallback: true },
  );
});

test('returns null when neither visuals nor collisions are visible', () => {
  assert.deepEqual(
    resolveEffectiveInteractionSubType('collision', false, false),
    { subType: null, didFallback: false },
  );
});

test('top-layer pick uses collision when both are visible and collision is always on top', () => {
  assert.equal(
    resolveTopLayerInteractionSubType({
      showVisual: true,
      showCollision: true,
      collisionAlwaysOnTop: true,
    }),
    'collision',
  );
});

test('top-layer pick uses visual when both are visible and collision is not always on top', () => {
  assert.equal(
    resolveTopLayerInteractionSubType({
      showVisual: true,
      showCollision: true,
      collisionAlwaysOnTop: false,
    }),
    'visual',
  );
});

test('top-layer pick respects single-visible-layer cases', () => {
  assert.equal(
    resolveTopLayerInteractionSubType({
      showVisual: false,
      showCollision: true,
      collisionAlwaysOnTop: false,
    }),
    'collision',
  );

  assert.equal(
    resolveTopLayerInteractionSubType({
      showVisual: true,
      showCollision: false,
      collisionAlwaysOnTop: true,
    }),
    'visual',
  );

  assert.equal(
    resolveTopLayerInteractionSubType({
      showVisual: false,
      showCollision: false,
      collisionAlwaysOnTop: true,
    }),
    null,
  );
});

test('hit-aware top-layer pick uses nearest hit role when collision overlay is disabled', () => {
  assert.equal(
    resolveTopLayerInteractionSubTypeFromHits({
      showVisual: true,
      showCollision: true,
      collisionAlwaysOnTop: false,
      hits: [
        { isCollision: true },
        { isCollision: false },
      ],
    }),
    'collision',
  );

  assert.equal(
    resolveTopLayerInteractionSubTypeFromHits({
      showVisual: true,
      showCollision: true,
      collisionAlwaysOnTop: false,
      hits: [
        { isCollision: false },
        { isCollision: true },
      ],
    }),
    'visual',
  );
});

test('hit-aware top-layer pick keeps collision priority when collision overlay is enabled', () => {
  assert.equal(
    resolveTopLayerInteractionSubTypeFromHits({
      showVisual: true,
      showCollision: true,
      collisionAlwaysOnTop: true,
      hits: [
        { isCollision: false },
        { isCollision: true },
      ],
    }),
    'collision',
  );

  assert.equal(
    resolveTopLayerInteractionSubTypeFromHits({
      showVisual: true,
      showCollision: true,
      collisionAlwaysOnTop: true,
      hits: [
        { isCollision: false },
      ],
    }),
    'visual',
  );
});

test('select mode leaves ordinary geometry available for orbit until a joint drag starts', () => {
  assert.equal(shouldBlockOrbitForGeometryHit('select'), false);
  assert.equal(shouldStartJointDragFromGeometryHit('select'), true);
});

test('transform-like modes still capture geometry hits for direct manipulation', () => {
  assert.equal(shouldBlockOrbitForGeometryHit('translate'), true);
  assert.equal(shouldBlockOrbitForGeometryHit('rotate'), true);
  assert.equal(shouldBlockOrbitForGeometryHit('universal'), true);

  assert.equal(shouldStartJointDragFromGeometryHit('select'), true);
  assert.equal(shouldStartJointDragFromGeometryHit('translate'), true);
  assert.equal(shouldStartJointDragFromGeometryHit('rotate'), true);
  assert.equal(shouldStartJointDragFromGeometryHit('universal'), true);
  assert.equal(shouldDisableOrbitForDirectJointDrag('select', true), true);
  assert.equal(shouldDisableOrbitForDirectJointDrag('translate', true), true);
  assert.equal(shouldDisableOrbitForDirectJointDrag('rotate', true), true);
  assert.equal(shouldDisableOrbitForDirectJointDrag('universal', true), true);
  assert.equal(shouldDisableOrbitForDirectJointDrag('select', false), false);
  assert.equal(shouldDisableOrbitForDirectJointDrag('translate', false), false);
});

test('measure mode blocks orbit on geometry hits without starting joint drag', () => {
  assert.equal(shouldBlockOrbitForGeometryHit('measure'), true);
  assert.equal(shouldBlockOrbitForGeometryHit('measure', 'object'), true);
  assert.equal(shouldStartJointDragFromGeometryHit('measure'), false);
  assert.equal(shouldDisableOrbitForDirectJointDrag('measure', true), false);
});

test('point measure mode keeps orbit controls available for surface picking', () => {
  assert.equal(shouldBlockOrbitForGeometryHit('measure', 'point'), false);
});

test('measure mode never enables direct joint drag', () => {
  assert.equal(shouldStartJointDragFromGeometryHit('measure'), false);
  assert.equal(shouldDisableOrbitForDirectJointDrag('measure', true), false);
});
