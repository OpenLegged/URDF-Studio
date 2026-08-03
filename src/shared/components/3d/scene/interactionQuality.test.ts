import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MIN_RENDER_DPR,
  RESTING_DPR_CAP,
  resolveCanvasDpr,
} from './interactionQuality.ts';

test('resolveCanvasDpr keeps canvases crisp up to the resting cap', () => {
  assert.equal(resolveCanvasDpr({ devicePixelRatio: 2.5 }), RESTING_DPR_CAP);
});

test('resolveCanvasDpr supersamples low-DPR displays to reduce viewport aliasing', () => {
  assert.equal(resolveCanvasDpr({ devicePixelRatio: 0.9 }), MIN_RENDER_DPR);
});

test('resolveCanvasDpr renders a DPR 1 display at the profile floor', () => {
  assert.equal(
    resolveCanvasDpr({ devicePixelRatio: 1, restingCap: 2, minRenderDpr: 1.75 }),
    1.75,
  );
});

test('resolveCanvasDpr uses the native ratio when it sits inside the profile range', () => {
  assert.equal(
    resolveCanvasDpr({ devicePixelRatio: 2, restingCap: 2.5, minRenderDpr: 2 }),
    2,
  );
});

test('resolveCanvasDpr keeps the resting cap authoritative when the floor exceeds it', () => {
  assert.equal(resolveCanvasDpr({ devicePixelRatio: 2, restingCap: 1.5, minRenderDpr: 2 }), 1.5);
});

test('resolveCanvasDpr falls back to a safe DPR when the device ratio is invalid', () => {
  assert.equal(resolveCanvasDpr({ devicePixelRatio: Number.NaN }), MIN_RENDER_DPR);
});
