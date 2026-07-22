import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { JSDOM } from 'jsdom';

import {
  GeometryType,
  JointType,
  DEFAULT_JOINT,
  DEFAULT_LINK,
  type RobotData,
  type UrdfJoint,
  type UrdfLink,
} from '@/types';
import { parseMJCF } from '@/core/parsers/mjcf/mjcfParser';

import {
  resolveDirectManipulableLinkIkJointIds,
  resolveDirectManipulableLinkIkDescriptor,
  resolveLinkIkHandleDescriptor,
  resolveLinkIkHandleWorldPosition,
  resolveSelectableIkHandleLinkId,
  solveLinkIkPositionTarget,
} from './linkIk';

function installDomGlobals(): void {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { contentType: 'text/html' });
  globalThis.window = dom.window as any;
  globalThis.document = dom.window.document as any;
  globalThis.DOMParser = dom.window.DOMParser as any;
  globalThis.XMLSerializer = dom.window.XMLSerializer as any;
  globalThis.Node = dom.window.Node as any;
  globalThis.Element = dom.window.Element as any;
  globalThis.Document = dom.window.Document as any;
}

function createLink(id: string, name: string, length: number): UrdfLink {
  return {
    ...DEFAULT_LINK,
    id,
    name,
    visual: {
      ...DEFAULT_LINK.visual,
      type: GeometryType.BOX,
      dimensions: { x: length, y: 0.1, z: 0.1 },
      origin: {
        xyz: { x: length / 2, y: 0, z: 0 },
        rpy: { r: 0, p: 0, y: 0 },
      },
    },
    visualBodies: [],
    collision: {
      ...DEFAULT_LINK.collision,
      type: GeometryType.NONE,
      dimensions: { x: 0, y: 0, z: 0 },
      origin: {
        xyz: { x: 0, y: 0, z: 0 },
        rpy: { r: 0, p: 0, y: 0 },
      },
    },
    collisionBodies: [],
  };
}

function createAxialLink(id: string, name: string, length: number): UrdfLink {
  return {
    ...DEFAULT_LINK,
    id,
    name,
    visual: {
      ...DEFAULT_LINK.visual,
      type: GeometryType.BOX,
      dimensions: { x: 0.1, y: 0.1, z: length },
      origin: {
        xyz: { x: 0, y: 0, z: length / 2 },
        rpy: { r: 0, p: 0, y: 0 },
      },
    },
    visualBodies: [],
    collision: {
      ...DEFAULT_LINK.collision,
      type: GeometryType.NONE,
      dimensions: { x: 0, y: 0, z: 0 },
      origin: {
        xyz: { x: 0, y: 0, z: 0 },
        rpy: { r: 0, p: 0, y: 0 },
      },
    },
    collisionBodies: [],
  };
}

function createRevoluteJoint(
  id: string,
  parentLinkId: string,
  childLinkId: string,
  originX: number,
): UrdfJoint {
  return {
    ...DEFAULT_JOINT,
    id,
    name: id,
    type: JointType.REVOLUTE,
    parentLinkId,
    childLinkId,
    origin: {
      xyz: { x: originX, y: 0, z: 0 },
      rpy: { r: 0, p: 0, y: 0 },
    },
    axis: { x: 0, y: 0, z: 1 },
    angle: 0,
    quaternion: undefined,
  };
}

function createPlanarIkRobot(): RobotData {
  return {
    name: 'planar-ik-fixture',
    rootLinkId: 'base',
    links: {
      base: createLink('base', 'base', 0.2),
      link1: createLink('link1', 'link1', 1),
      link2: createLink('link2', 'link2', 1),
    },
    joints: {
      joint1: createRevoluteJoint('joint1', 'base', 'link1', 0),
      joint2: createRevoluteJoint('joint2', 'link1', 'link2', 1),
    },
  };
}

