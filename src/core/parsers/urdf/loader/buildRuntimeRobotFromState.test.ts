import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { JSDOM } from 'jsdom';

import { createPlaceholderMesh } from '@/core/loaders';
import { DEFAULT_JOINT, DEFAULT_LINK, GeometryType, JointType } from '@/types';
import { parseThreeColorWithOpacity } from '@/core/utils/color.ts';
import { parseMJCF } from '@/core/parsers/mjcf/mjcfParser.ts';
import { parseURDF } from '@/core/parsers/urdf/parser';
import { buildRuntimeRobotFromState } from './buildRuntimeRobotFromState';

type RuntimeUrdfGroup = THREE.Object3D & {
  isURDFCollider?: boolean;
  isURDFVisual?: boolean;
};

const dom = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.DOMParser = dom.window.DOMParser as typeof DOMParser;
globalThis.Document = dom.window.Document as typeof Document;
globalThis.Element = dom.window.Element as typeof Element;

function createNoopMeshLoadCb() {
  return (_path: string, _manager: THREE.LoadingManager, done: (object: THREE.Object3D | null) => void) =>
    done(null);
}

function isUrdfColliderGroup(child: THREE.Object3D): child is RuntimeUrdfGroup {
  return (child as RuntimeUrdfGroup).isURDFCollider === true;
}

function isUrdfVisualGroup(child: THREE.Object3D): child is RuntimeUrdfGroup {
  return (child as RuntimeUrdfGroup).isURDFVisual === true;
}

function toFixedColorArray(color: THREE.Color, digits = 4): number[] {
  return color.toArray().map((value) => Number(value.toFixed(digits)));
}

function decomposeWorldPose(object: THREE.Object3D): {
  position: [number, number, number];
  quaternionWxyz: [number, number, number, number];
} {
  object.updateMatrixWorld(true);
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  object.matrixWorld.decompose(position, quaternion, scale);
  return {
    position: [position.x, position.y, position.z],
    quaternionWxyz: [quaternion.w, quaternion.x, quaternion.y, quaternion.z],
  };
}

function assertTupleClose(
  actual: readonly number[],
  expected: readonly number[],
  tolerance: number,
  message: string,
): void {
  assert.equal(actual.length, expected.length, `${message}: tuple length mismatch`);
  actual.forEach((value, index) => {
    assert.ok(
      Math.abs(value - expected[index]!) <= tolerance,
      `${message}[${index}] expected ${expected[index]}, got ${value}`,
    );
  });
}

function assertQuaternionClose(
  actual: { x: number; y: number; z: number; w: number } | null | undefined,
  expected: THREE.Quaternion,
  tolerance: number,
  message: string,
): void {
  assert.ok(actual, `${message}: expected quaternion`);
  assert.ok(Math.abs(actual.x - expected.x) <= tolerance, `${message}.x expected ${expected.x}, got ${actual.x}`);
  assert.ok(Math.abs(actual.y - expected.y) <= tolerance, `${message}.y expected ${expected.y}, got ${actual.y}`);
  assert.ok(Math.abs(actual.z - expected.z) <= tolerance, `${message}.z expected ${expected.z}, got ${actual.z}`);
  assert.ok(Math.abs(actual.w - expected.w) <= tolerance, `${message}.w expected ${expected.w}, got ${actual.w}`);
}

test('buildRuntimeRobotFromState preserves link and joint hierarchy from parsed robot state', async () => {
  const robotState = parseURDF(`<?xml version="1.0"?>
<robot name="state_robot">
  <link name="base_link">
    <visual>
      <geometry>
        <box size="1 2 3" />
      </geometry>
    </visual>
  </link>
  <link name="arm_link">
    <visual>
      <geometry>
        <cylinder radius="0.25" length="1.5" />
      </geometry>
    </visual>
  </link>
  <joint name="base_to_arm" type="revolute">
    <parent link="base_link" />
    <child link="arm_link" />
    <origin xyz="0 0 1" rpy="0 0 0.5" />
    <axis xyz="0 1 0" />
    <limit lower="-1" upper="1" effort="2" velocity="3" />
  </joint>
</robot>`);

  assert.ok(robotState, 'expected parsed robot state');

  const robot = await buildRuntimeRobotFromState({
    robotName: robotState.name,
    links: robotState.links,
    joints: robotState.joints,
    manager: new THREE.LoadingManager(),
    loadMeshCb: (_path, _manager, done) => done(null),
  });

  assert.equal(robot.robotName, 'state_robot');
  assert.deepEqual(Object.keys(robot.links).sort(), ['arm_link', 'base_link']);
  assert.deepEqual(Object.keys(robot.joints), ['base_to_arm']);
  assert.equal(robot.children.length, 1);
  assert.equal(robot.children[0], robot.links.base_link);

  const joint = robot.joints.base_to_arm as THREE.Object3D & {
    axis: THREE.Vector3;
    child?: THREE.Object3D;
    limit?: { lower?: number; upper?: number; effort?: number; velocity?: number };
  };
  assert.equal(joint.parent, robot.links.base_link);
  assert.equal(joint.children[0], robot.links.arm_link);
  assert.equal(joint.child, robot.links.arm_link);
  assert.deepEqual(joint.axis.toArray(), [0, 1, 0]);
  assert.equal(joint.limit?.lower, -1);
  assert.equal(joint.limit?.upper, 1);
  assert.equal(joint.limit?.effort, 2);
  assert.equal(joint.limit?.velocity, 3);
});

test('buildRuntimeRobotFromState preserves authored joint names when runtime ids differ', async () => {
  const robot = await buildRuntimeRobotFromState({
    robotName: 'state_robot',
    links: {
      base_link: {
        ...DEFAULT_LINK,
        id: 'base_link',
        name: 'base_link',
      },
      child_link_1743499999999: {
        ...DEFAULT_LINK,
        id: 'child_link_1743499999999',
        name: 'link_1',
      },
    },
    joints: {
      joint_1743499999999: {
        ...DEFAULT_JOINT,
        id: 'joint_1743499999999',
        name: 'joint_1',
        type: JointType.REVOLUTE,
        parentLinkId: 'base_link',
        childLinkId: 'child_link_1743499999999',
        origin: {
          xyz: { x: 0, y: 0, z: 0 },
          rpy: { r: 0, p: 0, y: 0 },
        },
        axis: { x: 0, y: 0, z: 1 },
        limit: { lower: -1, upper: 1, effort: 2, velocity: 3 },
      },
    },
    manager: new THREE.LoadingManager(),
    loadMeshCb: (_path, _manager, done) => done(null),
  });

  const joint = robot.joints.joint_1743499999999 as THREE.Object3D & {
    urdfName?: string;
    userData: {
      displayName?: string;
      jointId?: string;
    };
  };

  assert.equal(joint.name, 'joint_1');
  assert.equal(joint.urdfName, 'joint_1');
  assert.equal(joint.userData.displayName, 'joint_1');
  assert.equal(joint.userData.jointId, 'joint_1743499999999');
});

