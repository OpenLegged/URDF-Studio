import test from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveCameraAutoFrameLoadScopeKey,
  shouldAutoFrameRobotChange,
} from './cameraAutoFrame';

test('auto-frames when the current model scope has not been framed yet', () => {
  assert.equal(
    shouldAutoFrameRobotChange({
      autoFrameOnRobotChange: true,
      currentScopeKey: 'robots/example.urdf',
      lastAutoFramedScopeKey: null,
      focusTarget: null,
      mode: 'editor',
    }),
    true,
  );
});

test('does not auto-frame again after the same model scope was already framed once', () => {
  assert.equal(
    shouldAutoFrameRobotChange({
      autoFrameOnRobotChange: true,
      currentScopeKey: 'robots/example.urdf',
      lastAutoFramedScopeKey: 'robots/example.urdf',
      focusTarget: null,
      mode: 'editor',
    }),
    false,
  );
});

test('skips auto-frame when a specific focus target is active', () => {
  assert.equal(
    shouldAutoFrameRobotChange({
      autoFrameOnRobotChange: true,
      currentScopeKey: 'robots/example.urdf',
      lastAutoFramedScopeKey: null,
      focusTarget: 'arm_link',
      mode: 'editor',
    }),
    false,
  );
});

test('keeps auto-frame enabled in editor mode when no focus target is active', () => {
  assert.equal(
    shouldAutoFrameRobotChange({
      autoFrameOnRobotChange: true,
      currentScopeKey: 'robots/example.urdf',
      lastAutoFramedScopeKey: null,
      focusTarget: null,
      mode: 'editor',
    }),
    true,
  );
});

test('skips auto-frame when the viewer layer is inactive', () => {
  assert.equal(
    shouldAutoFrameRobotChange({
      autoFrameOnRobotChange: true,
      currentScopeKey: 'robots/example.urdf',
      lastAutoFramedScopeKey: null,
      focusTarget: null,
      mode: 'editor',
      active: false,
    }),
    false,
  );
});

test('inline imports get a fresh auto-frame scope when the viewer reload token changes', () => {
  assert.notEqual(
    resolveCameraAutoFrameLoadScopeKey({
      sourceFilePath: null,
      reloadToken: 1,
      fallbackScopeKey: 'viewer-session:inline',
    }),
    resolveCameraAutoFrameLoadScopeKey({
      sourceFilePath: null,
      reloadToken: 2,
      fallbackScopeKey: 'viewer-session:inline',
    }),
  );
});

test('path-based reloads keep the file identity but still re-arm auto-frame on reload', () => {
  assert.notEqual(
    resolveCameraAutoFrameLoadScopeKey({
      sourceFilePath: 'robots/example.urdf',
      reloadToken: 4,
      fallbackScopeKey: 'viewer-session:inline',
    }),
    resolveCameraAutoFrameLoadScopeKey({
      sourceFilePath: 'robots/example.urdf',
      reloadToken: 5,
      fallbackScopeKey: 'viewer-session:inline',
    }),
  );
});
