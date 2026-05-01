import test from 'node:test';
import assert from 'node:assert/strict';

import { GeometryType, JointType, type UrdfJoint, type UrdfLink } from '@/types';

import {
  detectJointPatches,
  detectSingleGeometryPatch,
  detectSingleJointPatch,
} from './robotLoaderDiff';

const makeJoint = (overrides: Partial<UrdfJoint> = {}): UrdfJoint => ({
  id: 'joint_1',
  name: 'joint_1',
  type: JointType.FLOATING,
  parentLinkId: 'world',
  childLinkId: 'base_link',
  origin: {
    xyz: { x: 0, y: 0, z: 0 },
    rpy: { r: 0, p: 0, y: 0 },
  },
  axis: undefined,
  limit: undefined,
  dynamics: { damping: 0, friction: 0 },
  hardware: {
    armature: 0,
    motorType: '',
    motorId: '',
    motorDirection: 1,
  },
  ...overrides,
});

const makeLink = (overrides: Partial<UrdfLink> = {}): UrdfLink => ({
  id: 'base_link',
  name: 'base_link',
  visible: true,
  visual: {
    type: GeometryType.BOX,
    dimensions: { x: 0.2, y: 0.2, z: 0.2 },
    color: '#808080',
    origin: {
      xyz: { x: 0, y: 0, z: 0 },
      rpy: { r: 0, p: 0, y: 0 },
    },
    visible: true,
  },
  visualBodies: [
    {
      type: GeometryType.BOX,
      dimensions: { x: 0.1, y: 0.1, z: 0.1 },
      color: '#22c55e',
      origin: {
        xyz: { x: 0.1, y: 0, z: 0 },
        rpy: { r: 0, p: 0, y: 0 },
      },
      visible: true,
    },
  ],
  collision: {
    type: GeometryType.NONE,
    dimensions: { x: 0, y: 0, z: 0 },
    color: '#808080',
    origin: {
      xyz: { x: 0, y: 0, z: 0 },
      rpy: { r: 0, p: 0, y: 0 },
    },
    visible: true,
  },
  collisionBodies: [],
  ...overrides,
});

test('detectSingleJointPatch tolerates joints without limits', () => {
  const prevJoints = {
    joint_1: makeJoint(),
  };
  const nextJoints = {
    joint_1: makeJoint({
      origin: {
        xyz: { x: 0, y: 0, z: 0.1 },
        rpy: { r: 0, p: 0, y: 0 },
      },
    }),
  };

  const patch = detectSingleJointPatch(prevJoints, nextJoints);

  assert.ok(patch);
  assert.equal(patch?.jointName, 'joint_1');
});

test('detectJointPatches returns multiple compatible joint patches for batch updates', () => {
  const prevJoints = {
    joint_1: makeJoint(),
    joint_2: makeJoint({
      id: 'joint_2',
      name: 'joint_2',
      childLinkId: 'link_2',
    }),
  };
  const nextJoints = {
    joint_1: makeJoint({
      origin: {
        xyz: { x: 0.1, y: 0, z: 0 },
        rpy: { r: 0, p: 0, y: 0 },
      },
    }),
    joint_2: makeJoint({
      id: 'joint_2',
      name: 'joint_2',
      childLinkId: 'link_2',
      origin: {
        xyz: { x: -0.2, y: 0.3, z: 0 },
        rpy: { r: 0, p: 0, y: 0.1 },
      },
    }),
  };

  const patches = detectJointPatches(prevJoints, nextJoints);

  assert.ok(patches);
  assert.equal(patches?.length, 2);
  assert.deepEqual(patches?.map((patch) => patch.jointName).sort(), ['joint_1', 'joint_2']);
});

test('detectSingleJointPatch treats hardware interface changes as joint updates', () => {
  const prevJoints = {
    joint_1: makeJoint(),
  };
  const nextJoints = {
    joint_1: makeJoint({
      hardware: {
        armature: 0,
        motorType: '',
        motorId: '',
        motorDirection: 1,
        hardwareInterface: 'velocity',
      },
    }),
  };

  const patch = detectSingleJointPatch(prevJoints, nextJoints);

  assert.ok(patch);
  assert.equal(patch?.jointName, 'joint_1');
});

test('detectSingleGeometryPatch treats visualBodies edits as geometry updates', () => {
  const previousLinks = {
    base_link: makeLink(),
  };
  const nextLinks = {
    base_link: makeLink({
      visualBodies: [
        {
          type: GeometryType.BOX,
          dimensions: { x: 0.1, y: 0.1, z: 0.1 },
          color: '#12ab34',
          origin: {
            xyz: { x: 0.1, y: 0, z: 0 },
            rpy: { r: 0, p: 0, y: 0 },
          },
          visible: true,
        },
      ],
    }),
  };

  const patch = detectSingleGeometryPatch(previousLinks, nextLinks);

  assert.ok(patch);
  assert.equal(patch?.linkName, 'base_link');
  assert.equal(patch?.visualChanged, false);
  assert.equal(patch?.visualBodiesChanged, true);
});

test('detectSingleGeometryPatch treats link display-name edits as compatible metadata patches', () => {
  const previousLinks = {
    base_link: makeLink({
      id: 'base_link',
      name: 'base_link',
    }),
  };
  const nextLinks = {
    base_link: makeLink({
      id: 'base_link',
      name: 'renamed_base_link',
    }),
  };

  const patch = detectSingleGeometryPatch(previousLinks, nextLinks);

  assert.ok(patch);
  assert.equal(patch?.linkName, 'base_link');
  assert.equal(patch?.linkDisplayName, 'renamed_base_link');
  assert.equal(patch?.linkNameChanged, true);
  assert.equal(patch?.visualChanged, false);
  assert.equal(patch?.visualBodiesChanged, false);
  assert.equal(patch?.collisionChanged, false);
  assert.equal(patch?.collisionBodiesChanged, false);
});