function createBranchingIkRobot(): RobotData {
  return {
    name: 'branching-ik-fixture',
    rootLinkId: 'base',
    links: {
      base: createLink('base', 'base', 0.2),
      trunk: createLink('trunk', 'trunk', 0.4),
      left_tip: createLink('left_tip', 'left_tip', 0.3),
      right_tip: createLink('right_tip', 'right_tip', 0.3),
    },
    joints: {
      base_joint: createRevoluteJoint('base_joint', 'base', 'trunk', 0.1),
      left_joint: createRevoluteJoint('left_joint', 'trunk', 'left_tip', 0.4),
      right_joint: createRevoluteJoint('right_joint', 'trunk', 'right_tip', 0.4),
    },
  };
}

function createPrismaticIkRobot(): RobotData {
  return {
    name: 'prismatic-ik-fixture',
    rootLinkId: 'base',
    links: {
      base: createLink('base', 'base', 0.2),
      tool: createLink('tool', 'tool', 0.4),
    },
    joints: {
      slide: {
        ...DEFAULT_JOINT,
        id: 'slide',
        name: 'slide',
        type: JointType.PRISMATIC,
        parentLinkId: 'base',
        childLinkId: 'tool',
        origin: {
          xyz: { x: 0, y: 0, z: 0 },
          rpy: { r: 0, p: 0, y: 0 },
        },
        axis: { x: 1, y: 0, z: 0 },
        angle: 0,
        quaternion: undefined,
        limit: { lower: -1, upper: 2, effort: 100, velocity: 10 },
      },
    },
  };
}

function createMeshOnlyIkRobot(): RobotData {
  return {
    name: 'mesh-only-ik-fixture',
    rootLinkId: 'base',
    links: {
      base: createLink('base', 'base', 0.2),
      tool: {
        ...DEFAULT_LINK,
        id: 'tool',
        name: 'tool',
        visual: {
          ...DEFAULT_LINK.visual,
          type: GeometryType.MESH,
          meshPath: 'package://demo/tool.stl',
          dimensions: { x: 0, y: 0, z: 0 },
          origin: {
            xyz: { x: 0, y: 0, z: 0 },
            rpy: { r: 0, p: 0, y: 0 },
          },
        },
        visualBodies: [],
        collision: {
          ...DEFAULT_LINK.collision,
          type: GeometryType.NONE,
          dimensions: { x: 0, y: 0, z: 0 },
          origin: {
            xyz: { x: 0, y: 0, z: 0 },
            rpy: { r: 0, p: 0, y: 0 },
          },
        },
        collisionBodies: [],
      },
    },
    joints: {
      joint1: createRevoluteJoint('joint1', 'base', 'tool', 0),
    },
  };
}

function createAxialZChainRobot(): RobotData {
  return {
    name: 'axial-z-chain-fixture',
    rootLinkId: 'base',
    links: {
      base: createAxialLink('base', 'base', 0.5),
      link1: createAxialLink('link1', 'link1', 0.5),
      link2: createAxialLink('link2', 'link2', 0.5),
    },
    joints: {
      joint1: {
        ...DEFAULT_JOINT,
        id: 'joint1',
        name: 'joint1',
        type: JointType.REVOLUTE,
        parentLinkId: 'base',
        childLinkId: 'link1',
        origin: {
          xyz: { x: 0, y: 0, z: 0.5 },
          rpy: { r: 0, p: 0, y: 0 },
        },
        axis: { x: 0, y: 0, z: 1 },
        angle: 0,
        quaternion: undefined,
      },
      joint2: {
        ...DEFAULT_JOINT,
        id: 'joint2',
        name: 'joint2',
        type: JointType.REVOLUTE,
        parentLinkId: 'link1',
        childLinkId: 'link2',
        origin: {
          xyz: { x: 0, y: 0, z: 0.5 },
          rpy: { r: 0, p: 0, y: 0 },
        },
        axis: { x: 0, y: 0, z: 1 },
        angle: 0,
        quaternion: undefined,
      },
    },
  };
}