test('buildRuntimeRobotFromState exposes MJCF sites and tendons from RobotState metadata', async () => {
  const robot = await buildRuntimeRobotFromState({
    robotName: 'mjcf_metadata_robot',
    links: {
      world: {
        ...DEFAULT_LINK,
        id: 'world',
        name: 'world',
        mjcfSites: [
          {
            name: 'anchor_site',
            sourceName: 'anchor_site',
            type: 'sphere',
            size: [0.015],
            rgba: [1, 0, 0, 1],
            pos: [0.1, 0.2, 0.3],
          },
        ],
      },
    },
    joints: {},
    manager: new THREE.LoadingManager(),
    loadMeshCb: (_path, _manager, done) => done(null),
    inspectionContext: {
      sourceFormat: 'mjcf',
      mjcf: {
        siteCount: 1,
        tendonCount: 1,
        tendonActuatorCount: 0,
        bodiesWithSites: [{ bodyId: 'world', siteCount: 1, siteNames: ['anchor_site'] }],
        tendons: [
          {
            name: 'main_tendon',
            type: 'spatial',
            attachmentRefs: ['anchor_site', 'anchor_site'],
            attachments: [
              { type: 'site', ref: 'anchor_site' },
              { type: 'site', ref: 'anchor_site' },
            ],
            actuatorNames: [],
            rgba: [0, 1, 0, 1],
            width: 0.004,
          },
        ],
      },
    },
  });

  assert.deepEqual(robot.links.world.userData.__mjcfSitesData, [
    {
      name: 'anchor_site',
      sourceName: 'anchor_site',
      type: 'sphere',
      size: [0.015],
      rgba: [1, 0, 0, 1],
      pos: [0.1, 0.2, 0.3],
    },
  ]);
  assert.deepEqual(robot.userData.__mjcfTendonsData, [
    {
      name: 'main_tendon',
      rgba: [0, 1, 0, 1],
      attachmentRefs: ['anchor_site', 'anchor_site'],
      attachments: [
        { type: 'site', ref: 'anchor_site' },
        { type: 'site', ref: 'anchor_site' },
      ],
      width: 0.004,
    },
  ]);
});

test('buildRuntimeRobotFromState labels RobotState geometry groups for MJCF tendon wrap anchors', async () => {
  const robot = await buildRuntimeRobotFromState({
    robotName: 'mjcf_wrap_geometry_robot',
    links: {
      world: {
        ...DEFAULT_LINK,
        id: 'world',
        name: 'world',
        collision: {
          ...DEFAULT_LINK.collision,
          name: 'wrap_geom',
          type: GeometryType.SPHERE,
          dimensions: { x: 0.02, y: 0, z: 0 },
          origin: {
            xyz: { x: 0.1, y: 0.2, z: 0.3 },
            rpy: { r: 0, p: 0, y: 0 },
          },
        },
      },
    },
    joints: {},
    manager: new THREE.LoadingManager(),
    loadMeshCb: createNoopMeshLoadCb(),
  });

  const wrapGeometry = robot.links.world.children.find(
    (child) => child.userData?.geometryName === 'wrap_geom',
  );
  assert.ok(wrapGeometry);
  assert.equal(wrapGeometry.userData.geometryRole, 'collision');
  assert.equal(wrapGeometry.userData.geometryType, GeometryType.SPHERE);
  assert.deepEqual(wrapGeometry.userData.geometryDimensions, { x: 0.02, y: 0, z: 0 });
  assert.deepEqual(wrapGeometry.position.toArray(), [0.1, 0.2, 0.3]);
});

test('buildRuntimeRobotFromState applies RobotState joint angles to runtime joints', async () => {
  const robot = await buildRuntimeRobotFromState({
    robotName: 'joint_angle_robot',
    links: {
      base_link: {
        ...DEFAULT_LINK,
        id: 'base_link',
        name: 'base_link',
      },
      child_link: {
        ...DEFAULT_LINK,
        id: 'child_link',
        name: 'child_link',
      },
    },
    joints: {
      hip_joint: {
        ...DEFAULT_JOINT,
        id: 'hip_joint',
        name: 'hip_joint',
        type: JointType.REVOLUTE,
        parentLinkId: 'base_link',
        childLinkId: 'child_link',
        axis: { x: 0, y: 0, z: 1 },
        angle: 0.45,
      },
    },
    manager: new THREE.LoadingManager(),
    loadMeshCb: (_path, _manager, done) => done(null),
  });

  const joint = robot.joints.hip_joint as { angle?: number; jointValue?: number[] };

  assert.equal(joint.angle, 0.45);
  assert.deepEqual(joint.jointValue, [0.45]);
});

test('buildRuntimeRobotFromState treats RobotState joint angles as actual positions relative to referencePosition', async () => {
  const referencePosition = Math.PI / 4;
  const actualAngle = referencePosition + 0.2;
  const robot = await buildRuntimeRobotFromState({
    robotName: 'joint_reference_robot',
    links: {
      base_link: {
        ...DEFAULT_LINK,
        id: 'base_link',
        name: 'base_link',
      },
      child_link: {
        ...DEFAULT_LINK,
        id: 'child_link',
        name: 'child_link',
      },
    },
    joints: {
      hip_joint: {
        ...DEFAULT_JOINT,
        id: 'hip_joint',
        name: 'hip_joint',
        type: JointType.REVOLUTE,
        parentLinkId: 'base_link',
        childLinkId: 'child_link',
        axis: { x: 0, y: 0, z: 1 },
        referencePosition,
        angle: actualAngle,
      },
    },
    manager: new THREE.LoadingManager(),
    loadMeshCb: createNoopMeshLoadCb(),
  });

  const joint = robot.joints.hip_joint as { jointValue?: number[] };

  assert.ok(joint.jointValue);
  assert.ok(Math.abs((joint.jointValue[0] ?? Number.NaN) - 0.2) <= 1e-12);
});

