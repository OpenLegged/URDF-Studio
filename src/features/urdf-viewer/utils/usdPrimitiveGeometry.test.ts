import test from 'node:test';
import assert from 'node:assert/strict';

import {
  GeometryType,
  type UrdfVisual,
  type UsdSceneMeshDescriptor,
  type UsdSceneSnapshot,
} from '@/types';
import { resolveUsdPrimitiveGeometryFromDescriptor } from './usdPrimitiveGeometry';

test('resolves USD primitive dimensions without baking descriptor world transforms into RobotState geometry', () => {
  const descriptor: UsdSceneMeshDescriptor = {
    meshId: '/Robot/base_link/collisions.proto_box_id0',
    sectionName: 'collisions',
    resolvedPrimPath: '/Robot/base_link/collisions/box_0',
    primType: 'cube',
    extentSize: [0.4, 0.5, 0.6],
    ranges: {
      transform: {
        offset: 0,
        count: 16,
        stride: 16,
      },
    },
  };
  const snapshot: UsdSceneSnapshot = {
    buffers: {
      transforms: [
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        7, 8, 9, 1,
      ],
    },
  };

  const geometry = resolveUsdPrimitiveGeometryFromDescriptor(descriptor, null, snapshot);

  assert.deepEqual(geometry, {
    type: GeometryType.BOX,
    dimensions: {
      x: 0.4,
      y: 0.5,
      z: 0.6,
    },
  });
});

test('folds USD primitive transform scale into RobotState dimensions', () => {
  const descriptor: UsdSceneMeshDescriptor = {
    meshId: '/go2_description/FL_thigh/collisions.proto_box_id0',
    sectionName: 'collisions',
    resolvedPrimPath: '/go2_description/FL_thigh/collisions/collision_0/box',
    primType: 'cube',
    size: 1,
    ranges: {
      transform: {
        offset: 0,
        count: 16,
        stride: 16,
      },
    },
  };
  const snapshot: UsdSceneSnapshot = {
    buffers: {
      transforms: [
        0.213, 0, 0, 0,
        0, 0.0245, 0, 0,
        0, 0, 0.034, 0,
        4, 5, 6, 1,
      ],
    },
  };

  const geometry = resolveUsdPrimitiveGeometryFromDescriptor(descriptor, null, snapshot);

  assert.deepEqual(geometry, {
    type: GeometryType.BOX,
    dimensions: {
      x: 0.213,
      y: 0.0245,
      z: 0.034,
    },
  });
});

test('folds USD primitive transform scale into extent-backed box dimensions', () => {
  const descriptor: UsdSceneMeshDescriptor = {
    meshId: '/Robot/base_link/collisions.proto_box_id0',
    sectionName: 'collisions',
    resolvedPrimPath: '/Robot/base_link/collisions/box_0',
    primType: 'cube',
    extentSize: [0.4, 0.5, 0.6],
    ranges: {
      transform: {
        offset: 0,
        count: 16,
        stride: 16,
      },
    },
  };
  const snapshot: UsdSceneSnapshot = {
    buffers: {
      transforms: [
        2, 0, 0, 0,
        0, 3, 0, 0,
        0, 0, 4, 0,
        0, 0, 0, 1,
      ],
    },
  };

  const geometry = resolveUsdPrimitiveGeometryFromDescriptor(descriptor, null, snapshot);

  assert.deepEqual(geometry, {
    type: GeometryType.BOX,
    dimensions: {
      x: 0.8,
      y: 1.5,
      z: 2.4,
    },
  });
});

test('folds USD primitive transform scale into extent-backed cylinder dimensions', () => {
  const descriptor: UsdSceneMeshDescriptor = {
    meshId: '/Robot/base_link/collisions.proto_cylinder_id0',
    sectionName: 'collisions',
    resolvedPrimPath: '/Robot/base_link/collisions/cylinder_0',
    primType: 'cylinder',
    axis: 'Z',
    extentSize: [0.2, 0.2, 1],
    ranges: {
      transform: {
        offset: 0,
        count: 16,
        stride: 16,
      },
    },
  };
  const snapshot: UsdSceneSnapshot = {
    buffers: {
      transforms: [
        2, 0, 0, 0,
        0, 3, 0, 0,
        0, 0, 4, 0,
        0, 0, 0, 1,
      ],
    },
  };

  const geometry = resolveUsdPrimitiveGeometryFromDescriptor(descriptor, null, snapshot);

  assert.equal(geometry?.type, GeometryType.CYLINDER);
  assert.ok(geometry);
  assert.ok(Math.abs(geometry.dimensions.x - 0.3) <= 1e-12);
  assert.equal(geometry.dimensions.y, 4);
  assert.equal(geometry.dimensions.z, 0);
});