function createMjcfSiteBackedIkRobot(): RobotData {
  return {
    name: 'mjcf-site-ik-fixture',
    rootLinkId: 'base',
    links: {
      base: createLink('base', 'base', 0.2),
      tool: {
        ...DEFAULT_LINK,
        id: 'tool',
        name: 'tool',
        visual: {
          ...DEFAULT_LINK.visual,
          type: GeometryType.NONE,
          dimensions: { x: 0, y: 0, z: 0 },
        },
        collision: {
          ...DEFAULT_LINK.collision,
          type: GeometryType.NONE,
          dimensions: { x: 0, y: 0, z: 0 },
        },
        mjcfSites: [
          {
            name: 'attachment_site',
            type: 'sphere',
            pos: [0, 0, 0.12],
          },
        ],
      },
      tool_geom_1: createLink('tool_geom_1', 'tool_geom_1', 0.1),
    },
    joints: {
      joint1: createRevoluteJoint('joint1', 'base', 'tool', 0),
      tool_to_tool_geom_1: {
        ...DEFAULT_JOINT,
        id: 'tool_to_tool_geom_1',
        name: 'tool_to_tool_geom_1',
        type: JointType.FIXED,
        parentLinkId: 'tool',
        childLinkId: 'tool_geom_1',
        origin: {
          xyz: { x: 0, y: 0, z: 0 },
          rpy: { r: 0, p: 0, y: 0 },
        },
        axis: { x: 0, y: 0, z: 1 },
      },
    },
  };
}

function createMjcfSiteWithFixedFrameChildRobot(): RobotData {
  return {
    name: 'mjcf-site-fixed-frame-fixture',
    rootLinkId: 'base',
    links: {
      base: createLink('base', 'base', 0.2),
      tool: {
        ...DEFAULT_LINK,
        id: 'tool',
        name: 'tool',
        visual: {
          ...DEFAULT_LINK.visual,
          type: GeometryType.NONE,
          dimensions: { x: 0, y: 0, z: 0 },
        },
        collision: {
          ...DEFAULT_LINK.collision,
          type: GeometryType.NONE,
          dimensions: { x: 0, y: 0, z: 0 },
        },
        mjcfSites: [
          {
            name: 'attachment_site',
            type: 'sphere',
            pos: [0, 0, 0.12],
          },
        ],
      },
      tool_frame: createLink('tool_frame', 'tool_frame', 0.08),
    },
    joints: {
      joint1: createRevoluteJoint('joint1', 'base', 'tool', 0),
      tool_to_tool_frame: {
        ...DEFAULT_JOINT,
        id: 'tool_to_tool_frame',
        name: 'tool_to_tool_frame',
        type: JointType.FIXED,
        parentLinkId: 'tool',
        childLinkId: 'tool_frame',
        origin: {
          xyz: { x: 0, y: 0, z: 0 },
          rpy: { r: 0, p: 0, y: 0 },
        },
        axis: { x: 0, y: 0, z: 1 },
      },
    },
  };
}

