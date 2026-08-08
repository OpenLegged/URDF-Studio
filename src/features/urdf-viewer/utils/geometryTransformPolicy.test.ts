import test from 'node:test';
import assert from 'node:assert/strict';

import { canTransformGeometry } from './geometryTransformPolicy.ts';

test('visual geometry can be transformed while visual is visible, regardless of collision visibility', () => {
  assert.equal(
    canTransformGeometry('visual', { showVisual: true, showCollision: false }),
    true,
  );
  assert.equal(
    canTransformGeometry('visual', { showVisual: true, showCollision: true }),
    true,
  );
  assert.equal(
    canTransformGeometry('visual', { showVisual: false, showCollision: true }),
    false,
  );
});

test('collision geometry can be transformed while collisions are visible', () => {
  assert.equal(
    canTransformGeometry('collision', { showVisual: true, showCollision: true }),
    true,
  );
  assert.equal(
    canTransformGeometry('collision', { showVisual: true, showCollision: false }),
    false,
  );
});
