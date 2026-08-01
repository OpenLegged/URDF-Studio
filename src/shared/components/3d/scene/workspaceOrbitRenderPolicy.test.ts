import assert from 'node:assert/strict';
import test from 'node:test';

import { shouldScheduleWorkspaceOrbitDemandFrame } from './workspaceOrbitRenderPolicy.ts';

test('schedules a fallback frame only when an enabled control needs to wake a demand canvas', () => {
  assert.equal(
    shouldScheduleWorkspaceOrbitDemandFrame({
      controlsEnabled: true,
      frameloop: 'demand',
      frameScheduled: false,
    }),
    true,
  );
});

test('does not duplicate updates while the canvas is already rendering continuously', () => {
  assert.equal(
    shouldScheduleWorkspaceOrbitDemandFrame({
      controlsEnabled: true,
      frameloop: 'always',
      frameScheduled: false,
    }),
    false,
  );
});

test('does not schedule disabled, never-loop, or already-pending controls', () => {
  assert.equal(
    shouldScheduleWorkspaceOrbitDemandFrame({
      controlsEnabled: false,
      frameloop: 'demand',
      frameScheduled: false,
    }),
    false,
  );
  assert.equal(
    shouldScheduleWorkspaceOrbitDemandFrame({
      controlsEnabled: true,
      frameloop: 'never',
      frameScheduled: false,
    }),
    false,
  );
  assert.equal(
    shouldScheduleWorkspaceOrbitDemandFrame({
      controlsEnabled: true,
      frameloop: 'demand',
      frameScheduled: true,
    }),
    false,
  );
});
