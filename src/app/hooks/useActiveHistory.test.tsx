import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';

import {
  createComponentSourceDraft,
  createSingleComponentWorkspace,
} from '@/core/robot';
import { parseURDF } from '@/core/parsers';
import { useAssetsStore } from '@/store/assetsStore';
import { useWorkspaceStore } from '@/store/workspaceStore';
import { DEFAULT_LINK, type RobotData } from '@/types';
import { generateEditableRobotSource } from '@/app/utils/generateEditableRobotSource';

import { useActiveHistory } from './useActiveHistory';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.DOMParser = dom.window.DOMParser as typeof DOMParser;
globalThis.XMLSerializer = dom.window.XMLSerializer as typeof XMLSerializer;

function createRobot(name: string): RobotData {
  return {
    name,
    rootLinkId: 'base',
    links: {
      base: { ...structuredClone(DEFAULT_LINK), id: 'base', name: 'base' },
    },
    joints: {},
  };
}

function renderHistory(): ReturnType<typeof useActiveHistory> {
  let hookValue: ReturnType<typeof useActiveHistory> | null = null;

  function Probe() {
    hookValue = useActiveHistory();
    return null;
  }

  renderToStaticMarkup(React.createElement(Probe));
  assert.ok(hookValue);
  return hookValue;
}

beforeEach(() => {
  const workspace = createSingleComponentWorkspace(createRobot('before'), {
    componentId: 'component',
    sourceFile: 'robot.urdf',
  });
  useWorkspaceStore.getState().replaceWorkspace(workspace, { resetHistory: true });
  useWorkspaceStore.setState({
    history: { past: [], future: [], activity: [] },
    revision: 0,
    jointMotionRevision: 0,
  });
  useAssetsStore.setState({ componentSourceDrafts: {} });
});

test('undo removes component source drafts whose hash matches the redone robot', () => {
  const beforeRobot = useWorkspaceStore.getState().workspace.components.component!.robot;
  const afterRobot = createRobot('after');
  useWorkspaceStore.getState().replaceComponentRobot('component', afterRobot, {
    label: 'Edit robot source',
  });
  useAssetsStore.getState().setComponentSourceDraft(createComponentSourceDraft({
    componentId: 'component',
    format: 'mjcf',
    content: '<mujoco model="after"><worldbody /></mujoco>',
    robot: afterRobot,
  }));

  renderHistory().undo();

  const state = useWorkspaceStore.getState();
  assert.equal(state.workspace.components.component!.robot.name, beforeRobot.name);
  assert.equal(useAssetsStore.getState().componentSourceDrafts.component, undefined);
  assert.equal(state.history.future.length, 1);
});

test('redo removes component source drafts whose hash matches the undone robot', () => {
  const beforeRobot = useWorkspaceStore.getState().workspace.components.component!.robot;
  const afterRobot = createRobot('after');
  useWorkspaceStore.getState().replaceComponentRobot('component', afterRobot, {
    label: 'Edit robot source',
  });
  const history = renderHistory();
  history.undo();
  useAssetsStore.getState().setComponentSourceDraft(createComponentSourceDraft({
    componentId: 'component',
    format: 'mjcf',
    content: '<mujoco model="before"><worldbody /></mujoco>',
    robot: beforeRobot,
  }));

  history.redo();

  const state = useWorkspaceStore.getState();
  assert.equal(state.workspace.components.component!.robot.name, afterRobot.name);
  assert.equal(useAssetsStore.getState().componentSourceDrafts.component, undefined);
  assert.equal(state.history.past.length, 1);
});

test('undo and redo reconcile valid URDF text instead of discarding its draft', () => {
  const seedRobot = useWorkspaceStore.getState().workspace.components.component!.robot;
  const generatedSeed = generateEditableRobotSource({
    format: 'urdf',
    robotState: { ...seedRobot, selection: { type: null, id: null } },
  });
  const parsedSeed = parseURDF(generatedSeed);
  assert.ok(parsedSeed);
  const { selection: _selection, ...beforeRobot } = parsedSeed;
  const workspace = createSingleComponentWorkspace(beforeRobot, {
    componentId: 'component',
    sourceFile: 'robot.urdf',
  });
  useWorkspaceStore.getState().replaceWorkspace(workspace, { resetHistory: true });
  const beforeContent = generatedSeed.replace(
    '<robot name="before">',
    '<robot name="before" data-vendor="kept">',
  );
  useAssetsStore.getState().setComponentSourceDraft(createComponentSourceDraft({
    componentId: 'component',
    format: 'urdf',
    content: beforeContent,
    robot: beforeRobot,
  }));
  const afterRobot = { ...beforeRobot, name: 'after' };
  useWorkspaceStore.getState().replaceComponentRobot('component', afterRobot, {
    label: 'Rename robot',
  });
  const afterHash = createComponentSourceDraft({
    componentId: 'component',
    format: 'urdf',
    content: beforeContent,
    robot: afterRobot,
  }).robotSnapshotHash;
  useAssetsStore.setState((state) => ({
    componentSourceDrafts: {
      component: {
        ...state.componentSourceDrafts.component!,
        content: beforeContent.replace('name="before"', 'name="after"'),
        robotSnapshotHash: afterHash,
      },
    },
  }));

  const history = renderHistory();
  history.undo();
  let draft = useAssetsStore.getState().componentSourceDrafts.component;
  assert.ok(draft);
  assert.match(draft.content, /name="before"/);
  assert.match(draft.content, /data-vendor="kept"/);

  history.redo();
  draft = useAssetsStore.getState().componentSourceDrafts.component;
  assert.ok(draft);
  assert.match(draft.content, /name="after"/);
  assert.match(draft.content, /data-vendor="kept"/);
});
