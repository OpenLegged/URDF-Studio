import assert from 'node:assert/strict';
import test from 'node:test';

import { shouldEnableViewerSceneCompileWarmup } from './sceneCompileWarmupPolicy';

test('shouldEnableViewerSceneCompileWarmup disables warmup for MJCF scenes', () => {
  assert.equal(shouldEnableViewerSceneCompileWarmup('mjcf'), false);
});

test('shouldEnableViewerSceneCompileWarmup keeps warmup enabled for URDF-family scenes', () => {
  assert.equal(shouldEnableViewerSceneCompileWarmup('urdf'), true);
});