function createDecorativeRotorLegIkRobot(): RobotData {
  return {
    name: 'decorative-rotor-leg-ik-fixture',
    rootLinkId: 'base',
    links: {
      base: createLink('base', 'base', 0.3),
      hip: createLink('hip', 'hip', 0.2),
      thigh: createLink('thigh', 'thigh', 0.7),
      thigh_rotor: createLink('thigh_rotor', 'thigh_rotor', 0.12),
      calf: createLink('calf', 'calf', 0.6),
      calf_rotor: createLink('calf_rotor', 'calf_rotor', 0.12),
      foot: createLink('foot', 'foot', 0.2),
    },
    joints: {
      hip_joint: createRevoluteJoint('hip_joint', 'base', 'hip', 0),
      thigh_joint: createRevoluteJoint('thigh_joint', 'hip', 'thigh', 0.2),
      thigh_rotor_joint: {
        ...DEFAULT_JOINT,
        id: 'thigh_rotor_joint',
        name: 'thigh_rotor_joint',
        type: JointType.FIXED,
        parentLinkId: 'hip',
        childLinkId: 'thigh_rotor',
        origin: {
          xyz: { x: 0, y: 0, z: 0 },
          rpy: { r: 0, p: 0, y: 0 },
        },
        axis: { x: 0, y: 0, z: 1 },
      },
      calf_joint: createRevoluteJoint('calf_joint', 'thigh', 'calf', 0.7),
      calf_rotor_joint: {
        ...DEFAULT_JOINT,
        id: 'calf_rotor_joint',
        name: 'calf_rotor_joint',
        type: JointType.FIXED,
        parentLinkId: 'thigh',
        childLinkId: 'calf_rotor',
        origin: {
          xyz: { x: 0, y: 0, z: 0 },
          rpy: { r: 0, p: 0, y: 0 },
        },
        axis: { x: 0, y: 0, z: 1 },
      },
      foot_joint: {
        ...DEFAULT_JOINT,
        id: 'foot_joint',
        name: 'foot_joint',
        type: JointType.FIXED,
        parentLinkId: 'calf',
        childLinkId: 'foot',
        origin: {
          xyz: { x: 0.6, y: 0, z: 0 },
          rpy: { r: 0, p: 0, y: 0 },
        },
        axis: { x: 0, y: 0, z: 1 },
      },
    },
  };
}

test('resolveLinkIkHandleDescriptor anchors the handle on the leaf link visual bounds', () => {
  const robot = createPlanarIkRobot();

  const descriptor = resolveLinkIkHandleDescriptor(robot, 'link2');

  assert.ok(descriptor);
  assert.equal(descriptor.linkId, 'link2');
  assert.equal(descriptor.anchorSource, 'visual-bounds');
  assert.deepEqual(descriptor.jointIds, ['joint1', 'joint2']);
  assert.ok(Math.abs(descriptor.anchorLocal.x - 0.5) < 1e-9);
  assert.ok(Math.abs(descriptor.anchorLocal.y) < 1e-9);
  assert.ok(Math.abs(descriptor.anchorLocal.z) < 1e-9);
  assert.equal(descriptor.radius, 0.03);
});

test('resolveLinkIkHandleDescriptor also exposes a top-level root handle', () => {
  const robot = createPlanarIkRobot();

  const descriptor = resolveLinkIkHandleDescriptor(robot, 'base');

  assert.ok(descriptor);
  assert.equal(descriptor.linkId, 'base');
  assert.equal(descriptor.anchorSource, 'visual-bounds');
  assert.deepEqual(descriptor.jointIds, []);
  assert.ok(Math.abs(descriptor.anchorLocal.x - 0.1) < 1e-9);
  assert.ok(Math.abs(descriptor.anchorLocal.y) < 1e-9);
  assert.ok(Math.abs(descriptor.anchorLocal.z) < 1e-9);
  assert.equal(descriptor.radius, 0.03);
});

test('resolveSelectableIkHandleLinkId maps an intermediate single-chain link to its only distal IK handle', () => {
  const robot = createPlanarIkRobot();

  assert.equal(resolveSelectableIkHandleLinkId(robot, 'link1'), 'link2');
});

test('resolveDirectManipulableLinkIkDescriptor keeps the clicked intermediate link as the IK target', () => {
  const robot = createPlanarIkRobot();

  const descriptor = resolveDirectManipulableLinkIkDescriptor(robot, 'link1');

  assert.ok(descriptor);
  assert.equal(descriptor.linkId, 'link1');
  assert.equal(descriptor.anchorSource, 'visual-bounds');
  assert.deepEqual(descriptor.jointIds, ['joint1']);
  assert.ok(Math.abs(descriptor.anchorLocal.x - 0.5) < 1e-9);
  assert.ok(Math.abs(descriptor.anchorLocal.y) < 1e-9);
  assert.ok(Math.abs(descriptor.anchorLocal.z) < 1e-9);
});