test('buildRuntimeRobotFromState exposes referenced joint limits in runtime motion space', async () => {
  const referencePosition = 0.4;
  const robot = await buildRuntimeRobotFromState({
    robotName: 'joint_reference_limit_robot',
    links: {
      base_link: {
        ...DEFAULT_LINK,
        id: 'base_link',
        name: 'base_link',
      },
      child_link: {
        ...DEFAULT_LINK,
        id: 'child_link',
        name: 'child_link',
      },
    },
    joints: {
      hip_joint: {
        ...DEFAULT_JOINT,
        id: 'hip_joint',
        name: 'hip_joint',
        type: JointType.REVOLUTE,
        parentLinkId: 'base_link',
        childLinkId: 'child_link',
        axis: { x: 0, y: 0, z: 1 },
        referencePosition,
        angle: referencePosition,
        limit: { lower: -0.2, upper: 1.2, effort: 1, velocity: 1 },
      },
    },
    manager: new THREE.LoadingManager(),
    loadMeshCb: createNoopMeshLoadCb(),
  });

  const joint = robot.joints.hip_joint as {
    jointValue?: number[];
    limit: { lower: number; upper: number };
    setJointValue: (value: number) => boolean;
  };

  assert.ok(Math.abs(joint.limit.lower + 0.6) <= 1e-12);
  assert.ok(Math.abs(joint.limit.upper - 0.8) <= 1e-12);

  joint.setJointValue(0.9);
  assert.ok(Math.abs((joint.jointValue?.[0] ?? Number.NaN) - 0.8) <= 1e-12);
});

test('buildRuntimeRobotFromState keeps scalar joints unbounded without finite bound pairs', async () => {
  const robot = await buildRuntimeRobotFromState({
    robotName: 'continuous_joint_robot',
    links: {
      base_link: { ...DEFAULT_LINK, id: 'base_link', name: 'base_link' },
      wheel_link: { ...DEFAULT_LINK, id: 'wheel_link', name: 'wheel_link' },
      slider_link: { ...DEFAULT_LINK, id: 'slider_link', name: 'slider_link' },
    },
    joints: {
      wheel_joint: {
        ...DEFAULT_JOINT,
        id: 'wheel_joint',
        name: 'wheel_joint',
        type: JointType.REVOLUTE,
        parentLinkId: 'base_link',
        childLinkId: 'wheel_link',
        axis: { x: 0, y: 0, z: 1 },
        limit: { effort: 12, velocity: 8 },
      },
      slider_joint: {
        ...DEFAULT_JOINT,
        id: 'slider_joint',
        name: 'slider_joint',
        type: JointType.PRISMATIC,
        parentLinkId: 'wheel_link',
        childLinkId: 'slider_link',
        axis: { x: 1, y: 0, z: 0 },
        limit: { velocity: 2 },
      },
    },
    manager: new THREE.LoadingManager(),
    loadMeshCb: createNoopMeshLoadCb(),
  });

  const joint = robot.joints.wheel_joint as {
    ignoreLimits: boolean;
    jointValue?: number[];
    limit: { effort?: number; velocity?: number };
    setJointValue: (value: number) => boolean;
  };
  assert.equal(joint.ignoreLimits, true);
  assert.equal(joint.limit.effort, 12);
  assert.equal(joint.limit.velocity, 8);
  joint.setJointValue(4);
  assert.equal(joint.jointValue?.[0], 4);

  const clonedJoint = (robot.joints.wheel_joint.clone() as typeof joint);
  assert.equal(clonedJoint.ignoreLimits, true);
  clonedJoint.setJointValue(5);
  assert.equal(clonedJoint.jointValue?.[0], 5);

  const sliderJoint = robot.joints.slider_joint as typeof joint;
  assert.equal(sliderJoint.ignoreLimits, true);
  assert.equal(sliderJoint.limit.velocity, 2);
  sliderJoint.setJointValue(3);
  assert.equal(sliderJoint.jointValue?.[0], 3);
});

test('buildRuntimeRobotFromState orders crossed finite limits before runtime clamping', async () => {
  const robot = await buildRuntimeRobotFromState({
    robotName: 'crossed_limit_robot',
    links: {
      base_link: {
        ...DEFAULT_LINK,
        id: 'base_link',
        name: 'base_link',
      },
      child_link: {
        ...DEFAULT_LINK,
        id: 'child_link',
        name: 'child_link',
      },
    },
    joints: {
      elbow_joint: {
        ...DEFAULT_JOINT,
        id: 'elbow_joint',
        name: 'elbow_joint',
        type: JointType.REVOLUTE,
        parentLinkId: 'base_link',
        childLinkId: 'child_link',
        axis: { x: 0, y: 0, z: 1 },
        limit: { lower: 2, upper: 1, effort: 1, velocity: 1 },
      },
    },
    manager: new THREE.LoadingManager(),
    loadMeshCb: createNoopMeshLoadCb(),
  });

  const joint = robot.joints.elbow_joint as {
    angle: number;
    limit: { lower: number; upper: number };
    setJointValue: (value: number) => boolean;
  };

  assert.equal(joint.limit.lower, 1);
  assert.equal(joint.limit.upper, 2);

  joint.setJointValue(1.5);
  assert.equal(joint.angle, 1.5);
});

test('buildRuntimeRobotFromState applies RobotState ball joint quaternion as motion relative to joint origin', async () => {
  const originRpy = { r: 0.2, p: -0.15, y: 0.35 };
  const motionQuaternion = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0.2, 0.7, -0.1).normalize(),
    0.6,
  );

  const robot = await buildRuntimeRobotFromState({
    robotName: 'ball_joint_state_robot',
    links: {
      base_link: {
        ...DEFAULT_LINK,
        id: 'base_link',
        name: 'base_link',
      },
      child_link: {
        ...DEFAULT_LINK,
        id: 'child_link',
        name: 'child_link',
      },
    },
    joints: {
      ball_joint: {
        ...DEFAULT_JOINT,
        id: 'ball_joint',
        name: 'ball_joint',
        type: JointType.BALL,
        parentLinkId: 'base_link',
        childLinkId: 'child_link',
        origin: {
          xyz: { x: 0.1, y: -0.2, z: 0.3 },
          rpy: originRpy,
        },
        quaternion: {
          x: motionQuaternion.x,
          y: motionQuaternion.y,
          z: motionQuaternion.z,
          w: motionQuaternion.w,
        },
      },
    },
    manager: new THREE.LoadingManager(),
    loadMeshCb: createNoopMeshLoadCb(),
  });

  const joint = robot.joints.ball_joint as THREE.Object3D & {
    jointQuaternion?: THREE.Quaternion;
    setJointQuaternion?: (quaternion: { x: number; y: number; z: number; w: number }) => void;
  };
  const originQuaternion = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(originRpy.r, originRpy.p, originRpy.y, 'ZYX'),
  );

  assert.equal(typeof joint.setJointQuaternion, 'function');
  assertQuaternionClose(joint.jointQuaternion, motionQuaternion, 1e-12, 'stored motion quaternion');
  assertQuaternionClose(
    joint.quaternion,
    originQuaternion.clone().multiply(motionQuaternion),
    1e-12,
    'joint local quaternion',
  );

  const nextMotionQuaternion = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(-0.3, 0.4, 0.5).normalize(),
    -0.25,
  );
  joint.setJointQuaternion?.({
    x: nextMotionQuaternion.x,
    y: nextMotionQuaternion.y,
    z: nextMotionQuaternion.z,
    w: nextMotionQuaternion.w,
  });

  assertQuaternionClose(
    joint.jointQuaternion,
    nextMotionQuaternion,
    1e-12,
    'updated stored motion quaternion',
  );
  assertQuaternionClose(
    joint.quaternion,
    originQuaternion.clone().multiply(nextMotionQuaternion),
    1e-12,
    'updated joint local quaternion',
  );
});

