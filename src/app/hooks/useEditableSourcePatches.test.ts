import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';

import {
  createComponentSourceDraft,
  createSingleComponentWorkspace,
  createSourceSemanticRobotHash,
} from '@/core/robot';
import { useAssetsStore } from '@/store/assetsStore';
import { useWorkspaceStore } from '@/store/workspaceStore';
import { DEFAULT_JOINT, DEFAULT_LINK, JointType, type AssemblyState, type RobotData } from '@/types';
import { generateEditableRobotSource } from '../utils/generateEditableRobotSource.ts';
import { parseEditableRobotSource } from '../utils/parseEditableRobotSource.ts';
import {
  applyComponentEditableSourcePatch,
  reconcileComponentEditableRobotSource,
} from './useEditableSourcePatches.ts';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.DOMParser = dom.window.DOMParser as typeof DOMParser;
globalThis.XMLSerializer = dom.window.XMLSerializer as typeof XMLSerializer;

function robot(name: string): RobotData {
  return {
    name,
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
  };
}

function workspace(): AssemblyState {
  const value = createSingleComponentWorkspace(robot('template'), {
    componentId: 'left',
    sourceFile: 'library/shared.xml',
  });
  value.components.right = createSingleComponentWorkspace(robot('template'), {
    componentId: 'right',
    sourceFile: 'library/shared.xml',
  }).components.right;
  return value;
}

function reset(): AssemblyState {
  const value = workspace();
  useWorkspaceStore.getState().replaceWorkspace(value, { resetHistory: true });
  useAssetsStore.setState({
    availableFiles: [{
      name: 'library/shared.xml',
      format: 'mjcf',
      content: '<mujoco model="template"/>',
    }],
    allFileContents: { 'library/shared.xml': '<mujoco model="template"/>' },
    componentSourceDrafts: {
      left: createComponentSourceDraft({
        componentId: 'left',
        format: 'mjcf',
        content: '<mujoco model="left"/>',
        robot: value.components.left.robot,
      }),
      right: createComponentSourceDraft({
        componentId: 'right',
        format: 'mjcf',
        content: '<mujoco model="right"/>',
        robot: value.components.right.robot,
      }),
    },
  });
  return value;
}

test('property patch updates only its target component draft and current semantic hash', () => {
  const before = reset();
  const expectedRobotSnapshotHash = createSourceSemanticRobotHash(before.components.left.robot);
  useWorkspaceStore.getState().replaceComponentRobot('left', {
    ...before.components.left.robot,
    name: 'left-edited',
  });

  assert.equal(applyComponentEditableSourcePatch({
    componentId: 'left',
    expectedRobotSnapshotHash,
    patch: (draft) => draft.content.replace('left', 'left-edited'),
  }), 'patched');

  const assets = useAssetsStore.getState();
  const currentLeft = useWorkspaceStore.getState().workspace.components.left;
  assert.match(assets.componentSourceDrafts.left.content, /left-edited/);
  assert.equal(
    assets.componentSourceDrafts.left.robotSnapshotHash,
    createSourceSemanticRobotHash(currentLeft.robot),
  );
  assert.equal(assets.componentSourceDrafts.right.content, '<mujoco model="right"/>');
  assert.equal(assets.availableFiles[0].content, '<mujoco model="template"/>');
  assert.equal(assets.allFileContents['library/shared.xml'], '<mujoco model="template"/>');
});

test('unsafe patch preserves its target draft for source reconciliation', () => {
  const before = reset();
  const expectedRobotSnapshotHash = createSourceSemanticRobotHash(before.components.left.robot);

  assert.equal(applyComponentEditableSourcePatch({
    componentId: 'left',
    expectedRobotSnapshotHash,
    patch: () => null,
  }), 'invalidated');
  assert.equal(
    useAssetsStore.getState().componentSourceDrafts.left.content,
    '<mujoco model="left"/>',
  );
  assert.ok(useAssetsStore.getState().componentSourceDrafts.right);
});