test('resolveDirectManipulableLinkIkDescriptor rejects the root/base link for click-to-drag IK', () => {
  const robot = createPlanarIkRobot();

  const descriptor = resolveDirectManipulableLinkIkDescriptor(robot, 'base');

  assert.equal(descriptor, null);
});

test('resolveDirectManipulableLinkIkDescriptor stays available on branching intermediate links', () => {
  const robot = createBranchingIkRobot();

  const descriptor = resolveDirectManipulableLinkIkDescriptor(robot, 'trunk');

  assert.ok(descriptor);
  assert.equal(descriptor.linkId, 'trunk');
  assert.deepEqual(descriptor.jointIds, ['base_joint']);
});

test('resolveDirectManipulableLinkIkDescriptor falls back to MJCF sites for clicked links without renderable bounds', () => {
  const robot = createMjcfSiteBackedIkRobot();

  const descriptor = resolveDirectManipulableLinkIkDescriptor(robot, 'tool');

  assert.ok(descriptor);
  assert.equal(descriptor.linkId, 'tool');
  assert.equal(descriptor.anchorSource, 'mjcf-site');
  assert.deepEqual(descriptor.jointIds, ['joint1']);
  assert.ok(Math.abs(descriptor.anchorLocal.x) < 1e-9);
  assert.ok(Math.abs(descriptor.anchorLocal.y) < 1e-9);
  assert.ok(Math.abs(descriptor.anchorLocal.z - 0.12) < 1e-9);
});

test('resolveDirectManipulableLinkIkJointIds keeps mesh-only links selectable for runtime-bounds dragging', () => {
  const robot = createMeshOnlyIkRobot();

  assert.equal(resolveDirectManipulableLinkIkDescriptor(robot, 'tool'), null);
  assert.deepEqual(resolveDirectManipulableLinkIkJointIds(robot, 'tool'), ['joint1']);
});

test('resolveDirectManipulableLinkIkDescriptor shifts the anchor off the distal joint axis when the bounds center is singular', () => {
  const robot = createAxialZChainRobot();

  const descriptor = resolveDirectManipulableLinkIkDescriptor(robot, 'link2');

  assert.ok(descriptor);
  assert.equal(descriptor.linkId, 'link2');
  assert.ok(Math.abs(descriptor.anchorLocal.z - 0.25) < 1e-9);
  assert.ok(
    Math.hypot(descriptor.anchorLocal.x, descriptor.anchorLocal.y) > 1e-9,
    `expected an off-axis anchor but got ${JSON.stringify(descriptor.anchorLocal)}`,
  );
});

test('resolveSelectableIkHandleLinkId keeps direct IK candidates unchanged', () => {
  const robot = createPlanarIkRobot();

  assert.equal(resolveSelectableIkHandleLinkId(robot, 'base'), 'base');
  assert.equal(resolveSelectableIkHandleLinkId(robot, 'link2'), 'link2');
});

test('resolveSelectableIkHandleLinkId stays null for branching links with ambiguous distal handles', () => {
  const robot = createBranchingIkRobot();

  assert.equal(resolveSelectableIkHandleLinkId(robot, 'trunk'), null);
});

test('resolveLinkIkHandleDescriptor falls back to MJCF sites for terminal links with only fixed decorative children', () => {
  const robot = createMjcfSiteBackedIkRobot();

  const descriptor = resolveLinkIkHandleDescriptor(robot, 'tool');

  assert.ok(descriptor);
  assert.equal(descriptor.linkId, 'tool');
  assert.equal(descriptor.anchorSource, 'mjcf-site');
  assert.deepEqual(descriptor.jointIds, ['joint1']);
  assert.ok(Math.abs(descriptor.anchorLocal.x) < 1e-9);
  assert.ok(Math.abs(descriptor.anchorLocal.y) < 1e-9);
  assert.ok(Math.abs(descriptor.anchorLocal.z - 0.12) < 1e-9);
});

