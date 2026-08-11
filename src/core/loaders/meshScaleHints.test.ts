import test from 'node:test';
import assert from 'node:assert/strict';

import { GeometryType, JointType, type RobotState } from '@/types';

import {
  buildExplicitlyScaledMeshPathHints,
  collectExplicitlyScaledMeshPaths,
  collectExplicitlyScaledMeshPathsFromLinks,
  hasExplicitMeshScaleHint,
} from './meshScaleHints';

const TEST_ROBOT: RobotState = {
  name: 'scaled-mesh-hints',
  rootLinkId: 'base_link',
  materials: {},
  selection: { type: null, id: null },
  links: {
    base_link: {
      id: 'base_link',
      name: 'base_link',
      visual: {
        type: GeometryType.MESH,
        meshPath: 'meshes/base_visual.STL',
        dimensions: { x: 1, y: 1, z: 1 },
        mjcfMesh: {
          name: 'base_visual',
          file: 'meshes/base_visual.STL',
          scale: [1, 1, 1],
        },
        color: '#ffffff',
        origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
      },
      collision: {
        type: GeometryType.MESH,
        meshPath: '../meshes/base_collision.STL',
        dimensions: { x: 0.001, y: 0.001, z: 0.001 },
        color: '#ffffff',
        origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
      },
      collisionBodies: [
        {
          type: GeometryType.MESH,
          meshPath: 'package://demo_description/meshes/foot_collision.STL',
          dimensions: { x: 0.5, y: 0.5, z: 0.5 },
          color: '#ffffff',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        {
          type: GeometryType.SDF,
          meshPath: 'meshes/implicit_surface.STL',
          dimensions: { x: 1, y: 1, z: 1 },
          mjcfMesh: {
            name: 'implicit_surface',
            file: 'meshes/implicit_surface.STL',
            scale: [1, 1, 1],
          },
          color: '#ffffff',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
      ],
    },
  },
  joints: {
    fixed_root: {
      id: 'fixed_root',
      name: 'fixed_root',
      type: JointType.FIXED,
      parentLinkId: 'world',
      childLinkId: 'base_link',
      origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
      dynamics: { damping: 0, friction: 0 },
      hardware: { armature: 0, motorType: '', motorId: '', motorDirection: 1 },
    },
  },
};

test('collectExplicitlyScaledMeshPaths keeps non-identity and MJCF-authored mesh scales', () => {
  const scaledPaths = collectExplicitlyScaledMeshPaths(TEST_ROBOT);

  assert.deepEqual(
    Array.from(scaledPaths).sort(),
    [
      '../meshes/base_collision.STL',
      'meshes/base_visual.STL',
      'meshes/implicit_surface.STL',
      'package://demo_description/meshes/foot_collision.STL',
    ],
  );
});

test('collectExplicitlyScaledMeshPathsFromLinks reuses the same extraction logic for pre-parsed links', () => {
  const scaledPaths = collectExplicitlyScaledMeshPathsFromLinks(TEST_ROBOT.links);

  assert.deepEqual(
    Array.from(scaledPaths).sort(),
    [
      '../meshes/base_collision.STL',
      'meshes/base_visual.STL',
      'meshes/implicit_surface.STL',
      'package://demo_description/meshes/foot_collision.STL',
    ],
  );
});

test('explicit mesh scale hints match relative, resolved, and package mesh paths', () => {
  const hints = buildExplicitlyScaledMeshPathHints(
    [
      '../meshes/base_collision.STL',
      'package://demo_description/meshes/foot_collision.STL',
    ],
    'demo_description/urdf/',
  );

  assert.equal(
    hasExplicitMeshScaleHint('../meshes/base_collision.STL', hints, 'demo_description/urdf/'),
    true,
  );
  assert.equal(
    hasExplicitMeshScaleHint('demo_description/meshes/base_collision.STL', hints, 'demo_description/urdf/'),
    true,
  );
  assert.equal(
    hasExplicitMeshScaleHint('package://demo_description/meshes/foot_collision.STL', hints, 'demo_description/urdf/'),
    true,
  );
  assert.equal(
    hasExplicitMeshScaleHint('meshes/base_visual.STL', hints, 'demo_description/urdf/'),
    false,
  );
});
