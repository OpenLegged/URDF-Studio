import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_JOINT, DEFAULT_LINK, GeometryType, JointType, type RobotData } from '@/types';

import type {
  CollisionOptimizationAnalysis,
  CollisionOptimizationCandidate,
} from '../collisionOptimization.ts';
import { createCollisionOptimizationCandidateKey } from '../collisionOptimization.ts';
import type { CollisionTargetRef } from './collisionTargets.ts';
import {
  GROUP_PADDING_X,
  GROUP_PADDING_Y,
  NODE_GAP_X,
  NODE_GAP_Y,
  buildGraphModel,
  buildTreeLayout,
} from './planarGraphLayout.ts';

function createLayoutRobot(): RobotData {
  return {
    name: 'planar-layout-test',
    rootLinkId: 'base',
    links: {
      base: { ...DEFAULT_LINK, id: 'base', name: 'Base' },
      sensor: { ...DEFAULT_LINK, id: 'sensor', name: 'Sensor' },
      arm: { ...DEFAULT_LINK, id: 'arm', name: 'Arm' },
      gripper: { ...DEFAULT_LINK, id: 'gripper', name: 'Gripper' },
      isolated: { ...DEFAULT_LINK, id: 'isolated', name: 'Isolated' },
    },
    joints: {
      sensor_joint: {
        ...DEFAULT_JOINT,
        id: 'sensor_joint',
        name: 'sensor_joint',
        type: JointType.FIXED,
        parentLinkId: 'base',
        childLinkId: 'sensor',
      },
      arm_joint: {
        ...DEFAULT_JOINT,
        id: 'arm_joint',
        name: 'arm_joint',
        type: JointType.FIXED,
        parentLinkId: 'base',
        childLinkId: 'arm',
      },
      gripper_joint: {
        ...DEFAULT_JOINT,
        id: 'gripper_joint',
        name: 'gripper_joint',
        type: JointType.FIXED,
        parentLinkId: 'arm',
        childLinkId: 'gripper',
      },
    },
  };
}

function createTarget(id: string, linkId: string, linkName: string): CollisionTargetRef {
  return {
    id,
    linkId,
    linkName,
    objectIndex: 0,
    bodyIndex: null,
    geometry: {
      type: GeometryType.CYLINDER,
      dimensions: { x: 0.1, y: 0.4, z: 0.1 },
      color: '#ffffff',
      origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
    },
    isPrimary: true,
    sequenceIndex: 0,
  };
}

test('tree layout sorts sibling subtrees, centers parents, and preserves disconnected roots', () => {
  const { positions, edges } = buildTreeLayout({ kind: 'robot', robot: createLayoutRobot() });
  const base = positions.get('base')!;
  const arm = positions.get('arm')!;
  const sensor = positions.get('sensor')!;
  const gripper = positions.get('gripper')!;
  const isolated = positions.get('isolated')!;

  assert.equal(positions.size, 5);
  assert.deepEqual(
    new Set(edges.map((edge) => `${edge.fromLinkId}::${edge.toLinkId}`)),
    new Set(['base::arm', 'arm::gripper', 'base::sensor']),
  );
  assert.equal(arm.y, base.y + NODE_GAP_Y);
  assert.equal(sensor.y, base.y + NODE_GAP_Y);
  assert.equal(gripper.y, arm.y + NODE_GAP_Y);
  assert.equal(base.x, (arm.x + sensor.x) / 2);
  assert.equal(sensor.x - arm.x, NODE_GAP_X);
  assert.equal(isolated.y, base.y);
  assert.ok(isolated.x > sensor.x);
});

test('graph groups enclose their paired nodes and focus bounds preserve group padding', () => {
  const robot = createLayoutRobot();
  const primary = createTarget('base-target', 'base', 'Base');
  const secondary = createTarget('gripper-target', 'gripper', 'Gripper');
  const candidate: CollisionOptimizationCandidate = {
    target: primary,
    secondaryTarget: secondary,
    eligible: true,
    currentType: GeometryType.CYLINDER,
    suggestedType: GeometryType.CAPSULE,
    status: 'ready',
  };
  const analysis: CollisionOptimizationAnalysis = {
    targets: [primary, secondary],
    filteredTargets: [primary, secondary],
    candidates: [candidate],
    meshAnalysisByTargetId: {},
  };
  const model = buildGraphModel(
    { kind: 'robot', robot },
    analysis,
    [candidate],
    new Set([createCollisionOptimizationCandidateKey(candidate)]),
    { type: 'link', id: 'base', subType: 'collision', objectIndex: 0 },
    [{ primaryTargetId: primary.id, secondaryTargetId: secondary.id }],
  );
  const base = model.nodes.find((node) => node.linkId === 'base')!;
  const gripper = model.nodes.find((node) => node.linkId === 'gripper')!;
  const group = model.groups[0]!;

  assert.equal(base.selected, true);
  assert.equal(base.checked, true);
  assert.equal(group.pairType, 'manual');
  assert.equal(group.checked, true);
  assert.ok(group.bounds.x <= Math.min(base.x, gripper.x) - GROUP_PADDING_X);
  assert.ok(group.bounds.y <= Math.min(base.y, gripper.y) - GROUP_PADDING_Y);
  assert.ok(
    group.bounds.x + group.bounds.width >=
      Math.max(base.x + base.width, gripper.x + gripper.width) + GROUP_PADDING_X,
  );
  assert.ok(
    group.bounds.y + group.bounds.height >=
      Math.max(base.y + base.height, gripper.y + gripper.height) + GROUP_PADDING_Y,
  );
  assert.ok(model.focusBounds.minX < group.bounds.x);
  assert.ok(model.focusBounds.minY < group.bounds.y);
  assert.ok(model.focusBounds.maxX > group.bounds.x + group.bounds.width);
  assert.ok(model.focusBounds.maxY > group.bounds.y + group.bounds.height);
});