test('detectSingleGeometryPatch treats collision body name edits as geometry updates', () => {
  const previousLinks = {
    base_link: makeLink({
      collisionBodies: [
        {
          name: 'collision_body_a',
          type: GeometryType.BOX,
          dimensions: { x: 0.1, y: 0.1, z: 0.1 },
          color: '#808080',
          origin: {
            xyz: { x: 0, y: 0, z: 0 },
            rpy: { r: 0, p: 0, y: 0 },
          },
          visible: true,
        },
      ],
    }),
  };
  const nextLinks = {
    base_link: makeLink({
      collisionBodies: [
        {
          name: 'collision_body_b',
          type: GeometryType.BOX,
          dimensions: { x: 0.1, y: 0.1, z: 0.1 },
          color: '#808080',
          origin: {
            xyz: { x: 0, y: 0, z: 0 },
            rpy: { r: 0, p: 0, y: 0 },
          },
          visible: true,
        },
      ],
    }),
  };

  const patch = detectSingleGeometryPatch(previousLinks, nextLinks);

  assert.ok(patch);
  assert.equal(patch?.linkName, 'base_link');
  assert.equal(patch?.collisionBodiesChanged, true);
});

test('detectSingleGeometryPatch detects authored material colorRgba changes', () => {
  const previousLinks = {
    base_link: makeLink({
      visual: {
        type: GeometryType.BOX,
        dimensions: { x: 0.2, y: 0.2, z: 0.2 },
        color: '#808080',
        origin: {
          xyz: { x: 0, y: 0, z: 0 },
          rpy: { r: 0, p: 0, y: 0 },
        },
        visible: true,
        authoredMaterials: [{ name: 'base_mat', color: '#808080', colorRgba: [0.5, 0.5, 0.5, 1] }],
      },
    }),
  };
  const nextLinks = {
    base_link: makeLink({
      visual: {
        type: GeometryType.BOX,
        dimensions: { x: 0.2, y: 0.2, z: 0.2 },
        color: '#808080',
        origin: {
          xyz: { x: 0, y: 0, z: 0 },
          rpy: { r: 0, p: 0, y: 0 },
        },
        visible: true,
        authoredMaterials: [
          { name: 'base_mat', color: '#808080', colorRgba: [0.9, 0.1, 0.1, 0.8] },
        ],
      },
    }),
  };

  const patch = detectSingleGeometryPatch(previousLinks, nextLinks);

  assert.ok(patch, 'colorRgba change should produce a patch');
  assert.equal(patch?.visualChanged, true);
});

test('detectSingleGeometryPatch detects authored material colorRgba added to existing material', () => {
  const previousLinks = {
    base_link: makeLink({
      visual: {
        type: GeometryType.BOX,
        dimensions: { x: 0.2, y: 0.2, z: 0.2 },
        color: '#808080',
        origin: {
          xyz: { x: 0, y: 0, z: 0 },
          rpy: { r: 0, p: 0, y: 0 },
        },
        visible: true,
        authoredMaterials: [{ name: 'base_mat', color: '#808080' }],
      },
    }),
  };
  const nextLinks = {
    base_link: makeLink({
      visual: {
        type: GeometryType.BOX,
        dimensions: { x: 0.2, y: 0.2, z: 0.2 },
        color: '#808080',
        origin: {
          xyz: { x: 0, y: 0, z: 0 },
          rpy: { r: 0, p: 0, y: 0 },
        },
        visible: true,
        authoredMaterials: [{ name: 'base_mat', color: '#808080', colorRgba: [0.9, 0.1, 0.1, 1] }],
      },
    }),
  };

  const patch = detectSingleGeometryPatch(previousLinks, nextLinks);

  assert.ok(patch, 'adding colorRgba to existing material should produce a patch');
  assert.equal(patch?.visualChanged, true);
});

test('detectSingleGeometryPatch detects visual double-sided render policy changes', () => {
  const previousLinks = {
    base_link: makeLink({
      visual: {
        type: GeometryType.MESH,
        meshPath: 'base_link_visual_0.obj',
        dimensions: { x: 1, y: 1, z: 1 },
        color: '#808080',
        origin: {
          xyz: { x: 0, y: 0, z: 0 },
          rpy: { r: 0, p: 0, y: 0 },
        },
        visible: true,
      },
    }),
  };
  const nextLinks = {
    base_link: makeLink({
      visual: {
        type: GeometryType.MESH,
        meshPath: 'base_link_visual_0.obj',
        dimensions: { x: 1, y: 1, z: 1 },
        color: '#808080',
        origin: {
          xyz: { x: 0, y: 0, z: 0 },
          rpy: { r: 0, p: 0, y: 0 },
        },
        visible: true,
        doubleSided: true,
      },
    }),
  };

  const patch = detectSingleGeometryPatch(previousLinks, nextLinks);

  assert.ok(patch, 'double-sided policy change should produce a patch');
  assert.equal(patch?.visualChanged, true);
});

test('detectSingleJointPatch treats joint display-name edits as compatible joint patches', () => {
  const prevJoints = {
    joint_1: makeJoint({
      id: 'joint_1',
      name: 'joint_1',
    }),
  };
  const nextJoints = {
    joint_1: makeJoint({
      id: 'joint_1',
      name: 'renamed_joint_1',
    }),
  };

  const patch = detectSingleJointPatch(prevJoints, nextJoints);

  assert.ok(patch);
  assert.equal(patch?.jointId, 'joint_1');
  assert.equal(patch?.jointName, 'renamed_joint_1');
  assert.equal(patch?.jointNameChanged, true);
});
