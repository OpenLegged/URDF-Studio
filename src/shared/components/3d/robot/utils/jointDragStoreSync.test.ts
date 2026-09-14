import test from 'node:test';
import assert from 'node:assert/strict';

import { createJointDragStoreSync } from './jointDragStoreSync';

test('emits every drag change immediately when throttling is disabled', () => {
  const changes: Array<[string, number]> = [];
  const commits: Array<[string, number]> = [];
  const sync = createJointDragStoreSync({
    onDragChange: (jointName, angle) => {
      changes.push([jointName, angle]);
    },
    onDragCommit: (jointName, angle) => {
      commits.push([jointName, angle]);
    },
    throttleChanges: false,
    intervalMs: 20,
  });

  sync.emit('hip', 0.1);
  sync.emit('hip', 0.2);
  sync.commit('hip', 0.3);
  sync.dispose();

  assert.deepEqual(changes, [
    ['hip', 0.1],
    ['hip', 0.2],
  ]);
  assert.deepEqual(commits, [['hip', 0.3]]);
});

test('throttles drag change propagation and cancels pending trailing updates on commit', async () => {
  const changes: Array<[string, number]> = [];
  const commits: Array<[string, number]> = [];
  const sync = createJointDragStoreSync({
    onDragChange: (jointName, angle) => {
      changes.push([jointName, angle]);
    },
    onDragCommit: (jointName, angle) => {
      commits.push([jointName, angle]);
    },
    throttleChanges: true,
    intervalMs: 20,
  });

  sync.emit('knee', 0.1);
  sync.emit('knee', 0.2);

  assert.deepEqual(changes, [['knee', 0.1]]);

  await new Promise((resolve) => setTimeout(resolve, 30));

  assert.deepEqual(changes, [
    ['knee', 0.1],
    ['knee', 0.2],
  ]);

  sync.emit('knee', 0.3);
  sync.emit('knee', 0.4);
  sync.commit('knee', 0.5);

  await new Promise((resolve) => setTimeout(resolve, 30));

  sync.dispose();

  assert.deepEqual(changes, [
    ['knee', 0.1],
    ['knee', 0.2],
  ]);
  assert.deepEqual(commits, [['knee', 0.5]]);
});

test('animation frame sync coalesces drag changes to the latest preview', () => {
  const globalWithAnimationFrame = globalThis as typeof globalThis & {
    requestAnimationFrame?: (callback: (time: number) => void) => number;
    cancelAnimationFrame?: (handle: number) => void;
  };
  const previousRequestAnimationFrame = globalWithAnimationFrame.requestAnimationFrame;
  const previousCancelAnimationFrame = globalWithAnimationFrame.cancelAnimationFrame;
  const frameCallbacks = new Map<number, (time: number) => void>();
  let nextFrameHandle = 1;

  globalWithAnimationFrame.requestAnimationFrame = (callback) => {
    const handle = nextFrameHandle++;
    frameCallbacks.set(handle, callback);
    return handle;
  };
  globalWithAnimationFrame.cancelAnimationFrame = (handle) => {
    frameCallbacks.delete(handle);
  };

  try {
    const changes: Array<[string, number]> = [];
    const commits: Array<[string, number]> = [];
    const sync = createJointDragStoreSync({
      onDragChange: (jointName, angle) => {
        changes.push([jointName, angle]);
      },
      onDragCommit: (jointName, angle) => {
        commits.push([jointName, angle]);
      },
      syncMode: 'animationFrame',
    });

    sync.emit('ankle', 0.1);
    sync.emit('ankle', 0.2);

    assert.deepEqual(changes, []);
    assert.equal(frameCallbacks.size, 1);

    const frameEntry = frameCallbacks.entries().next().value;
    assert.ok(frameEntry);
    const [frameHandle, frame] = frameEntry;
    frameCallbacks.delete(frameHandle);
    frame?.(16);

    assert.deepEqual(changes, [['ankle', 0.2]]);

    sync.emit('ankle', 0.3);
    sync.emit('ankle', 0.4);
    sync.commit('ankle', 0.5);

    assert.equal(frameCallbacks.size, 0);
    assert.deepEqual(changes, [['ankle', 0.2]]);
    assert.deepEqual(commits, [['ankle', 0.5]]);

    sync.dispose();
  } finally {
    globalWithAnimationFrame.requestAnimationFrame = previousRequestAnimationFrame;
    globalWithAnimationFrame.cancelAnimationFrame = previousCancelAnimationFrame;
  }
});
