import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';

import { GeometryType, JointType } from '../../../types/index.ts';
import type { RobotState, UsdPreparedExportCache, UsdSceneSnapshot } from '../../../types/index.ts';
import {
  __private__ as usdExportBundlePrivate,
  canPrepareUsdExportCacheFromSnapshot,
  buildUsdExportBundleFromPreparedCache as buildNullableUsdExportBundleFromPreparedCache,
  buildUsdExportBundleFromSnapshot as buildNullableUsdExportBundleFromSnapshot,
  prepareUsdExportCacheFromResolvedSnapshot,
  prepareUsdExportCacheFromSnapshot,
  repairObjFaceVaryingNormalsForExport,
  resolveUsdExportSceneSnapshot,
} from './usdExportBundle.ts';

function buildUsdExportBundleFromSnapshot(
  ...args: Parameters<typeof buildNullableUsdExportBundleFromSnapshot>
): NonNullable<ReturnType<typeof buildNullableUsdExportBundleFromSnapshot>> {
  const bundle = buildNullableUsdExportBundleFromSnapshot(...args);
  assert.ok(bundle, 'expected USD export bundle from snapshot');
  return bundle;
}

function buildUsdExportBundleFromPreparedCache(
  ...args: Parameters<typeof buildNullableUsdExportBundleFromPreparedCache>
): NonNullable<ReturnType<typeof buildNullableUsdExportBundleFromPreparedCache>> {
  const bundle = buildNullableUsdExportBundleFromPreparedCache(...args);
  assert.ok(bundle, 'expected USD export bundle from prepared cache');
  return bundle;
}

function createTriangleBuffers() {
  const positions = new Float32Array([
    0, 0, 0, 1, 0, 0, 0, 1, 0,

    0, 0, 0, 0, 1, 0, 0, 0, 1,

    0, 0, 0, 0, 0, 1, 1, 0, 0,

    0, 0, 0, 1, 0, 0, 0, 1, 0,
  ]);

  const indices = new Uint32Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);

  return { positions, indices };
}