test('buildRuntimeRobotFromState matches Cassie solved home keyframe pose for referenced closed-loop links', async () => {
  const xml = fs.readFileSync('test/mujoco_menagerie-main/agility_cassie/cassie.xml', 'utf8');
  const robotState = parseMJCF(xml);
  assert.ok(robotState, 'expected Cassie MJCF fixture to parse');

  const robot = await buildRuntimeRobotFromState({
    robotName: robotState.name,
    links: robotState.links,
    joints: robotState.joints,
    materials: robotState.materials,
    manager: new THREE.LoadingManager(),
    loadMeshCb: createNoopMeshLoadCb(),
    parseVisual: false,
    parseCollision: false,
    rootLinkId: robotState.rootLinkId,
  });
  robot.updateMatrixWorld(true);

  const expectedWorldPositions = {
    'left-shin': [0.005232061, 0.13172577, 0.733501836],
    'left-tarsus': [-0.261057309, 0.133274726, 0.389257984],
    'left-foot-crank': [-0.248328989, 0.110821994, 0.323141214],
    'left-plantar-rod': [-0.286542704, 0.1189099, 0.283620766],
    'left-foot': [-0.021871553, 0.134772839, 0.05631365],
    'left-achilles-rod': [-0.049, 0.090405415, 0.915728532],
    'left-heel-spring': [-0.29241532, 0.132402664, 0.378602221],
    'right-shin': [0.005232061, -0.13172577, 0.733501836],
    'right-tarsus': [-0.2610575, -0.133274726, 0.389258131],
    'right-foot-crank': [-0.248329258, -0.110821994, 0.323141347],
    'right-plantar-rod': [-0.28654302, -0.1189099, 0.283620944],
    'right-foot': [-0.02187214, -0.13477284, 0.056313513],
    'right-achilles-rod': [-0.049, -0.090405415, 0.915728532],
    'right-heel-spring': [-0.292415523, -0.132402663, 0.378602406],
  } satisfies Record<string, [number, number, number]>;

  Object.entries(expectedWorldPositions).forEach(([linkId, expectedPosition]) => {
    const link = robot.links[linkId];
    assert.ok(link, `expected runtime link ${linkId}`);
    const pose = decomposeWorldPose(link);
    assertTupleClose(pose.position, expectedPosition, 1e-6, `${linkId} world position`);
  });
});

test('buildRuntimeRobotFromState renders mirrored MJCF mesh visuals double-sided', async () => {
  const mirroredMesh = new THREE.Mesh(
    new THREE.BufferGeometry().setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3),
    ),
    new THREE.MeshBasicMaterial({ side: THREE.FrontSide }),
  );

  const robot = await buildRuntimeRobotFromState({
    robotName: 'mirrored_mesh_robot',
    links: {
      base_link: {
        ...DEFAULT_LINK,
        id: 'base_link',
        name: 'base_link',
        visual: {
          ...DEFAULT_LINK.visual,
          type: GeometryType.MESH,
          meshPath: 'mirrored.obj',
          dimensions: { x: 1, y: 1, z: -1 },
        },
      },
    },
    joints: {},
    manager: new THREE.LoadingManager(),
    loadMeshCb: (_path, _manager, done) => done(mirroredMesh),
  });

  const loadedMesh = robot.links.base_link.getObjectByProperty('isMesh', true) as THREE.Mesh;
  assert.ok(loadedMesh, 'expected mirrored mesh to load');
  assert.equal((loadedMesh.material as THREE.Material).side, THREE.DoubleSide);
});

test('buildRuntimeRobotFromState renders collision boxes as boxes', async () => {
  const robot = await buildRuntimeRobotFromState({
    robotName: 'collision_box_display_robot',
    links: {
      base_link: {
        ...DEFAULT_LINK,
        id: 'base_link',
        name: 'base_link',
        visual: {
          ...DEFAULT_LINK.visual,
          type: GeometryType.NONE,
          dimensions: { x: 0, y: 0, z: 0 },
        },
        collision: {
          ...DEFAULT_LINK.collision,
          type: GeometryType.BOX,
          dimensions: { x: 0.2, y: 0.4, z: 1.2 },
        },
      },
    },
    joints: {},
    manager: new THREE.LoadingManager(),
    loadMeshCb: (_path, _manager, done) => done(null),
  });

  const baseLink = robot.links.base_link as THREE.Object3D | undefined;
  assert.ok(baseLink, 'expected base link');

  const collisionGroup = baseLink.children.find(isUrdfColliderGroup);
  assert.ok(collisionGroup, 'expected collision group');
  assert.equal(collisionGroup.children.length, 1);

  const collisionMesh = collisionGroup.children[0] as THREE.Mesh;
  assert.equal(collisionMesh.geometry.type, 'BoxGeometry');
  assert.deepEqual(
    collisionMesh.scale.toArray().map((value) => Number(value.toFixed(4))),
    [0.2, 0.4, 1.2],
  );
  assert.equal(Number(collisionMesh.rotation.x.toFixed(4)), 0);
  assert.equal(Number(collisionMesh.rotation.y.toFixed(4)), 0);
  assert.equal(Number(collisionMesh.rotation.z.toFixed(4)), 0);
});

test('buildRuntimeRobotFromState applies mesh scale and visual color overrides on state-built meshes', async () => {
  const manager = new THREE.LoadingManager();

  const robotState = {
    name: 'mesh_robot',
    rootLinkId: 'base_link',
    links: {
      base_link: {
        ...DEFAULT_LINK,
        id: 'base_link',
        name: 'base_link',
        visual: {
          ...DEFAULT_LINK.visual,
          type: GeometryType.MESH,
          meshPath: 'meshes/base_link.obj',
          dimensions: { x: 2, y: 3, z: 4 },
          color: '#12ab34',
        },
        collision: {
          ...DEFAULT_LINK.collision,
          type: GeometryType.NONE,
          dimensions: { x: 0, y: 0, z: 0 },
        },
      },
    },
    joints: {},
  };

  let robot: Awaited<ReturnType<typeof buildRuntimeRobotFromState>> | null = null as Awaited<ReturnType<typeof buildRuntimeRobotFromState>> | null;
  const ready = new Promise<void>((resolve) => {
    manager.onLoad = () => resolve();
  });

  const completionKey = '__build_runtime_robot_from_state_test__';
  manager.itemStart(completionKey);
  try {
    robot = await buildRuntimeRobotFromState({
      robotName: robotState.name,
      links: robotState.links,
      joints: robotState.joints,
      manager,
      loadMeshCb: (_path, _manager, done) => {
        const mesh = new THREE.Mesh(
          new THREE.BoxGeometry(1, 1, 1),
          new THREE.MeshPhongMaterial({ color: new THREE.Color('#ffffff') }),
        );
        done(mesh);
      },
    });
  } finally {
    manager.itemEnd(completionKey);
  }

  await ready;

  const baseLink = robot?.links.base_link;
  assert.ok(baseLink, 'expected base link');

  const visualGroup = baseLink.children.find(isUrdfVisualGroup);
  assert.ok(visualGroup, 'expected visual group');
  assert.deepEqual(visualGroup.scale.toArray(), [2, 3, 4]);
  assert.equal(visualGroup.children.length, 1);

  const mesh = visualGroup.children[0] as THREE.Mesh;
  assert.ok(mesh.isMesh, 'expected built mesh');

  const material = mesh.material as THREE.MeshStandardMaterial;
  const parsedColor = parseThreeColorWithOpacity('#12ab34');
  assert.ok(parsedColor, 'expected parsed override color');
  assert.deepEqual(toFixedColorArray(material.color), toFixedColorArray(parsedColor.color));
});

