import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';

import { DEFAULT_LINK, type AssemblyState, type RobotData } from '@/types';
import {
  createAssemblyScenePlacement,
  createAssemblySceneProjection,
  type AssemblyScenePlacement,
} from '@/core/robot';
import {
  useAppLayoutSnapshotWorkflow,
  type AppLayoutSnapshotWorkflow,
} from './useAppLayoutSnapshotWorkflow.ts';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost',
});
globalThis.window = dom.window as unknown as Window & typeof globalThis;
globalThis.document = dom.window.document;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function robot(): RobotData {
  return {
    name: 'snapshot-arm',
    rootLinkId: 'base',
    links: { base: { ...structuredClone(DEFAULT_LINK), id: 'base', name: 'base' } },
    joints: {},
  };
}

function placedWorkspace(componentCount: number): AssemblyState {
  const sourceRobot = robot();
  sourceRobot.links.base!.visible = false;
  sourceRobot.links.base!.visual.visible = false;
  return {
    name: 'snapshot-workspace',
    transform: {
      position: { x: 20, y: 3, z: 1 },
      rotation: { r: 0.1, p: 0.2, y: 0.3 },
    },
    components: Object.fromEntries(
      Array.from({ length: componentCount }, (_, index) => {
        const id = `arm_${index}`;
        return [id, {
          id,
          name: id,
          sourceFile: `${id}.urdf`,
          robot: structuredClone(sourceRobot),
          transform: {
            position: { x: index + 2, y: -4, z: 0.8 },
            rotation: { r: -0.2, p: 0.4, y: -0.6 },
          },
          visible: true,
        }];
      }),
    ),
    bridges: {},
  };
}

test('snapshot workflow owns dialog session open and close state', async () => {
  const workspace = placedWorkspace(1);
  const placement = createAssemblyScenePlacement(workspace, createAssemblySceneProjection(workspace));
  const container = document.createElement('div');
  const root = createRoot(container);
  const rendered: { workflow: AppLayoutSnapshotWorkflow | null } = { workflow: null };
  const getWorkflow = () => {
    assert.ok(rendered.workflow);
    return rendered.workflow;
  };

  function Probe() {
    rendered.workflow = useAppLayoutSnapshotWorkflow({
      availableFiles: [
        {
          name: 'snapshot-arm.urdf',
          format: 'urdf',
          content: '<robot name="snapshot-arm" />',
        },
      ],
      groundPlaneOffset: 0,
      jointAngleState: {},
      jointMotionState: {},
      selectedFileFormat: 'urdf',
      theme: 'light',
      urdfContentForViewer: '<robot name="snapshot-arm" />',
      viewerAssets: {},
      viewerDocumentReady: true,
      viewerReloadKey: 1,
      viewerScenePlacement: placement,
      viewerShowVisual: true,
      viewerSourceFile: null,
      viewerSourceFilePath: 'snapshot-arm.urdf',
      viewerSourceFormat: 'urdf',
      showToast: () => undefined,
      snapshotFailedMessage: 'Snapshot failed',
    });
    return null;
  }

  await act(async () => root.render(<Probe />));
  assert.equal(getWorkflow().isDialogOpen, false);
  assert.equal(getWorkflow().previewSession, null);

  await act(async () => getWorkflow().handleSnapshot());
  assert.equal(getWorkflow().isDialogOpen, true);
  assert.equal(getWorkflow().previewSession?.robotName, 'snapshot-arm');

  await act(async () => getWorkflow().handleCloseSnapshotDialog());
  assert.equal(getWorkflow().isDialogOpen, false);
  assert.equal(getWorkflow().previewSession, null);

  await act(async () => root.unmount());
});

for (const componentCount of [1, 2]) {
  test(`snapshot workflow freezes placement and visible robot for ${componentCount} components`, async () => {
    const workspace = placedWorkspace(componentCount);
    const sourceSnapshot = structuredClone(workspace);
    const placement = createAssemblyScenePlacement(
      workspace,
      createAssemblySceneProjection(workspace),
    );
    const container = document.createElement('div');
    const root = createRoot(container);
    const rendered: { workflow: AppLayoutSnapshotWorkflow | null } = { workflow: null };
    const getWorkflow = () => {
      assert.ok(rendered.workflow);
      return rendered.workflow;
    };

    function Probe({ scenePlacement }: { scenePlacement: AssemblyScenePlacement }) {
      const params = {
        availableFiles: [],
        groundPlaneOffset: 0,
        selectedFileFormat: 'urdf' as const,
        theme: 'light' as const,
        urdfContentForViewer: '<robot name="snapshot-arm" />',
        viewerAssets: {},
        viewerDocumentReady: true,
        viewerReloadKey: 1,
        viewerScenePlacement: scenePlacement,
        viewerShowVisual: true,
        viewerSourceFile: null,
        viewerSourceFilePath: 'snapshot-arm.urdf',
        viewerSourceFormat: 'urdf' as const,
        showToast: () => undefined,
        snapshotFailedMessage: 'Snapshot failed',
      };
      rendered.workflow = useAppLayoutSnapshotWorkflow(params);
      return null;
    }

    try {
      await act(async () => root.render(<Probe scenePlacement={placement} />));
      await act(async () => getWorkflow().handleSnapshot());
      const session = getWorkflow().previewSession;
      assert.ok(session);
      assert.ok(session.scenePlacement, 'preview must preserve the scene placement');
      assert.equal(session.scenePlacement.robotData, session.robot);
      assert.notEqual(session.robot, placement.robotData);
      assert.deepEqual(session.scenePlacement.assemblyTransform, workspace.transform);
      assert.deepEqual(session.scenePlacement.directComponentTransform,
        componentCount === 1 ? workspace.components.arm_0!.transform : null);
      assert.equal(session.scenePlacement.renderStrategy,
        componentCount === 1 ? 'direct-component' : 'assembled-scene');
      assert.deepEqual(session.robot.joints, placement.robotData.joints);
      assert.deepEqual(session.scenePlacement.componentTransformTargets,
        placement.componentTransformTargets);
      assert.ok(Object.values(session.robot.links).every((link) =>
        link.visible === true && link.visual.visible === true));
      assert.deepEqual(workspace, sourceSnapshot);

      const movedWorkspace = structuredClone(workspace);
      movedWorkspace.transform.position.x = 50;
      movedWorkspace.components.arm_0!.transform.position.z = 5;
      const movedPlacement = createAssemblyScenePlacement(
        movedWorkspace,
        createAssemblySceneProjection(movedWorkspace),
      );
      await act(async () => root.render(<Probe scenePlacement={movedPlacement} />));
      assert.equal(getWorkflow().previewSession, session);
      assert.deepEqual(session.scenePlacement.assemblyTransform, sourceSnapshot.transform);
      assert.deepEqual(session.scenePlacement.robotData.joints, placement.robotData.joints);

      await act(async () => getWorkflow().handleCloseSnapshotDialog());
      await act(async () => getWorkflow().handleSnapshot());
      const reopenedSession = getWorkflow().previewSession;
      assert.ok(reopenedSession);
      assert.notEqual(reopenedSession, session);
      assert.deepEqual(reopenedSession.scenePlacement.assemblyTransform, movedWorkspace.transform);
      assert.deepEqual(reopenedSession.scenePlacement.directComponentTransform,
        componentCount === 1 ? movedWorkspace.components.arm_0!.transform : null);
      assert.deepEqual(reopenedSession.robot.joints, movedPlacement.robotData.joints);
    } finally {
      await act(async () => root.unmount());
    }
  });
}