test('resolveLinkIkHandleDescriptor does not expose site-backed intermediate links with non-decorative fixed children', () => {
  const robot = createMjcfSiteWithFixedFrameChildRobot();

  const descriptor = resolveLinkIkHandleDescriptor(robot, 'tool');

  assert.equal(descriptor, null);
});

test('resolveLinkIkHandleDescriptor keeps the distal foot handle and suppresses decorative fixed rotor leaves', () => {
  const robot = createDecorativeRotorLegIkRobot();

  const thighRotorDescriptor = resolveLinkIkHandleDescriptor(robot, 'thigh_rotor');
  const calfRotorDescriptor = resolveLinkIkHandleDescriptor(robot, 'calf_rotor');
  const footDescriptor = resolveLinkIkHandleDescriptor(robot, 'foot');

  assert.equal(thighRotorDescriptor, null);
  assert.equal(calfRotorDescriptor, null);
  assert.ok(footDescriptor);
  assert.equal(footDescriptor.linkId, 'foot');
  assert.deepEqual(footDescriptor.jointIds, [
    'hip_joint',
    'thigh_joint',
    'calf_joint',
    'foot_joint',
  ]);
});

test('resolveLinkIkHandleDescriptor exposes the franka fr3 MJCF attachment site on the wrist link', () => {
  installDomGlobals();
  const xml = fs.readFileSync('test/mujoco_menagerie-main/franka_fr3/fr3.xml', 'utf8');
  const robot = parseMJCF(xml);

  assert.ok(robot);

  const descriptor = resolveLinkIkHandleDescriptor(robot, 'fr3_link7');

  assert.ok(descriptor);
  assert.equal(descriptor.linkId, 'fr3_link7');
  assert.equal(descriptor.anchorSource, 'mjcf-site');
  assert.deepEqual(
    descriptor.jointIds.filter((jointId) => jointId.startsWith('fr3_joint')),
    [
      'fr3_joint1',
      'fr3_joint2',
      'fr3_joint3',
      'fr3_joint4',
      'fr3_joint5',
      'fr3_joint6',
      'fr3_joint7',
    ],
  );
  assert.ok(Math.abs(descriptor.anchorLocal.x) < 1e-9);
  assert.ok(Math.abs(descriptor.anchorLocal.y) < 1e-9);
  assert.ok(Math.abs(descriptor.anchorLocal.z - 0.107) < 1e-9);
});

test('solveLinkIkPositionTarget steps off the ARX L5 gripper singularity for axis-aligned drags', () => {
  installDomGlobals();
  const xml = fs.readFileSync('test/mujoco_menagerie-main/arx_l5/arx_l5.xml', 'utf8');
  const robot = parseMJCF(xml);

  assert.ok(robot);

  const descriptor = resolveLinkIkHandleDescriptor(robot, 'link8');
  assert.ok(descriptor);

  const start = resolveLinkIkHandleWorldPosition(robot, descriptor);
  const deltas = [
    { x: 0.01, y: 0, z: 0 },
    { x: 0, y: 0.01, z: 0 },
    { x: 0, y: 0, z: 0.01 },
  ];

  deltas.forEach((delta) => {
    const target = {
      x: start.x + delta.x,
      y: start.y + delta.y,
      z: start.z + delta.z,
    };
    const requestedDistance = Math.hypot(delta.x, delta.y, delta.z);
    const result = solveLinkIkPositionTarget(robot, {
      linkId: 'link8',
      targetWorldPosition: target,
      maxIterations: 64,
      positionTolerance: 1e-4,
      stallTolerance: 1e-8,
    });

    assert.ok(
      result.residual + 1e-6 < requestedDistance,
      `expected residual improvement for ${JSON.stringify(delta)} but got ${result.residual}`,
    );
    assert.ok(
      Object.values(result.angles).some((angle) => Math.abs(angle) > 1e-6),
      `expected non-zero joint motion for ${JSON.stringify(delta)}`,
    );
  });
});