test('buildRuntimeRobotFromState preserves single MTL-authored mesh materials without URDF overrides', async () => {
  const robot = await buildRuntimeRobotFromState({
    robotName: 'obj_mtl_robot',
    links: {
      base_link: {
        ...DEFAULT_LINK,
        id: 'base_link',
        name: 'base_link',
        visual: {
          ...DEFAULT_LINK.visual,
          type: GeometryType.MESH,
          meshPath: 'meshes/body.obj',
          dimensions: { x: 1, y: 1, z: 1 },
          color: '',
        },
        collision: {
          ...DEFAULT_LINK.collision,
          type: GeometryType.NONE,
          dimensions: { x: 0, y: 0, z: 0 },
        },
      },
    },
    joints: {},
    manager: new THREE.LoadingManager(),
    loadMeshCb: (_path, _manager, done) => {
      const material = new THREE.MeshPhongMaterial({ color: new THREE.Color('#ff0000') });
      material.name = 'PaintedRed';
      done(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material));
    },
  });

  const visualGroup = robot.links.base_link.children.find(isUrdfVisualGroup);
  assert.ok(visualGroup, 'expected visual group');

  const mesh = visualGroup.children[0] as THREE.Mesh;
  assert.ok(mesh.isMesh, 'expected loaded mesh');
  const material = mesh.material as THREE.MeshPhongMaterial;
  assert.equal(material.name, 'PaintedRed');
  assert.deepEqual(toFixedColorArray(material.color), [1, 0, 0]);
});

test('buildRuntimeRobotFromState applies visual material alpha from colorRgba', async () => {
  const robot = await buildRuntimeRobotFromState({
    robotName: 'transparent_state_robot',
    links: {
      base_link: {
        ...DEFAULT_LINK,
        id: 'base_link',
        name: 'base_link',
        visual: {
          ...DEFAULT_LINK.visual,
          type: GeometryType.BOX,
          dimensions: { x: 1, y: 1, z: 1 },
          color: '#19334c',
          authoredMaterials: [
            {
              name: 'transparent_paint',
              color: '#19334c',
              colorRgba: [0.1, 0.2, 0.3, 0.4],
            },
          ],
        },
        collision: {
          ...DEFAULT_LINK.collision,
          type: GeometryType.NONE,
          dimensions: { x: 0, y: 0, z: 0 },
        },
      },
    },
    joints: {},
    manager: new THREE.LoadingManager(),
    loadMeshCb: createNoopMeshLoadCb(),
  });

  const baseLink = robot.links.base_link;
  const visualGroup = baseLink.children.find(isUrdfVisualGroup);
  assert.ok(visualGroup, 'expected visual group');
  const mesh = visualGroup.children[0] as THREE.Mesh;
  assert.ok(mesh.isMesh, 'expected primitive visual mesh');

  const material = mesh.material as THREE.MeshStandardMaterial;
  assert.ok(Math.abs(material.opacity - 0.4) <= 1e-6);
  assert.equal(material.transparent, true);
});

test('buildRuntimeRobotFromState applies paint material groups to primitive box visuals', async () => {
  const robot = await buildRuntimeRobotFromState({
    robotName: 'painted_primitive_robot',
    links: {
      base_link: {
        ...DEFAULT_LINK,
        id: 'base_link',
        name: 'base_link',
        visual: {
          ...DEFAULT_LINK.visual,
          type: GeometryType.BOX,
          dimensions: { x: 1, y: 1, z: 1 },
          color: '#808080',
          authoredMaterials: [
            { name: 'base', color: '#808080' },
            { name: 'paint_base_link_0_1', color: '#3366ff' },
          ],
          meshMaterialGroups: [
            { meshKey: '0', start: 0, count: 6, materialIndex: 1 },
            { meshKey: '0', start: 6, count: 30, materialIndex: 0 },
          ],
        },
        collision: {
          ...DEFAULT_LINK.collision,
          type: GeometryType.NONE,
          dimensions: { x: 0, y: 0, z: 0 },
        },
      },
    },
    joints: {},
    manager: new THREE.LoadingManager(),
    loadMeshCb: createNoopMeshLoadCb(),
  });

  const visualGroup = robot.links.base_link.children.find(isUrdfVisualGroup);
  assert.ok(visualGroup, 'expected visual group');

  const mesh = visualGroup.children[0] as THREE.Mesh;
  assert.ok(mesh.isMesh, 'expected primitive visual mesh');
  assert.ok(Array.isArray(mesh.material), 'painted primitive should use material slots');
  if (!Array.isArray(mesh.material)) {
    assert.fail('painted primitive should use material slots');
  }

  assert.equal(mesh.material.length, 2);
  assert.equal((mesh.material[0] as THREE.MeshStandardMaterial).color.getHexString(), '808080');
  assert.equal((mesh.material[1] as THREE.MeshStandardMaterial).color.getHexString(), '3366ff');
  assert.deepEqual(
    mesh.geometry.groups.map(({ start, count, materialIndex }) => ({
      start,
      count,
      materialIndex,
    })),
    [
      { start: 0, count: 6, materialIndex: 1 },
      { start: 6, count: 30, materialIndex: 0 },
    ],
  );
});

