import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import {
  DEFAULT_JOINT,
  DEFAULT_LINK,
  GeometryType,
  JointType,
  type RobotData,
  type UsdSceneSnapshot,
} from '@/types';
import type { ViewerRobotDataResolution } from './viewerRobotData';
import { buildUsdRobotRuntimeFromScene } from './loadUsdRobotRuntime';
import { adaptUsdViewerSnapshotToRobotData } from './usdViewerRobotAdapter';

function createRobotData(): RobotData {
  return {
    name: 'usd_arm',
    rootLinkId: 'base',
    links: {
      base: {
        ...DEFAULT_LINK,
        id: 'base',
        name: 'base',
        visual: { ...DEFAULT_LINK.visual, type: GeometryType.NONE },
        collision: { ...DEFAULT_LINK.collision, type: GeometryType.NONE },
      },
      arm: {
        ...DEFAULT_LINK,
        id: 'arm',
        name: 'arm',
        visual: { ...DEFAULT_LINK.visual, type: GeometryType.NONE },
        collision: { ...DEFAULT_LINK.collision, type: GeometryType.NONE },
      },
    },
    joints: {
      hinge: {
        ...DEFAULT_JOINT,
        id: 'hinge',
        name: 'hinge',
        type: JointType.REVOLUTE,
        parentLinkId: 'base',
        childLinkId: 'arm',
        origin: {
          xyz: { x: 1, y: 0, z: 0 },
          rpy: { r: 0, p: 0, y: 0 },
        },
        axis: { x: 0, y: 0, z: 1 },
        limit: { lower: -Math.PI, upper: Math.PI },
      },
    },
  };
}

function createParsedScene(options: { includeBuffers?: boolean } = {}) {
  const robotData = createRobotData();
  const includeBuffers = options.includeBuffers ?? true;
  const descriptors = [
    {
      meshId: '/Robot/base/visuals.proto_mesh_id0',
      resolvedPrimPath: '/Robot/base/visuals/body',
      sectionName: 'visuals',
      primType: 'mesh',
      materialId: '/Robot/Looks/blue',
      ranges: includeBuffers
        ? {
            positions: { offset: 0, count: 9, stride: 3 },
            indices: { offset: 0, count: 3, stride: 1 },
            normals: { offset: 0, count: 9, stride: 3 },
            transform: { offset: 0, count: 16, stride: 16 },
          }
        : undefined,
    },
    {
      meshId: '/Robot/arm/visuals.proto_mesh_id0',
      resolvedPrimPath: '/Robot/arm/visuals/shell',
      sectionName: 'visuals',
      primType: 'mesh',
      materialId: '/Robot/Looks/blue',
      ranges: includeBuffers
        ? {
            positions: { offset: 9, count: 9, stride: 3 },
            indices: { offset: 3, count: 3, stride: 1 },
            normals: { offset: 9, count: 9, stride: 3 },
            transform: { offset: 16, count: 16, stride: 16 },
          }
        : undefined,
    },
  ];
  const snapshot: UsdSceneSnapshot = {
    stageSourcePath: '/Robot/robot.usda',
    stage: { defaultPrimPath: '/Robot', upAxis: 'Y', metersPerUnit: 1 },
    render: {
      meshDescriptors: descriptors,
      materials: [
        {
          materialId: '/Robot/Looks/blue',
          name: 'blue',
          color: [0.1, 0.2, 0.8],
          roughness: 0.25,
          metalness: 0.1,
        },
      ],
    },
    buffers: includeBuffers
      ? {
          positions: Float32Array.from([
            0, 0, 0, 0.5, 0, 0, 0, 0.5, 0, 0, 0, 0, 0.5, 0, 0, 0, 0.5, 0,
          ]),
          indices: Uint32Array.from([0, 1, 2, 0, 1, 2]),
          normals: Float32Array.from([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
          transforms: Float32Array.from([
            1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1,
            0, 0, 1,
          ]),
        }
      : undefined,
  };
  const resolution: ViewerRobotDataResolution = {
    robotData,
    stageSourcePath: snapshot.stageSourcePath ?? null,
    linkIdByPath: { '/Robot/base': 'base', '/Robot/arm': 'arm' },
    linkPathById: { base: '/Robot/base', arm: '/Robot/arm' },
    jointPathById: { hinge: '/Robot/joints/hinge' },
    childLinkPathByJointId: { hinge: '/Robot/arm' },
    parentLinkPathByJointId: { hinge: '/Robot/base' },
  };
  return { resolution, snapshot };
}

test('USD runtime builds baked meshes under articulated links with material and axis data', async () => {
  const runtime = await buildUsdRobotRuntimeFromScene(createParsedScene());

  assert.equal(runtime.format, 'usd');
  assert.equal(runtime.meshCount, 2);
  assert.ok(Math.abs(runtime.root.rotation.x - Math.PI / 2) < 1e-8);
  assert.deepEqual(
    runtime.joints.map((joint) => joint.urdfName),
    ['hinge'],
  );

  const armLink = runtime.root.links.arm;
  const armMesh = armLink.getObjectByName('shell') as THREE.Mesh;
  assert.ok(armMesh instanceof THREE.Mesh);
  assert.equal(armMesh.geometry.getAttribute('position').count, 3);
  assert.ok(Math.abs((armMesh.material as THREE.MeshPhysicalMaterial).color.b - 0.8) < 1e-8);
  assert.ok(Math.abs(armMesh.position.x) < 1e-8);

  const hinge = runtime.root.joints.hinge;
  const initialQuaternion = hinge.quaternion.clone();
  assert.equal(runtime.root.setJointValue('hinge', Math.PI / 3), true);
  assert.equal(hinge.quaternion.equals(initialQuaternion), false);

  runtime.dispose();
  assert.equal(runtime.root.children.length, 0);
});

test('USD runtime rejects descriptor-only snapshots instead of returning an invisible robot', async () => {
  await assert.rejects(
    buildUsdRobotRuntimeFromScene(createParsedScene({ includeBuffers: false })),
    /no baked geometry/,
  );
});

test('USD runtime renders a mesh-only static scene without inventing movable joints', async () => {
  const snapshot: UsdSceneSnapshot = {
    stageSourcePath: '/World/triangle.usda',
    stage: { defaultPrimPath: '/World', upAxis: 'Z', metersPerUnit: 1 },
    render: {
      meshDescriptors: [
        {
          meshId: '/World/visuals.proto_mesh_id0',
          resolvedPrimPath: '/World/Triangle',
          sectionName: 'visuals',
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
      positions: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      indices: Uint32Array.from([0, 1, 2]),
      transforms: Float32Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
    },
  };
  const resolution = adaptUsdViewerSnapshotToRobotData(snapshot, {
    fileName: 'triangle.usda',
  });
  assert.ok(resolution);

  const runtime = await buildUsdRobotRuntimeFromScene({ resolution, snapshot });
  assert.equal(runtime.meshCount, 1);
  assert.equal(runtime.joints.length, 0);
  assert.equal(Object.keys(runtime.robotData.joints).length, 0);
  assert.ok(runtime.root.getObjectByName('Triangle') instanceof THREE.Mesh);
  runtime.dispose();
});
