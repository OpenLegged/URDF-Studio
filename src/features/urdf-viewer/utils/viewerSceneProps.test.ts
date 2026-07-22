import test from 'node:test';
import assert from 'node:assert/strict';

import type { ViewerController } from '../hooks/useViewerController';
import { buildViewerSceneProps } from './viewerSceneProps';
import type { AssemblyState } from '@/types';
import { createAssemblyScenePlacement, createAssemblySceneProjection } from '@/core/robot';

function createControllerStub(overrides: Partial<ViewerController> = {}): ViewerController {
  return {
    groundPlaneOffset: 1.25,
    toolMode: 'measure',
    handleHoverWrapper: () => {},
    ...overrides,
  } as ViewerController;
}

function createAssemblyStateStub(): AssemblyState {
  return {
    name: 'workspace',
    transform: {
      position: { x: 0, y: 0, z: 0 },
      rotation: { r: 0, p: 0, y: 0 },
    },
    components: {},
    bridges: {},
  };
}

test('buildViewerSceneProps uses controller-owned defaults for viewer scene wiring', () => {
  const controller = createControllerStub();

  const sceneProps = buildViewerSceneProps({
    controller,
    availableFiles: [],
    urdfContent: '<robot name="go2" />',
    assets: {},
    mode: 'editor',
  });

  assert.equal(sceneProps.controller, controller);
  assert.equal(sceneProps.groundPlaneOffset, 1.25);
  assert.equal(sceneProps.toolMode, 'measure');
  assert.equal(sceneProps.active, true);
  assert.equal(sceneProps.interactionEnabled, true);
  assert.equal(sceneProps.hoverSelectionEnabled, true);
  assert.equal(sceneProps.onHover, controller.handleHoverWrapper);
  assert.equal(sceneProps.allowUrdfXmlFallback, false);
  assert.equal(sceneProps.isMeshPreview, false);
  assert.equal(sceneProps.runtimeInstanceKey, 0);
});

test('buildViewerSceneProps preserves explicit overrides for preview and handoff flows', () => {
  const controller = createControllerStub({
    groundPlaneOffset: 0.5,
    toolMode: 'select',
  });
  const onHover = () => {};
  const onMeshSelect = () => {};
  const onAssemblyTransform = () => {};
  const onComponentTransform = () => {};
  const onBridgeTransform = () => {};
  const onAssemblyComponentAutoGroundResolved = () => {};
  const workspace = createAssemblyStateStub();
  const sceneProjection = createAssemblySceneProjection(workspace);

  const sceneProps = buildViewerSceneProps({
    controller,
    active: false,
    sourceFile: {
      name: 'robots/go2/urdf/go2.urdf',
      content: '<robot name="go2" />',
      format: 'urdf',
    },
    availableFiles: [],
    urdfContent: '<robot name="go2" />',
    assets: { 'robots/go2/meshes/base.dae': 'blob:base' },
    sourceFilePath: 'robots/go2/urdf/go2.urdf',
    groundPlaneOffset: 3.5,
    mode: 'editor',
    allowUrdfXmlFallback: false,
    hoveredSelection: { type: 'link', id: 'base_link' },
    hoverSelectionEnabled: false,
    onHover,
    onMeshSelect,
    workspace,
    sceneProjection,
    scenePlacement: createAssemblyScenePlacement(workspace, sceneProjection),
    workspaceSelection: { entity: { type: 'component', componentId: 'comp_alpha' } },
    onAssemblyTransform,
    onComponentTransform,
    onBridgeTransform,
    pendingAutoGroundComponentIds: ['comp_alpha'],
    onAssemblyComponentAutoGroundResolved,
    isMeshPreview: true,
    runtimeInstanceKey: 7,
  });

  assert.equal(sceneProps.active, false);
  assert.equal(sceneProps.mode, 'editor');
  assert.equal(sceneProps.groundPlaneOffset, 3.5);
  assert.equal(sceneProps.toolMode, 'select');
  assert.equal(sceneProps.interactionEnabled, true);
  assert.equal(sceneProps.hoverSelectionEnabled, false);
  assert.equal(sceneProps.onHover, undefined);
  assert.equal(sceneProps.allowUrdfXmlFallback, false);
  assert.equal(sceneProps.onMeshSelect, onMeshSelect);
  assert.equal(sceneProps.workspaceSelection?.entity.type, 'component');
  assert.equal(sceneProps.onAssemblyTransform, onAssemblyTransform);
  assert.equal(sceneProps.onComponentTransform, onComponentTransform);
  assert.equal(sceneProps.onBridgeTransform, onBridgeTransform);
  assert.deepEqual(sceneProps.pendingAutoGroundComponentIds, ['comp_alpha']);
  assert.equal(
    sceneProps.onAssemblyComponentAutoGroundResolved,
    onAssemblyComponentAutoGroundResolved,
  );
  assert.equal(sceneProps.isMeshPreview, true);
  assert.equal(sceneProps.runtimeInstanceKey, 7);
});
