import test from 'node:test';
import assert from 'node:assert/strict';

import {
  disableLogarithmicDepthBuffer,
  REALTIME_GTAO_CONFIG,
  REALTIME_POSTPROCESSING_PASS_ORDER,
  resolveRealtimePostprocessingPixelRatio,
  shouldRenderRealtimeAmbientOcclusion,
} from './realtimeViewportComposer.ts';

test('realtime GTAO yields to the low-latency interaction render path', () => {
  assert.equal(
    shouldRenderRealtimeAmbientOcclusion({
      composerAvailable: true,
      isInteracting: false,
      snapshotRenderActive: false,
    }),
    true,
  );
  assert.equal(
    shouldRenderRealtimeAmbientOcclusion({
      composerAvailable: true,
      isInteracting: true,
      snapshotRenderActive: false,
    }),
    false,
  );
  assert.equal(
    shouldRenderRealtimeAmbientOcclusion({
      composerAvailable: true,
      isInteracting: false,
      snapshotRenderActive: true,
    }),
    false,
  );
});

test('realtime GTAO retains the canvas DPR on ordinary viewports', () => {
  assert.equal(
    resolveRealtimePostprocessingPixelRatio({
      width: 1280,
      height: 800,
      rendererPixelRatio: 2,
    }),
    1.5,
  );
  assert.equal(
    resolveRealtimePostprocessingPixelRatio({
      width: 1000,
      height: 800,
      rendererPixelRatio: 1,
    }),
    1,
  );
});

test('realtime GTAO respects the render-target pixel budget at 4K', () => {
  const pixelRatio = resolveRealtimePostprocessingPixelRatio({
    width: 3840,
    height: 2160,
    rendererPixelRatio: 2,
  });

  assert.ok(Math.abs(pixelRatio - Math.sqrt(2_500_000 / (3840 * 2160))) < 1e-12);
  assert.ok(3840 * 2160 * pixelRatio * pixelRatio <= 2_500_000.001);
});

test('realtime GTAO falls back safely for invalid viewport metrics', () => {
  assert.equal(
    resolveRealtimePostprocessingPixelRatio({
      width: 0,
      height: Number.NaN,
      rendererPixelRatio: 0,
    }),
    1,
  );
});

test('realtime GTAO keeps the Flex pass order and sampling profile', () => {
  assert.deepEqual(REALTIME_POSTPROCESSING_PASS_ORDER, [
    'RenderPass',
    'GTAOPass',
    'SMAAPass',
    'OutputPass',
  ]);
  assert.equal(REALTIME_GTAO_CONFIG.blendIntensity, 0.78);
  assert.equal(REALTIME_GTAO_CONFIG.samples, 12);
  assert.equal(REALTIME_GTAO_CONFIG.denoise.samples, 12);
});

test('GTAO private depth shaders explicitly disable logarithmic depth', () => {
  const shaderSource = 'void main() {}';
  const patchedSource = disableLogarithmicDepthBuffer(shaderSource);

  assert.match(patchedSource, /^#undef USE_LOGARITHMIC_DEPTH_BUFFER\n/);
  assert.ok(patchedSource.endsWith(shaderSource));
});
