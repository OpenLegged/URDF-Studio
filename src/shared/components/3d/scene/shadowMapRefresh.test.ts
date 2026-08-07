import test from 'node:test';
import assert from 'node:assert/strict';
import type * as THREE from 'three';

import {
  requestShadowMapRefresh,
  runWithShadowMapUpdatesPaused,
} from './shadowMapRefresh.ts';

function createRendererShadowMapStub(enabled: boolean, needsUpdate = false) {
  return {
    shadowMap: {
      enabled,
      needsUpdate,
    },
  } as unknown as Pick<THREE.WebGLRenderer, 'shadowMap'>;
}

test('requestShadowMapRefresh marks enabled shadow maps dirty', () => {
  const renderer = createRendererShadowMapStub(true);

  assert.equal(requestShadowMapRefresh(renderer), true);
  assert.equal(renderer.shadowMap.needsUpdate, true);
});

test('requestShadowMapRefresh leaves disabled or missing shadow maps alone', () => {
  const renderer = createRendererShadowMapStub(false);

  assert.equal(requestShadowMapRefresh(renderer), false);
  assert.equal(renderer.shadowMap.needsUpdate, false);
  assert.equal(requestShadowMapRefresh(null), false);
});

test('runWithShadowMapUpdatesPaused restores shadow update scheduling', () => {
  const renderer = createRendererShadowMapStub(true, true);
  renderer.shadowMap.autoUpdate = true;

  const result = runWithShadowMapUpdatesPaused(renderer, () => {
    assert.equal(renderer.shadowMap.autoUpdate, false);
    assert.equal(renderer.shadowMap.needsUpdate, false);
    return 'rendered';
  });

  assert.equal(result, 'rendered');
  assert.equal(renderer.shadowMap.autoUpdate, true);
  assert.equal(renderer.shadowMap.needsUpdate, true);
});

test('runWithShadowMapUpdatesPaused restores shadow state after a failed pass', () => {
  const renderer = createRendererShadowMapStub(true, false);
  renderer.shadowMap.autoUpdate = true;
  const expectedError = new Error('outline render failed');

  assert.throws(
    () =>
      runWithShadowMapUpdatesPaused(renderer, () => {
        throw expectedError;
      }),
    expectedError,
  );
  assert.equal(renderer.shadowMap.autoUpdate, true);
  assert.equal(renderer.shadowMap.needsUpdate, false);
});
