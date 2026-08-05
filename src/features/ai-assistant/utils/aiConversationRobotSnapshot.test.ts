import assert from 'node:assert/strict';
import test from 'node:test';

import { createSingleComponentWorkspace, generateId } from '@/core/robot';
import { useSelectionStore } from '@/store/selectionStore';
import { useWorkspaceStore } from '@/store/workspaceStore';
import {
  DEFAULT_JOINT,
  DEFAULT_LINK,
  GeometryType,
  JointType,
  type RobotState,
} from '@/types';

import { cloneAISnapshot, resolveCurrentAIRobotSnapshot } from './aiConversationRobotSnapshot.ts';

function makeLink(id: string, name = id) {
  return {
    ...structuredClone(DEFAULT_LINK),
    id,
    name,
    visual: {
      type: GeometryType.BOX,
      dimensions: { x: 0.1, y: 0.1, z: 0.1 },
      color: '#000000',
      origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
    },
    collision: {
      type: GeometryType.BOX,
      dimensions: { x: 0.1, y: 0.1, z: 0.1 },
      color: '#000000',
      origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
    },
  };
}

function makeJoint(id: string, parentId: string, childId: string) {
  return {
    ...structuredClone(DEFAULT_JOINT),
    id,
    name: id,
    type: JointType.REVOLUTE,
    parentLinkId: parentId,
    childLinkId: childId,
  };
}

function makeRobot(linkIds: string[], jointSpecs: Array<[string, string, string]>): RobotState {
  const links: Record<string, ReturnType<typeof makeLink>> = {};
  for (const id of linkIds) {
    links[id] = makeLink(id);
  }
  const joints: Record<string, ReturnType<typeof makeJoint>> = {};
  for (const [id, parent, child] of jointSpecs) {
    joints[id] = makeJoint(id, parent, child);
  }
  const [rootLinkId] = linkIds;
  return {
    name: 'snapshot-test',
    links,
    joints,
    rootLinkId,
    selection: { type: null, id: null },
  };
}

function seedWorkspace(robot: RobotState, componentId = 'arm') {
  const { selection: _selection, ...robotData } = robot;
  useWorkspaceStore.setState({
    workspace: createSingleComponentWorkspace(robotData, { componentId }),
    activeComponentId: componentId,
  });
  useSelectionStore.getState().setSelection(null);
}

test('resolveCurrentAIRobotSnapshot returns a fresh deep clone of the current robot', () => {
  const robot = makeRobot(['base_link'], []);
  seedWorkspace(robot);

  const snapshot = resolveCurrentAIRobotSnapshot();

  assert.equal(snapshot.name, robot.name);
  assert.equal(snapshot.rootLinkId, robot.rootLinkId);
  assert.equal(snapshot.links['base_link'].name, 'base_link');
  assert.equal(snapshot.selection.type, null);

  // Mutating the snapshot must not bleed into the workspace store.
  snapshot.name = 'mutated';
  snapshot.links['base_link'].name = 'mutated';

  const reSnapshot = resolveCurrentAIRobotSnapshot();
  assert.equal(reSnapshot.name, robot.name, 'workspace robot name must not be mutated by snapshot consumers');
  assert.equal(reSnapshot.links['base_link'].name, 'base_link');
});

test('resolveCurrentAIRobotSnapshot follows the live workspace, not a captured copy', () => {
  seedWorkspace(makeRobot(['base_link'], []));

  // Simulate a user-driven edit that adds a new link + joint after the chat
  // was opened: the next call must surface the new structure, not the old one.
  const { links, joints } = useWorkspaceStore.getState().workspace.components['arm'].robot;
  const newLinkId = generateId('link');
  const newJointId = generateId('joint');
  links[newLinkId] = makeLink(newLinkId, 'tool_link');
  joints[newJointId] = makeJoint(newJointId, 'base_link', newLinkId);

  const snapshot = resolveCurrentAIRobotSnapshot();
  assert.ok(snapshot.links[newLinkId], 'snapshot must include links added after the chat was opened');
  assert.equal(snapshot.links[newLinkId].name, 'tool_link');
  assert.ok(snapshot.joints[newJointId], 'snapshot must include joints added after the chat was opened');
});

test('resolveCurrentAIRobotSnapshot follows the current selection, not a captured copy', () => {
  const armRobot = makeRobot(['base_link'], []);
  const { selection: _armSel, ...armData } = armRobot;
  const gripperRobot = makeRobot(['gripper_base', 'gripper_finger'], [['gripper_joint', 'gripper_base', 'gripper_finger']]);
  const { selection: _gripperSel, ...gripperData } = gripperRobot;
  useWorkspaceStore.setState({
    workspace: {
      name: 'multi',
      transform: { position: { x: 0, y: 0, z: 0 }, rotation: { r: 0, p: 0, y: 0 } },
      components: {
        arm: { id: 'arm', name: 'arm', sourceFile: null, robot: armData, transform: { position: { x: 0, y: 0, z: 0 }, rotation: { r: 0, p: 0, y: 0 } }, visible: true },
        gripper: {
          id: 'gripper',
          name: 'gripper',
          sourceFile: null,
          robot: gripperData,
          transform: { position: { x: 0, y: 0, z: 0 }, rotation: { r: 0, p: 0, y: 0 } },
          visible: true,
        },
      },
      bridges: {},
    },
    activeComponentId: 'arm',
  });

  // Selection on the gripper component must redirect the snapshot away from
  // the unselected arm component.
  useSelectionStore.getState().setSelection({
    entity: { type: 'link', componentId: 'gripper', entityId: 'gripper_finger' },
  });
  const snapshot = resolveCurrentAIRobotSnapshot();
  assert.ok(snapshot.links['gripper_finger'], 'snapshot must include the gripper component the user is viewing');
  assert.ok(snapshot.links['gripper_base'], 'snapshot must include the full gripper link set');
  assert.equal(snapshot.links['base_link'], undefined, 'snapshot must not leak the unselected arm component');
});

test('cloneAISnapshot falls back to JSON when structuredClone is unavailable', () => {
  const original = { a: 1, nested: { b: [2, 3] } };
  const cloned = cloneAISnapshot(original);
  assert.deepEqual(cloned, original);
  assert.notEqual(cloned, original, 'must be a different reference');
  assert.notEqual(cloned.nested, original.nested, 'nested objects must also be cloned');
});