test('solveLinkIkPositionTarget keeps preview-budget ARX L5 X-axis drags responsive', () => {
  installDomGlobals();
  const xml = fs.readFileSync('test/mujoco_menagerie-main/arx_l5/arx_l5.xml', 'utf8');
  const robot = parseMJCF(xml);

  assert.ok(robot);

  const descriptor = resolveLinkIkHandleDescriptor(robot, 'link8');
  assert.ok(descriptor);

  const start = resolveLinkIkHandleWorldPosition(robot, descriptor);
  const delta = { x: 0.01, y: 0, z: 0 };
  const target = {
    x: start.x + delta.x,
    y: start.y + delta.y,
    z: start.z + delta.z,
  };
  const requestedDistance = Math.hypot(delta.x, delta.y, delta.z);
  const result = solveLinkIkPositionTarget(robot, {
    linkId: 'link8',
    targetWorldPosition: target,
    coordinatePairMaxDistance: 2,
    maxIterations: 6,
    positionTolerance: 2e-3,
    stallTolerance: 1e-4,
  });

  assert.ok(
    result.residual + 1e-6 < requestedDistance,
    `expected preview residual improvement for ${JSON.stringify(delta)} but got ${result.residual}`,
  );
  assert.ok(
    Object.values(result.angles).some((angle) => Math.abs(angle) > 1e-6),
    `expected preview-budget non-zero joint motion for ${JSON.stringify(delta)}`,
  );
});

test('solveLinkIkPositionTarget returns actual angles for joints with reference positions', () => {
  const robot = createPlanarIkRobot();
  robot.joints.joint1.referencePosition = 0.4;
  robot.joints.joint1.angle = 0.4;
  delete robot.joints.joint2;
  robot.joints.fixed_tool = {
    ...DEFAULT_JOINT,
    id: 'fixed_tool',
    name: 'fixed_tool',
    type: JointType.FIXED,
    parentLinkId: 'link1',
    childLinkId: 'link2',
    origin: {
      xyz: { x: 1, y: 0, z: 0 },
      rpy: { r: 0, p: 0, y: 0 },
    },
    axis: { x: 0, y: 0, z: 1 },
  };

  const descriptor = resolveLinkIkHandleDescriptor(robot, 'link2');
  assert.ok(descriptor);

  const start = resolveLinkIkHandleWorldPosition(robot, descriptor);
  const targetMotionAngle = 0.1;
  const target = {
    x: Math.cos(targetMotionAngle) * start.x - Math.sin(targetMotionAngle) * start.y,
    y: Math.sin(targetMotionAngle) * start.x + Math.cos(targetMotionAngle) * start.y,
    z: start.z,
  };

  const result = solveLinkIkPositionTarget(robot, {
    linkId: 'link2',
    targetWorldPosition: target,
    maxIterations: 64,
    positionTolerance: 1e-4,
    stallTolerance: 1e-8,
  });

  assert.equal(result.converged, true);
  assert.ok(Math.abs((result.angles.joint1 ?? 0) - 0.5) < 1e-3);
});

test('solveLinkIkPositionTarget converges on a reachable prismatic target', () => {
  const robot = createPrismaticIkRobot();
  const descriptor = resolveLinkIkHandleDescriptor(robot, 'tool');

  assert.ok(descriptor);

  const result = solveLinkIkPositionTarget(robot, {
    linkId: 'tool',
    targetWorldPosition: {
      x: 0.8,
      y: descriptor.anchorLocal.y,
      z: descriptor.anchorLocal.z,
    },
    maxIterations: 64,
    positionTolerance: 1e-4,
    stallTolerance: 1e-8,
  });

  assert.equal(result.converged, true);
  assert.equal(result.failureReason, undefined);
  assert.ok(result.iterations > 0);
  assert.ok(Object.keys(result.angles).includes('slide'));

  const dx = result.effectorWorldPosition.x - 0.8;
  const dy = result.effectorWorldPosition.y - descriptor.anchorLocal.y;
  const dz = result.effectorWorldPosition.z - descriptor.anchorLocal.z;
  assert.ok(Math.hypot(dx, dy, dz) <= 1e-3);
});

