import assert from 'node:assert/strict';
import test from 'node:test';
import { assertGeometryMetrics } from './geometry-edit-browser.mjs';

const model = { linkCount: 2, jointCount: 1, maxIndent: 4, sourceBytes: 500 };
const baseline = { runtimeRevision: 3, visualMeshes: 2, collisionMeshes: 3 };
const healthy = { ...baseline, links: 2, joints: 1, placeholders: 0, load: { status: 'ready' },
  canvasCount: 1, contextLosses: 0, draftSourceBytes: 600, draftValid: true, draftLinks: 2, draftJoints: 1, maxIndent: 4 };

test('an empty draft cache cannot pass the editing source check', () => {
  assert.doesNotThrow(() => assertGeometryMetrics(healthy, model, baseline));
  assert.throws(() => assertGeometryMetrics({ ...healthy, draftSourceBytes: 0, draftValid: false }, model, baseline), /nonempty valid URDF/);
});

test('well-formed but incomplete source and exponential whitespace both fail', () => {
  assert.throws(() => assertGeometryMetrics({ ...healthy, draftLinks: 1 }, model, baseline));
  assert.throws(() => assertGeometryMetrics({ ...healthy, maxIndent: 128 }, model, baseline), /indentation/);
  assert.throws(() => assertGeometryMetrics({ ...healthy, draftSourceBytes: 10000 }, model, baseline), /source size/);
});

test('runtime replacement, mesh loss, and WebGL context loss fail independently', () => {
  assert.throws(() => assertGeometryMetrics({ ...healthy, runtimeRevision: 4 }, model, baseline), /reuse/);
  assert.throws(() => assertGeometryMetrics({ ...healthy, visualMeshes: 1 }, model, baseline), /remain mounted/);
  assert.throws(() => assertGeometryMetrics({ ...healthy, contextLosses: 1 }, model, baseline), /WebGL/);
});
