import assert from 'node:assert/strict';
import test from 'node:test';

import { applyAssemblyAutoGroundResolution } from './assemblyAutoGrounding';

test('applies every measured transform before consuming the pending component ids', () => {
  const events: string[] = [];

  applyAssemblyAutoGroundResolution({
    resolution: {
      adjustments: [
        {
          componentId: 'component-a',
          transform: {
            position: { x: 1, y: 2, z: 3 },
            rotation: { r: 0, p: 0, y: 0 },
          },
        },
      ],
      measuredComponentIds: ['component-a', 'component-b'],
      runtimeRobotLocalPositionDelta: null,
    },
    consumePendingComponentIds: (componentIds) => {
      events.push(`consume:${Array.from(componentIds).join(',')}`);
    },
    onComponentTransform: (ref, _transform, options) => {
      events.push(`transform:${ref.componentId}`);
      assert.deepEqual(options, {
        commitMode: 'immediate',
        historyLabel: 'Ground component',
        skipHistory: true,
      });
    },
  });

  assert.deepEqual(events, ['transform:component-a', 'consume:component-a,component-b']);
});

test('does not consume pending ids when a transform commit fails', () => {
  let consumed = false;

  assert.throws(() => {
    applyAssemblyAutoGroundResolution({
      resolution: {
        adjustments: [
          {
            componentId: 'component-a',
            transform: {
              position: { x: 0, y: 0, z: 1 },
              rotation: { r: 0, p: 0, y: 0 },
            },
          },
        ],
        measuredComponentIds: ['component-a'],
        runtimeRobotLocalPositionDelta: null,
      },
      consumePendingComponentIds: () => {
        consumed = true;
      },
      onComponentTransform: () => {
        throw new Error('commit failed');
      },
    });
  }, /commit failed/);

  assert.equal(consumed, false);
});
