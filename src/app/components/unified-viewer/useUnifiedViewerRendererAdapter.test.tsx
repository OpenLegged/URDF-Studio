import assert from 'node:assert/strict';
import test from 'node:test';

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';

import {
  createAssemblyScenePlacement,
  createAssemblySceneProjection,
  type AssemblyScenePlacement,
  type AssemblySceneProjection,
} from '@/core/robot';
import {
  DEFAULT_JOINT,
  DEFAULT_LINK,
  entityRefKey,
  type AssemblyState,
  type AssemblyTransform,
  type JointEntityRef,
  type LinkEntityRef,
  type WorkspaceSelection,
} from '@/types';
import type {
  WorkspaceJointPropertyPatch,
  WorkspaceLinkPropertyPatch,
} from '@/store/workspaceStore';
import {
  useUnifiedViewerRendererAdapter,
  type UnifiedViewerRendererAdapter,
  type UnifiedViewerRendererAdapterInput,
  type UnifiedViewerWorkspaceUpdateHandler,
} from './useUnifiedViewerRendererAdapter';

function installDom() {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'http://localhost/',
    pretendToBeVisual: true,
  });

  (globalThis as { window?: Window }).window = dom.window as unknown as Window;
  (globalThis as { document?: Document }).document = dom.window.document;
  Object.defineProperty(globalThis, 'navigator', {
    value: dom.window.navigator,
    configurable: true,
  });
  (globalThis as { HTMLElement?: typeof HTMLElement }).HTMLElement = dom.window.HTMLElement;
  (globalThis as { Event?: typeof Event }).Event = dom.window.Event;
  (globalThis as { FocusEvent?: typeof FocusEvent }).FocusEvent = dom.window.FocusEvent;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

  return dom;
}

function createComponentRobot(options: { lockedLink?: string } = {}) {
  return {
    name: 'component_bot',
    rootLinkId: 'base_link',
    links: {
      base_link: {
        ...structuredClone(DEFAULT_LINK),
        id: 'base_link',
        name: 'base_link',
        editorLocked: options.lockedLink === 'base_link' ? true : undefined,
      },
      tip_link: {
        ...structuredClone(DEFAULT_LINK),
        id: 'tip_link',
        name: 'tip_link',
        editorLocked: options.lockedLink === 'tip_link' ? true : undefined,
      },
    },
    joints: {
      hip_joint: {
        ...structuredClone(DEFAULT_JOINT),
        id: 'hip_joint',
        name: 'hip_joint',
        parentLinkId: 'base_link',
        childLinkId: 'tip_link',
      },
    },
  };
}

function createWorkspace(options: {
  componentLocked?: boolean;
  lockedLink?: string;
} = {}): AssemblyState {
  return {
    name: 'workspace',
    transform: createTransform(0),
    components: {
      alpha: {
        id: 'alpha',
        name: 'Alpha',
        sourceFile: 'alpha.urdf',
        robot: createComponentRobot({ lockedLink: options.lockedLink }),
        transform: createTransform(1),
        visible: true,
        editorLocked: options.componentLocked ? true : undefined,
      },
      beta: {
        id: 'beta',
        name: 'Beta',
        sourceFile: 'beta.urdf',
        robot: createComponentRobot(),
        transform: createTransform(2),
        visible: true,
      },
    },
    bridges: {
      alpha_beta: {
        id: 'alpha_beta',
        name: 'Alpha beta',
        parentComponentId: 'alpha',
        parentLinkId: 'tip_link',
        childComponentId: 'beta',
        childLinkId: 'base_link',
        joint: {
          ...structuredClone(DEFAULT_JOINT),
          id: 'alpha_beta',
          name: 'alpha_beta',
          parentLinkId: 'tip_link',
          childLinkId: 'base_link',
        },
      },
    },
  };
}

function createTransform(offset: number): AssemblyTransform {
  return {
    position: { x: offset, y: 0, z: 0 },
    rotation: { r: 0, p: 0, y: 0 },
  };
}

function resolveGlobalId(
  projection: AssemblySceneProjection,
  ref: LinkEntityRef | JointEntityRef | { type: 'bridge'; bridgeId: string },
): string {
  const globalId = projection.entityRefKeyToGlobal.get(entityRefKey(ref));
  assert.ok(globalId, 'projection should contain requested entity');
  return globalId;
}

