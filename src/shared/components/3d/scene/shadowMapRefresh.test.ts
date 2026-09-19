import test from 'node:test';
import assert from 'node:assert/strict';
import type * as THREE from 'three';

import {
  isShadowMapRefreshPaused,
  pauseShadowMapRefresh,
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

test('manual shadow updates still work with autoUpdate disabled outside an interaction pause', () => {
  const renderer = createRendererShadowMapStub(true);
  renderer.shadowMap.autoUpdate = false;

  assert.equal(requestShadowMapRefresh(renderer), true);
  assert.equal(renderer.shadowMap.needsUpdate, true);
});

test('an interaction defers repeated shadow refreshes until its owner releases', () => {
  const renderer = createRendererShadowMapStub(true);
  renderer.shadowMap.autoUpdate = true;
  const release = pauseShadowMapRefresh(renderer, Symbol('drag'));

  assert.equal(renderer.shadowMap.autoUpdate, false);
  assert.equal(requestShadowMapRefresh(renderer), false);
  assert.equal(requestShadowMapRefresh(renderer), false);
  assert.equal(renderer.shadowMap.needsUpdate, false);

  release();
  assert.equal(renderer.shadowMap.autoUpdate, true);
  assert.equal(renderer.shadowMap.needsUpdate, true);
  renderer.shadowMap.needsUpdate = false;
  release();
  assert.equal(renderer.shadowMap.needsUpdate, false, 'cleanup is idempotent');
});

test('a pause preserves a pending refresh and the previous automatic update policy', () => {
  const renderer = createRendererShadowMapStub(true, true);
  renderer.shadowMap.autoUpdate = false;
  const release = pauseShadowMapRefresh(renderer, Symbol('drag'));

  assert.equal(renderer.shadowMap.needsUpdate, false);
  release();
  assert.equal(renderer.shadowMap.needsUpdate, true);
  assert.equal(renderer.shadowMap.autoUpdate, false);
});

test('independent pause owners share one renderer without suspending other renderers', () => {
  const renderer = createRendererShadowMapStub(true);
  const otherRenderer = createRendererShadowMapStub(true);
  renderer.shadowMap.autoUpdate = true;
  const releaseFirst = pauseShadowMapRefresh(renderer, Symbol('first'));
  const releaseSecond = pauseShadowMapRefresh(renderer, Symbol('second'));

  requestShadowMapRefresh(renderer);
  assert.equal(requestShadowMapRefresh(otherRenderer), true);
  assert.equal(isShadowMapRefreshPaused(otherRenderer), false);
  releaseFirst();
  assert.equal(isShadowMapRefreshPaused(renderer), true);
  assert.equal(renderer.shadowMap.autoUpdate, false);
  assert.equal(renderer.shadowMap.needsUpdate, false);
  releaseSecond();
  assert.equal(isShadowMapRefreshPaused(renderer), false);
  assert.equal(renderer.shadowMap.autoUpdate, true);
  assert.equal(renderer.shadowMap.needsUpdate, true);
});

test('repeated acquisition by one owner stays paused until both releases', () => {
  const renderer = createRendererShadowMapStub(true);
  const owner = Symbol('drag');
  const releaseFirst = pauseShadowMapRefresh(renderer, owner);
  const releaseSecond = pauseShadowMapRefresh(renderer, owner);

  requestShadowMapRefresh(renderer);
  releaseFirst();
  releaseFirst();
  assert.equal(renderer.shadowMap.needsUpdate, false);
  releaseSecond();
  assert.equal(renderer.shadowMap.needsUpdate, true);
});

test('snapshot refreshes can bypass a pause without losing the settled-scene refresh', () => {
  const renderer = createRendererShadowMapStub(true);
  renderer.shadowMap.autoUpdate = true;
  const release = pauseShadowMapRefresh(renderer, Symbol('drag'));

  assert.equal(requestShadowMapRefresh(renderer, { force: true }), true);
  assert.equal(renderer.shadowMap.needsUpdate, true);
  renderer.shadowMap.needsUpdate = false;
  assert.equal(requestShadowMapRefresh(renderer), false);
  assert.equal(renderer.shadowMap.needsUpdate, false);
  release();
  assert.equal(renderer.shadowMap.needsUpdate, true);
  assert.equal(renderer.shadowMap.autoUpdate, true);
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