test('solveLinkIkPositionTarget treats missing position bounds as unbounded', () => {
  const robot = createPrismaticIkRobot();
  robot.joints.slide.limit = { effort: 100, velocity: 10 };
  const descriptor = resolveLinkIkHandleDescriptor(robot, 'tool');

  assert.ok(descriptor);

  const result = solveLinkIkPositionTarget(robot, {
    linkId: 'tool',
    targetWorldPosition: {
      x: 0.8,
      y: descriptor.anchorLocal.y,
      z: descriptor.anchorLocal.z,
    },
    maxIterations: 64,
    positionTolerance: 1e-4,
    stallTolerance: 1e-8,
  });

  assert.equal(result.converged, true);
  assert.ok(Number.isFinite(result.angles.slide));
  assert.ok(Math.abs(result.effectorWorldPosition.x - 0.8) <= 1e-3);
});

test('solveLinkIkPositionTarget can rotate an axial chain once the direct-manipulation anchor is moved off-axis', () => {
  const robot = createAxialZChainRobot();
  const descriptor = resolveDirectManipulableLinkIkDescriptor(robot, 'link2');

  assert.ok(descriptor);

  const start = resolveLinkIkHandleWorldPosition(robot, descriptor);
  const target = {
    x: -start.y,
    y: start.x,
    z: start.z,
  };
  const requestedDistance = Math.hypot(target.x - start.x, target.y - start.y, target.z - start.z);
  const result = solveLinkIkPositionTarget(robot, {
    linkId: 'link2',
    targetWorldPosition: target,
    maxIterations: 64,
    positionTolerance: 1e-4,
    stallTolerance: 1e-8,
  });

  assert.ok(
    result.residual + 1e-6 < requestedDistance,
    `expected axial-chain residual improvement but got ${result.residual}`,
  );
  assert.ok(
    Object.values(result.angles).some((angle) => Math.abs(angle) > 1e-6),
    'expected non-zero joint motion for the off-axis anchor target',
  );
});

test('solveLinkIkPositionTarget uses an explicit anchor for mesh-only direct link dragging', () => {
  const robot = createMeshOnlyIkRobot();
  const targetAngle = Math.PI / 5;

  const result = solveLinkIkPositionTarget(robot, {
    linkId: 'tool',
    anchorLocal: { x: 1, y: 0, z: 0 },
    targetWorldPosition: {
      x: Math.cos(targetAngle),
      y: Math.sin(targetAngle),
      z: 0,
    },
    maxIterations: 64,
    positionTolerance: 1e-4,
    stallTolerance: 1e-8,
  });

  assert.equal(result.converged, true);
  assert.ok(Math.abs((result.angles.joint1 ?? 0) - targetAngle) < 1e-3);
});

test('solveLinkIkPositionTarget rejects mimic chains as unsupported', () => {
  const robot = createPlanarIkRobot();
  robot.joints.joint2 = {
    ...robot.joints.joint2,
    mimic: {
      joint: 'joint1',
      multiplier: 1,
      offset: 0,
    },
  };

  const descriptor = resolveLinkIkHandleDescriptor(robot, 'link2');
  const result = solveLinkIkPositionTarget(robot, {
    linkId: 'link2',
    targetWorldPosition: { x: 1.4, y: 1.2, z: 0 },
  });

  assert.equal(descriptor, null);
  assert.equal(result.converged, false);
  assert.equal(result.failureReason, 'unsupported-joint');
});