function createInput(overrides: {
  workspace?: AssemblyState;
  sceneProjection?: AssemblySceneProjection;
  scenePlacement?: AssemblyScenePlacement;
  selection?: WorkspaceSelection;
  hoveredSelection?: WorkspaceSelection;
  focusTarget?: UnifiedViewerRendererAdapterInput['focusTarget'];
  workspaceInteractionEnabled?: boolean;
  clearHover?: () => void;
  onSelect?: (selection: WorkspaceSelection) => void;
  onHover?: (selection: WorkspaceSelection) => void;
  onUpdate?: UnifiedViewerWorkspaceUpdateHandler;
  onCollisionTransformPreview?: UnifiedViewerRendererAdapterInput['onCollisionTransformPreview'];
  onCollisionTransform?: UnifiedViewerRendererAdapterInput['onCollisionTransform'];
  onAssemblyTransform?: UnifiedViewerRendererAdapterInput['onAssemblyTransform'];
  onComponentTransform?: UnifiedViewerRendererAdapterInput['onComponentTransform'];
  onBridgeTransform?: UnifiedViewerRendererAdapterInput['onBridgeTransform'];
} = {}): UnifiedViewerRendererAdapterInput {
  const workspace = overrides.workspace ?? createWorkspace();
  const sceneProjection = overrides.sceneProjection ?? createAssemblySceneProjection(workspace);
  const scenePlacement =
    overrides.scenePlacement ?? createAssemblyScenePlacement(workspace, sceneProjection);
  const onUpdate = ((
    _ref: LinkEntityRef | JointEntityRef,
    _data: WorkspaceLinkPropertyPatch | WorkspaceJointPropertyPatch,
  ) => {}) satisfies UnifiedViewerWorkspaceUpdateHandler;

  return {
    workspace,
    sceneProjection,
    scenePlacement,
    selection: overrides.selection ?? null,
    hoveredSelection: overrides.hoveredSelection ?? null,
    focusTarget: overrides.focusTarget,
    workspaceInteractionEnabled: overrides.workspaceInteractionEnabled ?? true,
    clearHover: overrides.clearHover ?? (() => {}),
    onSelect: overrides.onSelect ?? (() => {}),
    onHover: overrides.onHover,
    onUpdate: overrides.onUpdate ?? onUpdate,
    onCollisionTransformPreview: overrides.onCollisionTransformPreview,
    onCollisionTransform: overrides.onCollisionTransform,
    onAssemblyTransform: overrides.onAssemblyTransform,
    onComponentTransform: overrides.onComponentTransform,
    onBridgeTransform: overrides.onBridgeTransform,
  };
}

function renderAdapter(_input: UnifiedViewerRendererAdapterInput) {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');
  const root = createRoot(container);
  let latest: UnifiedViewerRendererAdapter | null = null;

  function Probe({ adapterInput }: { adapterInput: UnifiedViewerRendererAdapterInput }) {
    latest = useUnifiedViewerRendererAdapter(adapterInput);
    return null;
  }

  function getAdapter() {
    assert.ok(latest, 'adapter should be rendered');
    return latest;
  }

  return {
    dom,
    root,
    getAdapter,
    update: (nextInput: UnifiedViewerRendererAdapterInput) =>
      act(async () => {
        root.render(React.createElement(Probe, { adapterInput: nextInput }));
      }),
    unmount: () =>
      act(async () => {
        root.unmount();
      }),
  };
}

