import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canRenderCollisionTransformControls,
  resolveActiveCollisionDraggingControls,
  resolveCurrentCollisionDraggingControls,
  resolveCollisionTransformControlMode,
  shouldUseCollisionTranslateProxy,
} from './collisionTransformControlsShared';

test('shouldUseCollisionTranslateProxy enables proxy only for translate and universal modes', () => {
  assert.equal(shouldUseCollisionTranslateProxy('select'), false);
  assert.equal(shouldUseCollisionTranslateProxy('rotate'), false);
  assert.equal(shouldUseCollisionTranslateProxy('translate'), true);
  assert.equal(shouldUseCollisionTranslateProxy('universal'), true);
});

test('resolveCollisionTransformControlMode maps select back to translate for gizmo rendering', () => {
  assert.equal(resolveCollisionTransformControlMode('select'), 'translate');
  assert.equal(resolveCollisionTransformControlMode('translate'), 'translate');
  assert.equal(resolveCollisionTransformControlMode('rotate'), 'rotate');
  assert.equal(resolveCollisionTransformControlMode('universal'), 'universal');
});

test('resolveActiveCollisionDraggingControls prefers rotate, then translate, then the last active control', () => {
  const translateControls = { dragging: false, kind: 'translate' };
  const rotateControls = { dragging: false, kind: 'rotate' };
  const activeControls = { dragging: false, kind: 'active' };

  assert.equal(
    resolveActiveCollisionDraggingControls(
      translateControls,
      { ...rotateControls, dragging: true },
      activeControls,
    )?.kind,
    'rotate',
  );

  assert.equal(
    resolveActiveCollisionDraggingControls(
      { ...translateControls, dragging: true },
      rotateControls,
      activeControls,
    )?.kind,
    'translate',
  );

  assert.equal(
    resolveActiveCollisionDraggingControls(translateControls, rotateControls, activeControls)?.kind,
    'active',
  );

  assert.equal(
    resolveActiveCollisionDraggingControls(translateControls, rotateControls, null),
    null,
  );
});

test('resolveCurrentCollisionDraggingControls ignores stale active controls once both gizmos stopped dragging', () => {
  const translateControls = { dragging: false, kind: 'translate' };
  const rotateControls = { dragging: false, kind: 'rotate' };

  assert.equal(
    resolveCurrentCollisionDraggingControls(
      { ...translateControls, dragging: true },
      rotateControls,
    )?.kind,
    'translate',
  );

  assert.equal(
    resolveCurrentCollisionDraggingControls(translateControls, {
      ...rotateControls,
      dragging: true,
    })?.kind,
    'rotate',
  );

  assert.equal(resolveCurrentCollisionDraggingControls(translateControls, rotateControls), null);
});

test('canRenderCollisionTransformControls requires a translate proxy only when the active mode needs it', () => {
  assert.equal(canRenderCollisionTransformControls('rotate', false, null), true);
  assert.equal(canRenderCollisionTransformControls('translate', false, null), true);
  assert.equal(canRenderCollisionTransformControls('translate', true, null), false);
  assert.equal(canRenderCollisionTransformControls('translate', true, {}), true);
});
