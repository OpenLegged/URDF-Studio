import test from 'node:test';
import assert from 'node:assert/strict';

import { createJoint, createLink } from './builders.ts';
import {
  addLinkJoint,
  deleteLink,
  getJoint,
  getLink,
  readRobotPath,
  updateJoint,
  updateJointLimit,
  updateLinkGeometry,
  updateLinkInertial,
  updateLinkOrigin,
  writeRobotPath,
} from './agentRobotTools.ts';
import { GeometryType, JointType, type RobotData } from '@/types';

/** base_link (cylinder r=0.05 l=0.5) → elbow (revolute) → forearm. */
function buildRobot(): RobotData {
  const base = createLink({ id: 'base_link', name: 'base_link' });
  const forearm = createLink({ id: 'forearm', name: 'forearm' });
  const elbow = createJoint({
    id: 'elbow',
    name: 'elbow',
    type: JointType.REVOLUTE,
    parentLinkId: 'base_link',
    childLinkId: 'forearm',
  });
  return {
    name: 'robot',
    rootLinkId: 'base_link',
    links: { base_link: base, forearm },
    joints: { elbow },
  };
}

/** base_link → j1 → mid → j2 → tip (for non-leaf deletion tests). */
function buildChainRobot(): RobotData {
  const base = createLink({ id: 'base_link', name: 'base_link' });
  const mid = createLink({ id: 'mid', name: 'mid' });
  const tip = createLink({ id: 'tip', name: 'tip' });
  const j1 = createJoint({ id: 'j1', name: 'j1', type: JointType.REVOLUTE, parentLinkId: 'base_link', childLinkId: 'mid' });
  const j2 = createJoint({ id: 'j2', name: 'j2', type: JointType.REVOLUTE, parentLinkId: 'mid', childLinkId: 'tip' });
  return {
    name: 'robot',
    rootLinkId: 'base_link',
    links: { base_link: base, mid, tip },
    joints: { j1, j2 },
  };
}

test('updateLinkGeometry changes cylinder radius and preserves length', () => {
  const robot = buildRobot();
  const before = { ...robot.links.base_link.visual.dimensions };

  const res = updateLinkGeometry(robot, { linkId: 'base_link', geometryType: 'cylinder', radius: 0.3 });

  assert.equal(res.ok, true);
  assert.equal(robot.links.base_link.visual.dimensions.x, 0.3);
  assert.equal(robot.links.base_link.visual.dimensions.y, before.y);
  assert.equal(robot.links.base_link.collision.dimensions.x, 0.3);
  assert.equal(robot.links.base_link.collision.dimensions.y, before.y);
  // Inertia untouched — surgical.
  assert.equal(robot.links.base_link.inertial?.mass, 1);
});

test('updateLinkGeometry changes both radius and length when given', () => {
  const robot = buildRobot();
  updateLinkGeometry(robot, { linkId: 'base_link', geometryType: 'cylinder', radius: 0.3, length: 0.3 });
  assert.equal(robot.links.base_link.visual.dimensions.x, 0.3);
  assert.equal(robot.links.base_link.visual.dimensions.y, 0.3);
});

test('updateLinkGeometry switches to box with dimensions', () => {
  const robot = buildRobot();
  updateLinkGeometry(robot, { linkId: 'base_link', geometryType: 'box', dimensions: [0.2, 0.05, 0.05] });
  assert.equal(robot.links.base_link.visual.type, GeometryType.BOX);
  assert.equal(robot.links.base_link.visual.dimensions.x, 0.2);
  assert.equal(robot.links.base_link.collision.type, GeometryType.BOX);
});

test('updateLinkGeometry switches to sphere with radius', () => {
  const robot = buildRobot();
  updateLinkGeometry(robot, { linkId: 'base_link', geometryType: 'sphere', radius: 0.15 });
  assert.equal(robot.links.base_link.visual.type, GeometryType.SPHERE);
  assert.equal(robot.links.base_link.visual.dimensions.x, 0.15);
});

test('updateLinkGeometry is surgical — sibling link untouched', () => {
  const robot = buildRobot();
  const forearmBefore = structuredClone(robot.links.forearm);
  updateLinkGeometry(robot, { linkId: 'base_link', geometryType: 'cylinder', radius: 0.3 });
  assert.deepEqual(robot.links.forearm, forearmBefore);
});

test('updateLinkGeometry fails for unknown link', () => {
  const robot = buildRobot();
  const res = updateLinkGeometry(robot, { linkId: 'nope', geometryType: 'cylinder', radius: 0.3 });
  assert.equal(res.ok, false);
});