test('no-op text patch cannot mark a semantically changed robot draft as current', () => {
  const before = reset();
  const expectedRobotSnapshotHash = createSourceSemanticRobotHash(before.components.left.robot);
  useWorkspaceStore.getState().replaceComponentRobot('left', {
    ...before.components.left.robot,
    name: 'workspace-only-change',
  });

  assert.equal(applyComponentEditableSourcePatch({
    componentId: 'left',
    expectedRobotSnapshotHash,
    patch: (draft) => draft.content,
  }), 'invalidated');
  assert.equal(useAssetsStore.getState().componentSourceDrafts.left, undefined);
  assert.ok(useAssetsStore.getState().componentSourceDrafts.right);
});

test('foreign or already-stale drafts are rejected without discarding authored text', () => {
  const before = reset();
  useAssetsStore.setState((state) => ({
    componentSourceDrafts: {
      ...state.componentSourceDrafts,
      left: { ...state.componentSourceDrafts.left, robotSnapshotHash: 'foreign-hash' },
    },
  }));

  assert.equal(applyComponentEditableSourcePatch({
    componentId: 'left',
    expectedRobotSnapshotHash: createSourceSemanticRobotHash(before.components.left.robot),
    patch: () => '<mujoco model="should-not-commit"/>',
  }), 'invalidated');
  assert.equal(
    useAssetsStore.getState().componentSourceDrafts.left.content,
    '<mujoco model="left"/>',
  );
  assert.ok(useAssetsStore.getState().componentSourceDrafts.right);
});

test('missing draft reports unavailable without changing other drafts', () => {
  const before = reset();
  useAssetsStore.getState().removeComponentSourceDraft('left');

  assert.equal(applyComponentEditableSourcePatch({
    componentId: 'left',
    expectedRobotSnapshotHash: createSourceSemanticRobotHash(before.components.left.robot),
    patch: () => '<mujoco model="unused"/>',
  }), 'unavailable');
  assert.ok(useAssetsStore.getState().componentSourceDrafts.right);
});

(['mjcf', 'sdf', 'urdf', 'xacro'] as const).forEach((format) => {
  test(`complete source reconciliation keeps an imported ${format} draft in its format`, () => {
    const fileName = format === 'xacro' ? 'library/robot.xacro' : 'library/robot.xml';
    const generated = generateEditableRobotSource({
      format,
      robotState: { ...robot('before'), selection: { type: null, id: null } },
    });
    const content = generated.replace(
      /(<(?:mujoco|robot|sdf)\b[^>]*>)/,
      '$1\n  <!-- preserve imported source -->',
    );
    const parsed = parseEditableRobotSource({
      file: { name: fileName, format },
      content,
      allFileContents: { [fileName]: content },
    });
    assert.ok(parsed);
    const { selection: _selection, ...beforeRobot } = parsed;
    const currentWorkspace = createSingleComponentWorkspace(beforeRobot, {
      componentId: 'component',
      sourceFile: fileName,
    });
    useWorkspaceStore.getState().replaceWorkspace(currentWorkspace, { resetHistory: true });
    useAssetsStore.setState({
      componentSourceDrafts: {
        component: createComponentSourceDraft({
          componentId: 'component',
          format,
          content,
          robot: beforeRobot,
        }),
      },
    });
    const afterRobot = { ...structuredClone(beforeRobot), name: `${format}_after` };
    useWorkspaceStore.getState().replaceComponentRobot('component', afterRobot);

    const result = reconcileComponentEditableRobotSource({
      componentId: 'component',
      expectedRobotSnapshotHash: createSourceSemanticRobotHash(beforeRobot),
      previousRobot: beforeRobot,
      nextRobot: afterRobot,
    });

    assert.equal(result.handled, true);
    assert.equal(result.outcome, 'patched');
    const draft = useAssetsStore.getState().componentSourceDrafts.component;
    assert.ok(draft);
    assert.equal(draft.format, format);
    assert.match(draft.content, /preserve imported source/);
    assert.match(draft.content, new RegExp(`${format}_after`));
    assert.equal(draft.robotSnapshotHash, createSourceSemanticRobotHash(afterRobot));
  });
});