test('buildUsdExportBundleFromSnapshot preserves current robot edits and emits exportable mesh files', async () => {
  const { positions, indices } = createTriangleBuffers();

  const snapshot = {
    stageSourcePath: '/robots/demo/demo.usd',
    stage: {
      defaultPrimPath: '/Robot',
    },
    robotTree: {
      linkParentPairs: [
        ['/Robot/base_link', null],
        ['/Robot/link1', '/Robot/base_link'],
      ] as Array<[string, string | null]>,
      rootLinkPaths: ['/Robot/base_link'],
    },
    robotMetadataSnapshot: {
      stageSourcePath: '/robots/demo/demo.usd',
      linkParentPairs: [
        ['/Robot/base_link', null],
        ['/Robot/link1', '/Robot/base_link'],
      ] as Array<[string, string | null]>,
      jointCatalogEntries: [
        {
          linkPath: '/Robot/link1',
          parentLinkPath: '/Robot/base_link',
          jointName: 'joint_link1',
          jointTypeName: 'revolute',
          axisToken: 'Z',
          lowerLimitDeg: -90,
          upperLimitDeg: 90,
          localPivotInLink: [0, 0, 0],
        },
      ],
      meshCountsByLinkPath: {
        '/Robot/base_link': {
          visualMeshCount: 1,
          collisionMeshCount: 0,
        },
        '/Robot/link1': {
          visualMeshCount: 1,
          collisionMeshCount: 2,
          collisionPrimitiveCounts: {
            mesh: 2,
          },
        },
      },
    },
    render: {
      meshDescriptors: [
        {
          meshId: '/Robot/base_link/visuals.proto_mesh_id0',
          sectionName: 'visuals',
          resolvedPrimPath: '/Robot/base_link/visuals/mesh_0',
          primType: 'mesh',
          ranges: {
            positions: { offset: 0, count: 9, stride: 3 },
            indices: { offset: 0, count: 3, stride: 1 },
          },
        },
        {
          meshId: '/Robot/link1/visuals.proto_mesh_id0',
          sectionName: 'visuals',
          resolvedPrimPath: '/Robot/link1/visuals/mesh_0',
          primType: 'mesh',
          ranges: {
            positions: { offset: 9, count: 9, stride: 3 },
            indices: { offset: 3, count: 3, stride: 1 },
          },
        },
        {
          meshId: '/Robot/link1/collisions.proto_mesh_id0',
          sectionName: 'collisions',
          resolvedPrimPath: '/Robot/link1/collisions/mesh_0',
          primType: 'mesh',
          ranges: {
            positions: { offset: 18, count: 9, stride: 3 },
            indices: { offset: 6, count: 3, stride: 1 },
          },
        },
        {
          meshId: '/Robot/link1/collisions.proto_mesh_id1',
          sectionName: 'collisions',
          resolvedPrimPath: '/Robot/link1/collisions/mesh_1',
          primType: 'mesh',
          ranges: {
            positions: { offset: 27, count: 9, stride: 3 },
            indices: { offset: 9, count: 3, stride: 1 },
          },
        },
      ],
    },
    buffers: {
      positions,
      indices,
      normals: new Float32Array(0),
      uvs: new Float32Array(0),
      transforms: new Float32Array(0),
      rangesByMeshId: {},
    },
  } as unknown as UsdSceneSnapshot;

  const currentRobot: RobotState = {
    name: 'edited_robot',
    rootLinkId: 'base_link',
    selection: { type: null, id: null },
    links: {
      base_link: {
        id: 'base_link',
        name: 'base_link',
        visible: true,
        visual: {
          type: GeometryType.MESH,
          dimensions: { x: 2, y: 2, z: 2 },
          color: '#ff0000',
          origin: { xyz: { x: 1, y: 2, z: 3 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collision: {
          type: GeometryType.NONE,
          dimensions: { x: 0, y: 0, z: 0 },
          color: '#00ff00',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        inertial: {
          mass: 1,
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          inertia: { ixx: 1, ixy: 0, ixz: 0, iyy: 1, iyz: 0, izz: 1 },
        },
      },
      link1: {
        id: 'link1',
        name: 'link1',
        visible: true,
        visual: {
          type: GeometryType.MESH,
          dimensions: { x: 1, y: 1, z: 1 },
          color: '#ffffff',
          origin: { xyz: { x: 4, y: 5, z: 6 }, rpy: { r: 0.1, p: 0.2, y: 0.3 } },
        },
        collision: {
          type: GeometryType.MESH,
          dimensions: { x: 1, y: 1, z: 1 },
          color: '#cccccc',
          origin: { xyz: { x: 7, y: 8, z: 9 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collisionBodies: [
          {
            type: GeometryType.MESH,
            dimensions: { x: 3, y: 3, z: 3 },
            color: '#888888',
            origin: { xyz: { x: 10, y: 11, z: 12 }, rpy: { r: 0, p: 0, y: 0 } },
          },
        ],
        inertial: {
          mass: 42,
          origin: { xyz: { x: 0.4, y: 0.5, z: 0.6 }, rpy: { r: 0, p: 0, y: 0 } },
          inertia: { ixx: 2, ixy: 0, ixz: 0, iyy: 3, iyz: 0, izz: 4 },
        },
      },
    },
    joints: {
      joint_link1: {
        id: 'joint_link1',
        name: 'joint_link1',
        type: JointType.REVOLUTE,
        parentLinkId: 'base_link',
        childLinkId: 'link1',
        origin: { xyz: { x: 1, y: 1, z: 1 }, rpy: { r: 0, p: 0, y: 0 } },
        axis: { x: 0, y: 0, z: 1 },
        limit: { lower: -1, upper: 1, effort: 1, velocity: 1 },
        dynamics: { damping: 0, friction: 0 },
        hardware: { armature: 0, motorType: 'None', motorId: '', motorDirection: 1 },
      },
    },
  };

  const bundle = buildUsdExportBundleFromSnapshot(snapshot, {
    fileName: 'demo.usd',
    currentRobot,
  });

  assert.equal(bundle.robot.name, 'edited_robot');
  assert.ok(bundle.robot.links.link1.inertial);
  assert.equal(bundle.robot.links.link1.inertial.mass, 42);
  assert.deepEqual(bundle.robot.links.base_link.visual.origin.xyz, { x: 1, y: 2, z: 3 });
  assert.deepEqual(bundle.robot.links.link1.visual.origin.xyz, { x: 4, y: 5, z: 6 });

  assert.match(bundle.robot.links.base_link.visual.meshPath || '', /base_link_visual_0\.obj$/);
  assert.match(bundle.robot.links.link1.visual.meshPath || '', /link1_visual_0\.obj$/);
  assert.match(bundle.robot.links.link1.collision.meshPath || '', /link1_collision_0\.obj$/);
  assert.match(
    bundle.robot.links.link1.collisionBodies?.[0]?.meshPath || '',
    /link1_collision_1\.obj$/,
  );

  assert.equal(bundle.meshFiles.size, 4);

  const baseVisualBlob = bundle.meshFiles.get(bundle.robot.links.base_link.visual.meshPath || '');
  assert.ok(baseVisualBlob);

  const baseVisualText = await baseVisualBlob!.text();
  assert.match(baseVisualText, /^o base_link_visual_0/m);
  assert.match(baseVisualText, /^v 0 0 0 1 0 0$/m);
  assert.match(baseVisualText, /^f 1 2 3$/m);
});

test('USD export mesh range reader borrows typed array ranges without copying', () => {
  const source = new Float32Array([0, 1, 2, 3, 4, 5]);

  const values = usdExportBundlePrivate.readRangeValues(source, {
    offset: 2,
    count: 3,
    stride: 1,
  });

  assert.equal(ArrayBuffer.isView(values), true);
  assert.equal((values as Float32Array).buffer, source.buffer);
  assert.deepEqual(Array.from(values), [2, 3, 4]);
});

test('buildUsdExportBundleFromSnapshot keeps descriptor transforms in origins instead of baking them twice into OBJ vertices', async () => {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const indices = new Uint32Array([0, 1, 2]);
  const transforms = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 6, 7, 1]);

  const snapshot = {
    stageSourcePath: '/robots/demo/translated.usd',
    stage: {
      defaultPrimPath: '/Robot',
    },
    robotTree: {
      linkParentPairs: [['/Robot/base_link', null]] as Array<[string, string | null]>,
      rootLinkPaths: ['/Robot/base_link'],
    },
    robotMetadataSnapshot: {
      stageSourcePath: '/robots/demo/translated.usd',
      linkParentPairs: [['/Robot/base_link', null]] as Array<[string, string | null]>,
      jointCatalogEntries: [],
      meshCountsByLinkPath: {
        '/Robot/base_link': {
          visualMeshCount: 1,
          collisionMeshCount: 0,
        },
      },
    },
    render: {
      meshDescriptors: [
        {
          meshId: '/Robot/base_link/visuals.proto_mesh_id0',
          sectionName: 'visuals',
          resolvedPrimPath: '/Robot/base_link/visuals/mesh_0',
          primType: 'mesh',
          ranges: {
            positions: { offset: 0, count: 9, stride: 3 },
            indices: { offset: 0, count: 3, stride: 1 },
            transform: { offset: 0, count: 16, stride: 16 },
          },
        },
      ],
    },
    buffers: {
      positions,
      indices,
      normals: new Float32Array(0),
      uvs: new Float32Array(0),
      transforms,
      rangesByMeshId: {},
    },
  };

  const currentRobot: RobotState = {
    name: 'translated_robot',
    rootLinkId: 'base_link',
    selection: { type: null, id: null },
    links: {
      base_link: {
        id: 'base_link',
        name: 'base_link',
        visible: true,
        visual: {
          type: GeometryType.MESH,
          dimensions: { x: 1, y: 1, z: 1 },
          color: '#ffffff',
          origin: { xyz: { x: 5, y: 6, z: 7 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collision: {
          type: GeometryType.NONE,
          dimensions: { x: 0, y: 0, z: 0 },
          color: '#cccccc',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        inertial: {
          mass: 1,
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          inertia: { ixx: 1, ixy: 0, ixz: 0, iyy: 1, iyz: 0, izz: 1 },
        },
      },
    },
    joints: {},
  };

  const bundle = buildUsdExportBundleFromSnapshot(snapshot, {
    fileName: 'translated.usd',
    currentRobot,
  });

  assert.ok(bundle);
  assert.deepEqual(bundle.robot.links.base_link.visual.origin.xyz, { x: 5, y: 6, z: 7 });

  const meshPath = bundle.robot.links.base_link.visual.meshPath || '';
  const meshBlob = bundle.meshFiles.get(meshPath);
  assert.ok(meshBlob);

  const meshText = await meshBlob!.text();
  assert.equal(bundle.robot.links.base_link.visual.color, '#ffffff');
  // Vertex colors only appear when the descriptor authors one, and this mesh
  // does not; what matters here is that the descriptor translation stayed out
  // of the vertex data.
  assert.match(meshText, /^v 0 0 0$/m);
  assert.doesNotMatch(meshText, /^v 5 6 7$/m);
});

test('buildUsdExportBundleFromSnapshot still bakes descriptor transforms when no authored origin is available', async () => {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const indices = new Uint32Array([0, 1, 2]);
  const transforms = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 6, 7, 1]);

  const snapshot = {
    stageSourcePath: '/robots/demo/unhydrated.usd',
    stage: {
      defaultPrimPath: '/Robot',
    },
    robotTree: {
      linkParentPairs: [['/Robot/base_link', null]] as Array<[string, string | null]>,
      rootLinkPaths: ['/Robot/base_link'],
    },
    robotMetadataSnapshot: {
      stageSourcePath: '/robots/demo/unhydrated.usd',
      linkParentPairs: [['/Robot/base_link', null]] as Array<[string, string | null]>,
      jointCatalogEntries: [],
      meshCountsByLinkPath: {
        '/Robot/base_link': {
          visualMeshCount: 1,
          collisionMeshCount: 0,
        },
      },
    },
    render: {
      meshDescriptors: [
        {
          meshId: '/Robot/base_link/visuals.proto_mesh_id0',
          sectionName: 'visuals',
          resolvedPrimPath: '/Robot/base_link/visuals/mesh_0',
          primType: 'mesh',
          ranges: {
            positions: { offset: 0, count: 9, stride: 3 },
            indices: { offset: 0, count: 3, stride: 1 },
            transform: { offset: 0, count: 16, stride: 16 },
          },
        },
      ],
    },
    buffers: {
      positions,
      indices,
      normals: new Float32Array(0),
      uvs: new Float32Array(0),
      transforms,
      rangesByMeshId: {},
    },
  };

  const bundle = buildUsdExportBundleFromSnapshot(snapshot, {
    fileName: 'unhydrated.usd',
  });

  assert.ok(bundle);
  assert.deepEqual(bundle.robot.links.base_link.visual.origin.xyz, { x: 0, y: 0, z: 0 });

  const meshPath = bundle.robot.links.base_link.visual.meshPath || '';
  const meshBlob = bundle.meshFiles.get(meshPath);
  assert.ok(meshBlob);

  const meshText = await meshBlob!.text();
  assert.match(meshText, /^v 5 6 7$/m);
});

test('buildUsdExportBundleFromSnapshot hydrates live attachment visual origins before exporting meshes', async () => {
  const positions = new Float32Array([
    0, 0, 0, 1, 0, 0, 0, 1, 0,

    0, 0, 0, 1, 0, 0, 0, 1, 0,
  ]);
  const indices = new Uint32Array([0, 1, 2, 3, 4, 5]);
  const transforms = new Float32Array([
    1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0.1, 0.2, 0.3, 1,

    1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0.4, 0.5, 0.6, 1,
  ]);

  const snapshot = {
    stageSourcePath: '/robots/demo/runtime_hydrated.usd',
    stage: {
      defaultPrimPath: '/Robot',
    },
    robotTree: {
      linkParentPairs: [
        ['/Robot/base_link', null],
        ['/Robot/arm_link', '/Robot/base_link'],
      ] as Array<[string, string | null]>,
      rootLinkPaths: ['/Robot/base_link'],
    },
    robotMetadataSnapshot: {
      stageSourcePath: '/robots/demo/runtime_hydrated.usd',
      linkParentPairs: [
        ['/Robot/base_link', null],
        ['/Robot/arm_link', '/Robot/base_link'],
      ] as Array<[string, string | null]>,
      jointCatalogEntries: [
        {
          linkPath: '/Robot/arm_link',
          parentLinkPath: '/Robot/base_link',
          jointName: 'arm_joint',
          jointTypeName: 'revolute',
          axisToken: 'Z',
          localPivotInLink: [0, 0, 0],
        },
      ],
      meshCountsByLinkPath: {
        '/Robot/base_link': {
          visualMeshCount: 0,
          collisionMeshCount: 0,
        },
        '/Robot/arm_link': {
          visualMeshCount: 2,
          collisionMeshCount: 0,
        },
      },
    },
    render: {
      meshDescriptors: [
        {
          meshId: '/Robot/arm_link/visuals.proto_mesh_id0',
          sectionName: 'visuals',
          resolvedPrimPath: '/Robot/arm_link/visuals/arm_link/mesh',
          primType: 'mesh',
          ranges: {
            positions: { offset: 0, count: 9, stride: 3 },
            indices: { offset: 0, count: 3, stride: 1 },
            transform: { offset: 0, count: 16, stride: 16 },
          },
        },
        {
          meshId: '/Robot/arm_link/visuals.proto_mesh_id1',
          sectionName: 'visuals',
          resolvedPrimPath: '/Robot/arm_link/visuals/arm_cap/mesh',
          primType: 'mesh',
          ranges: {
            positions: { offset: 9, count: 9, stride: 3 },
            indices: { offset: 3, count: 3, stride: 1 },
            transform: { offset: 16, count: 16, stride: 16 },
          },
        },
      ],
    },
    buffers: {
      positions,
      indices,
      normals: new Float32Array(0),
      uvs: new Float32Array(0),
      transforms,
      rangesByMeshId: {},
    },
  };

  const bundle = buildUsdExportBundleFromSnapshot(snapshot, {
    fileName: 'runtime_hydrated.usd',
    targetWindow: {
      renderInterface: {
        getPreferredLinkWorldTransform: (linkPath: string) => {
          if (linkPath === '/Robot/base_link') {
            return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
          }
          if (linkPath === '/Robot/arm_link') {
            return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 2, 3, 1];
          }
          return null;
        },
        getWorldTransformForPrimPath: (primPath: string) => {
          if (primPath === '/Robot/arm_link/visuals/arm_link/mesh') {
            return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1.1, 2.2, 3.3, 1];
          }
          if (primPath === '/Robot/arm_link/visuals/arm_cap/mesh') {
            return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1.4, 2.5, 3.6, 1];
          }
          return null;
        },
      },
    },
  });

  assert.ok(bundle);
  assert.ok(Math.abs((bundle.robot.links.arm_link.visual.origin.xyz.x || 0) - 0.1) < 1e-9);
  assert.ok(Math.abs((bundle.robot.links.arm_link.visual.origin.xyz.y || 0) - 0.2) < 1e-9);
  assert.ok(Math.abs((bundle.robot.links.arm_link.visual.origin.xyz.z || 0) - 0.3) < 1e-9);
  assert.ok(
    bundle.robot.links.arm_cap,
    'expected hydrated export bundle to keep the attachment link',
  );
  assert.ok(Math.abs((bundle.robot.links.arm_cap.visual.origin.xyz.x || 0) - 0.4) < 1e-9);
  assert.ok(Math.abs((bundle.robot.links.arm_cap.visual.origin.xyz.y || 0) - 0.5) < 1e-9);
  assert.ok(Math.abs((bundle.robot.links.arm_cap.visual.origin.xyz.z || 0) - 0.6) < 1e-9);

  const attachmentMeshText = await bundle.meshFiles.get('arm_link_visual_1.obj')?.text();
  assert.ok(attachmentMeshText);
  assert.match(attachmentMeshText || '', /^v 0 0 0$/m);
  assert.doesNotMatch(attachmentMeshText || '', /^v 0\.4 0\.5 0\.6$/m);
});

test('buildUsdExportBundleFromSnapshot assigns extra visual descriptors to fixed child links and syncs materials into robot state', () => {
  const { positions, indices } = createTriangleBuffers();

  const snapshot = {
    stageSourcePath: '/robots/demo/g1.usd',
    stage: {
      defaultPrimPath: '/Robot',
    },
    robotTree: {
      linkParentPairs: [['/Robot/torso_link', null]] as Array<[string, string | null]>,
      rootLinkPaths: ['/Robot/torso_link'],
    },
    robotMetadataSnapshot: {
      stageSourcePath: '/robots/demo/g1.usd',
      linkParentPairs: [['/Robot/torso_link', null]] as Array<[string, string | null]>,
      jointCatalogEntries: [],
      meshCountsByLinkPath: {
        '/Robot/torso_link': {
          visualMeshCount: 2,
          collisionMeshCount: 0,
        },
      },
    },
    render: {
      meshDescriptors: [
        {
          meshId: '/Robot/torso_link/visuals.proto_mesh_id0',
          sectionName: 'visuals',
          resolvedPrimPath: '/Robot/torso_link/visuals/torso_link',
          primType: 'mesh',
          materialId: '/Looks/Torso',
          ranges: {
            positions: { offset: 0, count: 9, stride: 3 },
            indices: { offset: 0, count: 3, stride: 1 },
          },
        },
        {
          meshId: '/Robot/torso_link/visuals.proto_mesh_id1',
          sectionName: 'visuals',
          resolvedPrimPath: '/Robot/torso_link/visuals/head_link',
          primType: 'mesh',
          materialId: '/Looks/Head',
          ranges: {
            positions: { offset: 9, count: 9, stride: 3 },
            indices: { offset: 3, count: 3, stride: 1 },
          },
        },
      ],
      materials: [
        {
          materialId: '/Looks/Torso',
          name: 'Torso',
          color: [0.2, 0.3, 0.4, 1],
        },
        {
          materialId: '/Looks/Head',
          name: 'Head',
          color: [0.9, 0.9, 0.9, 1],
        },
      ],
    },
    buffers: {
      positions,
      indices,
      normals: new Float32Array(0),
      uvs: new Float32Array(0),
      transforms: new Float32Array(0),
      rangesByMeshId: {},
    },
  } as unknown as UsdSceneSnapshot;

  const currentRobot: RobotState = {
    name: 'g1_export',
    rootLinkId: 'torso_link',
    selection: { type: null, id: null },
    links: {
      torso_link: {
        id: 'torso_link',
        name: 'torso_link',
        visible: true,
        visual: {
          type: GeometryType.MESH,
          dimensions: { x: 1, y: 1, z: 1 },
          color: '#3b82f6',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collision: {
          type: GeometryType.NONE,
          dimensions: { x: 0, y: 0, z: 0 },
          color: '#ef4444',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collisionBodies: [],
        inertial: {
          mass: 10,
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          inertia: { ixx: 1, ixy: 0, ixz: 0, iyy: 1, iyz: 0, izz: 1 },
        },
      },
      head_link: {
        id: 'head_link',
        name: 'head_link',
        visible: true,
        visual: {
          type: GeometryType.MESH,
          dimensions: { x: 1, y: 1, z: 1 },
          color: '#3b82f6',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collision: {
          type: GeometryType.NONE,
          dimensions: { x: 0, y: 0, z: 0 },
          color: '#ef4444',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collisionBodies: [],
        inertial: {
          mass: 0,
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          inertia: { ixx: 0, ixy: 0, ixz: 0, iyy: 0, iyz: 0, izz: 0 },
        },
      },
    },
    joints: {
      fixed_head_link: {
        id: 'fixed_head_link',
        name: 'fixed_head_link',
        type: JointType.FIXED,
        parentLinkId: 'torso_link',
        childLinkId: 'head_link',
        origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        axis: { x: 0, y: 0, z: 1 },
        dynamics: { damping: 0, friction: 0 },
        hardware: { armature: 0, motorType: 'None', motorId: '', motorDirection: 1 },
      },
    },
    materials: {},
  };

  const bundle = buildUsdExportBundleFromSnapshot(snapshot, {
    fileName: 'g1.usd',
    currentRobot,
  });

  assert.ok(bundle);
  assert.equal(bundle.robot.links.torso_link.visual.meshPath, 'torso_link_visual_0.obj');
  assert.equal(bundle.robot.links.head_link.visual.meshPath, 'torso_link_visual_1.obj');
  assert.equal(bundle.robot.links.head_link.visual.color, '#f3f3f3');
  assert.equal(bundle.robot.materials?.head_link?.color, '#f3f3f3');
  assert.equal(bundle.meshFiles.has('torso_link_visual_1.obj'), true);
});

test('buildUsdExportBundleFromSnapshot falls back to preferred live visual material when descriptor material binding is missing', async () => {
  const { positions, indices } = createTriangleBuffers();

  const snapshot = {
    stageSourcePath: '/robots/demo/go2.usd',
    stage: {
      defaultPrimPath: '/Robot',
    },
    robotTree: {
      linkParentPairs: [['/Robot/base_link', null]] as Array<[string, string | null]>,
      rootLinkPaths: ['/Robot/base_link'],
    },
    robotMetadataSnapshot: {
      stageSourcePath: '/robots/demo/go2.usd',
      linkParentPairs: [['/Robot/base_link', null]] as Array<[string, string | null]>,
      jointCatalogEntries: [],
      meshCountsByLinkPath: {
        '/Robot/base_link': {
          visualMeshCount: 1,
          collisionMeshCount: 0,
        },
      },
    },
    render: {
      meshDescriptors: [
        {
          meshId: '/Robot/base_link/visuals.proto_mesh_id0',
          sectionName: 'visuals',
          resolvedPrimPath: '/Robot/base_link/visuals/base_link',
          primType: 'mesh',
          ranges: {
            positions: { offset: 0, count: 9, stride: 3 },
            indices: { offset: 0, count: 3, stride: 1 },
          },
        },
      ],
      materials: [],
      preferredVisualMaterialsByLinkPath: {
        '/Robot/base_link': {
          name: 'Body',
          color: [0.6717, 0.6924, 0.7743, 1],
        },
      },
    },
    buffers: {
      positions,
      indices,
      normals: new Float32Array(0),
      uvs: new Float32Array(0),
      transforms: new Float32Array(0),
      rangesByMeshId: {},
    },
  } as unknown as UsdSceneSnapshot;

  const currentRobot: RobotState = {
    name: 'go2_export',
    rootLinkId: 'base_link',
    selection: { type: null, id: null },
    links: {
      base_link: {
        id: 'base_link',
        name: 'base_link',
        visible: true,
        visual: {
          type: GeometryType.MESH,
          dimensions: { x: 1, y: 1, z: 1 },
          color: '#3b82f6',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collision: {
          type: GeometryType.NONE,
          dimensions: { x: 0, y: 0, z: 0 },
          color: '#ef4444',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collisionBodies: [],
        inertial: {
          mass: 1,
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          inertia: { ixx: 1, ixy: 0, ixz: 0, iyy: 1, iyz: 0, izz: 1 },
        },
      },
    },
    joints: {},
    materials: {
      base_link: {
        color: '#3b82f6',
      },
    },
  };

  const bundle = buildUsdExportBundleFromSnapshot(snapshot, {
    fileName: 'go2.usd',
    currentRobot,
  });

  assert.ok(bundle);
  assert.equal(bundle.robot.links.base_link.visual.color, '#d6d9e4');
  assert.equal(bundle.robot.materials?.base_link?.color, '#d6d9e4');
  assert.equal(bundle.robot.links.base_link.visual.meshPath, 'base_link_visual_0.obj');

  const meshText = await bundle.meshFiles.get('base_link_visual_0.obj')?.text();
  assert.ok(meshText);
  assert.match(meshText, /^v 0 0 0 0\.6717 0\.6924 0\.7743$/m);

  const parsedObject = new OBJLoader().parse(meshText);
  let hasVertexColors = false;
  parsedObject.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) {
      return;
    }

    hasVertexColors = Boolean(child.geometry.getAttribute('color'));
  });
  assert.equal(hasVertexColors, true);
});

test('buildUsdExportBundleFromSnapshot preserves UV coordinates for textured snapshot meshes', async () => {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const indices = new Uint32Array([0, 1, 2]);
  const uvs = new Float32Array([0, 0, 1, 0, 0, 1]);

  const snapshot = {
    stageSourcePath: '/robots/demo/textured.usd',
    stage: {
      defaultPrimPath: '/Robot',
    },
    robotTree: {
      linkParentPairs: [['/Robot/base_link', null]] as Array<[string, string | null]>,
      rootLinkPaths: ['/Robot/base_link'],
    },
    robotMetadataSnapshot: {
      stageSourcePath: '/robots/demo/textured.usd',
      linkParentPairs: [['/Robot/base_link', null]] as Array<[string, string | null]>,
      jointCatalogEntries: [],
      meshCountsByLinkPath: {
        '/Robot/base_link': {
          visualMeshCount: 1,
          collisionMeshCount: 0,
        },
      },
    },
    render: {
      meshDescriptors: [
        {
          meshId: '/Robot/base_link/visuals.proto_mesh_id0',
          sectionName: 'visuals',
          resolvedPrimPath: '/Robot/base_link/visuals/base_link',
          primType: 'mesh',
          materialId: '/Robot/Looks/body',
          ranges: {
            positions: { offset: 0, count: 9, stride: 3 },
            indices: { offset: 0, count: 3, stride: 1 },
            uvs: { offset: 0, count: 6, stride: 2 },
          },
        },
      ],
      materials: [
        {
          materialId: '/Robot/Looks/body',
          color: [1, 1, 1, 1],
          mapPath: 'textures/body_basecolor.png',
        },
      ],
    },
    buffers: {
      positions,
      indices,
      normals: new Float32Array(0),
      uvs,
      transforms: new Float32Array(0),
      rangesByMeshId: {},
    },
  } as unknown as UsdSceneSnapshot;

  const currentRobot: RobotState = {
    name: 'textured_export',
    rootLinkId: 'base_link',
    selection: { type: null, id: null },
    links: {
      base_link: {
        id: 'base_link',
        name: 'base_link',
        visible: true,
        visual: {
          type: GeometryType.MESH,
          dimensions: { x: 1, y: 1, z: 1 },
          color: '#ffffff',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collision: {
          type: GeometryType.NONE,
          dimensions: { x: 0, y: 0, z: 0 },
          color: '#000000',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collisionBodies: [],
      },
    },
    joints: {},
    materials: {},
  };

  const bundle = buildUsdExportBundleFromSnapshot(snapshot, {
    fileName: 'textured.usd',
    currentRobot,
  });

  assert.ok(bundle);
  assert.equal(bundle.robot.materials?.base_link?.texture, 'textures/body_basecolor.png');
  assert.equal(
    bundle.robot.materials?.base_link?.usdMaterial?.mapPath,
    'textures/body_basecolor.png',
  );

  const meshText = await bundle.meshFiles.get('base_link_visual_0.obj')?.text();
  assert.ok(meshText);
  assert.match(meshText, /^vt 0 0$/m);
  assert.match(meshText, /^vt 1 0$/m);
  assert.match(meshText, /^vt 0 1$/m);
  assert.match(meshText, /^f 1\/1 2\/2 3\/3$/m);

  const parsedObject = new OBJLoader().parse(meshText);
  let uvCount = 0;
  parsedObject.traverse((child: any) => {
    if (!child.isMesh || uvCount > 0) {
      return;
    }

    uvCount = Number(child.geometry?.getAttribute?.('uv')?.count || 0);
  });

  assert.equal(uvCount, 3);
});

test('buildUsdExportBundleFromSnapshot lets snapshot textures replace stale link material textures', () => {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const indices = new Uint32Array([0, 1, 2]);
  const uvs = new Float32Array([0, 0, 1, 0, 0, 1]);

  const snapshot = {
    stageSourcePath: '/robots/demo/textured.usd',
    stage: {
      defaultPrimPath: '/Robot',
    },
    robotTree: {
      linkParentPairs: [['/Robot/base_link', null]] as Array<[string, string | null]>,
      rootLinkPaths: ['/Robot/base_link'],
    },
    robotMetadataSnapshot: {
      stageSourcePath: '/robots/demo/textured.usd',
      linkParentPairs: [['/Robot/base_link', null]] as Array<[string, string | null]>,
      jointCatalogEntries: [],
      meshCountsByLinkPath: {
        '/Robot/base_link': {
          visualMeshCount: 1,
          collisionMeshCount: 0,
        },
      },
    },
    render: {
      meshDescriptors: [
        {
          meshId: '/Robot/base_link/visuals.proto_mesh_id0',
          sectionName: 'visuals',
          resolvedPrimPath: '/Robot/base_link/visuals/base_link',
          primType: 'mesh',
          materialId: '/Robot/Looks/body',
          ranges: {
            positions: { offset: 0, count: 9, stride: 3 },
            indices: { offset: 0, count: 3, stride: 1 },
            uvs: { offset: 0, count: 6, stride: 2 },
          },
        },
      ],
      materials: [
        {
          materialId: '/Robot/Looks/body',
          color: [1, 1, 1, 1],
          mapPath: 'textures/new.png',
        },
      ],
    },
    buffers: {
      positions,
      indices,
      normals: new Float32Array(0),
      uvs,
      transforms: new Float32Array(0),
      rangesByMeshId: {},
    },
  } as unknown as UsdSceneSnapshot;

  const currentRobot: RobotState = {
    name: 'stale_textured_export',
    rootLinkId: 'base_link',
    selection: { type: null, id: null },
    links: {
      base_link: {
        id: 'base_link',
        name: 'base_link',
        visible: true,
        visual: {
          type: GeometryType.MESH,
          dimensions: { x: 1, y: 1, z: 1 },
          color: '#ffffff',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collision: {
          type: GeometryType.NONE,
          dimensions: { x: 0, y: 0, z: 0 },
          color: '#000000',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collisionBodies: [],
      },
    },
    joints: {},
    materials: {
      base_link: {
        color: '#ffffff',
        texture: 'textures/stale.png',
        usdMaterial: {
          mapPath: 'textures/stale.png',
          color: [1, 1, 1],
        },
      },
    },
  };

  const bundle = buildUsdExportBundleFromSnapshot(snapshot, {
    fileName: 'stale_textured.usd',
    currentRobot,
  });

  assert.ok(bundle);
  assert.equal(bundle.robot.materials?.base_link?.texture, 'textures/new.png');
  assert.equal(bundle.robot.materials?.base_link?.usdMaterial?.mapPath, 'textures/new.png');
});

test('buildUsdExportBundleFromSnapshot keeps geom subsets on a single export mesh with authored material groups', async () => {
  const positions = new Float32Array([
    0, 0, 0, 1, 0, 0, 0, 1, 0,

    0, 0, 0, 0, 1, 0, 0, 0, 1,
  ]);
  const indices = new Uint32Array([0, 1, 2, 3, 4, 5]);

  const snapshot = {
    stageSourcePath: '/robots/demo/go2.usd',
    stage: {
      defaultPrimPath: '/Robot',
    },
    robotTree: {
      linkParentPairs: [['/Robot/base_link', null]] as Array<[string, string | null]>,
      rootLinkPaths: ['/Robot/base_link'],
    },
    robotMetadataSnapshot: {
      stageSourcePath: '/robots/demo/go2.usd',
      linkParentPairs: [['/Robot/base_link', null]] as Array<[string, string | null]>,
      jointCatalogEntries: [],
      meshCountsByLinkPath: {
        '/Robot/base_link': {
          visualMeshCount: 1,
          collisionMeshCount: 0,
        },
      },
    },
    render: {
      meshDescriptors: [
        {
          meshId: '/Robot/base_link/visuals.proto_mesh_id0',
          sectionName: 'visuals',
          resolvedPrimPath: '/Robot/base_link/visuals/base_link',
          primType: 'mesh',
          geometry: {
            geomSubsetSections: [
              { start: 0, length: 3, materialId: '/Looks/Red' },
              { start: 3, length: 3, materialId: '/Looks/Green' },
            ],
          },
          ranges: {
            positions: { offset: 0, count: 18, stride: 3 },
            indices: { offset: 0, count: 6, stride: 1 },
          },
        },
      ],
      materials: [
        {
          materialId: '/Looks/Red',
          name: 'Red',
          color: [1, 0, 0, 1],
        },
        {
          materialId: '/Looks/Green',
          name: 'Green',
          color: [0, 1, 0, 1],
        },
      ],
    },
    buffers: {
      positions,
      indices,
      normals: new Float32Array(0),
      uvs: new Float32Array(0),
      transforms: new Float32Array(0),
      rangesByMeshId: {},
    },
  } as unknown as UsdSceneSnapshot;

  const currentRobot: RobotState = {
    name: 'subset_export',
    rootLinkId: 'base_link',
    selection: { type: null, id: null },
    links: {
      base_link: {
        id: 'base_link',
        name: 'base_link',
        visible: true,
        visual: {
          type: GeometryType.MESH,
          dimensions: { x: 1, y: 1, z: 1 },
          color: '#3b82f6',
          origin: { xyz: { x: 0.12, y: -0.34, z: 0.56 }, rpy: { r: Math.PI / 2, p: 0, y: 0 } },
        },
        collision: {
          type: GeometryType.NONE,
          dimensions: { x: 0, y: 0, z: 0 },
          color: '#ef4444',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collisionBodies: [],
        inertial: {
          mass: 1,
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          inertia: { ixx: 1, ixy: 0, ixz: 0, iyy: 1, iyz: 0, izz: 1 },
        },
      },
    },
    joints: {},
    materials: {
      base_link: {
        color: '#3b82f6',
      },
    },
  };

  const bundle = buildUsdExportBundleFromSnapshot(snapshot, {
    fileName: 'go2.usd',
    currentRobot,
  });

  assert.ok(bundle);
  assert.equal(bundle.robot.links.base_link.visual.meshPath, 'base_link_visual_0.obj');
  assert.equal(bundle.robot.links.base_link.visual.color, '#ff0000');
  assert.deepEqual(bundle.robot.links.base_link.visual.authoredMaterials, [
    { name: 'Red', color: '#ff0000' },
    { name: 'Green', color: '#00ff00' },
  ]);
  assert.deepEqual(bundle.robot.links.base_link.visual.meshMaterialGroups, [
    { meshKey: '0', start: 0, count: 3, materialIndex: 0 },
    { meshKey: '0', start: 3, count: 3, materialIndex: 1 },
  ]);
  assert.deepEqual(
    Object.keys(bundle.robot.links),
    ['base_link'],
    'geom subsets should not expand into synthetic attachment links',
  );

  const fullObj = await bundle.meshFiles.get('base_link_visual_0.obj')?.text();
  assert.ok(fullObj);
  assert.equal(bundle.meshFiles.has('base_link_visual_0_section_0.obj'), false);
  assert.equal(bundle.meshFiles.has('base_link_visual_0_section_1.obj'), false);
  assert.match(fullObj, /^v 0 0 0 1 0 0$/m);
  assert.match(fullObj, /^v 0 0 0 0 1 0$/m);
});

test('buildUsdExportBundleFromSnapshot uses authored multi-material colors when snapshot materials are unavailable', () => {
  const { positions, indices } = createTriangleBuffers();

  const snapshot = {
    stageSourcePath: '/robots/b2/b2.usd',
    stage: {
      defaultPrimPath: '/Robot',
    },
    robotTree: {
      linkParentPairs: [['/Robot/FR_calf', null]] as Array<[string, string | null]>,
      rootLinkPaths: ['/Robot/FR_calf'],
    },
    robotMetadataSnapshot: {
      stageSourcePath: '/robots/b2/b2.usd',
      linkParentPairs: [['/Robot/FR_calf', null]] as Array<[string, string | null]>,
      jointCatalogEntries: [],
      meshCountsByLinkPath: {
        '/Robot/FR_calf': {
          visualMeshCount: 1,
          collisionMeshCount: 0,
        },
      },
    },
    render: {
      meshDescriptors: [
        {
          meshId: '/Robot/FR_calf/visuals.proto_mesh_id0',
          sectionName: 'visuals',
          resolvedPrimPath: '/Robot/FR_calf/visuals/FR_calf',
          primType: 'mesh',
          geometry: {
            geomSubsetSections: [
              { start: 0, length: 3 },
              { start: 3, length: 3 },
            ],
          },
          ranges: {
            positions: { offset: 0, count: 18, stride: 3 },
            indices: { offset: 0, count: 6, stride: 1 },
          },
        },
      ],
      materials: [],
    },
    buffers: {
      positions,
      indices,
      normals: new Float32Array(0),
      uvs: new Float32Array(0),
      transforms: new Float32Array(0),
      rangesByMeshId: {},
    },
  } as unknown as UsdSceneSnapshot;

  const currentRobot: RobotState = {
    name: 'b2_export',
    rootLinkId: 'FR_calf',
    selection: { type: null, id: null },
    links: {
      FR_calf: {
        id: 'FR_calf',
        name: 'FR_calf',
        visible: true,
        visual: {
          type: GeometryType.MESH,
          dimensions: { x: 1, y: 1, z: 1 },
          color: '#3b82f6',
          authoredMaterials: [
            { name: '磨砂铝合金_018-effect', color: '#bfbfbf' },
            { name: '材质_005-effect', color: '#121212' },
          ],
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collision: {
          type: GeometryType.NONE,
          dimensions: { x: 0, y: 0, z: 0 },
          color: '#ef4444',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collisionBodies: [],
        inertial: {
          mass: 0.404,
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          inertia: { ixx: 1, ixy: 0, ixz: 0, iyy: 1, iyz: 0, izz: 1 },
        },
      },
    },
    joints: {},
    materials: {
      FR_calf: {
        color: '#3b82f6',
      },
    },
  };

  const bundle = buildUsdExportBundleFromSnapshot(snapshot, {
    fileName: 'b2.usd',
    currentRobot,
  });

  assert.ok(bundle);
  assert.equal(bundle.robot.links.FR_calf.visual.color, '#bfbfbf');
  assert.equal(bundle.robot.materials?.FR_calf?.color, '#bfbfbf');
  assert.deepEqual(bundle.robot.links.FR_calf.visual.authoredMaterials, [
    { name: '磨砂铝合金_018-effect', color: '#bfbfbf' },
    { name: '材质_005-effect', color: '#121212' },
  ]);
  assert.deepEqual(bundle.robot.links.FR_calf.visual.meshMaterialGroups, [
    { meshKey: '0', start: 0, count: 3, materialIndex: 0 },
    { meshKey: '0', start: 3, count: 3, materialIndex: 1 },
  ]);
  assert.deepEqual(
    Object.keys(bundle.robot.links),
    ['FR_calf'],
    'authored subset materials should stay on the source link',
  );
});

test('buildUsdExportBundleFromSnapshot reuses preferred visual material colors without creating synthetic subset links', () => {
  const { positions, indices } = createTriangleBuffers();
  const preferredColor = new THREE.Color(0.74, 0.74, 0.74);
  const expectedHex = `#${preferredColor.getHexString()}`;

  const snapshot = {
    stageSourcePath: '/robots/b2/b2.usd',
    stage: {
      defaultPrimPath: '/Robot',
    },
    robotTree: {
      linkParentPairs: [['/Robot/FR_calf', null]] as Array<[string, string | null]>,
      rootLinkPaths: ['/Robot/FR_calf'],
    },
    robotMetadataSnapshot: {
      stageSourcePath: '/robots/b2/b2.usd',
      linkParentPairs: [['/Robot/FR_calf', null]] as Array<[string, string | null]>,
      jointCatalogEntries: [],
      meshCountsByLinkPath: {
        '/Robot/FR_calf': {
          visualMeshCount: 1,
          collisionMeshCount: 0,
        },
      },
    },
    render: {
      meshDescriptors: [
        {
          meshId: '/Robot/FR_calf/visuals.proto_mesh_id0',
          sectionName: 'visuals',
          resolvedPrimPath: '/Robot/FR_calf/visuals/FR_calf',
          primType: 'mesh',
          geometry: {
            geomSubsetSections: [
              { start: 0, length: 3 },
              { start: 3, length: 3 },
            ],
          },
          ranges: {
            positions: { offset: 0, count: 18, stride: 3 },
            indices: { offset: 0, count: 6, stride: 1 },
          },
        },
      ],
      materials: [],
      preferredVisualMaterialsByLinkPath: {
        '/Robot/FR_calf': {
          name: 'Calf',
          color: [preferredColor.r, preferredColor.g, preferredColor.b, 1],
        },
      },
    },
    buffers: {
      positions,
      indices,
      normals: new Float32Array(0),
      uvs: new Float32Array(0),
      transforms: new Float32Array(0),
      rangesByMeshId: {},
    },
  } as unknown as UsdSceneSnapshot;

  const currentRobot: RobotState = {
    name: 'b2_export',
    rootLinkId: 'FR_calf',
    selection: { type: null, id: null },
    links: {
      FR_calf: {
        id: 'FR_calf',
        name: 'FR_calf',
        visible: true,
        visual: {
          type: GeometryType.MESH,
          dimensions: { x: 1, y: 1, z: 1 },
          color: '#3b82f6',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collision: {
          type: GeometryType.NONE,
          dimensions: { x: 0, y: 0, z: 0 },
          color: '#ef4444',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collisionBodies: [],
        inertial: {
          mass: 0.404,
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          inertia: { ixx: 1, ixy: 0, ixz: 0, iyy: 1, iyz: 0, izz: 1 },
        },
      },
    },
    joints: {},
    materials: {
      FR_calf: {
        color: '#3b82f6',
      },
    },
  };

  const bundle = buildUsdExportBundleFromSnapshot(snapshot, {
    fileName: 'b2.usd',
    currentRobot,
  });

  assert.ok(bundle);
  assert.equal(bundle.robot.links.FR_calf.visual.color, expectedHex);
  assert.equal(bundle.robot.materials?.FR_calf?.color, expectedHex);
  assert.deepEqual(
    Object.keys(bundle.robot.links),
    ['FR_calf'],
    'preferred fallback colors should not force extra synthetic links for geom subsets',
  );
});

test('buildUsdExportBundleFromSnapshot writes OBJ vertex normals for buffered mesh exports', async () => {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const indices = new Uint32Array([0, 1, 2]);
  const normals = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]);

  const snapshot = {
    stageSourcePath: '/robots/demo/normals.usd',
    stage: {
      defaultPrimPath: '/Robot',
    },
    robotTree: {
      linkParentPairs: [['/Robot/base_link', null]] as Array<[string, string | null]>,
      rootLinkPaths: ['/Robot/base_link'],
    },
    robotMetadataSnapshot: {
      stageSourcePath: '/robots/demo/normals.usd',
      linkParentPairs: [['/Robot/base_link', null]] as Array<[string, string | null]>,
      jointCatalogEntries: [],
      meshCountsByLinkPath: {
        '/Robot/base_link': {
          visualMeshCount: 1,
          collisionMeshCount: 0,
        },
      },
    },
    render: {
      meshDescriptors: [
        {
          meshId: '/Robot/base_link/visuals.proto_mesh_id0',
          sectionName: 'visuals',
          resolvedPrimPath: '/Robot/base_link/visuals/mesh_0',
          primType: 'mesh',
          ranges: {
            positions: { offset: 0, count: 9, stride: 3 },
            indices: { offset: 0, count: 3, stride: 1 },
            normals: { offset: 0, count: 9, stride: 3 },
          },
        },
      ],
    },
    buffers: {
      positions,
      indices,
      normals,
      uvs: new Float32Array(0),
      transforms: new Float32Array(0),
      rangesByMeshId: {},
    },
  } as unknown as UsdSceneSnapshot;

  const currentRobot: RobotState = {
    name: 'normal_export',
    rootLinkId: 'base_link',
    selection: { type: null, id: null },
    links: {
      base_link: {
        id: 'base_link',
        name: 'base_link',
        visible: true,
        visual: {
          type: GeometryType.MESH,
          dimensions: { x: 1, y: 1, z: 1 },
          color: '#ffffff',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collision: {
          type: GeometryType.NONE,
          dimensions: { x: 0, y: 0, z: 0 },
          color: '#000000',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collisionBodies: [],
      },
    },
    joints: {},
    materials: {},
  };

  const bundle = buildUsdExportBundleFromSnapshot(snapshot, {
    fileName: 'normals.usd',
    currentRobot,
  });

  assert.ok(bundle);
  const objText = await bundle.meshFiles.get('base_link_visual_0.obj')?.text();
  assert.ok(objText);
  assert.match(objText, /^vn 0 0 1$/m);
  assert.match(objText, /^f 1\/\/1 2\/\/2 3\/\/3$/m);
});

test('buildUsdExportBundleFromSnapshot repairs USD normals that oppose triangle winding', async () => {
  const positions = new Float32Array([
    0, 0, 0,
    1, 0, 0,
    1, 1, 0,
    0, 1, 0,
  ]);
  const indices = new Uint32Array([0, 1, 2, 0, 2, 3]);
  const normals = new Float32Array([
    0, 0, -1,
    0, 0, -1,
    0, 0, -1,
    0, 0, -1,
  ]);

  const snapshot = {
    stageSourcePath: '/robots/demo/reversed-normals.usd',
    stage: {
      defaultPrimPath: '/Robot',
    },
    robotTree: {
      linkParentPairs: [['/Robot/base_link', null]] as Array<[string, string | null]>,
      rootLinkPaths: ['/Robot/base_link'],
    },
    robotMetadataSnapshot: {
      stageSourcePath: '/robots/demo/reversed-normals.usd',
      linkParentPairs: [['/Robot/base_link', null]] as Array<[string, string | null]>,
      jointCatalogEntries: [],
      meshCountsByLinkPath: {
        '/Robot/base_link': {
          visualMeshCount: 1,
          collisionMeshCount: 0,
        },
      },
    },
    render: {
      meshDescriptors: [
        {
          meshId: '/Robot/base_link/visuals.proto_mesh_id0',
          sectionName: 'visuals',
          resolvedPrimPath: '/Robot/base_link/visuals/mesh_0',
          primType: 'mesh',
          ranges: {
            positions: { offset: 0, count: 12, stride: 3 },
            indices: { offset: 0, count: 6, stride: 1 },
            normals: { offset: 0, count: 12, stride: 3 },
          },
        },
      ],
    },
    buffers: {
      positions,
      indices,
      normals,
      uvs: new Float32Array(0),
      transforms: new Float32Array(0),
      rangesByMeshId: {},
    },
  } as unknown as UsdSceneSnapshot;

  const currentRobot: RobotState = {
    name: 'normal_repair',
    rootLinkId: 'base_link',
    selection: { type: null, id: null },
    links: {
      base_link: {
        id: 'base_link',
        name: 'base_link',
        visible: true,
        visual: {
          type: GeometryType.MESH,
          dimensions: { x: 1, y: 1, z: 1 },
          color: '#ffffff',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collision: {
          type: GeometryType.NONE,
          dimensions: { x: 0, y: 0, z: 0 },
          color: '#000000',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collisionBodies: [],
      },
    },
    joints: {},
    materials: {},
  };

  const bundle = buildUsdExportBundleFromSnapshot(snapshot, {
    fileName: 'reversed-normals.usd',
    currentRobot,
  });

  assert.ok(bundle);
  const objText = await bundle.meshFiles.get('base_link_visual_0.obj')?.text();
  assert.ok(objText);
  assert.doesNotMatch(objText, /^vn 0 0 -1$/m);
  assert.match(objText, /^vn 0 0 1$/m);
  assert.match(objText, /^f 1\/\/1 2\/\/2 3\/\/3$/m);
  assert.match(objText, /^f 1\/\/4 3\/\/5 4\/\/6$/m);
});

test('buildUsdExportBundleFromSnapshot repairs individual opposed face-varying normals', async () => {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const indices = new Uint32Array([0, 1, 2]);
  const normals = new Float32Array([
    0, 0, -1,
    0, 0, 1,
    0, 0, 1,
  ]);

  const snapshot = {
    stageSourcePath: '/robots/demo/partially-reversed-normals.usd',
    stage: {
      defaultPrimPath: '/Robot',
    },
    robotTree: {
      linkParentPairs: [['/Robot/base_link', null]] as Array<[string, string | null]>,
      rootLinkPaths: ['/Robot/base_link'],
    },
    robotMetadataSnapshot: {
      stageSourcePath: '/robots/demo/partially-reversed-normals.usd',
      linkParentPairs: [['/Robot/base_link', null]] as Array<[string, string | null]>,
      jointCatalogEntries: [],
      meshCountsByLinkPath: {
        '/Robot/base_link': {
          visualMeshCount: 1,
          collisionMeshCount: 0,
        },
      },
    },
    render: {
      meshDescriptors: [
        {
          meshId: '/Robot/base_link/visuals.proto_mesh_id0',
          sectionName: 'visuals',
          resolvedPrimPath: '/Robot/base_link/visuals/mesh_0',
          primType: 'mesh',
          ranges: {
            positions: { offset: 0, count: 9, stride: 3 },
            indices: { offset: 0, count: 3, stride: 1 },
            normals: { offset: 0, count: 9, stride: 3 },
          },
        },
      ],
    },
    buffers: {
      positions,
      indices,
      normals,
      uvs: new Float32Array(0),
      transforms: new Float32Array(0),
      rangesByMeshId: {},
    },
  } as unknown as UsdSceneSnapshot;

  const currentRobot: RobotState = {
    name: 'partial_normal_repair',
    rootLinkId: 'base_link',
    selection: { type: null, id: null },
    links: {
      base_link: {
        id: 'base_link',
        name: 'base_link',
        visible: true,
        visual: {
          type: GeometryType.MESH,
          dimensions: { x: 1, y: 1, z: 1 },
          color: '#ffffff',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collision: {
          type: GeometryType.NONE,
          dimensions: { x: 0, y: 0, z: 0 },
          color: '#000000',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collisionBodies: [],
      },
    },
    joints: {},
    materials: {},
  };

  const bundle = buildUsdExportBundleFromSnapshot(snapshot, {
    fileName: 'partially-reversed-normals.usd',
    currentRobot,
  });

  assert.ok(bundle);
  const objText = await bundle.meshFiles.get('base_link_visual_0.obj')?.text();
  assert.ok(objText);
  assert.doesNotMatch(objText, /^vn 0 0 -1$/m);
  assert.match(objText, /^vn 0 0 1$/m);
  assert.match(objText, /^f 1\/\/1 2\/\/2 3\/\/3$/m);
});

test('repairObjFaceVaryingNormalsForExport fixes normals that oppose emitted OBJ faces', () => {
  const objText = [
    'o normal_mismatch',
    'v 0 0 0',
    'v 1 0 0',
    'v 0 1 0',
    'vn 0 0 -1',
    'vn 0 0 1',
    'vn 0 0 1',
    'f 1//1 2//2 3//3',
    '',
  ].join('\n');

  const repaired = repairObjFaceVaryingNormalsForExport(objText);

  assert.doesNotMatch(repaired, /^vn 0 0 -1$/m);
  assert.match(repaired, /^vn 0 0 1$/m);
  assert.match(repaired, /^f 1\/\/1 2\/\/2 3\/\/3$/m);
});

test('repairObjFaceVaryingNormalsForExport repairs opposed normals on small valid triangles', () => {
  const objText = [
    'o small_triangle',
    'v 0.020639 -0.365146 0.02741',
    'v 0.020838 -0.364871 0.02741',
    'v 0.001299 -0.348476 0.02741',
    'vn 0 0 -1',
    'vn 0 0 -1',
    'vn 0 0 -1',
    'f 1//1 2//2 3//3',
    '',
  ].join('\n');

  const repaired = repairObjFaceVaryingNormalsForExport(objText);

  assert.doesNotMatch(repaired, /^vn 0 0 -1$/m);
  assert.match(repaired, /^vn 0 0 1$/m);
});

test('repairObjFaceVaryingNormalsForExport repairs near-sideways normals that make faces render dark', () => {
  const objText = [
    'o dark_sideways_normal',
    'v 0 0 0',
    'v 1 0 0',
    'v 0 1 0',
    'vn 1 0 0',
    'vn 0 0 1',
    'vn 0 0 1',
    'f 1//1 2//2 3//3',
    '',
  ].join('\n');

  const repaired = repairObjFaceVaryingNormalsForExport(objText);

  assert.doesNotMatch(repaired, /^vn 1 0 0$/m);
  assert.match(repaired, /^vn 0 0 1$/m);
});

test('prepareUsdExportCacheFromSnapshot materializes exportable mesh paths and reusable mesh files', async () => {
  const { positions, indices } = createTriangleBuffers();

  const snapshot = {
    stageSourcePath: '/robots/demo/demo.usd',
    stage: {
      defaultPrimPath: '/Robot',
    },
    robotTree: {
      linkParentPairs: [
        ['/Robot/base_link', null],
        ['/Robot/link1', '/Robot/base_link'],
      ] as Array<[string, string | null]>,
      rootLinkPaths: ['/Robot/base_link'],
    },
    robotMetadataSnapshot: {
      stageSourcePath: '/robots/demo/demo.usd',
      linkParentPairs: [
        ['/Robot/base_link', null],
        ['/Robot/link1', '/Robot/base_link'],
      ] as Array<[string, string | null]>,
      jointCatalogEntries: [],
      meshCountsByLinkPath: {
        '/Robot/base_link': {
          visualMeshCount: 1,
          collisionMeshCount: 0,
        },
      },
    },
    render: {
      meshDescriptors: [
        {
          meshId: '/Robot/base_link/visuals.proto_mesh_id0',
          sectionName: 'visuals',
          resolvedPrimPath: '/Robot/base_link/visuals/mesh_0',
          primType: 'mesh',
          ranges: {
            positions: { offset: 0, count: 9, stride: 3 },
            indices: { offset: 0, count: 3, stride: 1 },
          },
        },
      ],
    },
    buffers: {
      positions,
      indices,
      normals: new Float32Array(0),
      uvs: new Float32Array(0),
      transforms: new Float32Array(0),
      rangesByMeshId: {},
    },
  };

  const prepared = prepareUsdExportCacheFromSnapshot(snapshot, {
    fileName: 'demo.usd',
  });

  assert.ok(prepared);
  assert.match(
    prepared.robotData.links.base_link.visual.meshPath || '',
    /base_link_visual_0\.obj$/,
  );
  assert.equal(Object.keys(prepared.meshFiles).length, 1);

  const preparedBlob = prepared.meshFiles[prepared.robotData.links.base_link.visual.meshPath || ''];
  assert.ok(preparedBlob);
  const meshText = await preparedBlob.text();
  assert.match(meshText, /^o base_link_visual_0/m);
});

test('prepareUsdExportCacheFromResolvedSnapshot keeps descriptor world transforms out of RobotState mesh OBJ vertices', async () => {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const indices = new Uint32Array([0, 1, 2]);
  const transforms = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 0, 0, 1]);

  const snapshot = {
    stageSourcePath: '/robots/demo/robot-state-preview.usd',
    stage: {
      defaultPrimPath: '/Robot',
    },
    robotTree: {
      linkParentPairs: [
        ['/Robot/base_link', null],
        ['/Robot/child_link', '/Robot/base_link'],
      ] as Array<[string, string | null]>,
      rootLinkPaths: ['/Robot/base_link'],
    },
    robotMetadataSnapshot: {
      stageSourcePath: '/robots/demo/robot-state-preview.usd',
      linkParentPairs: [
        ['/Robot/base_link', null],
        ['/Robot/child_link', '/Robot/base_link'],
      ] as Array<[string, string | null]>,
      jointCatalogEntries: [],
      meshCountsByLinkPath: {
        '/Robot/base_link': {
          visualMeshCount: 0,
          collisionMeshCount: 0,
        },
        '/Robot/child_link': {
          visualMeshCount: 1,
          collisionMeshCount: 0,
        },
      },
    },
    render: {
      meshDescriptors: [
        {
          meshId: '/Robot/child_link/visuals.proto_mesh_id0',
          sectionName: 'visuals',
          resolvedPrimPath: '/Robot/child_link/visuals/mesh_0',
          primType: 'mesh',
          ranges: {
            positions: { offset: 0, count: 9, stride: 3 },
            indices: { offset: 0, count: 3, stride: 1 },
            transform: { offset: 0, count: 16, stride: 16 },
          },
        },
      ],
    },
    buffers: {
      positions,
      indices,
      normals: new Float32Array(0),
      uvs: new Float32Array(0),
      transforms,
      rangesByMeshId: {},
    },
  };

  const resolution = {
    stageSourcePath: '/robots/demo/robot-state-preview.usd',
    robotData: {
      name: 'robot_state_preview',
      rootLinkId: 'base_link',
      links: {
        base_link: {
          id: 'base_link',
          name: 'base_link',
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
            color: '#cccccc',
            origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          },
          inertial: {
            mass: 1,
            origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
            inertia: { ixx: 1, ixy: 0, ixz: 0, iyy: 1, iyz: 0, izz: 1 },
          },
        },
        child_link: {
          id: 'child_link',
          name: 'child_link',
          visible: true,
          visual: {
            type: GeometryType.MESH,
            dimensions: { x: 1, y: 1, z: 1 },
            color: '#ffffff',
            origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          },
          collision: {
            type: GeometryType.NONE,
            dimensions: { x: 0, y: 0, z: 0 },
            color: '#cccccc',
            origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          },
          inertial: {
            mass: 1,
            origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
            inertia: { ixx: 1, ixy: 0, ixz: 0, iyy: 1, iyz: 0, izz: 1 },
          },
        },
      },
      joints: {
        base_to_child: {
          id: 'base_to_child',
          name: 'base_to_child',
          type: JointType.FIXED,
          parentLinkId: 'base_link',
          childLinkId: 'child_link',
          origin: { xyz: { x: 5, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          axis: { x: 0, y: 0, z: 1 },
          dynamics: { damping: 0, friction: 0 },
          hardware: { armature: 0, motorType: '', motorId: '', motorDirection: 1 as const },
        },
      },
    },
    linkIdByPath: {
      '/Robot/base_link': 'base_link',
      '/Robot/child_link': 'child_link',
    },
    linkPathById: {
      base_link: '/Robot/base_link',
      child_link: '/Robot/child_link',
    },
    jointPathById: {
      base_to_child: '/Robot/base_to_child',
    },
    childLinkPathByJointId: {
      base_to_child: '/Robot/child_link',
    },
    parentLinkPathByJointId: {
      base_to_child: '/Robot/base_link',
    },
  };

  const prepared = prepareUsdExportCacheFromResolvedSnapshot(snapshot, resolution);

  assert.equal(prepared.robotData.links.child_link.visual.meshPath, 'child_link_visual_0.obj');
  assert.equal(prepared.robotData.links.child_link.visual.doubleSided, true);
  const meshText = await prepared.meshFiles['child_link_visual_0.obj'].text();
  assert.match(meshText, /^v 0 0 0(?:\s|$)/m);
  assert.doesNotMatch(meshText, /^v 5 0 0(?:\s|$)/m);
});

test('prepareUsdExportCacheFromResolvedSnapshot omits OBJ UVs for color-only USD materials', async () => {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const indices = new Uint32Array([0, 1, 2]);
  const uvs = new Float32Array([0, 0, 1, 0, 0, 1]);
  const makeResolution = (color = '#ffffff') => ({
    stageSourcePath: '/robots/demo/color-only.usd',
    robotData: {
      name: 'color_only',
      rootLinkId: 'base_link',
      links: {
        base_link: {
          id: 'base_link',
          name: 'base_link',
          visible: true,
          visual: {
            type: GeometryType.MESH,
            dimensions: { x: 1, y: 1, z: 1 },
            color,
            origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          },
          collision: {
            type: GeometryType.NONE,
            dimensions: { x: 0, y: 0, z: 0 },
            color: '#cccccc',
            origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          },
          inertial: {
            mass: 1,
            origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
            inertia: { ixx: 1, ixy: 0, ixz: 0, iyy: 1, iyz: 0, izz: 1 },
          },
        },
      },
      joints: {},
    },
    linkIdByPath: {
      '/Robot/base_link': 'base_link',
    },
    linkPathById: {
      base_link: '/Robot/base_link',
    },
    jointPathById: {},
    childLinkPathByJointId: {},
    parentLinkPathByJointId: {},
  });
  const makeSnapshot = (material: Record<string, unknown>) => ({
    stageSourcePath: '/robots/demo/color-only.usd',
    stage: {
      defaultPrimPath: '/Robot',
    },
    robotTree: {
      linkParentPairs: [['/Robot/base_link', null]] as Array<[string, string | null]>,
      rootLinkPaths: ['/Robot/base_link'],
    },
    robotMetadataSnapshot: {
      stageSourcePath: '/robots/demo/color-only.usd',
      linkParentPairs: [['/Robot/base_link', null]] as Array<[string, string | null]>,
      jointCatalogEntries: [],
    },
    render: {
      materials: [
        {
          materialId: '/Robot/Looks/base',
          name: 'base',
          ...material,
        },
      ],
      meshDescriptors: [
        {
          meshId: '/Robot/base_link/visuals.proto_mesh_id0',
          sectionName: 'visuals',
          resolvedPrimPath: '/Robot/base_link/visuals/mesh_0',
          primType: 'mesh',
          materialId: '/Robot/Looks/base',
          normalDiagnostics: {
            postRepairLowDotCount: 0,
          },
          ranges: {
            positions: { offset: 0, count: 9, stride: 3 },
            indices: { offset: 0, count: 3, stride: 1 },
            uvs: { offset: 0, count: 6, stride: 2 },
          },
        },
      ],
    },
    buffers: {
      positions,
      indices,
      normals: new Float32Array(0),
      uvs,
      transforms: new Float32Array(0),
      rangesByMeshId: {},
    },
  });

  const colorOnly = prepareUsdExportCacheFromResolvedSnapshot(
    makeSnapshot({ color: [0.8, 0.8, 0.8] }),
    makeResolution(),
  );
  const colorOnlyText = await colorOnly.meshFiles['base_link_visual_0.obj'].text();
  assert.doesNotMatch(colorOnlyText, /^vt /m);
  assert.match(colorOnlyText, /^f 1 2 3$/m);

  const textured = prepareUsdExportCacheFromResolvedSnapshot(
    makeSnapshot({ mapPath: 'textures/base.png', opacity: null }),
    makeResolution(),
  );
  const texturedText = await textured.meshFiles['base_link_visual_0.obj'].text();
  assert.match(texturedText, /^vt 0 0$/m);
  assert.match(texturedText, /^f 1\/1 2\/2 3\/3$/m);
  assert.equal(textured.robotData.links.base_link.visual.color, '#ffffff');
  assert.equal(textured.robotData.materials?.base_link?.color, undefined);
  assert.equal(textured.robotData.materials?.base_link?.texture, 'textures/base.png');
});

test('canPrepareUsdExportCacheFromSnapshot requires mesh buffers for buffer-backed descriptors', () => {
  const snapshot = {
    stageSourcePath: '/robots/demo/demo.usd',
    render: {
      meshDescriptors: [
        {
          meshId: '/Robot/base_link/visuals.proto_mesh_id0',
          sectionName: 'visuals',
          resolvedPrimPath: '/Robot/base_link/visuals/mesh_0',
          primType: 'mesh',
          ranges: {
            positions: { offset: 0, count: 9, stride: 3 },
          },
        },
      ],
    },
    buffers: {
      rangesByMeshId: {},
    },
  } as unknown as UsdSceneSnapshot;

  assert.equal(canPrepareUsdExportCacheFromSnapshot(snapshot), false);
});

test('canPrepareUsdExportCacheFromSnapshot allows primitive-only snapshots without mesh buffers', () => {
  const snapshot = {
    stageSourcePath: '/robots/demo/primitive-only.usd',
    render: {
      meshDescriptors: [
        {
          meshId: '/Robot/base_link/collisions.proto_sphere_id0',
          sectionName: 'collisions',
          resolvedPrimPath: '/Robot/base_link/collisions/sphere_0',
          primType: 'sphere',
          radius: 0.5,
        },
      ],
    },
  } as unknown as UsdSceneSnapshot;

  assert.equal(canPrepareUsdExportCacheFromSnapshot(snapshot), true);
});

test('canPrepareUsdExportCacheFromSnapshot accepts full mesh snapshots when position buffers are present', () => {
  const snapshot = {
    stageSourcePath: '/robots/demo/full-mesh.usd',
    render: {
      meshDescriptors: [
        {
          meshId: '/Robot/base_link/visuals.proto_mesh_id0',
          sectionName: 'visuals',
          resolvedPrimPath: '/Robot/base_link/visuals/mesh_0',
          primType: 'mesh',
          ranges: {
            positions: { offset: 0, count: 9, stride: 3 },
          },
        },
      ],
    },
    buffers: {
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    },
  } as unknown as UsdSceneSnapshot;

  assert.equal(canPrepareUsdExportCacheFromSnapshot(snapshot), true);
});

test('prepareUsdExportCacheFromSnapshot hydrates live attachment visual origins before caching export data', () => {
  const positions = new Float32Array([
    0, 0, 0, 1, 0, 0, 0, 1, 0,

    0, 0, 0, 1, 0, 0, 0, 1, 0,
  ]);
  const indices = new Uint32Array([0, 1, 2, 3, 4, 5]);
  const transforms = new Float32Array([
    1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0.1, 0.2, 0.3, 1,

    1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0.4, 0.5, 0.6, 1,
  ]);

  const snapshot = {
    stageSourcePath: '/robots/demo/runtime_cache.usd',
    stage: {
      defaultPrimPath: '/Robot',
    },
    robotTree: {
      linkParentPairs: [
        ['/Robot/base_link', null],
        ['/Robot/arm_link', '/Robot/base_link'],
      ] as Array<[string, string | null]>,
      rootLinkPaths: ['/Robot/base_link'],
    },
    robotMetadataSnapshot: {
      stageSourcePath: '/robots/demo/runtime_cache.usd',
      linkParentPairs: [
        ['/Robot/base_link', null],
        ['/Robot/arm_link', '/Robot/base_link'],
      ] as Array<[string, string | null]>,
      jointCatalogEntries: [
        {
          linkPath: '/Robot/arm_link',
          parentLinkPath: '/Robot/base_link',
          jointName: 'arm_joint',
          jointTypeName: 'revolute',
          axisToken: 'Z',
          localPivotInLink: [0, 0, 0],
        },
      ],
      meshCountsByLinkPath: {
        '/Robot/base_link': {
          visualMeshCount: 0,
          collisionMeshCount: 0,
        },
        '/Robot/arm_link': {
          visualMeshCount: 2,
          collisionMeshCount: 0,
        },
      },
    },
    render: {
      meshDescriptors: [
        {
          meshId: '/Robot/arm_link/visuals.proto_mesh_id0',
          sectionName: 'visuals',
          resolvedPrimPath: '/Robot/arm_link/visuals/arm_link/mesh',
          primType: 'mesh',
          ranges: {
            positions: { offset: 0, count: 9, stride: 3 },
            indices: { offset: 0, count: 3, stride: 1 },
            transform: { offset: 0, count: 16, stride: 16 },
          },
        },
        {
          meshId: '/Robot/arm_link/visuals.proto_mesh_id1',
          sectionName: 'visuals',
          resolvedPrimPath: '/Robot/arm_link/visuals/arm_cap/mesh',
          primType: 'mesh',
          ranges: {
            positions: { offset: 9, count: 9, stride: 3 },
            indices: { offset: 3, count: 3, stride: 1 },
            transform: { offset: 16, count: 16, stride: 16 },
          },
        },
      ],
    },
    buffers: {
      positions,
      indices,
      normals: new Float32Array(0),
      uvs: new Float32Array(0),
      transforms,
      rangesByMeshId: {},
    },
  };

  const prepared = prepareUsdExportCacheFromSnapshot(snapshot, {
    fileName: 'runtime_cache.usd',
    targetWindow: {
      renderInterface: {
        getPreferredLinkWorldTransform: (linkPath: string) => {
          if (linkPath === '/Robot/base_link') {
            return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
          }
          if (linkPath === '/Robot/arm_link') {
            return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 2, 3, 1];
          }
          return null;
        },
        getWorldTransformForPrimPath: (primPath: string) => {
          if (primPath === '/Robot/arm_link/visuals/arm_link/mesh') {
            return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1.1, 2.2, 3.3, 1];
          }
          if (primPath === '/Robot/arm_link/visuals/arm_cap/mesh') {
            return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1.4, 2.5, 3.6, 1];
          }
          return null;
        },
      },
    },
  });

  assert.ok(prepared);
  assert.ok(Math.abs((prepared.robotData.links.arm_link.visual.origin.xyz.x || 0) - 0.1) < 1e-9);
  assert.ok(Math.abs((prepared.robotData.links.arm_link.visual.origin.xyz.y || 0) - 0.2) < 1e-9);
  assert.ok(Math.abs((prepared.robotData.links.arm_link.visual.origin.xyz.z || 0) - 0.3) < 1e-9);
  assert.ok(prepared.robotData.links.arm_cap);
  assert.ok(Math.abs((prepared.robotData.links.arm_cap.visual.origin.xyz.x || 0) - 0.4) < 1e-9);
  assert.ok(Math.abs((prepared.robotData.links.arm_cap.visual.origin.xyz.y || 0) - 0.5) < 1e-9);
  assert.ok(Math.abs((prepared.robotData.links.arm_cap.visual.origin.xyz.z || 0) - 0.6) < 1e-9);
  assert.ok(prepared.meshFiles['arm_link_visual_1.obj']);
});

test('prepareUsdExportCacheFromSnapshot keeps primitive collisions as native geometry without phantom OBJ exports', () => {
  const { positions, indices } = createTriangleBuffers();

  const snapshot = {
    stageSourcePath: '/robots/demo/primitive-collision.usd',
    stage: {
      defaultPrimPath: '/Robot',
    },
    robotTree: {
      linkParentPairs: [['/Robot/base_link', null]] as Array<[string, string | null]>,
      rootLinkPaths: ['/Robot/base_link'],
    },
    robotMetadataSnapshot: {
      stageSourcePath: '/robots/demo/primitive-collision.usd',
      linkParentPairs: [['/Robot/base_link', null]] as Array<[string, string | null]>,
      jointCatalogEntries: [],
      meshCountsByLinkPath: {
        '/Robot/base_link': {
          visualMeshCount: 1,
          collisionMeshCount: 2,
          collisionPrimitiveCounts: {
            cube: 1,
            cylinder: 1,
          },
        },
      },
    },
    render: {
      meshDescriptors: [
        {
          meshId: '/Robot/base_link/visuals.proto_mesh_id0',
          sectionName: 'visuals',
          resolvedPrimPath: '/Robot/base_link/visuals/mesh_0',
          primType: 'mesh',
          ranges: {
            positions: { offset: 0, count: 9, stride: 3 },
            indices: { offset: 0, count: 3, stride: 1 },
          },
        },
        {
          meshId: '/Robot/base_link/collisions.proto_box_id0',
          sectionName: 'collisions',
          resolvedPrimPath: '/Robot/base_link/collisions/box_0',
          primType: 'cube',
          extentSize: [0.2, 0.3, 0.4],
        },
        {
          meshId: '/Robot/base_link/collisions.proto_cylinder_id1',
          sectionName: 'collisions',
          resolvedPrimPath: '/Robot/base_link/collisions/cylinder_1',
          primType: 'cylinder',
          axis: 'Z',
          radius: 0.15,
          height: 0.9,
          extentSize: [0.3, 0.3, 0.9],
        },
      ],
    },
    buffers: {
      positions,
      indices,
      normals: new Float32Array(0),
      uvs: new Float32Array(0),
      transforms: new Float32Array(0),
      rangesByMeshId: {},
    },
  };

  const prepared = prepareUsdExportCacheFromSnapshot(snapshot, {
    fileName: 'primitive-collision.usd',
  });

  assert.ok(prepared);
  assert.equal(prepared.robotData.links.base_link.visual.meshPath, 'base_link_visual_0.obj');
  assert.equal(prepared.robotData.links.base_link.collision.type, GeometryType.BOX);
  assert.deepEqual(prepared.robotData.links.base_link.collision.dimensions, {
    x: 0.2,
    y: 0.3,
    z: 0.4,
  });
  assert.equal(prepared.robotData.links.base_link.collision.meshPath, undefined);
  assert.equal(prepared.robotData.links.base_link.collisionBodies?.length, 1);
  assert.equal(
    prepared.robotData.links.base_link.collisionBodies?.[0]?.type,
    GeometryType.CYLINDER,
  );
  assert.deepEqual(prepared.robotData.links.base_link.collisionBodies?.[0]?.dimensions, {
    x: 0.15,
    y: 0.9,
    z: 0,
  });
  assert.equal(prepared.robotData.links.base_link.collisionBodies?.[0]?.meshPath, undefined);
  assert.deepEqual(Object.keys(prepared.meshFiles), ['base_link_visual_0.obj']);
});

test('buildUsdExportBundleFromPreparedCache preserves current robot edits without rereading snapshot', () => {
  const prepared: UsdPreparedExportCache = {
    stageSourcePath: '/robots/demo/demo.usd',
    robotData: {
      name: 'snapshot_robot',
      rootLinkId: 'base_link',
      links: {
        base_link: {
          id: 'base_link',
          name: 'base_link',
          visible: true,
          visual: {
            type: GeometryType.MESH,
            dimensions: { x: 1, y: 1, z: 1 },
            color: '#ffffff',
            meshPath: 'base_link_visual_0.obj',
            origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          },
          collision: {
            type: GeometryType.NONE,
            dimensions: { x: 0, y: 0, z: 0 },
            color: '#cccccc',
            origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          },
          inertial: {
            mass: 1,
            origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
            inertia: { ixx: 1, ixy: 0, ixz: 0, iyy: 1, iyz: 0, izz: 1 },
          },
        },
      },
      joints: {},
    },
    meshFiles: {
      'base_link_visual_0.obj': new Blob(['o cached_mesh\nv 0 0 0\nf 1 1 1\n'], {
        type: 'text/plain',
      }),
    },
  };

  const currentRobot: RobotState = {
    name: 'edited_robot',
    rootLinkId: 'base_link',
    selection: { type: null, id: null },
    links: {
      base_link: {
        id: 'base_link',
        name: 'base_link',
        visible: true,
        visual: {
          type: GeometryType.MESH,
          dimensions: { x: 2, y: 2, z: 2 },
          color: '#ff0000',
          origin: { xyz: { x: 1, y: 2, z: 3 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collision: {
          type: GeometryType.NONE,
          dimensions: { x: 0, y: 0, z: 0 },
          color: '#00ff00',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        inertial: {
          mass: 5,
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          inertia: { ixx: 1, ixy: 0, ixz: 0, iyy: 1, iyz: 0, izz: 1 },
        },
      },
    },
    joints: {},
  };

  const bundle = buildUsdExportBundleFromPreparedCache(prepared, {
    currentRobot,
  });

  assert.ok(bundle);
  assert.equal(bundle.robot.name, 'edited_robot');
  assert.deepEqual(bundle.robot.links.base_link.visual.origin.xyz, { x: 1, y: 2, z: 3 });
  assert.equal(bundle.robot.links.base_link.visual.meshPath, 'base_link_visual_0.obj');
  assert.equal(
    bundle.meshFiles.get('base_link_visual_0.obj'),
    prepared.meshFiles['base_link_visual_0.obj'],
  );
});

test('buildUsdExportBundleFromPreparedCache keeps prepared USD geometry while stripping a synthetic world root before export', () => {
  const prepared = {
    stageSourcePath: '/robots/demo/go2.usd',
    robotData: {
      name: 'go2_description',
      rootLinkId: 'world',
      links: {
        world: {
          id: 'world',
          name: 'world',
          visible: true,
          visual: {
            type: GeometryType.NONE,
            dimensions: { x: 0, y: 0, z: 0 },
            color: '#808080',
            origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          },
          collision: {
            type: GeometryType.NONE,
            dimensions: { x: 0, y: 0, z: 0 },
            color: '#ef4444',
            origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          },
          inertial: {
            mass: 0,
            origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
            inertia: { ixx: 0, ixy: 0, ixz: 0, iyy: 0, iyz: 0, izz: 0 },
          },
        },
        base_link: {
          id: 'base_link',
          name: 'base_link',
          visible: true,
          visual: {
            type: GeometryType.MESH,
            dimensions: { x: 1, y: 1, z: 1 },
            color: '#d6d9e4',
            meshPath: 'base_link_visual_0.obj',
            origin: { xyz: { x: 0.12, y: 0.34, z: 0.56 }, rpy: { r: 0.1, p: 0.2, y: 0.3 } },
          },
          collision: {
            type: GeometryType.NONE,
            dimensions: { x: 0, y: 0, z: 0 },
            color: '#cccccc',
            origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          },
          inertial: {
            mass: 1,
            origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
            inertia: { ixx: 1, ixy: 0, ixz: 0, iyy: 1, iyz: 0, izz: 1 },
          },
        },
      },
      joints: {
        world_to_base_link: {
          id: 'world_to_base_link',
          name: 'world_to_base_link',
          type: JointType.FIXED,
          parentLinkId: 'world',
          childLinkId: 'base_link',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          axis: { x: 0, y: 0, z: 1 },
          dynamics: { damping: 0, friction: 0 },
          hardware: { armature: 0, motorType: 'None', motorId: '', motorDirection: 1 as const },
        },
      },
    },
    meshFiles: {
      'base_link_visual_0.obj': new Blob(['o prepared_mesh\nv 0 0 0\nf 1 1 1\n'], {
        type: 'text/plain',
      }),
    },
  };

  const currentRobot: RobotState = {
    name: 'go2_description',
    rootLinkId: 'base_link',
    selection: { type: null, id: null },
    links: {
      base_link: {
        id: 'base_link',
        name: 'base_link',
        visible: true,
        visual: {
          type: GeometryType.MESH,
          dimensions: { x: 1, y: 1, z: 1 },
          color: '#808080',
          origin: { xyz: { x: 0.12, y: 0.34, z: 0.56 }, rpy: { r: 0.1, p: 0.2, y: 0.3 } },
        },
        collision: {
          type: GeometryType.NONE,
          dimensions: { x: 0, y: 0, z: 0 },
          color: '#ef4444',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        inertial: {
          mass: 5,
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          inertia: { ixx: 1, ixy: 0, ixz: 0, iyy: 1, iyz: 0, izz: 1 },
        },
      },
    },
    joints: {},
  };

  const bundle = buildUsdExportBundleFromPreparedCache(prepared, {
    currentRobot,
  });

  assert.ok(bundle);
  assert.equal(bundle.robot.rootLinkId, 'base_link');
  assert.equal(bundle.robot.links.world, undefined);
  assert.equal(bundle.robot.joints.world_to_base_link, undefined);
  assert.equal(bundle.robot.links.base_link.visual.type, GeometryType.MESH);
  assert.equal(bundle.robot.links.base_link.visual.meshPath, 'base_link_visual_0.obj');
  assert.deepEqual(bundle.robot.links.base_link.visual.origin?.xyz, { x: 0.12, y: 0.34, z: 0.56 });
});

test('buildUsdExportBundleFromPreparedCache preserves non-identity synthetic world roots', () => {
  const prepared: UsdPreparedExportCache = {
    stageSourcePath: '/robots/demo/root_pose.usd',
    robotData: {
      name: 'root_pose',
      rootLinkId: 'world',
      links: {
        world: {
          id: 'world',
          name: 'world',
          visible: true,
          visual: {
            type: GeometryType.NONE,
            dimensions: { x: 0, y: 0, z: 0 },
            color: '#808080',
            origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          },
          collision: {
            type: GeometryType.NONE,
            dimensions: { x: 0, y: 0, z: 0 },
            color: '#ef4444',
            origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          },
          inertial: {
            mass: 0,
            origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
            inertia: { ixx: 0, ixy: 0, ixz: 0, iyy: 0, iyz: 0, izz: 0 },
          },
        },
        base_link: {
          id: 'base_link',
          name: 'base_link',
          visible: true,
          visual: {
            type: GeometryType.MESH,
            dimensions: { x: 1, y: 1, z: 1 },
            color: '#d6d9e4',
            meshPath: 'base_link_visual_0.obj',
            origin: { xyz: { x: 0.12, y: 0.34, z: 0.56 }, rpy: { r: 0.1, p: 0.2, y: 0.3 } },
          },
          collision: {
            type: GeometryType.NONE,
            dimensions: { x: 0, y: 0, z: 0 },
            color: '#cccccc',
            origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          },
          inertial: {
            mass: 1,
            origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
            inertia: { ixx: 1, ixy: 0, ixz: 0, iyy: 1, iyz: 0, izz: 1 },
          },
        },
      },
      joints: {
        world_to_base_link: {
          id: 'world_to_base_link',
          name: 'world_to_base_link',
          type: JointType.FIXED,
          parentLinkId: 'world',
          childLinkId: 'base_link',
          origin: { xyz: { x: 0.5, y: -0.25, z: 0.75 }, rpy: { r: 0.1, p: -0.2, y: 0.3 } },
          axis: { x: 0, y: 0, z: 1 },
          dynamics: { damping: 0, friction: 0 },
          hardware: { armature: 0, motorType: 'None', motorId: '', motorDirection: 1 as const },
        },
      },
    },
    meshFiles: {
      'base_link_visual_0.obj': new Blob(['o prepared_mesh\nv 0 0 0\nf 1 1 1\n'], {
        type: 'text/plain',
      }),
    },
  };

  const bundle = buildUsdExportBundleFromPreparedCache(prepared);

  assert.ok(bundle);
  assert.equal(bundle.robot.rootLinkId, 'world');
  assert.ok(bundle.robot.links.world);
  assert.ok(bundle.robot.joints.world_to_base_link);
  assert.deepEqual(bundle.robot.joints.world_to_base_link.origin?.xyz, {
    x: 0.5,
    y: -0.25,
    z: 0.75,
  });
});

test('resolveUsdExportSceneSnapshot prefers cached store snapshot before live render snapshot', () => {
  const cachedSnapshot = {
    stageSourcePath: '/robots/cached.usd',
    render: {
      meshDescriptors: [],
    },
  };

  let liveSnapshotReads = 0;
  const liveSnapshot = {
    stageSourcePath: '/robots/live.usd',
    render: {
      meshDescriptors: [],
    },
  };

  const resolved = resolveUsdExportSceneSnapshot({
    stageSourcePath: '/robots/cached.usd',
    cachedSnapshot,
    targetWindow: {
      renderInterface: {
        getCachedRobotSceneSnapshot: () => {
          liveSnapshotReads += 1;
          return liveSnapshot;
        },
      },
    },
  });

  assert.equal(resolved, cachedSnapshot);
  assert.equal(liveSnapshotReads, 0);
});

test('resolveUsdExportSceneSnapshot enriches cached snapshots with live preferred material records when available', () => {
  const preferredMaterial = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color('#d6d9e4'),
    roughness: 0.28,
    metalness: 0.63,
    emissive: new THREE.Color('#223344'),
    emissiveIntensity: 1.4,
    opacity: 0.85,
    transparent: true,
    transmission: 0.18,
    thickness: 0.12,
    ior: 1.45,
    clearcoat: 0.22,
    clearcoatRoughness: 0.41,
  });
  preferredMaterial.name = 'Body';
  preferredMaterial.map = new THREE.Texture();
  preferredMaterial.map.name = 'textures/body_basecolor.png';
  preferredMaterial.roughnessMap = new THREE.Texture();
  preferredMaterial.roughnessMap.name = 'textures/body_roughness.png';
  preferredMaterial.normalMap = new THREE.Texture();
  preferredMaterial.normalMap.name = 'textures/body_normal.png';
  preferredMaterial.alphaMap = new THREE.Texture();
  preferredMaterial.alphaMap.name = 'textures/body_opacity.png';

  const cachedSnapshot = {
    stageSourcePath: '/robots/go2.usd',
    render: {
      meshDescriptors: [
        {
          meshId: '/Robot/base_link/visuals.proto_mesh_id0',
          sectionName: 'visuals',
          resolvedPrimPath: '/Robot/base_link/visuals/base_link',
          primType: 'mesh',
        },
      ],
    },
  };

  const resolved = resolveUsdExportSceneSnapshot({
    stageSourcePath: '/robots/go2.usd',
    cachedSnapshot,
    targetWindow: {
      renderInterface: {
        getPreferredVisualMaterialForLink: (linkPath: string) =>
          linkPath === '/Robot/base_link' ? preferredMaterial : null,
      },
    },
  });

  assert.notEqual(resolved, cachedSnapshot);
  const preferredRecord =
    resolved?.render?.preferredVisualMaterialsByLinkPath?.['/Robot/base_link'];
  assert.ok(preferredRecord);
  assert.equal(preferredRecord.name, 'Body');
  assert.deepEqual(preferredRecord.color, [
    preferredMaterial.color.r,
    preferredMaterial.color.g,
    preferredMaterial.color.b,
  ]);
  assert.equal(preferredRecord.opacity, 0.85);
  assert.equal(preferredRecord.roughness, 0.28);
  assert.equal(preferredRecord.metalness, 0.63);
  assert.deepEqual(preferredRecord.emissive, [
    preferredMaterial.emissive.r,
    preferredMaterial.emissive.g,
    preferredMaterial.emissive.b,
  ]);
  assert.equal(preferredRecord.emissiveIntensity, 1.4);
  assert.equal(preferredRecord.transmission, 0.18);
  assert.equal(preferredRecord.thickness, 0.12);
  assert.equal(preferredRecord.ior, 1.45);
  assert.equal(preferredRecord.clearcoat, 0.22);
  assert.equal(preferredRecord.clearcoatRoughness, 0.41);
  assert.equal(preferredRecord.mapPath, 'textures/body_basecolor.png');
  assert.equal(preferredRecord.roughnessMapPath, 'textures/body_roughness.png');
  assert.equal(preferredRecord.normalMapPath, 'textures/body_normal.png');
  assert.equal(preferredRecord.alphaMapPath, 'textures/body_opacity.png');
});

test('resolveUsdExportSceneSnapshot normalizes bare stage source paths for live snapshot lookups', () => {
  let receivedStageSourcePath: string | null = null as string | null;
  const liveSnapshot = {
    stageSourcePath: '/robots/b2/b2.usd',
    render: {
      meshDescriptors: [],
    },
  };

  const resolved = resolveUsdExportSceneSnapshot({
    stageSourcePath: 'robots/b2/b2.usd',
    cachedSnapshot: null,
    targetWindow: {
      renderInterface: {
        getCachedRobotSceneSnapshot: (stageSourcePath?: string | null) => {
          receivedStageSourcePath = stageSourcePath ?? null;
          return stageSourcePath === '/robots/b2/b2.usd' ? liveSnapshot : null;
        },
      },
    },
  });

  assert.equal(receivedStageSourcePath, '/robots/b2/b2.usd');
  assert.equal(resolved, liveSnapshot);
});
