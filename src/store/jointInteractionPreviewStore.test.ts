import assert from 'node:assert/strict';
import test from 'node:test';

import {
  EMPTY_JOINT_INTERACTION_PREVIEW,
  useJointInteractionPreviewStore,
} from './jointInteractionPreviewStore';

test('joint interaction preview store supports tree-panel previews and source-scoped clearing', () => {
  const store = useJointInteractionPreviewStore.getState();
  store.clearPreview();

  store.publishPreview({
    ownerId: 'tree-owner',
    source: 'tree-panel',
    dragSessionId: 'tree-drag',
    activeJointId: 'joint_a',
    jointAngles: { joint_a: 0.5 },
    jointQuaternions: {},
    jointOrigins: {},
  });

  assert.equal(useJointInteractionPreviewStore.getState().preview.source, 'tree-panel');

  store.clearPreview({ source: 'viewer' });
  assert.equal(useJointInteractionPreviewStore.getState().preview.source, 'tree-panel');

  store.clearPreview({
    ownerId: 'stale-tree-owner',
    source: 'tree-panel',
    dragSessionId: 'tree-drag',
  });
  assert.equal(useJointInteractionPreviewStore.getState().preview.source, 'tree-panel');

  store.clearPreview({ source: 'tree-panel', dragSessionId: 'tree-drag' });
  assert.deepEqual(
    useJointInteractionPreviewStore.getState().preview,
    EMPTY_JOINT_INTERACTION_PREVIEW,
  );
});

test('joint interaction preview store preserves canonical component-local viewer payloads', () => {
  const store = useJointInteractionPreviewStore.getState();
  store.clearPreview();
  store.publishPreview({
    ownerId: 'viewer-owner',
    source: 'viewer',
    dragSessionId: 'viewer-drag',
    activeJointId: 'left_joint',
    jointAngles: { left_joint: 0.5, right_joint: -0.25 },
    jointQuaternions: {},
    jointOrigins: {},
    workspaceByComponent: {
      left: {
        activeJointId: 'joint',
        jointAngles: { joint: 0.5 },
        jointQuaternions: {},
        jointOrigins: {},
      },
      right: {
        activeJointId: null,
        jointAngles: { joint: -0.25 },
        jointQuaternions: {},
        jointOrigins: {},
      },
    },
  });

  assert.deepEqual(
    useJointInteractionPreviewStore.getState().preview.workspaceByComponent?.right?.jointAngles,
    { joint: -0.25 },
  );
  store.clearPreview();
});
