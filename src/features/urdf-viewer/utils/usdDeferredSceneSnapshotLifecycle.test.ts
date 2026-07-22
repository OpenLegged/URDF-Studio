import assert from 'node:assert/strict';
import test from 'node:test';

import type { ViewerRobotDataResolution } from './viewerRobotData.ts';
import { createUsdDeferredSceneSnapshotLifecycle } from './usdDeferredSceneSnapshotLifecycle.ts';

type ScheduledTask = {
  cancelled: boolean;
  delayMs: number;
  run: () => void;
};

type SceneSnapshot = NonNullable<ViewerRobotDataResolution['usdSceneSnapshot']>;

function createHarness() {
  const tasks: ScheduledTask[] = [];
  const published: Array<{ snapshot: SceneSnapshot; sourceFileName: string }> = [];
  let activeGeneration = 1;
  let activeInteraction = false;
  let lastInteractionAt = 0;
  let now = 1_000;

  const lifecycle = createUsdDeferredSceneSnapshotLifecycle<SceneSnapshot>({
    isActive: (generation) => generation === activeGeneration,
    interaction: () => ({ active: activeInteraction, lastInteractionAt }),
    publish: (snapshot, sourceFileName) => {
      published.push({ snapshot, sourceFileName });
    },
    log: () => undefined,
    now: () => now,
    scheduleTimeout: (callback, delayMs) => {
      const task = { cancelled: false, delayMs, run: callback };
      tasks.push(task);
      return task;
    },
    clearScheduledTimeout: (handle) => {
      (handle as ScheduledTask).cancelled = true;
    },
  });

  return {
    lifecycle,
    published,
    tasks,
    setActiveGeneration(generation: number) {
      activeGeneration = generation;
    },
    setInteraction(active: boolean, interactedAt: number) {
      activeInteraction = active;
      lastInteractionAt = interactedAt;
    },
    setNow(value: number) {
      now = value;
    },
  };
}

function createSnapshot(): SceneSnapshot {
  return { stageSourcePath: '/robot.usd' } as SceneSnapshot;
}

function runTask(task: ScheduledTask): void {
  assert.equal(task.cancelled, false, 'expected a live scheduled task');
  task.cancelled = true;
  task.run();
}

test('deferred snapshot lifecycle publishes after the initial delay', () => {
  const harness = createHarness();
  const snapshot = createSnapshot();

  harness.lifecycle.schedule(snapshot, 'robot.usd', 1);

  assert.equal(harness.tasks.length, 1);
  assert.equal(harness.tasks[0].delayMs, 1_200);
  assert.equal(harness.published.length, 0);

  harness.setNow(2_200);
  runTask(harness.tasks[0]);
  assert.deepEqual(harness.published, [{ snapshot, sourceFileName: 'robot.usd' }]);
});

test('deferred snapshot lifecycle waits until interaction becomes idle', () => {
  const harness = createHarness();

  harness.lifecycle.schedule(createSnapshot(), 'robot.usd', 1);
  harness.setNow(2_200);
  harness.setInteraction(true, 2_200);
  runTask(harness.tasks[0]);

  assert.equal(harness.tasks[1].delayMs, 900);
  assert.equal(harness.published.length, 0);

  harness.setNow(3_100);
  harness.setInteraction(false, 2_200);
  runTask(harness.tasks[1]);
  assert.equal(harness.published.length, 1);
});

test('deferred snapshot lifecycle drops work from an inactive generation', () => {
  const harness = createHarness();

  harness.lifecycle.schedule(createSnapshot(), 'robot.usd', 1);
  harness.setActiveGeneration(2);
  harness.setNow(2_200);
  runTask(harness.tasks[0]);

  assert.equal(harness.published.length, 0);
  assert.equal(harness.tasks.length, 1);
});

test('clear invalidates the pending snapshot even if a cancelled callback runs', () => {
  const harness = createHarness();

  harness.lifecycle.schedule(createSnapshot(), 'robot.usd', 1);
  const staleTask = harness.tasks[0];
  harness.lifecycle.clear();

  assert.equal(staleTask.cancelled, true);
  staleTask.run();
  assert.equal(harness.published.length, 0);
  assert.equal(harness.tasks.length, 1);
});

test('a stale callback cannot detach the replacement timeout from clear', () => {
  const harness = createHarness();

  harness.lifecycle.schedule(createSnapshot(), 'old.usd', 1);
  const staleTask = harness.tasks[0];
  harness.lifecycle.schedule(createSnapshot(), 'new.usd', 1);
  const replacementTask = harness.tasks[1];

  staleTask.run();
  harness.lifecycle.clear();

  assert.equal(replacementTask.cancelled, true);
  replacementTask.run();
  assert.equal(harness.published.length, 0);
});

test('dispose clears pending work and rejects later schedules', () => {
  const harness = createHarness();

  harness.lifecycle.schedule(createSnapshot(), 'robot.usd', 1);
  harness.lifecycle.dispose();
  harness.lifecycle.schedule(createSnapshot(), 'new.usd', 1);

  assert.equal(harness.tasks[0].cancelled, true);
  assert.equal(harness.tasks.length, 1);
  assert.equal(harness.published.length, 0);
});
