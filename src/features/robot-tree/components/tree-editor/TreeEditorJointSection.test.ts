import assert from 'node:assert/strict';
import test from 'node:test';

import type { JointInteractionPreviewSnapshot } from '@/store/jointInteractionPreviewStore';
import { JointType, type UrdfJoint } from '@/types';
import {
  createTreeJointPanelScopeKey,
  resolveComponentViewerJointPreview,
  resolveJointPanelResetAngles,
} from './TreeEditorJointSection.tsx';

function createJoint(id: string, overrides: Partial<UrdfJoint> = {}): UrdfJoint {
  return {
    id,
    name: id,
    type: JointType.REVOLUTE,
    parentLinkId: 'parent',
    childLinkId: id,
    origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
    axis: { x: 0, y: 0, z: 1 },
    dynamics: { damping: 0, friction: 0 },
    hardware: { armature: 0, motorType: '', motorId: '', motorDirection: 1 },
    ...overrides,
  };
}

test('viewer joint preview isolates duplicate source-local IDs by component', () => {
  const preview: JointInteractionPreviewSnapshot = {
    ownerId: 'viewer-owner',
    source: 'viewer',
    dragSessionId: 'drag-1',
    activeJointId: 'right__shared_joint',
    jointAngles: { right__shared_joint: 99 },
    jointQuaternions: {},
    jointOrigins: {},
    workspaceByComponent: {
      left: {
        activeJointId: 'shared_joint',
        jointAngles: { shared_joint: 0.25 },
        jointQuaternions: {},
        jointOrigins: {},
      },
      right: {
        activeJointId: 'shared_joint',
        jointAngles: { shared_joint: 0.75 },
        jointQuaternions: {},
        jointOrigins: {},
      },
    },
  };

  assert.deepEqual(resolveComponentViewerJointPreview(preview, 'left')?.jointAngles, {
    shared_joint: 0.25,
  });
  assert.deepEqual(resolveComponentViewerJointPreview(preview, 'right')?.jointAngles, {
    shared_joint: 0.75,
  });
  assert.equal(resolveComponentViewerJointPreview(preview, 'missing'), null);
});

test('tree ignores renderer-global and non-viewer preview payloads', () => {
  const preview: JointInteractionPreviewSnapshot = {
    ownerId: 'tree-owner',
    source: 'tree-panel',
    dragSessionId: 'tree-drag',
    activeJointId: 'left__shared_joint',
    jointAngles: { left__shared_joint: 1.5 },
    jointQuaternions: {},
    jointOrigins: {},
    workspaceByComponent: {
      left: {
        activeJointId: 'shared_joint',
        jointAngles: { shared_joint: 0.5 },
        jointQuaternions: {},
        jointOrigins: {},
      },
    },
  };

  assert.equal(resolveComponentViewerJointPreview(preview, 'left'), null);
});

test('joint panel scope isolates components sharing source and local topology names', () => {
  const robot = { name: 'shared_robot', rootLinkId: 'base' };
  const left = createTreeJointPanelScopeKey({
    componentId: 'left',
    sourceFilePath: 'library/shared.xml',
    robot,
  });
  const right = createTreeJointPanelScopeKey({
    componentId: 'right',
    sourceFilePath: 'library/shared.xml',
    robot,
  });

  assert.notEqual(left, right);
  assert.equal(left, 'left:library/shared.xml');
  assert.equal(right, 'right:library/shared.xml');
});

test('reset targets the authored rest pose, not the pose the robot currently holds', () => {
  const joints = {
    posed_joint: createJoint('posed_joint', { angle: 1.25 }),
    referenced_joint: createJoint('referenced_joint', {
      angle: -0.75,
      referencePosition: 0.5,
    }),
    fixed_joint: createJoint('fixed_joint', { type: JointType.FIXED, angle: 0.3 }),
  };

  assert.deepEqual(resolveJointPanelResetAngles(joints), {
    posed_joint: 0,
    referenced_joint: 0.5,
  });
});
