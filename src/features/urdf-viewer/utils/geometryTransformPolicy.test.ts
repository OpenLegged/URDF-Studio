import test from 'node:test';
import assert from 'node:assert/strict';

import {
  canTransformGeometry,
  shouldNotifyVisualTransformLock,
} from './geometryTransformPolicy.ts';

test('visual geometry can be transformed only while collisions are hidden', () => {
  assert.equal(
    canTransformGeometry('visual', { showVisual: true, showCollision: false }),
    true,
  );
  assert.equal(
    canTransformGeometry('visual', { showVisual: true, showCollision: true }),
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

test('notification is emitted only when collision visibility turns on', () => {
  assert.equal(shouldNotifyVisualTransformLock(false, true), true);
  assert.equal(shouldNotifyVisualTransformLock(true, true), false);
  assert.equal(shouldNotifyVisualTransformLock(true, false), false);
});
