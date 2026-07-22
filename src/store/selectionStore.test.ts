import assert from 'node:assert/strict';
import test from 'node:test';

import { createSingleComponentWorkspace } from '@/core/robot';
import {
  DEFAULT_JOINT,
  DEFAULT_LINK,
  JointType,
  type AssemblyState,
  type EntityRef,
  type RobotData,
  type WorkspaceSelection,
} from '@/types';
import {
  matchesSelection,
  repairWorkspaceSelection,
  useSelectionStore,
  validateEntityRef,
} from './selectionStore.ts';
import { useWorkspaceStore } from './workspaceStore.ts';

function createRobot(name: string): RobotData {
  return {
    name,
    rootLinkId: 'base_link',
    links: {
      base_link: {
        ...DEFAULT_LINK,
        id: 'base_link',
        name: `${name} display base`,
        visible: true,
      },
      tool_link: {
        ...DEFAULT_LINK,
        id: 'tool_link',
        name: `${name} display tool`,
        visible: true,
      },
    },
    joints: {
      tool_joint: {
        ...DEFAULT_JOINT,
        id: 'tool_joint',
        name: `${name} display joint`,
        type: JointType.FIXED,
        parentLinkId: 'base_link',
        childLinkId: 'tool_link',
      },
    },
    inspectionContext: {
      sourceFormat: 'mjcf',
      mjcf: {
        siteCount: 0,
        tendonCount: 1,
        tendonActuatorCount: 0,
        bodiesWithSites: [],
        tendons: [{
          name: 'shared_tendon',
          type: 'fixed',
          attachmentRefs: ['tool_joint'],
          attachments: [{ type: 'joint', ref: 'tool_joint', coef: 1 }],
          actuatorNames: [],
        }],
      },
    },
  };
}

function createWorkspace(): AssemblyState {
  const workspace = createSingleComponentWorkspace(createRobot('left'), {
    workspaceName: 'selection_workspace',
    componentId: 'left',
  });
  workspace.components.right = createSingleComponentWorkspace(createRobot('right'), {
    componentId: 'right',
  }).components.right;
  workspace.bridges.mount = {
    id: 'mount',
    name: 'mount',
    parentComponentId: 'left',
    parentLinkId: 'base_link',
    childComponentId: 'right',
    childLinkId: 'base_link',
    joint: {
      ...DEFAULT_JOINT,
      id: 'mount',
      name: 'mount_joint',
      type: JointType.FIXED,
      parentLinkId: 'base_link',
      childLinkId: 'base_link',
    },
  };
  return workspace;
}

function selection(entity: EntityRef): WorkspaceSelection {
  return { entity };
}

function resetSelectionStore(): void {
  const state = useSelectionStore.getState();
  state.setInteractionGuard(null);
  state.interactionHoverFreezeOwners.forEach((owner) => {
    useSelectionStore.getState().setHoverFrozen(owner, false);
  });
  while (useSelectionStore.getState().hoverBlockCount > 0) {
    useSelectionStore.getState().endHoverBlock();
  }
  state.clearSelection();
  state.clearHover();
  state.clearAttentionSelection();
  state.setFocusTarget(null);
}

test('explicit selection APIs preserve component ownership for identical local IDs', () => {
  resetSelectionStore();
  const leftRef = { type: 'link', componentId: 'left', entityId: 'base_link' } as const;
  const rightRef = { type: 'link', componentId: 'right', entityId: 'base_link' } as const;

  useSelectionStore.getState().selectLink(leftRef, {
    subType: 'visual',
    objectIndex: 0,
  });
  const leftSelection = useSelectionStore.getState().selection;
  assert.deepEqual(leftSelection, {
    entity: leftRef,
    subType: 'visual',
    objectIndex: 0,
  });

  useSelectionStore.getState().selectLink(rightRef);
  const rightSelection = useSelectionStore.getState().selection;
  assert.deepEqual(rightSelection, { entity: rightRef });
  assert.equal(matchesSelection(leftSelection, rightSelection), false);
});

test('selection actions do not mutate workspace ownership state', () => {
  resetSelectionStore();
  const workspace = createWorkspace();
  useWorkspaceStore.getState().replaceWorkspace(workspace, { resetHistory: true });
  useWorkspaceStore.getState().setActiveComponent('left');

  useSelectionStore.getState().selectLink({
    type: 'link', componentId: 'right', entityId: 'base_link',
  });
  assert.equal(useWorkspaceStore.getState().activeComponentId, 'left');

  useSelectionStore.getState().selectBridge('mount');
  useSelectionStore.getState().clearSelection();
  assert.equal(useWorkspaceStore.getState().activeComponentId, 'left');
});