test('buildRuntimeRobotFromState applies double-sided rendering to marked visual meshes', async () => {
  const manager = new THREE.LoadingManager();
  const robotState = {
    name: 'usd_prepared_mesh_robot',
    rootLinkId: 'base_link',
    links: {
      base_link: {
        ...DEFAULT_LINK,
        id: 'base_link',
        name: 'base_link',
        visual: {
          ...DEFAULT_LINK.visual,
          type: GeometryType.MESH,
          meshPath: 'base_link_visual_0.obj',
          doubleSided: true,
        },
        collision: {
          ...DEFAULT_LINK.collision,
          type: GeometryType.NONE,
          dimensions: { x: 0, y: 0, z: 0 },
        },
      },
    },
    joints: {},
  };

  let robot: Awaited<ReturnType<typeof buildRuntimeRobotFromState>> | null = null as Awaited<ReturnType<typeof buildRuntimeRobotFromState>> | null;
  const ready = new Promise<void>((resolve) => {
    manager.onLoad = () => resolve();
  });
  const completionKey = '__build_runtime_robot_from_state_double_sided_test__';
  manager.itemStart(completionKey);
  try {
    robot = await buildRuntimeRobotFromState({
      robotName: robotState.name,
      links: robotState.links,
      joints: robotState.joints,
      manager,
      loadMeshCb: (_path, _manager, done) => {
        const mesh = new THREE.Mesh(
          new THREE.BoxGeometry(1, 1, 1),
          new THREE.MeshPhongMaterial({
            color: new THREE.Color('#ffffff'),
            side: THREE.FrontSide,
          }),
        );
        done(mesh);
      },
    });
  } finally {
    manager.itemEnd(completionKey);
  }

  await ready;

  const visualGroup = robot?.links.base_link.children.find(isUrdfVisualGroup);
  assert.ok(visualGroup, 'expected visual group');

  const mesh = visualGroup.children[0] as THREE.Mesh;
  assert.ok(mesh.isMesh, 'expected loaded mesh');
  assert.equal((mesh.material as THREE.Material).side, THREE.DoubleSide);
});

test('buildRuntimeRobotFromState applies authored texture overrides onto loaded mesh materials', async () => {
  const originalTextureLoad = THREE.TextureLoader.prototype.load;
  const appliedTexture = new THREE.Texture();
  const requestedTexturePaths: string[] = [];

  THREE.TextureLoader.prototype.load = function mockTextureLoad(
    url: string,
    onLoad?: (texture: THREE.Texture<HTMLImageElement>) => void,
  ) {
    requestedTexturePaths.push(url);
    const texture = appliedTexture as THREE.Texture<HTMLImageElement>;
    onLoad?.(texture);
    return texture;
  };

  try {
    const manager = new THREE.LoadingManager();
    const robotState = {
      name: 'textured_mesh_robot',
      rootLinkId: 'base_link',
      links: {
        base_link: {
          ...DEFAULT_LINK,
          id: 'base_link',
          name: 'base_link',
          visual: {
            ...DEFAULT_LINK.visual,
            type: GeometryType.MESH,
            meshPath: 'meshes/base_link.obj',
            authoredMaterials: [{ texture: 'textures/coat.png' }],
          },
          collision: {
            ...DEFAULT_LINK.collision,
            type: GeometryType.NONE,
            dimensions: { x: 0, y: 0, z: 0 },
          },
        },
      },
      joints: {},
    };

    let robot: Awaited<ReturnType<typeof buildRuntimeRobotFromState>> | null = null as Awaited<ReturnType<typeof buildRuntimeRobotFromState>> | null;
    const ready = new Promise<void>((resolve) => {
      manager.onLoad = () => resolve();
    });
    const completionKey = '__build_runtime_robot_from_state_texture_override_test__';
    manager.itemStart(completionKey);

    try {
      robot = await buildRuntimeRobotFromState({
        robotName: robotState.name,
        links: robotState.links,
        joints: robotState.joints,
        manager,
        loadMeshCb: (_path, _manager, done) => {
          const embeddedTexture = new THREE.Texture();
          const mesh = new THREE.Mesh(
            new THREE.BoxGeometry(1, 1, 1),
            new THREE.MeshPhongMaterial({
              color: new THREE.Color('#444444'),
              map: embeddedTexture,
            }),
          );
          done(mesh);
        },
      });
    } finally {
      manager.itemEnd(completionKey);
    }

    await ready;

    const baseLink = robot?.links.base_link;
    assert.ok(baseLink, 'expected textured base link');

    const visualGroup = baseLink.children.find(isUrdfVisualGroup);
    assert.ok(visualGroup, 'expected visual group');
    assert.equal(visualGroup.children.length, 1);

    const mesh = visualGroup.children[0] as THREE.Mesh;
    assert.ok(mesh.isMesh, 'expected loaded mesh');
    assert.deepEqual(requestedTexturePaths, ['textures/coat.png']);
    assert.equal(mesh.material instanceof THREE.MeshStandardMaterial, true);
    if (!(mesh.material instanceof THREE.MeshStandardMaterial)) {
      assert.fail('expected texture override to rebuild the mesh material');
    }

    assert.equal(mesh.material.map, appliedTexture);
    assert.notEqual(mesh.material.color.getHexString(), '444444');
    assert.equal(mesh.material.userData.urdfTextureApplied, true);
    assert.equal(mesh.material.userData.urdfTexturePath, 'textures/coat.png');
  } finally {
    THREE.TextureLoader.prototype.load = originalTextureLoad;
  }
});