test('updateLinkInertial patches mass and preserves inertia', () => {
  const robot = buildRobot();
  const before = { ...robot.links.base_link.inertial!.inertia };
  updateLinkInertial(robot, { linkId: 'base_link', mass: 2.5 });
  assert.equal(robot.links.base_link.inertial!.mass, 2.5);
  assert.deepEqual(robot.links.base_link.inertial!.inertia, before);
});

test('updateLinkInertial patches origin and inertia together', () => {
  const robot = buildRobot();
  updateLinkInertial(robot, {
    linkId: 'base_link',
    originXyz: [0, 0, 0.25],
    inertia: { ixx: 0.5, ixy: 0, ixz: 0, iyy: 0.5, iyz: 0, izz: 0.5 },
  });
  const inertial = robot.links.base_link.inertial!;
  assert.ok(inertial.origin);
  assert.equal(inertial.origin.xyz.z, 0.25);
  assert.equal(inertial.inertia.ixx, 0.5);
});

test('updateLinkInertial fails for unknown link', () => {
  const robot = buildRobot();
  const res = updateLinkInertial(robot, { linkId: 'nope', mass: 1 });
  assert.equal(res.ok, false);
});

test('updateLinkOrigin patches visual origin xyz and preserves rpy', () => {
  const robot = buildRobot();
  const beforeRpy = { ...robot.links.base_link.visual.origin.rpy };
  updateLinkOrigin(robot, { linkId: 'base_link', target: 'visual', xyz: [0, 0, 0.25] });
  assert.equal(robot.links.base_link.visual.origin.xyz.z, 0.25);
  assert.deepEqual(robot.links.base_link.visual.origin.rpy, beforeRpy);
});

test('updateLinkOrigin fails for inertial when none exists', () => {
  const robot = buildRobot();
  delete (robot.links.base_link as { inertial?: unknown }).inertial;
  const res = updateLinkOrigin(robot, { linkId: 'base_link', target: 'inertial', xyz: [0, 0, 0] });
  assert.equal(res.ok, false);
});

test('addLinkJoint adds a child link and joint', () => {
  const robot = buildRobot();
  const res = addLinkJoint(robot, { linkId: 'upper_arm', parentLinkId: 'base_link', jointName: 'shoulder', jointType: 'revolute' });
  assert.equal(res.ok, true);
  assert.ok(robot.links.upper_arm);
  const joint = Object.values(robot.joints).find((j) => j.childLinkId === 'upper_arm');
  assert.ok(joint);
  assert.equal(joint!.parentLinkId, 'base_link');
  assert.equal(joint!.type, JointType.REVOLUTE);
});

test('addLinkJoint fails for unknown parent', () => {
  const robot = buildRobot();
  const res = addLinkJoint(robot, { parentLinkId: 'nope', jointType: 'revolute' });
  assert.equal(res.ok, false);
});

test('deleteLink removes a leaf link and its connecting joint', () => {
  const robot = buildRobot();
  const res = deleteLink(robot, { linkId: 'forearm' });
  assert.equal(res.ok, true);
  assert.equal(robot.links.forearm, undefined);
  assert.equal(robot.joints.elbow, undefined);
});

test('deleteLink refuses a non-leaf link', () => {
  const robot = buildChainRobot();
  const res = deleteLink(robot, { linkId: 'mid' });
  assert.equal(res.ok, false);
  assert.ok(robot.links.mid);
  assert.ok(robot.joints.j1);
  assert.ok(robot.joints.j2);
});

test('deleteLink refuses the root link', () => {
  const robot = buildRobot();
  const res = deleteLink(robot, { linkId: 'base_link' });
  assert.equal(res.ok, false);
  assert.ok(robot.links.base_link);
});

test('updateJoint patches type and origin', () => {
  const robot = buildRobot();
  const res = updateJoint(robot, { jointId: 'elbow', type: 'prismatic', originXyz: [0, 0, 0.1] });
  assert.equal(res.ok, true);
  assert.equal(robot.joints.elbow.type, JointType.PRISMATIC);
  assert.equal(robot.joints.elbow.origin.xyz.z, 0.1);
});

test('updateJoint fails for unknown joint', () => {
  const robot = buildRobot();
  const res = updateJoint(robot, { jointId: 'nope', type: 'fixed' });
  assert.equal(res.ok, false);
});

test('updateJointLimit patches limits and preserves unspecified effort/velocity', () => {
  const robot = buildRobot();
  const before = { ...robot.joints.elbow.limit! };
  updateJointLimit(robot, { jointId: 'elbow', lower: -0.5, upper: 0.5 });
  assert.equal(robot.joints.elbow.limit!.lower, -0.5);
  assert.equal(robot.joints.elbow.limit!.upper, 0.5);
  assert.equal(robot.joints.elbow.limit!.effort, before.effort);
  assert.equal(robot.joints.elbow.limit!.velocity, before.velocity);
});

