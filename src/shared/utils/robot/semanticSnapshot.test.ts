import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_LINK, JointType, type RobotData, type UrdfJoint, type UrdfLink } from '@/types';

import {
  createRobotSemanticSnapshot,
  createRobotPersistenceSnapshot,
  stripTransientJointMotionFromRobotData,
} from './semanticSnapshot.ts';

function createLinks(): Record<string, UrdfLink> {
  return {
    base_link: {
      ...DEFAULT_LINK,
      id: 'base_link',
      name: 'base_link',
      visual: structuredClone(DEFAULT_LINK.visual),
      visualBodies: structuredClone(DEFAULT_LINK.visualBodies ?? []),
      collision: structuredClone(DEFAULT_LINK.collision),
      collisionBodies: structuredClone(DEFAULT_LINK.collisionBodies ?? []),
      inertial: structuredClone(DEFAULT_LINK.inertial),
    },
    tool_link: {
      ...DEFAULT_LINK,
      id: 'tool_link',
      name: 'tool_link',
      visual: structuredClone(DEFAULT_LINK.visual),
      visualBodies: structuredClone(DEFAULT_LINK.visualBodies ?? []),
      collision: structuredClone(DEFAULT_LINK.collision),
      collisionBodies: structuredClone(DEFAULT_LINK.collisionBodies ?? []),
      inertial: structuredClone(DEFAULT_LINK.inertial),
    },
  };
}

function createJoints(): Record<string, UrdfJoint> {
  return {
    joint_a: {
      id: 'joint_a',
      name: 'joint_a',
      type: JointType.REVOLUTE,
      parentLinkId: 'base_link',
      childLinkId: 'tool_link',
      origin: {
        xyz: { x: 0, y: 0, z: 0 },
        rpy: { r: 0, p: 0, y: 0 },
      },
      axis: { x: 0, y: 0, z: 1 },
      limit: { lower: -1, upper: 1, effort: 10, velocity: 5 },
      dynamics: { damping: 0, friction: 0 },
      hardware: {
        armature: 0,
        motorType: 'None',
        motorId: '',
        motorDirection: 1,
      },
    },
  };
}

function createRobotData(): RobotData {
  return {
    name: 'demo_bot',
    links: createLinks(),
    joints: createJoints(),
    rootLinkId: 'base_link',
  };
}

test('stripTransientJointMotionFromRobotData removes joint angle and quaternion state', () => {
  const robot = createRobotData();
  robot.joints.joint_a.angle = 0.5;
  robot.joints.joint_a.quaternion = { x: 0, y: 0, z: 0.382683, w: 0.92388 };

  const sanitized = stripTransientJointMotionFromRobotData(robot);

  assert.equal(sanitized.joints.joint_a.angle, undefined);
  assert.equal(sanitized.joints.joint_a.quaternion, undefined);
});

test('createRobotSemanticSnapshot ignores transient joint motion state', () => {
  const baseline = createRobotData();
  const moved = createRobotData();
  moved.joints.joint_a.angle = 1.2;
  moved.joints.joint_a.quaternion = { x: 0, y: 0, z: 0.5, w: 0.8660254 };

  assert.equal(
    createRobotSemanticSnapshot(baseline),
    createRobotSemanticSnapshot(moved),
  );
});

test('createRobotSemanticSnapshot detects link geometry edits', () => {
  const baseline = createRobotData();
  const edited = createRobotData();
  edited.links.tool_link.collision.dimensions = { x: 1.2, y: 0.4, z: 0.3 };

  assert.notEqual(
    createRobotSemanticSnapshot(baseline),
    createRobotSemanticSnapshot(edited),
  );
});

test('createRobotPersistenceSnapshot ignores scene visibility-only changes', () => {
  const baseline = createRobotData();
  const hidden = createRobotData();

  hidden.links.base_link.visible = false;
  hidden.links.tool_link.visual.visible = false;
  hidden.links.tool_link.collision.visible = false;

  assert.equal(
    createRobotPersistenceSnapshot(baseline),
    createRobotPersistenceSnapshot(hidden),
  );
});

test('robot snapshots ignore editor locks as editor-only presentation state', () => {
  const baseline = createRobotData();
  const locked = structuredClone(baseline);
  locked.links.base_link.editorLocked = true;

  assert.equal(
    createRobotSemanticSnapshot(baseline),
    createRobotSemanticSnapshot(locked),
  );
  assert.equal(
    createRobotPersistenceSnapshot(baseline),
    createRobotPersistenceSnapshot(locked),
  );
});
