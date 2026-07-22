import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';

import { parseURDF } from '@/core/parsers';
import { createComponentSourceDraft, createSourceSemanticRobotHash } from '@/core/robot';
import { useAssetsStore } from '@/store/assetsStore';
import { useWorkspaceStore } from '@/store/workspaceStore';
import {
  DEFAULT_JOINT,
  JointType,
  type AssemblyState,
  type BridgeJoint,
  type RobotData,
} from '@/types';
import type { GroupSourceCodeDocumentChangeTarget } from '@/app/utils/sourceCodeDocuments';
import { buildCanonicalWorkspaceSourceDocuments } from '@/app/utils/sourceCodeDocuments';
import { applyFlattenedGroupSourceEdit } from './useFlattenedGroupSourceApply.ts';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.DOMParser = dom.window.DOMParser as typeof DOMParser;

const MASTER_SOURCE = `<?xml version="1.0"?>
<robot name="master">
  <link name="base" />
  <link name="tip" />
  <joint name="master_joint" type="fixed">
    <parent link="base" />
    <child link="tip" />
  </joint>
</robot>
`;

const SLAVE_SOURCE = `<?xml version="1.0"?>
<robot name="slave">
  <link name="slave_base" />
</robot>
`;

function robotData(source: string): RobotData {
  const parsed = parseURDF(source);
  assert.ok(parsed);
  const { selection: _selection, ...robot } = parsed;
  return robot;
}

function bridge(): BridgeJoint {
  return {
    id: 'mount',
    name: 'mount',
    parentComponentId: 'master',
    parentLinkId: 'tip',
    childComponentId: 'slave',
    childLinkId: 'slave_base',
    joint: {
      ...structuredClone(DEFAULT_JOINT),
      id: 'mount',
      name: 'mount',
      type: JointType.FIXED,
      parentLinkId: 'tip',
      childLinkId: 'slave_base',
      origin: {
        xyz: { x: 0, y: 0, z: 0 },
        rpy: { r: 0, p: 0, y: 0 },
      },
    },
  };
}

function reset(): GroupSourceCodeDocumentChangeTarget {
  const current = useWorkspaceStore.getState();
  if (current.transaction) current.cancelWorkspaceTransaction(current.transaction.id);
  const masterRobot = robotData(MASTER_SOURCE);
  const slaveRobot = robotData(SLAVE_SOURCE);
  const workspace: AssemblyState = {
    name: 'group',
    transform: { position: { x: 0, y: 0, z: 0 }, rotation: { r: 0, p: 0, y: 0 } },
    components: {
      master: {
        id: 'master',
        name: 'Master',
        sourceFile: 'master.urdf',
        robot: masterRobot,
        transform: { position: { x: 0, y: 0, z: 0 }, rotation: { r: 0, p: 0, y: 0 } },
        visible: true,
      },
      slave: {
        id: 'slave',
        name: 'Slave',
        sourceFile: 'slave.urdf',
        robot: slaveRobot,
        transform: { position: { x: 0, y: 0, z: 0 }, rotation: { r: 0, p: 0, y: 0 } },
        visible: true,
      },
    },
    bridges: { mount: bridge() },
  };
  useWorkspaceStore.getState().replaceWorkspace(workspace, { resetHistory: true });
  const drafts = {
    master: createComponentSourceDraft({
      componentId: 'master',
      format: 'urdf',
      content: MASTER_SOURCE,
      robot: masterRobot,
    }),
    slave: createComponentSourceDraft({
      componentId: 'slave',
      format: 'urdf',
      content: SLAVE_SOURCE,
      robot: slaveRobot,
    }),
  };
  useAssetsStore.getState().replaceComponentSourceDrafts(drafts);
  const document = buildCanonicalWorkspaceSourceDocuments({
    workspace,
    activeComponentId: 'master',
    componentSourceDrafts: drafts,
    availableFiles: [],
    allFileContents: {},
  }).documents[0];
  assert.equal(document.changeTarget?.kind, 'group');
  if (document.changeTarget?.kind !== 'group') throw new Error('Expected group target');
  return document.changeTarget;
}

function editMasterAndBridge(): string {
  const document = buildCanonicalWorkspaceSourceDocuments({
    workspace: useWorkspaceStore.getState().workspace,
    activeComponentId: 'master',
    componentSourceDrafts: useAssetsStore.getState().componentSourceDrafts,
    availableFiles: [],
    allFileContents: {},
  }).documents[0];
  return document.content
    .replace('<robot name="master">', '<robot name="edited_master">')
    .replace(
      /(<joint name="mount"[\s\S]*?<origin xyz=")[^"]+/,
      (_match, prefix: string) => `${prefix}1 2 3`,
    );
}

test('applies master and bridge edits atomically with one undo step', () => {
  const target = reset();
  const editedText = editMasterAndBridge();

  assert.equal(applyFlattenedGroupSourceEdit(editedText, target), true);
  const applied = useWorkspaceStore.getState();
  assert.equal(applied.workspace.components.master.robot.name, 'edited_master');
  assert.deepEqual(applied.workspace.bridges.mount.joint.origin.xyz, { x: 1, y: 2, z: 3 });
  assert.equal(applied.history.past.length, 1);
  assert.equal(applied.transaction, null);
  const masterDraft = useAssetsStore.getState().componentSourceDrafts.master;
  assert.equal(masterDraft.content.includes('name="slave_base"'), false);
  assert.equal(
    masterDraft.robotSnapshotHash,
    createSourceSemanticRobotHash(applied.workspace.components.master.robot),
  );

  assert.equal(useWorkspaceStore.getState().undo(), true);
  const undone = useWorkspaceStore.getState();
  assert.equal(undone.workspace.components.master.robot.name, 'master');
  assert.deepEqual(undone.workspace.bridges.mount.joint.origin.xyz, { x: 0, y: 0, z: 0 });
  assert.equal(undone.history.past.length, 0);
});

test('rolls back the component and draft when a later bridge apply fails', () => {
  const target = reset();
  const editedText = editMasterAndBridge();
  const beforeWorkspace = structuredClone(useWorkspaceStore.getState().workspace);
  const beforeDrafts = structuredClone(useAssetsStore.getState().componentSourceDrafts);
  const originalUpdateBridge = useWorkspaceStore.getState().updateBridge;
  useWorkspaceStore.setState({ updateBridge: () => false });

  try {
    assert.equal(applyFlattenedGroupSourceEdit(editedText, target), false);
  } finally {
    useWorkspaceStore.setState({ updateBridge: originalUpdateBridge });
  }

  const after = useWorkspaceStore.getState();
  assert.deepEqual(after.workspace, beforeWorkspace);
  assert.deepEqual(useAssetsStore.getState().componentSourceDrafts, beforeDrafts);
  assert.equal(after.history.past.length, 0);
  assert.equal(after.transaction, null);
});