test('renderer adapter projects workspace selection and preserves collision object index', async () => {
  const workspace = createWorkspace();
  const sceneProjection = createAssemblySceneProjection(workspace);
  const baseRef: LinkEntityRef = { type: 'link', componentId: 'alpha', entityId: 'base_link' };
  const selected: WorkspaceSelection = { entity: baseRef };
  const hovered: WorkspaceSelection = {
    entity: { type: 'joint', componentId: 'alpha', entityId: 'hip_joint' },
  };
  const selections: WorkspaceSelection[] = [];
  const harness = renderAdapter(createInput({
    workspace,
    sceneProjection,
    selection: selected,
    hoveredSelection: hovered,
    focusTarget: { type: 'component', componentId: 'alpha' },
    onSelect: (selection) => selections.push(selection),
  }));

  await harness.update(createInput({
    workspace,
    sceneProjection,
    selection: selected,
    hoveredSelection: hovered,
    focusTarget: { type: 'component', componentId: 'alpha' },
    onSelect: (selection) => selections.push(selection),
  }));

  const adapter = harness.getAdapter();
  assert.equal(adapter.rendererSelection.type, 'link');
  assert.equal(adapter.rendererHoveredSelection.type, 'joint');
  assert.equal(adapter.rendererFocusTarget, adapter.rendererSelection.id);

  adapter.handleRendererMeshSelect(adapter.rendererSelection.id!, null, 2, 'collision');
  assert.deepEqual(selections[0], {
    entity: baseRef,
    subType: 'collision',
    objectIndex: 2,
  });

  await harness.unmount();
  harness.dom.window.close();
});

test('renderer adapter blocks locked selection, updates, and transforms', async () => {
  const workspace = createWorkspace({ componentLocked: true });
  const sceneProjection = createAssemblySceneProjection(workspace);
  const baseId = resolveGlobalId(sceneProjection, {
    type: 'link',
    componentId: 'alpha',
    entityId: 'base_link',
  });
  let selectCount = 0;
  let updateCount = 0;
  let collisionCount = 0;
  let componentTransformCount = 0;
  const onUpdate = ((
    _ref: LinkEntityRef | JointEntityRef,
    _data: WorkspaceLinkPropertyPatch | WorkspaceJointPropertyPatch,
  ) => {
    updateCount += 1;
  }) satisfies UnifiedViewerWorkspaceUpdateHandler;
  const harness = renderAdapter(createInput({
    workspace,
    sceneProjection,
    onSelect: () => {
      selectCount += 1;
    },
    onUpdate,
    onCollisionTransform: () => {
      collisionCount += 1;
    },
    onComponentTransform: () => {
      componentTransformCount += 1;
    },
  }));

  await harness.update(createInput({
    workspace,
    sceneProjection,
    onSelect: () => {
      selectCount += 1;
    },
    onUpdate,
    onCollisionTransform: () => {
      collisionCount += 1;
    },
    onComponentTransform: () => {
      componentTransformCount += 1;
    },
  }));

  const adapter = harness.getAdapter();
  adapter.handleRendererSelect('link', baseId);
  adapter.handleRendererUpdate('link', baseId, { visible: false });
  adapter.handleRendererCollisionTransform(
    baseId,
    { x: 1, y: 2, z: 3 },
    { r: 0, p: 0, y: 0 },
    1,
  );
  adapter.handleRendererComponentTransform('alpha', createTransform(3));

  assert.equal(selectCount, 0);
  assert.equal(updateCount, 0);
  assert.equal(collisionCount, 0);
  assert.equal(componentTransformCount, 0);

  await harness.unmount();
  harness.dom.window.close();
});