test('assembly, component, bridge, joint, and tendon APIs produce EntityRef selections', () => {
  resetSelectionStore();
  const state = useSelectionStore.getState();

  state.selectAssembly();
  assert.deepEqual(useSelectionStore.getState().selection, selection({ type: 'assembly' }));
  state.selectComponent('left');
  assert.deepEqual(
    useSelectionStore.getState().selection,
    selection({ type: 'component', componentId: 'left' }),
  );
  state.selectBridge('mount');
  assert.deepEqual(
    useSelectionStore.getState().selection,
    selection({ type: 'bridge', bridgeId: 'mount' }),
  );
  state.selectJoint({ type: 'joint', componentId: 'right', entityId: 'tool_joint' });
  assert.deepEqual(
    useSelectionStore.getState().selection,
    selection({ type: 'joint', componentId: 'right', entityId: 'tool_joint' }),
  );
  state.selectTendon({ type: 'tendon', componentId: 'left', entityId: 'shared_tendon' });
  assert.deepEqual(
    useSelectionStore.getState().selection,
    selection({ type: 'tendon', componentId: 'left', entityId: 'shared_tendon' }),
  );
});

test('matchesSelection compares every optional detail unless explicitly ignored', () => {
  const ref = { type: 'link', componentId: 'left', entityId: 'base_link' } as const;
  const first: WorkspaceSelection = {
    entity: ref,
    subType: 'visual',
    objectIndex: 0,
    helperKind: 'center-of-mass',
    highlightObjectId: 10,
  };
  const second: WorkspaceSelection = {
    entity: ref,
    subType: 'collision',
    objectIndex: 1,
    helperKind: 'inertia',
    highlightObjectId: 20,
  };

  assert.equal(matchesSelection(first, second), false);
  assert.equal(matchesSelection(first, second, {
    ignoreSubType: true,
    ignoreObjectIndex: true,
    ignoreHelperKind: true,
    ignoreHighlightObjectId: true,
  }), true);
  assert.equal(matchesSelection(null, null), true);
  assert.equal(matchesSelection(first, null), false);
});

test('interaction guard receives owned selections while null always clears', () => {
  resetSelectionStore();
  let guardCalls = 0;
  useSelectionStore.getState().setInteractionGuard((candidate) => {
    guardCalls += 1;
    return candidate.entity.type === 'component' && candidate.entity.componentId === 'left';
  });

  useSelectionStore.getState().selectComponent('right');
  assert.equal(useSelectionStore.getState().selection, null);
  useSelectionStore.getState().selectComponent('left');
  assert.deepEqual(
    useSelectionStore.getState().selection,
    selection({ type: 'component', componentId: 'left' }),
  );
  useSelectionStore.getState().clearSelection();
  assert.equal(useSelectionStore.getState().selection, null);
  assert.equal(useSelectionStore.getState().isInteractionAllowed(null), true);
  assert.equal(guardCalls, 2);
});

test('hover freeze preserves visible hover and applies the latest deferred intent', () => {
  resetSelectionStore();
  const owner = Symbol('primary-viewer');
  const left = { type: 'link', componentId: 'left', entityId: 'base_link' } as const;
  const right = { type: 'link', componentId: 'right', entityId: 'base_link' } as const;
  const state = useSelectionStore.getState();
  state.hoverLink(left, { subType: 'visual', objectIndex: 0 });
  state.setHoverFrozen(owner, true);

  assert.deepEqual(useSelectionStore.getState().hoveredSelection, {
    entity: left,
    subType: 'visual',
    objectIndex: 0,
  });
  state.hoverLink(right, { subType: 'collision', objectIndex: 1 });
  assert.deepEqual(useSelectionStore.getState().deferredHoveredSelection, {
    entity: right,
    subType: 'collision',
    objectIndex: 1,
  });

  state.setHoverFrozen(owner, false);
  assert.deepEqual(useSelectionStore.getState().hoveredSelection, {
    entity: right,
    subType: 'collision',
    objectIndex: 1,
  });
  assert.equal(useSelectionStore.getState().deferredHoveredSelection, null);
});

test('hover freeze remains held until its owning viewer releases it', () => {
  resetSelectionStore();
  const primaryViewer = Symbol('primary-viewer');
  const snapshotViewer = Symbol('snapshot-viewer');
  const state = useSelectionStore.getState();

  state.setHoverFrozen(primaryViewer, true);
  state.setHoverFrozen(snapshotViewer, false);

  assert.equal(useSelectionStore.getState().interactionHoverFrozen, true);
  assert.equal(useSelectionStore.getState().interactionHoverFreezeOwners.size, 1);

  state.setHoverFrozen(snapshotViewer, true);
  state.setHoverFrozen(snapshotViewer, false);
  assert.equal(useSelectionStore.getState().interactionHoverFrozen, true);
  assert.deepEqual(
    [...useSelectionStore.getState().interactionHoverFreezeOwners],
    [primaryViewer],
  );

  state.setHoverFrozen(primaryViewer, false);
  assert.equal(useSelectionStore.getState().interactionHoverFrozen, false);
  assert.equal(useSelectionStore.getState().interactionHoverFreezeOwners.size, 0);
});

