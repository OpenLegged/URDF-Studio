import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { JSDOM } from 'jsdom';

import { createSingleComponentWorkspace } from '@/core/robot';
import { DEFAULT_JOINT, DEFAULT_LINK, JointType, type AssemblyState } from '@/types';
import {
  useWorkspaceViewerDerivations,
  type WorkspaceViewerDerivations,
} from './useWorkspaceViewerDerivations.ts';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost',
});
globalThis.window = dom.window as unknown as Window & typeof globalThis;
globalThis.document = dom.window.document;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function createWorkspace(): AssemblyState {
  return createSingleComponentWorkspace(
    {
      name: 'arm',
      rootLinkId: 'base',
      links: {
        base: { ...structuredClone(DEFAULT_LINK), id: 'base', name: 'base' },
        tip: { ...structuredClone(DEFAULT_LINK), id: 'tip', name: 'tip' },
      },
      joints: {
        hinge: {
          ...structuredClone(DEFAULT_JOINT),
          id: 'hinge',
          name: 'hinge',
          type: JointType.REVOLUTE,
          parentLinkId: 'base',
          childLinkId: 'tip',
        },
      },
    },
    {
      componentId: 'arm-component',
      sourceFile: 'arm.urdf',
    },
  );
}

interface RenderedHook {
  getResult: () => WorkspaceViewerDerivations;
  render: (workspace: AssemblyState, semanticWorkspace: AssemblyState) => Promise<void>;
  cleanup: () => Promise<void>;
}

function renderHook(): RenderedHook {
  const container = document.createElement('div');
  const root: Root = createRoot(container);
  let result: WorkspaceViewerDerivations | null = null;

  function Probe({
    workspace,
    semanticWorkspace,
  }: {
    workspace: AssemblyState;
    semanticWorkspace: AssemblyState;
  }) {
    result = useWorkspaceViewerDerivations({
      workspace,
      semanticWorkspace,
      bridgePreview: null,
      activeComponentId: 'arm-component',
      availableFiles: [{ name: 'arm.urdf', format: 'urdf', content: '<robot name="arm" />' }],
      componentSourceDrafts: {},
      allFileContents: {},
    });
    return null;
  }

  return {
    getResult: () => {
      assert.ok(result);
      return result;
    },
    render: async (workspace, semanticWorkspace) => {
      await act(async () => root.render(<Probe {...{ workspace, semanticWorkspace }} />));
    },
    cleanup: async () => {
      await act(async () => root.unmount());
    },
  };
}

test('semantic scene projection remains stable while live joint motion updates', async () => {
  const semanticWorkspace = createWorkspace();
  const rendered = renderHook();
  await rendered.render(semanticWorkspace, semanticWorkspace);

  const initial = rendered.getResult();
  const liveWorkspace = structuredClone(semanticWorkspace);
  liveWorkspace.components['arm-component'].robot.joints.hinge!.angle = 0.4;
  await rendered.render(liveWorkspace, semanticWorkspace);

  const updated = rendered.getResult();
  const projectedJointId = updated.sceneProjection.entityRefKeyToGlobal.get(
    JSON.stringify(['joint', 'arm-component', 'hinge']),
  );
  assert.equal(updated.sceneProjection, initial.sceneProjection);
  assert.equal(updated.scenePlacement, initial.scenePlacement);
  assert.ok(projectedJointId);
  assert.equal(updated.jointAngleState[projectedJointId], 0.4);

  await rendered.cleanup();
});