test('renderer adapter routes update patches, transforms, and joint previews', async () => {
  const workspace = createWorkspace();
  const sceneProjection = createAssemblySceneProjection(workspace);
  const baseRef: LinkEntityRef = { type: 'link', componentId: 'alpha', entityId: 'base_link' };
  const jointRef: JointEntityRef = { type: 'joint', componentId: 'alpha', entityId: 'hip_joint' };
  const baseId = resolveGlobalId(sceneProjection, baseRef);
  const jointId = resolveGlobalId(sceneProjection, jointRef);
  const updates: Array<{
    ref: LinkEntityRef | JointEntityRef;
    data: WorkspaceLinkPropertyPatch | WorkspaceJointPropertyPatch;
  }> = [];
  const collisionObjectIndices: Array<number | undefined> = [];
  const componentTransformRefs: string[] = [];
  const bridgeTransformRefs: string[] = [];
  const assemblyTransforms: AssemblyTransform[] = [];
  const onUpdate = ((
    ref: LinkEntityRef | JointEntityRef,
    data: WorkspaceLinkPropertyPatch | WorkspaceJointPropertyPatch,
  ) => {
    updates.push({ ref, data });
  }) satisfies UnifiedViewerWorkspaceUpdateHandler;
  const harness = renderAdapter(createInput({
    workspace,
    sceneProjection,
    onUpdate,
    onCollisionTransformPreview: (_ref, _position, _rotation, objectIndex) => {
      collisionObjectIndices.push(objectIndex);
    },
    onAssemblyTransform: (_ref, transform) => {
      assemblyTransforms.push(transform);
    },
    onComponentTransform: (ref) => {
      componentTransformRefs.push(ref.componentId);
    },
    onBridgeTransform: (ref) => {
      bridgeTransformRefs.push(ref.bridgeId);
    },
  }));

  await harness.update(createInput({
    workspace,
    sceneProjection,
    onUpdate,
    onCollisionTransformPreview: (_ref, _position, _rotation, objectIndex) => {
      collisionObjectIndices.push(objectIndex);
    },
    onAssemblyTransform: (_ref, transform) => {
      assemblyTransforms.push(transform);
    },
    onComponentTransform: (ref) => {
      componentTransformRefs.push(ref.componentId);
    },
    onBridgeTransform: (ref) => {
      bridgeTransformRefs.push(ref.bridgeId);
    },
  }));

  const adapter = harness.getAdapter();
  adapter.handleRendererUpdate('link', baseId, { visible: false });
  adapter.handleRendererUpdate('joint', jointId, { limit: { lower: -0.5 } });
  adapter.handleRendererUpdate('joint', jointId, 'not-a-patch');
  adapter.handleRendererCollisionTransformPreview(
    baseId,
    { x: 0, y: 0, z: 0 },
    { r: 0, p: 0, y: 0 },
    4,
  );
  adapter.handleRendererAssemblyTransform(createTransform(4));
  adapter.handleRendererComponentTransform('alpha', createTransform(5));
  adapter.handleRendererBridgeTransform('alpha_beta', {
    xyz: { x: 1, y: 0, z: 0 },
    rpy: { r: 0, p: 0, y: 0 },
  });
  const projectedPreview = adapter.projectJointInteractionPreview({
    activeJointId: jointId,
    jointAngles: { [jointId]: 0.25 },
    jointQuaternions: {},
    jointOrigins: {},
  });

  assert.deepEqual(updates, [
    { ref: baseRef, data: { visible: false } },
    { ref: jointRef, data: { limit: { lower: -0.5 } } },
  ]);
  assert.deepEqual(collisionObjectIndices, [4]);
  assert.equal(assemblyTransforms.length, 1);
  assert.deepEqual(componentTransformRefs, ['alpha']);
  assert.deepEqual(bridgeTransformRefs, ['alpha_beta']);
  assert.equal(projectedPreview.alpha?.activeJointId, 'hip_joint');
  assert.equal(projectedPreview.alpha?.jointAngles.hip_joint, 0.25);
  assert.equal(typeof adapter.commitProjectedJointMotion, 'function');

  await harness.unmount();
  harness.dom.window.close();
});

test('renderer adapter clears hover on lifecycle boundaries', async () => {
  let clearCount = 0;
  const harness = renderAdapter(createInput({
    clearHover: () => {
      clearCount += 1;
    },
  }));

  await harness.update(createInput({
    clearHover: () => {
      clearCount += 1;
    },
  }));
  assert.equal(clearCount, 0);

  harness.dom.window.dispatchEvent(new FocusEvent('blur'));
  assert.equal(clearCount, 1);

  Object.defineProperty(harness.dom.window.document, 'visibilityState', {
    value: 'hidden',
    configurable: true,
  });
  harness.dom.window.document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(clearCount, 2);

  await harness.unmount();
  assert.equal(clearCount, 3);
  harness.dom.window.close();

  let disabledClearCount = 0;
  const disabledHarness = renderAdapter(createInput({
    workspaceInteractionEnabled: false,
    clearHover: () => {
      disabledClearCount += 1;
    },
  }));
  await disabledHarness.update(createInput({
    workspaceInteractionEnabled: false,
    clearHover: () => {
      disabledClearCount += 1;
    },
  }));
  assert.equal(disabledClearCount, 1);
  await disabledHarness.unmount();
  disabledHarness.dom.window.close();
});
