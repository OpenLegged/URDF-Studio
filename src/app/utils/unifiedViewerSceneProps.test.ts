import test from 'node:test';
import assert from 'node:assert/strict';

import type { ViewerController, ViewerProps } from '@/features/editor';
import type { ViewerResourceScope } from '@/features/editor';
import { DEFAULT_JOINT, DEFAULT_LINK, type AssemblyState, type RobotState } from '@/types';
import { createAssemblyScenePlacement, createAssemblySceneProjection } from '@/core/robot';
import {
  buildUnifiedViewerSceneProps,
  EMPTY_VIEWER_SELECTION,
  type UnifiedViewerSceneWorkspaceInput,
  type UnifiedViewerSceneDocumentInput,
  type UnifiedViewerSceneInteractionInput,
} from './unifiedViewerSceneProps';

function createControllerStub(overrides: Partial<ViewerController> = {}): ViewerController {
  return {
    groundPlaneOffset: 2,
    toolMode: 'measure',
    handleHoverWrapper: () => {},
    ...overrides,
  } as ViewerController;
}

function createRobotStub(): RobotState {
  return {
    name: 'go2',
    rootLinkId: 'base_link',
    links: {
      base_link: { ...structuredClone(DEFAULT_LINK), id: 'base_link', name: 'base_link' },
      tip_link: { ...structuredClone(DEFAULT_LINK), id: 'tip_link', name: 'tip_link' },
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
    selection: { type: null, id: null },
  };
}

function createScopeStub(): ViewerResourceScope {
  return {
    assets: { 'robots/go2/meshes/base.dae': 'blob:base' },
    availableFiles: [],
    signature: 'viewer-scope',
  };
}

function createAssemblyStateStub(): AssemblyState {
  const { selection: _selection, ...robot } = createRobotStub();
  return {
    name: 'workspace',
    transform: {
      position: { x: 0, y: 0, z: 0 },
      rotation: { r: 0, p: 0, y: 0 },
    },
    components: {
      comp_alpha: {
        id: 'comp_alpha',
        name: 'Alpha',
        sourceFile: 'alpha.urdf',
        robot,
        transform: {
          position: { x: 0, y: 0, z: 0 },
          rotation: { r: 0, p: 0, y: 0 },
        },
        visible: true,
      },
    },
    bridges: {},
  };
}

function createWorkspaceInput(): UnifiedViewerSceneWorkspaceInput {
  const workspace = createAssemblyStateStub();
  const sceneProjection = createAssemblySceneProjection(workspace);
  return {
    workspace,
    sceneProjection,
    scenePlacement: createAssemblyScenePlacement(workspace, sceneProjection),
    workspaceSelection: null,
  };
}

function createSceneArgs({
  controller = createControllerStub(),
  document,
  interaction,
  workspace,
}: {
  controller?: ViewerController;
  document?: Partial<UnifiedViewerSceneDocumentInput>;
  interaction?: Partial<UnifiedViewerSceneInteractionInput>;
  workspace?: Partial<UnifiedViewerSceneWorkspaceInput>;
} = {}): Parameters<typeof buildUnifiedViewerSceneProps>[0] {
  return {
    controller,
    document: {
      viewerResourceScope: createScopeStub(),
      effectiveSourceFile: null,
      effectiveUrdfContent: '<robot name="go2" />',
      ...document,
    },
    interaction: {
      active: true,
      hasActivePreview: false,
      mode: 'editor',
      robot: createRobotStub(),
      ...interaction,
    },
    workspace: {
      ...createWorkspaceInput(),
      ...workspace,
    },
  };
}

test('buildUnifiedViewerSceneProps preserves live interaction wiring without preview', () => {
  const controller = createControllerStub();
  const selection: NonNullable<ViewerProps['selection']> = { type: 'link', id: 'base_link' };
  const hoveredSelection: NonNullable<ViewerProps['hoveredSelection']> = {
    type: 'joint',
    id: 'hip_joint',
  };
  const onHover = () => {};
  const onMeshSelect = () => {};
  const onUpdate = () => {};
  const onAssemblyTransform = () => {};
  const onComponentTransform = () => {};
  const onBridgeTransform = () => {};
  const onAssemblyComponentAutoGroundResolved = () => {};

  const sceneProps = buildUnifiedViewerSceneProps(createSceneArgs({
    controller,
    interaction: {
      hoveredSelection,
      selection,
      onHover,
      onMeshSelect,
      onUpdate,
      focusTarget: 'base_link',
      isMeshPreview: true,
      viewerReloadKey: 9,
    },
    workspace: {
      workspaceSelection: { entity: { type: 'component', componentId: 'comp_alpha' } },
      onAssemblyTransform,
      onComponentTransform,
      onBridgeTransform,
      pendingAutoGroundComponentIds: ['comp_alpha'],
      onAssemblyComponentAutoGroundResolved,
    },
  }));

  assert.equal(sceneProps.mode, 'editor');
  assert.equal(sceneProps.selection, selection);
  assert.equal(sceneProps.hoveredSelection, hoveredSelection);
  assert.equal(sceneProps.interactionEnabled, true);
  assert.equal(sceneProps.hoverSelectionEnabled, true);
  assert.equal(sceneProps.onHover, controller.handleHoverWrapper);
  assert.equal(sceneProps.onMeshSelect, onMeshSelect);
  assert.equal(sceneProps.onUpdate, onUpdate);
  assert.equal(sceneProps.allowUrdfXmlFallback, false);
  assert.equal(sceneProps.robotLinks?.base_link !== undefined, true);
  assert.equal(sceneProps.robotJoints?.hip_joint !== undefined, true);
  assert.equal(sceneProps.focusTarget, 'base_link');
  assert.equal(sceneProps.isMeshPreview, true);
  assert.equal(sceneProps.runtimeInstanceKey, 9);
  assert.equal(sceneProps.workspaceSelection?.entity.type, 'component');
  assert.equal(sceneProps.onAssemblyTransform, onAssemblyTransform);
  assert.equal(sceneProps.onComponentTransform, onComponentTransform);
  assert.equal(sceneProps.onBridgeTransform, onBridgeTransform);
  assert.deepEqual(sceneProps.pendingAutoGroundComponentIds, ['comp_alpha']);
  assert.equal(
    sceneProps.onAssemblyComponentAutoGroundResolved,
    onAssemblyComponentAutoGroundResolved,
  );
});

test('buildUnifiedViewerSceneProps forwards snapshot display overrides without changing interaction rules', () => {
  const controller = createControllerStub({
    showCollision: true,
    showCollisionAlwaysOnTop: true,
  } as Partial<ViewerController>);

  const sceneProps = buildUnifiedViewerSceneProps(createSceneArgs({
    controller,
    interaction: {
      active: false,
      showCollision: false,
      showCollisionAlwaysOnTop: false,
    },
  }));

  assert.equal(sceneProps.showCollision, false);
  assert.equal(sceneProps.showCollisionAlwaysOnTop, false);
  assert.equal(sceneProps.interactionEnabled, false);
  assert.equal(sceneProps.hoverSelectionEnabled, false);
  assert.equal(sceneProps.robotLinks?.base_link !== undefined, true);
});

test('buildUnifiedViewerSceneProps does not forward legacy robot data callbacks', () => {
  const controller = createControllerStub();
  const onRobotDataResolved = () => {};

  const args = {
    ...createSceneArgs({
      controller,
      interaction: {
        hoveredSelection: undefined,
      },
    }),
    onRobotDataResolved,
  } as Parameters<typeof buildUnifiedViewerSceneProps>[0] & {
    onRobotDataResolved: () => void;
  };

  const sceneProps = buildUnifiedViewerSceneProps(args);

  assert.equal('onRobotDataResolved' in sceneProps, false);
});

test('buildUnifiedViewerSceneProps clamps preview sessions to a read-only editor scene', () => {
  const controller = createControllerStub();
  const onHover = () => {};
  const onMeshSelect = () => {};
  const onUpdate = () => {};
  const onCollisionTransformPreview = () => {};
  const onCollisionTransform = () => {};
  const onAssemblyTransform = () => {};

  const sceneProps = buildUnifiedViewerSceneProps(createSceneArgs({
    controller,
    interaction: {
      hasActivePreview: true,
      hoveredSelection: { type: 'link', id: 'base_link' },
      selection: { type: 'joint', id: 'hip_joint' },
      onHover,
      onMeshSelect,
      onUpdate,
      focusTarget: 'base_link',
      onCollisionTransformPreview,
      onCollisionTransform,
      isMeshPreview: true,
      viewerReloadKey: 3,
    },
    workspace: {
      workspaceSelection: { entity: { type: 'assembly' } },
      onAssemblyTransform,
    },
  }));

  assert.equal(sceneProps.mode, 'editor');
  assert.deepEqual(sceneProps.selection, EMPTY_VIEWER_SELECTION);
  assert.equal(sceneProps.hoveredSelection, undefined);
  assert.equal(sceneProps.interactionEnabled, false);
  assert.equal(sceneProps.hoverSelectionEnabled, false);
  assert.equal(sceneProps.onHover, undefined);
  assert.equal(sceneProps.onMeshSelect, undefined);
  assert.equal(sceneProps.onUpdate, undefined);
  assert.equal(sceneProps.allowUrdfXmlFallback, true);
  assert.equal(sceneProps.robotLinks, undefined);
  assert.equal(sceneProps.robotJoints, undefined);
  assert.equal(sceneProps.focusTarget, 'base_link');
  assert.equal(sceneProps.onCollisionTransformPreview, undefined);
  assert.equal(sceneProps.onCollisionTransform, undefined);
  assert.equal(sceneProps.isMeshPreview, false);
  assert.equal(sceneProps.runtimeInstanceKey, 3);
  assert.equal(sceneProps.workspaceSelection, null);
  assert.equal(sceneProps.workspace, null);
  assert.equal(sceneProps.sceneProjection, null);
  assert.equal(sceneProps.scenePlacement, null);
  assert.equal(sceneProps.onAssemblyTransform, undefined);
});

test('buildUnifiedViewerSceneProps disables hover interaction for inactive retained scenes without dropping selection', () => {
  const controller = createControllerStub();
  const selection: NonNullable<ViewerProps['selection']> = { type: 'link', id: 'base_link' };
  const hoveredSelection: NonNullable<ViewerProps['hoveredSelection']> = {
    type: 'joint',
    id: 'hip_joint',
  };
  const onHover = () => {};
  const onMeshSelect = () => {};

  const sceneProps = buildUnifiedViewerSceneProps(createSceneArgs({
    controller,
    interaction: {
      active: false,
      hoveredSelection,
      selection,
      onHover,
      onMeshSelect,
    },
  }));

  assert.equal(sceneProps.selection, selection);
  assert.equal(sceneProps.hoveredSelection, hoveredSelection);
  assert.equal(sceneProps.interactionEnabled, false);
  assert.equal(sceneProps.hoverSelectionEnabled, false);
  assert.equal(sceneProps.onHover, undefined);
  assert.equal(sceneProps.onMeshSelect, undefined);
  assert.equal(sceneProps.allowUrdfXmlFallback, false);
  assert.equal(sceneProps.robotLinks?.base_link !== undefined, true);
});

test('buildUnifiedViewerSceneProps disables model interaction for standalone read-only previews without dropping render data', () => {
  const controller = createControllerStub();
  const onHover = () => {};
  const onMeshSelect = () => {};
  const onUpdate = () => {};

  const sceneProps = buildUnifiedViewerSceneProps(createSceneArgs({
    controller,
    document: {
      effectiveSourceFile: {
        name: 'meshes/gripper.stl',
        content: '',
        format: 'mesh',
      },
      effectiveUrdfContent: '<robot name="mesh-preview" />',
    },
    interaction: {
      modelInteractionEnabled: false,
      hoveredSelection: { type: 'joint', id: 'hip_joint' },
      selection: { type: 'link', id: 'base_link' },
      onHover,
      onMeshSelect,
      onUpdate,
      focusTarget: 'base_link',
      isMeshPreview: true,
    },
  }));

  assert.deepEqual(sceneProps.selection, EMPTY_VIEWER_SELECTION);
  assert.equal(sceneProps.hoveredSelection, undefined);
  assert.equal(sceneProps.interactionEnabled, false);
  assert.equal(sceneProps.hoverSelectionEnabled, false);
  assert.equal(sceneProps.onHover, undefined);
  assert.equal(sceneProps.onMeshSelect, undefined);
  assert.equal(sceneProps.onUpdate, undefined);
  assert.equal(sceneProps.robotLinks?.base_link !== undefined, true);
  assert.equal(sceneProps.robotJoints?.hip_joint !== undefined, true);
  assert.equal(sceneProps.focusTarget, 'base_link');
  assert.equal(sceneProps.isMeshPreview, true);
});