test('buildRuntimeRobotFromState applies link-level RobotData materials to state-built meshes', async () => {
  const originalTextureLoad = THREE.TextureLoader.prototype.load;
  const appliedTexture = new THREE.Texture();
  const requestedTexturePaths: string[] = [];

  THREE.TextureLoader.prototype.load = function mockTextureLoad(
    url: string,
    onLoad?: (texture: THREE.Texture<HTMLImageElement>) => void,
  ) {
    requestedTexturePaths.push(url);
    const texture = appliedTexture as THREE.Texture<HTMLImageElement>;
    onLoad?.(texture);
    return texture;
  };

  try {
    const manager = new THREE.LoadingManager();
    const robotState = {
      name: 'usd_prepared_material_robot',
      rootLinkId: 'base_link',
      links: {
        base_link: {
          ...DEFAULT_LINK,
          id: 'base_link',
          name: 'base_link',
          visual: {
            ...DEFAULT_LINK.visual,
            type: GeometryType.MESH,
            meshPath: 'base_link_visual_0.obj',
          },
          collision: {
            ...DEFAULT_LINK.collision,
            type: GeometryType.NONE,
            dimensions: { x: 0, y: 0, z: 0 },
          },
        },
      },
      joints: {},
      materials: {
        base_link: {
          color: '#102030',
          texture: 'textures/base_color.png',
        },
      },
    };

    let robot: Awaited<ReturnType<typeof buildRuntimeRobotFromState>> | null = null as Awaited<ReturnType<typeof buildRuntimeRobotFromState>> | null;
    const ready = new Promise<void>((resolve) => {
      manager.onLoad = () => resolve();
    });
    const completionKey = '__build_runtime_robot_from_state_robot_material_test__';
    manager.itemStart(completionKey);

    try {
      robot = await buildRuntimeRobotFromState({
        robotName: robotState.name,
        links: robotState.links,
        joints: robotState.joints,
        materials: robotState.materials,
        manager,
        loadMeshCb: (_path, _manager, done) => {
          const mesh = new THREE.Mesh(
            new THREE.BoxGeometry(1, 1, 1),
            new THREE.MeshPhongMaterial({ color: new THREE.Color('#ffffff') }),
          );
          done(mesh);
        },
      });
    } finally {
      manager.itemEnd(completionKey);
    }

    await ready;

    const visualGroup = robot?.links.base_link.children.find(isUrdfVisualGroup);
    assert.ok(visualGroup, 'expected visual group');

    const mesh = visualGroup.children[0] as THREE.Mesh;
    assert.ok(mesh.isMesh, 'expected loaded mesh');
    assert.deepEqual(requestedTexturePaths, ['textures/base_color.png']);
    assert.equal(mesh.material instanceof THREE.MeshStandardMaterial, true);
    if (!(mesh.material instanceof THREE.MeshStandardMaterial)) {
      assert.fail('expected link material override to rebuild the mesh material');
    }

    const parsedColor = parseThreeColorWithOpacity('#102030');
    assert.ok(parsedColor, 'expected parsed material color');
    assert.deepEqual(toFixedColorArray(mesh.material.color), toFixedColorArray(parsedColor.color));
    assert.equal(mesh.material.map, appliedTexture);
    assert.equal(mesh.material.userData.urdfTextureApplied, true);
    assert.equal(mesh.material.userData.urdfTexturePath, 'textures/base_color.png');
  } finally {
    THREE.TextureLoader.prototype.load = originalTextureLoad;
  }
});

test('buildRuntimeRobotFromState keeps Cassie MJCF texture-only materials neutral white', async () => {
  const originalTextureLoad = THREE.TextureLoader.prototype.load;
  const appliedTexture = new THREE.Texture();
  const requestedTexturePaths: string[] = [];

  THREE.TextureLoader.prototype.load = function mockTextureLoad(
    url: string,
    onLoad?: (texture: THREE.Texture<HTMLImageElement>) => void,
  ) {
    requestedTexturePaths.push(url);
    const texture = appliedTexture as THREE.Texture<HTMLImageElement>;
    onLoad?.(texture);
    return texture;
  };

  try {
    const xml = fs.readFileSync('test/mujoco_menagerie-main/agility_cassie/cassie.xml', 'utf8');
    const robotState = parseMJCF(xml);
    assert.ok(robotState, 'expected Cassie MJCF fixture to parse');
    const cassiePelvisLink = robotState.links['cassie-pelvis'];
    assert.ok(cassiePelvisLink, 'expected Cassie pelvis link');

    const manager = new THREE.LoadingManager();
    let robot: Awaited<ReturnType<typeof buildRuntimeRobotFromState>> | null = null as Awaited<ReturnType<typeof buildRuntimeRobotFromState>> | null;
    const ready = new Promise<void>((resolve) => {
      manager.onLoad = () => resolve();
    });
    const completionKey = '__build_runtime_robot_from_state_cassie_texture_test__';
    manager.itemStart(completionKey);

    try {
      robot = await buildRuntimeRobotFromState({
        robotName: robotState.name,
        links: {
          'cassie-pelvis': cassiePelvisLink,
        },
        joints: {},
        materials: robotState.materials,
        manager,
        loadMeshCb: (_path, _manager, done) => {
          const geometry = new THREE.BoxGeometry(1, 1, 1);
          const positionAttribute = geometry.getAttribute('position');
          assert.ok(positionAttribute, 'expected generated test geometry to have positions');
          geometry.setAttribute(
            'uv',
            new THREE.BufferAttribute(new Float32Array(positionAttribute.count * 2), 2),
          );
          done(
            new THREE.Mesh(
              geometry,
              new THREE.MeshPhongMaterial({ color: new THREE.Color('#444444') }),
            ),
          );
        },
        rootLinkId: 'cassie-pelvis',
      });
    } finally {
      manager.itemEnd(completionKey);
    }

    await ready;

    const visualMesh = robot?.links['cassie-pelvis'].getObjectByProperty(
      'isMesh',
      true,
    ) as THREE.Mesh | undefined;
    assert.ok(visualMesh, 'expected Cassie pelvis visual mesh');
    assert.ok(
      visualMesh.material instanceof THREE.MeshStandardMaterial,
      'expected material override to produce MeshStandardMaterial',
    );
    assert.deepEqual(requestedTexturePaths, ['assets/cassie-texture.png']);
    assert.equal(visualMesh.material.map, appliedTexture);
    assert.deepEqual(toFixedColorArray(visualMesh.material.color), [1, 1, 1]);
  } finally {
    THREE.TextureLoader.prototype.load = originalTextureLoad;
  }
});

test('buildRuntimeRobotFromState preserves embedded multi-material mesh slots for named palettes', async () => {
  const manager = new THREE.LoadingManager();
  const robotState = {
    name: 'multi_material_mesh_robot',
    rootLinkId: 'base_link',
    links: {
      base_link: {
        ...DEFAULT_LINK,
        id: 'base_link',
        name: 'base_link',
        visual: {
          ...DEFAULT_LINK.visual,
          type: GeometryType.MESH,
          meshPath: 'meshes/base_link.dae',
          authoredMaterials: [
            { name: 'body', color: '#bebebe' },
            { name: 'trim', color: '#111111' },
          ],
        },
        collision: {
          ...DEFAULT_LINK.collision,
          type: GeometryType.NONE,
          dimensions: { x: 0, y: 0, z: 0 },
        },
      },
    },
    joints: {},
  };

  let robot: Awaited<ReturnType<typeof buildRuntimeRobotFromState>> | null = null as Awaited<ReturnType<typeof buildRuntimeRobotFromState>> | null;
  const ready = new Promise<void>((resolve) => {
    manager.onLoad = () => resolve();
  });
  const completionKey = '__build_runtime_robot_from_state_multi_material_test__';
  manager.itemStart(completionKey);

  try {
    robot = await buildRuntimeRobotFromState({
      robotName: robotState.name,
      links: robotState.links,
      joints: robotState.joints,
      manager,
      loadMeshCb: (_path, _manager, done) => {
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), [
          new THREE.MeshPhongMaterial({ name: 'body', color: new THREE.Color('#ff0000') }),
          new THREE.MeshPhongMaterial({ name: 'trim', color: new THREE.Color('#00ff00') }),
        ]);
        done(mesh);
      },
    });
  } finally {
    manager.itemEnd(completionKey);
  }

  await ready;

  const baseLink = robot?.links.base_link;
  assert.ok(baseLink, 'expected multi-material base link');

  const visualGroup = baseLink.children.find(isUrdfVisualGroup);
  assert.ok(visualGroup, 'expected visual group');
  assert.equal(visualGroup.children.length, 1);

  const mesh = visualGroup.children[0] as THREE.Mesh;
  assert.ok(Array.isArray(mesh.material), 'expected mesh to keep material slots');
  if (!Array.isArray(mesh.material)) {
    assert.fail('expected named multi-material mesh to preserve array material');
  }

  assert.deepEqual(
    mesh.material.map((material) => material.name),
    ['body', 'trim'],
  );
  assert.equal((mesh.material[0] as THREE.MeshPhongMaterial).color.getHexString(), 'ff0000');
  assert.equal((mesh.material[1] as THREE.MeshPhongMaterial).color.getHexString(), '00ff00');
});

