import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveJointInteractionControlMode } from './jointInteractionControlsShared';

test('resolveJointInteractionControlMode hides joint controls in select mode', () => {
  assert.equal(resolveJointInteractionControlMode('select', 'revolute'), null);
  assert.equal(resolveJointInteractionControlMode('select', 'prismatic'), null);
});

test('resolveJointInteractionControlMode maps revolute-like joints to rotate controls', () => {
  assert.equal(resolveJointInteractionControlMode('translate', 'revolute'), 'rotate');
  assert.equal(resolveJointInteractionControlMode('rotate', 'continuous'), 'rotate');
  assert.equal(resolveJointInteractionControlMode('universal', 'revolute'), 'rotate');
});

test('resolveJointInteractionControlMode maps prismatic joints to translate controls', () => {
  assert.equal(resolveJointInteractionControlMode('translate', 'prismatic'), 'translate');
  assert.equal(resolveJointInteractionControlMode('rotate', 'prismatic'), 'translate');
  assert.equal(resolveJointInteractionControlMode('universal', 'prismatic'), 'translate');
});

test('resolveJointInteractionControlMode skips unsupported joint types', () => {
  assert.equal(resolveJointInteractionControlMode('translate', 'fixed'), null);
  assert.equal(resolveJointInteractionControlMode('rotate', 'ball'), null);
});