test('does not reuse already-scaled RobotState primitive dimensions as USD local cylinder dimensions', () => {
  const descriptor: UsdSceneMeshDescriptor = {
    meshId: '/go2_description/FL_calf/collisions/collision_0/cylinder',
    sectionName: 'collisions',
    resolvedPrimPath: '/go2_description/FL_calf/collisions/collision_0/cylinder',
    primType: 'cylinder',
    ranges: {
      transform: {
        offset: 0,
        count: 16,
        stride: 16,
      },
    },
  };
  const current: UrdfVisual = {
    type: GeometryType.CYLINDER,
    dimensions: { x: 0.024, y: 0.12, z: 0 },
    color: '#ff0000',
    origin: {
      xyz: { x: 0, y: 0, z: 0 },
      rpy: { r: 0, p: 0, y: 0 },
    },
  };
  const snapshot: UsdSceneSnapshot = {
    buffers: {
      transforms: [
        0.024, 0, 0, 0,
        0, 0.024, 0, 0,
        0, 0, 0.12, 0,
        0, 0, 0, 1,
      ],
    },
  };

  const geometry = resolveUsdPrimitiveGeometryFromDescriptor(descriptor, current, snapshot);

  assert.deepEqual(geometry, {
    type: GeometryType.CYLINDER,
    dimensions: {
      x: 0.012,
      y: 0.12,
      z: 0,
    },
  });
});

test('folds Unitree B2 USD cylinder scale along the schema Z axis', () => {
  const descriptor: UsdSceneMeshDescriptor = {
    meshId: '/b2_description/FL_hip/collisions.proto_cylinder_id0',
    sectionName: 'collisions',
    resolvedPrimPath: '/b2_description/FL_hip/collisions/collision_0/cylinder',
    primType: 'cylinder',
    radius: 0.5,
    height: 1,
    ranges: {
      transform: {
        offset: 0,
        count: 16,
        stride: 16,
      },
    },
  };
  const snapshot: UsdSceneSnapshot = {
    buffers: {
      transforms: [
        0.14, 0, 0, 0,
        0, 0.14, 0, 0,
        0, 0, 0.05, 0,
        0, 0, 0, 1,
      ],
    },
  };

  const geometry = resolveUsdPrimitiveGeometryFromDescriptor(descriptor, null, snapshot);

  assert.deepEqual(geometry, {
    type: GeometryType.CYLINDER,
    dimensions: {
      x: 0.07,
      y: 0.05,
      z: 0,
    },
  });
});

test('prefers authored B2 cylinder dimensions over the USD schema default extent', () => {
  const descriptor: UsdSceneMeshDescriptor = {
    meshId: '/b2_description/FR_hip_rotor/collisions.proto_cylinder_id0',
    sectionName: 'collisions',
    resolvedPrimPath: '/b2_description/FR_hip_rotor/collisions/collision_0/cylinder',
    primType: 'cylinder',
    axis: 'Z',
    radius: 0.05,
    height: 0.02,
    extentSize: [2, 2, 2],
    ranges: {
      transform: {
        offset: 0,
        count: 16,
        stride: 16,
      },
    },
  };
  const snapshot: UsdSceneSnapshot = {
    buffers: {
      transforms: [
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        0, 0, 0, 1,
      ],
    },
  };

  assert.deepEqual(resolveUsdPrimitiveGeometryFromDescriptor(descriptor, null, snapshot), {
    type: GeometryType.CYLINDER,
    dimensions: {
      x: 0.05,
      y: 0.02,
      z: 0,
    },
  });
});

test('does not invent primitive dimensions when the baked USD descriptor has no size evidence', () => {
  const descriptor: UsdSceneMeshDescriptor = {
    meshId: '/Robot/base_link/collisions.proto_box_id0',
    sectionName: 'collisions',
    resolvedPrimPath: '/Robot/base_link/collisions/box_0',
    primType: 'cube',
  };

  assert.equal(resolveUsdPrimitiveGeometryFromDescriptor(descriptor, null, null), null);
});
