import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ADAPTIVE_INTERACTION_DEFAULT_FRAME_BUDGET_MS,
  ADAPTIVE_INTERACTION_FAST_FRAME_COUNT,
  ADAPTIVE_INTERACTION_FAST_FRAME_BUDGET_MULTIPLIER,
  ADAPTIVE_INTERACTION_SLOW_FRAME_COUNT,
  ADAPTIVE_INTERACTION_SLOW_FRAME_BUDGET_MULTIPLIER,
  MIN_RENDER_DPR,
  RESTING_DPR_CAP,
  resolveAdaptiveInteractionFrameBudget,
  resolveCanvasDpr,
  resolveNativeInteractionDpr,
  sampleAdaptiveInteractionDpr,
} from './interactionQuality.ts';

test('resolveCanvasDpr keeps resting canvases crisp up to the resting cap', () => {
  assert.equal(resolveCanvasDpr({ devicePixelRatio: 2.5, isInteracting: false }), RESTING_DPR_CAP);
});

test('resolveCanvasDpr removes extra supersampling during interaction on DPR 1 displays', () => {
  assert.equal(
    resolveCanvasDpr({
      devicePixelRatio: 1,
      isInteracting: true,
      restingCap: 2,
      minRenderDpr: 1.75,
    }),
    1,
  );
});

test('resolveCanvasDpr preserves native DPR 2 during interaction when the profile allows it', () => {
  assert.equal(
    resolveCanvasDpr({
      devicePixelRatio: 2,
      isInteracting: true,
      restingCap: 2.5,
      minRenderDpr: 2,
    }),
    2,
  );
});

test('resolveCanvasDpr supersamples low-DPR displays to reduce viewport aliasing', () => {
  assert.equal(resolveCanvasDpr({ devicePixelRatio: 0.9, isInteracting: false }), MIN_RENDER_DPR);
});

test('resolveCanvasDpr respects an adaptive cap below the supersampling floor', () => {
  assert.equal(
    resolveCanvasDpr({ devicePixelRatio: 2, isInteracting: true, interactionCap: 1.25 }),
    1.25,
  );
});

test('resolveCanvasDpr falls back to a safe DPR when the device ratio is invalid', () => {
  assert.equal(
    resolveCanvasDpr({ devicePixelRatio: Number.NaN, isInteracting: false }),
    MIN_RENDER_DPR,
  );
});

test('resolveNativeInteractionDpr respects both the physical display and profile cap', () => {
  assert.equal(resolveNativeInteractionDpr(2, 2.5), 2);
  assert.equal(resolveNativeInteractionDpr(3, 2.5), 2.5);
  assert.equal(resolveNativeInteractionDpr(1, 2.5), 1);
});

test('resolveAdaptiveInteractionFrameBudget calibrates low-refresh displays without exceeding 60 FPS', () => {
  assert.equal(
    resolveAdaptiveInteractionFrameBudget(Array.from({ length: 24 }, () => 1000 / 50)),
    1000 / 50,
  );
  assert.equal(
    resolveAdaptiveInteractionFrameBudget(Array.from({ length: 24 }, () => 1000 / 120)),
    ADAPTIVE_INTERACTION_DEFAULT_FRAME_BUDGET_MS,
  );
});

test('resolveAdaptiveInteractionFrameBudget ignores isolated stalls during calibration', () => {
  const intervals = [...Array.from({ length: 20 }, () => 1000 / 60), 35, 48, 70, 1000];
  assert.ok(
    Math.abs(
      resolveAdaptiveInteractionFrameBudget(intervals) -
        ADAPTIVE_INTERACTION_DEFAULT_FRAME_BUDGET_MS,
    ) < 0.001,
  );
});

test('sampleAdaptiveInteractionDpr lowers DPR only after sustained slow frames', () => {
  let state = { dpr: 2, slowFrameCount: 0, fastFrameCount: 0 };
  const slowFrameTimeMs =
    ADAPTIVE_INTERACTION_DEFAULT_FRAME_BUDGET_MS *
      ADAPTIVE_INTERACTION_SLOW_FRAME_BUDGET_MULTIPLIER +
    1;

  for (let index = 1; index < ADAPTIVE_INTERACTION_SLOW_FRAME_COUNT; index += 1) {
    state = sampleAdaptiveInteractionDpr({ state, frameTimeMs: slowFrameTimeMs, targetDpr: 2 });
    assert.equal(state.dpr, 2);
  }

  state = sampleAdaptiveInteractionDpr({ state, frameTimeMs: slowFrameTimeMs, targetDpr: 2 });
  assert.equal(state.dpr, 1.75);
});

test('sampleAdaptiveInteractionDpr ignores isolated slow-frame spikes', () => {
  const slowFrameTimeMs =
    ADAPTIVE_INTERACTION_DEFAULT_FRAME_BUDGET_MS *
      ADAPTIVE_INTERACTION_SLOW_FRAME_BUDGET_MULTIPLIER +
    1;
  let state = sampleAdaptiveInteractionDpr({
    state: { dpr: 2, slowFrameCount: 0, fastFrameCount: 0 },
    frameTimeMs: slowFrameTimeMs,
    targetDpr: 2,
  });
  state = sampleAdaptiveInteractionDpr({ state, frameTimeMs: 20, targetDpr: 2 });

  for (let index = 0; index < ADAPTIVE_INTERACTION_SLOW_FRAME_COUNT - 1; index += 1) {
    state = sampleAdaptiveInteractionDpr({ state, frameTimeMs: slowFrameTimeMs, targetDpr: 2 });
  }

  assert.equal(state.dpr, 2);
});

test('sampleAdaptiveInteractionDpr slowly restores DPR after sustained fast frames', () => {
  let state = { dpr: 1.25, slowFrameCount: 0, fastFrameCount: 0 };
  const fastFrameTimeMs =
    ADAPTIVE_INTERACTION_DEFAULT_FRAME_BUDGET_MS *
      ADAPTIVE_INTERACTION_FAST_FRAME_BUDGET_MULTIPLIER -
    1;

  for (let index = 0; index < ADAPTIVE_INTERACTION_FAST_FRAME_COUNT; index += 1) {
    state = sampleAdaptiveInteractionDpr({ state, frameTimeMs: fastFrameTimeMs, targetDpr: 2 });
  }

  assert.equal(state.dpr, 1.5);
});

test('sampleAdaptiveInteractionDpr never crosses its adaptive bounds', () => {
  const lowered = sampleAdaptiveInteractionDpr({
    state: {
      dpr: 1,
      slowFrameCount: ADAPTIVE_INTERACTION_SLOW_FRAME_COUNT - 1,
      fastFrameCount: 0,
    },
    frameTimeMs:
      ADAPTIVE_INTERACTION_DEFAULT_FRAME_BUDGET_MS *
        ADAPTIVE_INTERACTION_SLOW_FRAME_BUDGET_MULTIPLIER +
      1,
    targetDpr: 2,
  });
  const raised = sampleAdaptiveInteractionDpr({
    state: {
      dpr: 2,
      slowFrameCount: 0,
      fastFrameCount: ADAPTIVE_INTERACTION_FAST_FRAME_COUNT - 1,
    },
    frameTimeMs:
      ADAPTIVE_INTERACTION_DEFAULT_FRAME_BUDGET_MS *
        ADAPTIVE_INTERACTION_FAST_FRAME_BUDGET_MULTIPLIER -
      1,
    targetDpr: 2,
  });

  assert.equal(lowered.dpr, 1);
  assert.equal(raised.dpr, 2);
});
