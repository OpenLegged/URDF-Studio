import assert from 'node:assert/strict';
import test from 'node:test';

import { createJointDragFrameSync } from './jointDragFrameSync.ts';

test('applies the leading pointer immediately and coalesces the remaining frame burst', () => {
  const queued: FrameRequestCallback[] = [];
  const calls: Array<[number, number]> = [];
  const scheduler = createJointDragFrameSync({
    onFrame: (clientX, clientY) => {
      calls.push([clientX, clientY]);
    },
    requestFrame: (callback) => {
      queued.push(callback);
      return queued.length;
    },
    cancelFrame: () => {},
  });

  scheduler.schedule(10, 20);
  scheduler.schedule(30, 40);
  scheduler.schedule(50, 60);

  assert.equal(queued.length, 1);
  assert.deepEqual(calls, [[10, 20]]);

  queued[0](0);

  assert.deepEqual(calls, [
    [10, 20],
    [50, 60],
  ]);
});

test('flush applies the latest pending pointer update immediately', () => {
  const calls: Array<[number, number]> = [];
  let cancelledHandle: number | null = null as number | null;
  const scheduler = createJointDragFrameSync({
    onFrame: (clientX, clientY) => {
      calls.push([clientX, clientY]);
    },
    requestFrame: () => 7,
    cancelFrame: (handle) => {
      cancelledHandle = handle;
    },
  });

  scheduler.schedule(12, 34);
  scheduler.schedule(56, 78);
  scheduler.flush();

  assert.equal(cancelledHandle, 7);
  assert.deepEqual(calls, [
    [12, 34],
    [56, 78],
  ]);
});

test('cancel drops the pending frame without emitting a drag update', () => {
  const queued: FrameRequestCallback[] = [];
  const calls: Array<[number, number]> = [];
  let cancelledHandle: number | null = null as number | null;
  const scheduler = createJointDragFrameSync({
    onFrame: (clientX, clientY) => {
      calls.push([clientX, clientY]);
    },
    requestFrame: (callback) => {
      queued.push(callback);
      return 3;
    },
    cancelFrame: (handle) => {
      cancelledHandle = handle;
    },
  });

  scheduler.schedule(11, 22);
  scheduler.cancel();

  assert.equal(cancelledHandle, 3);
  assert.deepEqual(calls, [[11, 22]]);

  queued[0](0);
  assert.deepEqual(calls, [[11, 22]]);
});
