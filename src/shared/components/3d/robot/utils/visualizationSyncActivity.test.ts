import test from 'node:test';
import assert from 'node:assert/strict';

import { isModelOpacitySyncActive, shouldRunVisualizationSync } from './visualizationSyncActivity';

test('shouldRunVisualizationSync skips inactive default-state passes', () => {
  assert.equal(shouldRunVisualizationSync(false, false), false);
});

test('shouldRunVisualizationSync keeps one cleanup pass after an active state', () => {
  assert.equal(shouldRunVisualizationSync(false, true), true);
  assert.equal(shouldRunVisualizationSync(true, false), true);
});

test('isModelOpacitySyncActive only activates away from the default opacity', () => {
  assert.equal(isModelOpacitySyncActive(1), false);
  assert.equal(isModelOpacitySyncActive(0.9998), false);
  assert.equal(isModelOpacitySyncActive(0.95), true);
});