test('hover blocks hide and restore the existing intent while ignoring new hover targets', () => {
  resetSelectionStore();
  const left = selection({ type: 'link', componentId: 'left', entityId: 'base_link' });
  const right = selection({ type: 'link', componentId: 'right', entityId: 'base_link' });
  const state = useSelectionStore.getState();
  state.setHoveredSelection(left);
  state.beginHoverBlock();

  assert.equal(useSelectionStore.getState().hoveredSelection, null);
  assert.deepEqual(useSelectionStore.getState().deferredHoveredSelection, left);
  state.setHoveredSelection(right);
  assert.deepEqual(useSelectionStore.getState().deferredHoveredSelection, left);

  state.endHoverBlock();
  assert.deepEqual(useSelectionStore.getState().hoveredSelection, left);
  assert.equal(useSelectionStore.getState().deferredHoveredSelection, null);
});

test('null clears frozen hover intent and guard-rejected hover targets', () => {
  resetSelectionStore();
  const owner = Symbol('primary-viewer');
  const state = useSelectionStore.getState();
  state.setHoveredSelection(
    selection({ type: 'component', componentId: 'left' }),
  );
  state.setHoverFrozen(owner, true);
  state.clearHover();
  assert.equal(useSelectionStore.getState().deferredHoveredSelection, null);
  state.setHoverFrozen(owner, false);
  assert.equal(useSelectionStore.getState().hoveredSelection, null);

  state.setInteractionGuard((candidate) =>
    candidate.entity.type === 'component' && candidate.entity.componentId === 'left');
  state.hoverComponent('left');
  assert.deepEqual(
    useSelectionStore.getState().hoveredSelection,
    selection({ type: 'component', componentId: 'left' }),
  );
  state.hoverComponent('right');
  assert.equal(useSelectionStore.getState().hoveredSelection, null);
});

test('pulse and focus timers clear canonical targets and explicit null cancels pending work', async () => {
  resetSelectionStore();
  const target = selection({ type: 'joint', componentId: 'left', entityId: 'tool_joint' });
  useSelectionStore.getState().pulseSelection(target, 5);
  assert.deepEqual(useSelectionStore.getState().attentionSelection, target);
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(useSelectionStore.getState().attentionSelection, null);

  const focusRef = { type: 'link', componentId: 'left', entityId: 'base_link' } as const;
  useSelectionStore.getState().focusOn(focusRef, 5);
  assert.deepEqual(useSelectionStore.getState().focusTarget, focusRef);
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(useSelectionStore.getState().focusTarget, null);

  useSelectionStore.getState().focusOn(focusRef, 50);
  useSelectionStore.getState().focusOn(focusRef, 50);
  assert.equal(useSelectionStore.getState().focusTarget, null);
  useSelectionStore.getState().setFocusTarget(null);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(useSelectionStore.getState().focusTarget, null);
});

test('validateEntityRef uses exact component-local keys and keeps duplicate IDs distinct', () => {
  const workspace = createWorkspace();
  assert.equal(validateEntityRef(workspace, {
    type: 'link', componentId: 'left', entityId: 'base_link',
  }), true);
  assert.equal(validateEntityRef(workspace, {
    type: 'link', componentId: 'right', entityId: 'base_link',
  }), true);
  assert.equal(validateEntityRef(workspace, {
    type: 'joint', componentId: 'right', entityId: 'tool_joint',
  }), true);
  assert.equal(validateEntityRef(workspace, {
    type: 'tendon', componentId: 'left', entityId: 'shared_tendon',
  }), true);
  assert.equal(validateEntityRef(workspace, { type: 'bridge', bridgeId: 'mount' }), true);
  assert.equal(validateEntityRef(workspace, {
    type: 'link', componentId: 'left', entityId: 'left display base',
  }), false);
  assert.equal(validateEntityRef(workspace, {
    type: 'link', componentId: 'missing', entityId: 'base_link',
  }), false);
  assert.equal(validateEntityRef(workspace, {
    type: 'link', componentId: 'toString', entityId: 'base_link',
  }), false);
});

test('repairWorkspaceSelection preserves valid refs and repairs stale refs deterministically', () => {
  const workspace = createWorkspace();
  const valid: WorkspaceSelection = {
    entity: { type: 'link', componentId: 'right', entityId: 'base_link' },
    subType: 'visual',
    objectIndex: 0,
  };
  assert.equal(repairWorkspaceSelection(workspace, valid, 'left'), valid);
  assert.equal(repairWorkspaceSelection(workspace, null, 'left'), null);

  assert.deepEqual(
    repairWorkspaceSelection(workspace, selection({
      type: 'joint', componentId: 'right', entityId: 'missing_joint',
    }), 'left'),
    selection({ type: 'component', componentId: 'right' }),
  );
  assert.deepEqual(
    repairWorkspaceSelection(workspace, selection({
      type: 'link', componentId: 'missing', entityId: 'base_link',
    }), 'right'),
    selection({ type: 'component', componentId: 'right' }),
  );
  assert.deepEqual(
    repairWorkspaceSelection(workspace, selection({ type: 'bridge', bridgeId: 'missing' }), null),
    selection({ type: 'component', componentId: 'left' }),
  );
  assert.deepEqual(
    repairWorkspaceSelection(workspace, selection({
      type: 'component', componentId: 'missing',
    }), 'also_missing'),
    selection({ type: 'component', componentId: 'left' }),
  );
});
