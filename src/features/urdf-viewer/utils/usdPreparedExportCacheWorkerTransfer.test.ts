import test from 'node:test';
import assert from 'node:assert/strict';

import { GeometryType } from '@/types';
import type { RobotData } from '@/types';
import type { ViewerRobotDataResolution } from '@/lib/robot-parser/usd/viewerRobotData';
import {
  hydratePreparedUsdExportCacheFromWorker,
  serializePreparedUsdExportCacheForWorker,
} from './usdPreparedExportCacheWorkerTransfer.ts';
import type { PreparedUsdExportCacheResult } from './usdExportBundle.ts';

const demoRobotData: RobotData = {
  name: 'demo',
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
        color: '#ffffff',
        origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
      },
      inertial: {
        mass: 0,
        origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        inertia: { ixx: 0, ixy: 0, ixz: 0, iyy: 0, iyz: 0, izz: 0 },
      },
    },
  },
  joints: {},
  materials: {},
  closedLoopConstraints: [],
};

const demoResolution: ViewerRobotDataResolution = {
  robotData: demoRobotData,
  stageSourcePath: '/robots/demo/demo.usd',
  linkIdByPath: {
    '/Robot/base_link': 'base_link',
  },
  linkPathById: {
    base_link: '/Robot/base_link',
  },
  jointPathById: {},
  childLinkPathByJointId: {},
  parentLinkPathByJointId: {},
};

test('usdPreparedExportCache transfer serialization preserves mesh blobs across worker boundaries', async () => {
  const payload: PreparedUsdExportCacheResult = {
    stageSourcePath: '/robots/demo/demo.usd',
    robotData: demoRobotData,
    meshFiles: {
      'meshes/base_link_visual_0.obj': new Blob(['o base_link_visual_0\n'], { type: 'text/plain' }),
    },
    resolution: demoResolution,
  };

  const serialized = await serializePreparedUsdExportCacheForWorker(payload);

  assert.equal(serialized.payload.meshFiles[0]?.path, 'meshes/base_link_visual_0.obj');
  assert.equal(serialized.payload.meshFiles[0]?.mimeType, 'text/plain');
  assert.equal(serialized.transferables.length, 1);

  const hydrated = hydratePreparedUsdExportCacheFromWorker(serialized.payload);

  assert.equal(hydrated.stageSourcePath, payload.stageSourcePath);
  assert.equal(hydrated.resolution.stageSourcePath, payload.resolution.stageSourcePath);
  assert.equal(
    await hydrated.meshFiles['meshes/base_link_visual_0.obj']?.text(),
    'o base_link_visual_0\n',
  );
  assert.equal(hydrated.meshFiles['meshes/base_link_visual_0.obj']?.type, 'text/plain');
});

test('usdPreparedExportCache transfer serialization prefers prepared mesh bytes over blob rereads', async () => {
  const throwingBlob = {
    type: 'text/plain',
    arrayBuffer: async () => {
      throw new Error('blob read should be bypassed');
    },
  } as unknown as Blob;

  const payload: PreparedUsdExportCacheResult = {
    stageSourcePath: '/robots/demo/demo.usd',
    robotData: demoRobotData,
    meshFiles: {
      'meshes/base_link_collision_0.obj': throwingBlob,
    },
    resolution: demoResolution,
  };

  Object.defineProperty(payload, '__meshFileBytes', {
    value: {
      'meshes/base_link_collision_0.obj': new TextEncoder().encode('o base_link_collision_0\n'),
    },
    enumerable: false,
  });

  const serialized = await serializePreparedUsdExportCacheForWorker(payload);
  const hydrated = hydratePreparedUsdExportCacheFromWorker(serialized.payload);

  assert.equal(
    await hydrated.meshFiles['meshes/base_link_collision_0.obj']?.text(),
    'o base_link_collision_0\n',
  );
  assert.equal(serialized.transferables.length, 1);
});
