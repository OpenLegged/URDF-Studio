import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { JSDOM } from 'jsdom';

import { parseURDF } from '@/core/parsers/urdf/parser';
import {
  GeometryType,
  JointType,
  type RobotState,
  type UrdfJoint,
  type UrdfLink,
} from '@/types';
import { buildUsdLinkPathMaps, buildUsdPhysicsLayerContent } from './usdPackageLayers';

const UNITREE_HAND_URDF = path.resolve(
  'test/unitree_ros/robots/g1_description/inspire_hand/DFQ_left_hand.urdf',
);
const UNITREE_DEX1_URDF = path.resolve(
  'test/unitree_ros/robots/dexterous_hand_description/dex1_1/dex1_1.urdf',
);
const UNITREE_B2W_URDF = path.resolve(
  'test/unitree_ros/robots/b2w_description/urdf/b2w_description.urdf',
);

const dom = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.DOMParser = dom.window.DOMParser as typeof DOMParser;

function loadUrdf(filePath: string): RobotState {
  const robot = parseURDF(fs.readFileSync(filePath, 'utf8'));
  assert.ok(robot, `expected ${filePath} to parse`);
  return robot;
}

function buildPhysicsLayer(
  robot: RobotState,
  rootPrimName: string,
  layoutProfile: 'legacy' | 'isaacsim' = 'isaacsim',
): string {
  const pathMaps = buildUsdLinkPathMaps(robot, rootPrimName, { layoutProfile });
  return buildUsdPhysicsLayerContent(robot, pathMaps, rootPrimName, rootPrimName, {
    layoutProfile,
    fileFormat: 'usda',
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractJointSpec(layer: string, jointId: string): string {
  const startMatch = layer.match(
    new RegExp(`\\n        def [A-Za-z0-9_]+ "${escapeRegExp(jointId)}"(?: |\\n)`),
  );
  assert.ok(startMatch?.index !== undefined, `expected joint prim ${jointId}`);
  const start = startMatch.index + 1;
  const nextJoint = layer.indexOf('\n        def ', start + startMatch[0].length);
  const jointsScopeEnd = layer.indexOf('\n    }\n}', start);
  const end = nextJoint >= 0 ? nextJoint : jointsScopeEnd;
  assert.ok(end > start, `expected complete joint prim ${jointId}`);
  return layer.slice(start, end);
}

function createEmptyLink(id: string): UrdfLink {
  return {
    id,
    name: id,
    visible: true,
    visual: {
      type: GeometryType.NONE,
      dimensions: { x: 0, y: 0, z: 0 },
      color: '#ffffff',
      origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
    },
    collision: {
      type: GeometryType.NONE,
      dimensions: { x: 0, y: 0, z: 0 },
      color: '#ffffff',
      origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
    },
    collisionBodies: [],
  };
}

function createMatrixJoint(
  id: string,
  type: JointType,
  parentLinkId: string,
  childLinkId: string,
): UrdfJoint {
  return {
    id,
    name: id,
    type,
    parentLinkId,
    childLinkId,
    origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
    axis: { x: 1, y: 0, z: 0 },
    limit: { lower: -0.5, upper: 0.75, effort: 4, velocity: 2 },
    dynamics: { damping: 0.1, friction: 0 },
    hardware: { armature: 0, motorType: 'None', motorId: '', motorDirection: 1 },
  };
}

function createJointClassificationRobot(): RobotState {
  const jointTypes = [
    JointType.FIXED,
    JointType.REVOLUTE,
    JointType.CONTINUOUS,
    JointType.PRISMATIC,
    JointType.FLOATING,
    JointType.PLANAR,
    JointType.BALL,
  ];
  const links: Record<string, UrdfLink> = { root: createEmptyLink('root') };
  const joints: Record<string, UrdfJoint> = {};
  let parentLinkId = 'root';

  jointTypes.forEach((jointType) => {
    const childLinkId = `${jointType}_link`;
    const jointId = `${jointType}_joint`;
    links[childLinkId] = createEmptyLink(childLinkId);
    joints[jointId] = createMatrixJoint(jointId, jointType, parentLinkId, childLinkId);
    parentLinkId = childLinkId;
  });

  joints.revolute_joint.axis = { x: 1, y: 0, z: 0 };
  joints.revolute_joint.origin = {
    xyz: { x: 1, y: 2, z: 3 },
    rpy: { r: 0, p: 0, y: Math.PI / 2 },
  };
  joints.revolute_joint.usdPhysics = {
    axisToken: 'Z',
    localPos1: { x: 1, y: 0, z: 0 },
    localRot1Wxyz: [1, 0, 0, 0],
  };
  joints.continuous_joint.limit = { effort: 6, velocity: 10 };
  joints.prismatic_joint.axis = { x: -1, y: 0, z: 0 };
  joints.planar_joint.axis = { x: 0, y: Math.SQRT1_2, z: Math.SQRT1_2 };

  return {
    name: 'joint_matrix',
    rootLinkId: 'root',
    selection: { type: null, id: null },
    links,
    joints,
    materials: {},
  };
}

test('Unitree H1_2-style hand mimic joints use PhysX gearing without independent drives', () => {
  const robot = loadUrdf(UNITREE_HAND_URDF);
  const mimicJoints = Object.values(robot.joints).filter((joint) => joint.mimic);
  assert.equal(mimicJoints.length, 6);

  const physicsLayer = buildPhysicsLayer(robot, 'h1_2');
  assert.equal(
    physicsLayer.match(/"PhysxMimicJointAPI:rotZ"/g)?.length,
    mimicJoints.length,
  );

  const follower = extractJointSpec(physicsLayer, 'L_thumb_intermediate_joint');
  assert.match(
    follower,
    /prepend apiSchemas = \["PhysicsJointStateAPI:angular", "PhysxJointAPI", "PhysxMimicJointAPI:rotZ"\]/,
  );
  assert.match(follower, /float physxMimicJoint:rotZ:gearing = -1\.6/);
  assert.match(follower, /float physxMimicJoint:rotZ:offset = 0/);
  assert.match(
    follower,
    /prepend rel physxMimicJoint:rotZ:referenceJoint = <\/h1_2\/joints\/L_thumb_proximal_pitch_joint>/,
  );
  assert.doesNotMatch(follower, /PhysicsDriveAPI|drive:angular:physics:/);

  const master = extractJointSpec(physicsLayer, 'L_thumb_proximal_pitch_joint');
  assert.match(master, /"PhysicsDriveAPI:angular"/);

  robot.joints.L_thumb_intermediate_joint.mimic = {
    joint: 'L_thumb_proximal_pitch_joint',
    multiplier: 1.6,
    offset: Math.PI / 6,
  };
  const offsetFollower = extractJointSpec(
    buildPhysicsLayer(robot, 'h1_2'),
    'L_thumb_intermediate_joint',
  );
  assert.match(offsetFollower, /float physxMimicJoint:rotZ:offset = -30/);

  const legacyLayer = buildPhysicsLayer(robot, 'h1_2_description', 'legacy');
  assert.doesNotMatch(legacyLayer, /PhysxMimicJointAPI|physxMimicJoint:/);
});

test('Unitree prismatic mimic preserves linear units and IsaacSim PhysX dynamics', () => {
  const robot = loadUrdf(UNITREE_DEX1_URDF);
  const follower = robot.joints.Joint1_1;
  assert.ok(follower);
  follower.mimic = { joint: 'Joint2_1', multiplier: -0.5, offset: 0.012 };
  follower.dynamics.friction = 0.4;
  follower.hardware.armature = 0.007;

  const physicsLayer = buildPhysicsLayer(robot, 'dex1_1');
  const followerSpec = extractJointSpec(physicsLayer, 'Joint1_1');

  assert.match(followerSpec, /def PhysicsPrismaticJoint "Joint1_1"/);
  assert.match(followerSpec, /uniform token physics:axis = "X"/);
  assert.match(followerSpec, /float physics:lowerLimit = -0\.02/);
  assert.match(followerSpec, /float physics:upperLimit = 0\.0245/);
  assert.match(followerSpec, /"PhysxMimicJointAPI:rotX"/);
  assert.match(followerSpec, /float physxMimicJoint:rotX:gearing = 0\.5/);
  assert.match(followerSpec, /float physxMimicJoint:rotX:offset = -0\.012/);
  assert.match(
    followerSpec,
    /prepend rel physxMimicJoint:rotX:referenceJoint = <\/dex1_1\/joints\/Joint2_1>/,
  );
  assert.match(followerSpec, /float physxJoint:jointFriction = 0\.4/);
  assert.match(followerSpec, /float physxJoint:armature = 0\.007/);
  assert.doesNotMatch(followerSpec, /PhysicsDriveAPI|drive:linear:physics:/);

  follower.mimic = { joint: 'missing_master_joint' };
  const missingMasterSpec = extractJointSpec(buildPhysicsLayer(robot, 'dex1_1'), 'Joint1_1');
  assert.doesNotMatch(missingMasterSpec, /PhysxMimicJointAPI|physxMimicJoint:/);
  assert.match(missingMasterSpec, /"PhysicsDriveAPI:linear"/);
});

test('Unitree B2W continuous joints remain unbounded revolute joints', () => {
  const robot = loadUrdf(UNITREE_B2W_URDF);
  const physicsLayer = buildPhysicsLayer(robot, 'b2w_description');

  ['FL_foot_joint', 'FR_foot_joint', 'RL_foot_joint', 'RR_foot_joint'].forEach((jointId) => {
    const jointSpec = extractJointSpec(physicsLayer, jointId);
    assert.match(jointSpec, new RegExp(`def PhysicsRevoluteJoint "${jointId}"`));
    assert.match(jointSpec, /uniform token physics:axis = "Y"/);
    assert.doesNotMatch(jointSpec, /physics:(?:lower|upper)Limit/);
    assert.match(jointSpec, /float drive:angular:physics:maxForce = 20/);
  });
});

test('joint classification matrix preserves D6 freedom, planar locks, axes, and offset frames', () => {
  const robot = createJointClassificationRobot();
  const physicsLayer = buildPhysicsLayer(robot, 'joint_matrix');

  assert.match(physicsLayer, /def PhysicsFixedJoint "fixed_joint"/);
  assert.match(physicsLayer, /def PhysicsRevoluteJoint "revolute_joint"/);
  assert.match(physicsLayer, /def PhysicsRevoluteJoint "continuous_joint"/);
  assert.match(physicsLayer, /def PhysicsPrismaticJoint "prismatic_joint"/);
  assert.match(physicsLayer, /def PhysicsJoint "floating_joint"/);
  assert.match(physicsLayer, /def PhysicsJoint "planar_joint"/);
  assert.match(physicsLayer, /def PhysicsSphericalJoint "ball_joint"/);

  const revolute = extractJointSpec(physicsLayer, 'revolute_joint');
  assert.match(revolute, /uniform token physics:axis = "Z"/);
  assert.match(revolute, /point3f physics:localPos0 = \(1, 3, 3\)/);
  assert.match(revolute, /point3f physics:localPos1 = \(1, 0, 0\)/);

  const continuous = extractJointSpec(physicsLayer, 'continuous_joint');
  assert.doesNotMatch(continuous, /physics:(?:lower|upper)Limit/);

  const planar = extractJointSpec(physicsLayer, 'planar_joint');
  assert.match(
    planar,
    /prepend apiSchemas = \["PhysicsLimitAPI:transY", "PhysicsLimitAPI:rotX", "PhysicsLimitAPI:rotZ"\]/,
  );
  assert.match(planar, /float limit:transY:physics:low = 1/);
  assert.match(planar, /float limit:transY:physics:high = -1/);
  assert.match(planar, /float limit:rotX:physics:low = 1/);
  assert.match(planar, /float limit:rotZ:physics:high = -1/);
});

const hasPythonOpenUsd =
  spawnSync('python3', ['-c', 'from pxr import Sdf'], { encoding: 'utf8' }).status === 0;

test(
  'USDA to USDC conversion preserves joint type, APIs, values, and relationships',
  { skip: !hasPythonOpenUsd },
  () => {
    const robot = loadUrdf(UNITREE_HAND_URDF);
    const physicsLayer = buildPhysicsLayer(robot, 'h1_2');
    const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'urdf-studio-usd-physics-'));
    const usdaPath = path.join(temporaryDirectory, 'h1_2_physics.usda');
    const usdcPath = path.join(temporaryDirectory, 'h1_2_physics.usdc');
    fs.writeFileSync(usdaPath, physicsLayer);

    const comparison = spawnSync(
      'python3',
      [
        '-c',
        `
import sys
from pxr import Sdf

source_path, binary_path = sys.argv[1], sys.argv[2]
source = Sdf.Layer.FindOrOpen(source_path)
assert source and source.Export(binary_path)
binary = Sdf.Layer.FindOrOpen(binary_path)
assert binary

def snapshot(layer, prim_path):
    prim = layer.GetPrimAtPath(prim_path)
    assert prim
    properties = {}
    for prop in prim.properties:
        if isinstance(prop, Sdf.RelationshipSpec):
            properties[prop.name] = (
                "relationship",
                tuple(str(path) for path in prop.targetPathList.prependedItems),
                tuple(str(path) for path in prop.targetPathList.explicitItems),
            )
        else:
            properties[prop.name] = ("attribute", str(prop.default))
    return (prim.typeName, str(prim.GetInfo("apiSchemas")), properties)

for path in (
    "/h1_2/joints/L_thumb_proximal_pitch_joint",
    "/h1_2/joints/L_thumb_intermediate_joint",
):
    assert snapshot(source, path) == snapshot(binary, path), path
`,
        usdaPath,
        usdcPath,
      ],
      { encoding: 'utf8' },
    );

    try {
      assert.equal(comparison.status, 0, comparison.stderr || comparison.stdout);
      assert.ok(fs.statSync(usdcPath).size > 0);
    } finally {
      fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  },
);
