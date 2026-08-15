import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { createAssemblySceneProjection } from '@/core/robot';
import type { JointInteractionPreviewSnapshot } from '@/store/jointInteractionPreviewStore';
import {
  DEFAULT_LINK,
  JointType,
  type AssemblyComponent,
  type AssemblyState,
  type UrdfJoint,
} from '@/types';
import {
  TreeEditorJointSection,
  createTreeJointPanelScopeKey,
  resolveComponentViewerJointPreview,
  resolveJointPanelResetReconciliation,
  resolveJointPanelWorkspaceRef,
  resolveJointPanelResetAngles,
  resolveWorkspaceViewerJointPreview,
  resolveWorkspaceViewerJointPreviewState,
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

function createComponent(id: string): AssemblyComponent {
  return {
    id,
    name: id,
    sourceFile: `${id}.urdf`,
    transform: {
      position: { x: 0, y: 0, z: 0 },
      rotation: { r: 0, p: 0, y: 0 },
    },
    visible: true,
    robot: {
      name: id,
      rootLinkId: 'base',
      links: {
        base: { ...structuredClone(DEFAULT_LINK), id: 'base', name: 'base' },
        tip: { ...structuredClone(DEFAULT_LINK), id: 'tip', name: 'tip' },
      },
      joints: {
        shared_joint: createJoint('shared_joint', {
          parentLinkId: 'base',
          childLinkId: 'tip',
        }),
      },
    },
  };
}

function createAssembly(): AssemblyState {
  return {
    name: 'assembly',
    transform: {
      position: { x: 0, y: 0, z: 0 },
      rotation: { r: 0, p: 0, y: 0 },
    },
    components: {
      arm: createComponent('arm'),
      hand: createComponent('hand'),
    },
    bridges: {
      arm_to_hand: {
        id: 'arm_to_hand',
        name: 'arm_to_hand',
        parentComponentId: 'arm',
        parentLinkId: 'tip',
        childComponentId: 'hand',
        childLinkId: 'base',
        joint: createJoint('arm_to_hand', {
          parentLinkId: 'tip',
          childLinkId: 'base',
        }),
      },
    },
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

test('workspace joint panel scope follows semantic projection identity', () => {
  const assembly = createAssembly();
  const projection = createAssemblySceneProjection(assembly);
  const createScope = (sceneProjection = projection) =>
    createTreeJointPanelScopeKey({
      componentId: 'workspace',
      sourceFilePath: 'assembly',
      robot: sceneProjection.robotData,
      projection: sceneProjection,
    });

  // Joint-motion-only renders reuse the semantic projection, so pending slider
  // values remain in the same scope.
  assert.equal(createScope(), createScope());

  // Replacing even an identically named workspace produces a new semantic
  // projection and must not inherit pending slider values.
  const replacementProjection = createAssemblySceneProjection(structuredClone(assembly));
  assert.notEqual(createScope(), createScope(replacementProjection));

  const topologyChange = structuredClone(assembly);
  topologyChange.components.tool = createComponent('tool');
  const topologyProjection = createAssemblySceneProjection(topologyChange);
  assert.notEqual(createScope(), createScope(topologyProjection));
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

test('workspace joint preview keeps duplicate local IDs separated by projection', () => {
  const projection = createAssemblySceneProjection(createAssembly());
  const preview: JointInteractionPreviewSnapshot = {
    ownerId: 'viewer-owner',
    source: 'viewer',
    dragSessionId: 'drag-1',
    activeJointId: null,
    jointAngles: {},
    jointQuaternions: {},
    jointOrigins: {},
    workspaceByComponent: {
      arm: {
        activeJointId: 'shared_joint',
        jointAngles: { shared_joint: 0.25 },
        jointQuaternions: {},
        jointOrigins: {},
      },
      hand: {
        activeJointId: 'shared_joint',
        jointAngles: { shared_joint: 0.75 },
        jointQuaternions: {},
        jointOrigins: {},
      },
    },
  };

  const angles = resolveWorkspaceViewerJointPreview(preview, projection);
  const armId = projection.entityRefKeyToGlobal.get(
    JSON.stringify(['joint', 'arm', 'shared_joint']),
  );
  const handId = projection.entityRefKeyToGlobal.get(
    JSON.stringify(['joint', 'hand', 'shared_joint']),
  );
  assert.ok(armId);
  assert.ok(handId);
  assert.notEqual(armId, handId);
  assert.deepEqual(angles, { [armId]: 0.25, [handId]: 0.75 });
});

test('workspace joint preview merges canonical component and bridge targets', () => {
  const projection = createAssemblySceneProjection(createAssembly());
  const origin = {
    xyz: { x: 1, y: 2, z: 3 },
    rpy: { r: 0.1, p: 0.2, y: 0.3 },
  };
  const quaternion = { x: 0, y: 0, z: 0.25, w: 0.75 };
  const preview: JointInteractionPreviewSnapshot = {
    ownerId: 'viewer-owner',
    source: 'viewer',
    dragSessionId: 'drag-1',
    activeJointId: 'renderer-bridge',
    jointAngles: {},
    jointQuaternions: {},
    jointOrigins: {},
    workspaceTargets: [
      {
        ref: { type: 'joint', componentId: 'arm', entityId: 'shared_joint' },
        active: false,
        angle: 0.25,
      },
      {
        ref: { type: 'bridge', bridgeId: 'arm_to_hand' },
        active: true,
        angle: -0.5,
        quaternion,
        origin,
      },
    ],
  };
  const armId = projection.entityRefKeyToGlobal.get(
    JSON.stringify(['joint', 'arm', 'shared_joint']),
  );
  const bridgeId = projection.entityRefKeyToGlobal.get(JSON.stringify(['bridge', 'arm_to_hand']));
  assert.ok(armId && bridgeId);

  assert.deepEqual(resolveWorkspaceViewerJointPreviewState(preview, projection), {
    activeJointId: bridgeId,
    jointAngles: { [armId]: 0.25, [bridgeId]: -0.5 },
    jointQuaternions: { [bridgeId]: quaternion },
    jointOrigins: { [bridgeId]: origin },
  });
});

test('reset reconciliation keeps rejected joints canonical and pending only accepted writes', () => {
  const projection = createAssemblySceneProjection(createAssembly());
  const armJointId = projection.entityRefKeyToGlobal.get(
    JSON.stringify(['joint', 'arm', 'shared_joint']),
  );
  const handJointId = projection.entityRefKeyToGlobal.get(
    JSON.stringify(['joint', 'hand', 'shared_joint']),
  );
  const bridgeId = projection.entityRefKeyToGlobal.get(JSON.stringify(['bridge', 'arm_to_hand']));
  assert.ok(armJointId && handJointId && bridgeId);

  const reconciliation = resolveJointPanelResetReconciliation({
    acceptedTargets: [
      {
        ref: { type: 'joint', componentId: 'arm', entityId: 'shared_joint' },
        angle: 0,
      },
      { ref: { type: 'bridge', bridgeId: 'arm_to_hand' }, angle: 0 },
    ],
    currentAngles: {
      [armJointId]: 0.5,
      [handJointId]: 0.75,
      [bridgeId]: 0,
    },
    projection,
    requestedAngles: {
      [armJointId]: 0,
      [handJointId]: 0,
      [bridgeId]: 0,
    },
  });

  assert.deepEqual(reconciliation.jointAngles, {
    [armJointId]: 0,
    // The locked/rejected hand joint must snap back to canonical state.
    [handJointId]: 0.75,
    [bridgeId]: 0,
  });
  assert.deepEqual(reconciliation.pendingAngles, {
    // The already-canonical bridge does not need a pending optimistic value.
    [armJointId]: 0,
  });
});

test('workspace joint section renders every component joint and the revolute bridge', () => {
  const projection = createAssemblySceneProjection(createAssembly());
  const markup = renderToStaticMarkup(
    React.createElement(TreeEditorJointSection, {
      robot: projection.robotData,
      projection,
      selection: null,
      lang: 'en',
      onUpdate: () => {},
      show: true,
      height: 320,
    }),
  );

  const armJointId = projection.entityRefKeyToGlobal.get(
    JSON.stringify(['joint', 'arm', 'shared_joint']),
  );
  const handJointId = projection.entityRefKeyToGlobal.get(
    JSON.stringify(['joint', 'hand', 'shared_joint']),
  );
  const bridgeId = projection.entityRefKeyToGlobal.get(JSON.stringify(['bridge', 'arm_to_hand']));
  assert.ok(armJointId && markup.includes(armJointId));
  assert.ok(handJointId && markup.includes(handJointId));
  assert.ok(bridgeId && markup.includes(bridgeId));
  assert.deepEqual(resolveJointPanelWorkspaceRef(projection, bridgeId), {
    type: 'bridge',
    bridgeId: 'arm_to_hand',
  });
});