test('buildRuntimeRobotFromState keeps placeholder meshes for missing visual assets', async () => {
  const robotState = {
    name: 'missing_visual_mesh',
    rootLinkId: 'base_link',
    links: {
      base_link: {
        ...DEFAULT_LINK,
        id: 'base_link',
        name: 'base_link',
        visual: {
          ...DEFAULT_LINK.visual,
          type: GeometryType.MESH,
          meshPath: 'package://aliengo_description/meshes/hip.dae',
        },
      },
    },
    joints: {},
  };

  const robot = await buildRuntimeRobotFromState({
    robotName: robotState.name,
    links: robotState.links,
    joints: robotState.joints,
    manager: new THREE.LoadingManager(),
    loadMeshCb: (path, _manager, done) => {
      done(createPlaceholderMesh(path));
    },
  });

  const baseLink = robot.links.base_link as THREE.Object3D | undefined;
  assert.ok(baseLink);

  const visualGroup = baseLink.children.find(isUrdfVisualGroup);
  assert.ok(visualGroup);

  let placeholderMesh: THREE.Mesh | null = null as THREE.Mesh | null;
  visualGroup.traverse((child) => {
    if ((child as THREE.Mesh).isMesh && child.userData?.isPlaceholder) {
      placeholderMesh = child as THREE.Mesh;
    }
  });

  assert.ok(placeholderMesh);
  assert.equal(
    placeholderMesh.userData?.missingMeshPath,
    'package://aliengo_description/meshes/hip.dae',
  );
});

test('buildRuntimeRobotFromState logs when a mesh callback completes without an object', async () => {
  const robotState = {
    name: 'missing_visual_mesh_object',
    rootLinkId: 'base_link',
    links: {
      base_link: {
        ...DEFAULT_LINK,
        id: 'base_link',
        name: 'base_link',
        visual: {
          ...DEFAULT_LINK.visual,
          type: GeometryType.MESH,
          meshPath: 'package://aliengo_description/meshes/hip.dae',
        },
      },
    },
    joints: {},
  };

  const originalConsoleError = console.error;
  const loggedErrors: unknown[][] = [];
  console.error = (...args) => {
    loggedErrors.push(args);
  };

  try {
    await buildRuntimeRobotFromState({
      robotName: robotState.name,
      links: robotState.links,
      joints: robotState.joints,
      manager: new THREE.LoadingManager(),
      loadMeshCb: (_path, _manager, done) => {
        done(null, undefined);
      },
    });
  } finally {
    console.error = originalConsoleError;
  }

  assert.equal(loggedErrors.length, 1);
  assert.match(
    String(loggedErrors[0]?.[0] || ''),
    /Mesh loader completed without an object for robot state geometry/,
  );
  assert.equal(loggedErrors[0]?.[1], 'package://aliengo_description/meshes/hip.dae');
});

test('buildRuntimeRobotFromState falls back to prefix match when submesh name is missing from flattened Collada scene', async () => {
  // Simulates the WASM fast-mesh parser output for DAE files where an authored
  // `<node name="Propeller">` wraps an unnamed intermediate `<node>` that hosts
  // `<instance_geometry url="#geom-Prop">` (with `<geometry name="Prop">`).
  // The flattening emits a leaf mesh named "Prop" while the SDF requests the
  // submesh by the authored node name "Propeller".
  const robotState = {
    name: 'flattened_submesh_robot',
    rootLinkId: 'base_link',
    links: {
      base_link: {
        ...DEFAULT_LINK,
        id: 'base_link',
        name: 'base_link',
        visual: {
          ...DEFAULT_LINK.visual,
          type: GeometryType.MESH,
          meshPath: 'meshes/wing.dae',
          submeshName: 'Propeller',
          submeshCenter: false,
        },
      },
    },
    joints: {},
  };

  const manager = new THREE.LoadingManager();
  let robot: Awaited<ReturnType<typeof buildRuntimeRobotFromState>> | null = null as Awaited<ReturnType<typeof buildRuntimeRobotFromState>> | null;
  const ready = new Promise<void>((resolve) => {
    manager.onLoad = () => resolve();
  });
  const completionKey = '__build_runtime_robot_from_state_submesh_fallback_test__';
  manager.itemStart(completionKey);

  const originalConsoleWarn = console.warn;
  const warnings: unknown[][] = [];
  console.warn = (...args) => {
    warnings.push(args);
  };

  try {
    robot = await buildRuntimeRobotFromState({
      robotName: robotState.name,
      links: robotState.links,
      joints: robotState.joints,
      manager,
      loadMeshCb: (_path, _manager, done) => {
        // Mirror the WASM output: a flat scene whose only mesh child is named
        // "Prop" (geometry name) rather than the authored "Propeller".
        const scene = new THREE.Group();
        const propMesh = new THREE.Mesh(
          new THREE.BoxGeometry(0.1, 0.1, 0.1),
          new THREE.MeshPhongMaterial({ color: new THREE.Color('#990000') }),
        );
        propMesh.name = 'Prop';
        scene.add(propMesh);
        done(scene);
      },
    });
  } finally {
    console.warn = originalConsoleWarn;
    manager.itemEnd(completionKey);
  }

  await ready;

  const baseLink = robot?.links.base_link;
  assert.ok(baseLink, 'expected base link');

  const visualGroup = baseLink.children.find(isUrdfVisualGroup);
  assert.ok(visualGroup, 'expected visual group');
  assert.equal(visualGroup.children.length, 1, 'expected the prefix-matched submesh to attach');

  const attachedMesh = visualGroup.children[0] as THREE.Mesh;
  assert.ok(attachedMesh.isMesh, 'expected attached mesh');
  assert.equal(attachedMesh.name, 'Prop');

  // The fuzzy fallback must not log the "Submesh not found" warning.
  const submeshWarnings = warnings.filter((args) =>
    String(args[0] || '').includes('Submesh "Propeller" not found'),
  );
  assert.equal(submeshWarnings.length, 0, 'expected no submesh-not-found warning');
});