test('updateJointLimit fails for unknown joint', () => {
  const robot = buildRobot();
  const res = updateJointLimit(robot, { jointId: 'nope', lower: 0 });
  assert.equal(res.ok, false);
});

// --- read-only inspection tools ---

test('getLink returns current geometry as JSON', () => {
  const robot = buildRobot();
  const res = getLink(robot, { linkId: 'base_link' });
  assert.equal(res.ok, true);
  const data = JSON.parse(res.message) as {
    visual: { type: string; dimensions: { x: number; y: number } };
    inertial: { mass: number } | null;
  };
  assert.equal(data.visual.type, 'cylinder');
  assert.equal(data.visual.dimensions.x, 0.05);
  assert.equal(data.visual.dimensions.y, 0.5);
  assert.equal(data.inertial?.mass, 1);
});

test('getLink fails for unknown link', () => {
  const robot = buildRobot();
  const res = getLink(robot, { linkId: 'nope' });
  assert.equal(res.ok, false);
});

test('getLink does not mutate the robot', () => {
  const robot = buildRobot();
  const before = structuredClone(robot);
  getLink(robot, { linkId: 'base_link' });
  assert.deepEqual(robot, before);
});

test('getJoint returns axis and limit as JSON', () => {
  const robot = buildRobot();
  const res = getJoint(robot, { jointId: 'elbow' });
  assert.equal(res.ok, true);
  const data = JSON.parse(res.message) as {
    type: string;
    parentLinkId: string;
    childLinkId: string;
    axis: { x: number; y: number; z: number };
    limit: { lower: number; upper: number };
  };
  assert.equal(data.type, 'revolute');
  assert.equal(data.parentLinkId, 'base_link');
  assert.equal(data.childLinkId, 'forearm');
  assert.equal(data.axis.z, 1);
  assert.equal(data.limit.lower, -1.57);
});

test('getJoint fails for unknown joint', () => {
  const robot = buildRobot();
  const res = getJoint(robot, { jointId: 'nope' });
  assert.equal(res.ok, false);
});

test('readRobotPath reads a nested link field as JSON', () => {
  const robot = buildRobot();
  const res = readRobotPath(robot, { path: 'links.base_link.visual.dimensions' });
  assert.equal(res.ok, true);
  const dims = JSON.parse(res.message);
  assert.equal(dims.x, 0.05);
  assert.equal(dims.y, 0.5);
});

test('readRobotPath reads a joint field', () => {
  const robot = buildRobot();
  const res = readRobotPath(robot, { path: 'joints.elbow.axis' });
  assert.equal(res.ok, true);
  const axis = JSON.parse(res.message);
  assert.equal(axis.z, 1);
});

test('readRobotPath rejects paths outside links/joints', () => {
  const robot = buildRobot();
  const res = readRobotPath(robot, { path: 'globalThis.process' });
  assert.equal(res.ok, false);
  assert.match(res.message, /links|<linkId>|joints/);
});

test('readRobotPath fails for missing entity or key', () => {
  const robot = buildRobot();
  assert.equal(readRobotPath(robot, { path: 'links.nope.visual' }).ok, false);
  assert.equal(readRobotPath(robot, { path: 'links.base_link.notAKey' }).ok, false);
});

test('writeRobotPath replaces a scalar leaf', () => {
  const robot = buildRobot();
  const res = writeRobotPath(robot, { path: 'links.base_link.visual.dimensions.x', value: 0.3 });
  assert.equal(res.ok, true);
  assert.equal(robot.links.base_link.visual.dimensions.x, 0.3);
  assert.equal(robot.links.base_link.visual.dimensions.y, 0.5, 'sibling preserved');
});

test('writeRobotPath shallow-merges an object leaf', () => {
  const robot = buildRobot();
  const res = writeRobotPath(robot, {
    path: 'joints.elbow.dynamics',
    value: { damping: 5 },
  });
  assert.equal(res.ok, true);
  assert.equal(robot.joints.elbow.dynamics.damping, 5);
  assert.equal(robot.joints.elbow.dynamics.friction, 0, 'unspecified sibling preserved');
});

test('writeRobotPath rejects paths outside links/joints and short paths', () => {
  const robot = buildRobot();
  assert.equal(writeRobotPath(robot, { path: 'process.exit', value: 1 }).ok, false);
  assert.equal(writeRobotPath(robot, { path: 'links.base_link', value: {} }).ok, false);
});
