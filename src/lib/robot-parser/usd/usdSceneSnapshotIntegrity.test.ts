import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_JOINT,
  DEFAULT_LINK,
  JointType,
  type RobotData,
  type UsdSceneSnapshot,
} from '@/types';
import type { ViewerRobotDataResolution } from './viewerRobotData';
import { assertUsdSceneSnapshotIntegrity } from './usdSceneSnapshotIntegrity';

function createResolution(): ViewerRobotDataResolution {
  const robotData: RobotData = {
    name: 'scene',
    rootLinkId: 'base',
    links: {
      base: { ...DEFAULT_LINK, id: 'base', name: 'base' },
      arm: { ...DEFAULT_LINK, id: 'arm', name: 'arm' },
    },
    joints: {
      hinge: {
        ...DEFAULT_JOINT,
        id: 'hinge',
        name: 'hinge',
        type: JointType.REVOLUTE,
        parentLinkId: 'base',
        childLinkId: 'arm',
      },
    },
  };
  return {
    robotData,
    stageSourcePath: '/Robot/robot.usda',
    linkIdByPath: { '/Robot/base': 'base', '/Robot/arm': 'arm' },
    linkPathById: { base: '/Robot/base', arm: '/Robot/arm' },
    jointPathById: { hinge: '/Robot/hinge' },
    childLinkPathByJointId: { hinge: '/Robot/arm' },
    parentLinkPathByJointId: { hinge: '/Robot/base' },
  };
}

test('USD snapshot integrity accepts mesh-only scenes without articulation metadata', () => {
  assert.doesNotThrow(() =>
    assertUsdSceneSnapshotIntegrity(
      {
        stage: { defaultPrimPath: '/World' },
        render: { meshDescriptors: [{ meshId: '/World/visuals.proto_mesh_id0' }] },
      },
      createResolution(),
    ),
  );
});

test('USD snapshot integrity rejects stale metadata and partial articulated topology', () => {
  assert.throws(
    () =>
      assertUsdSceneSnapshotIntegrity(
        { robotMetadataSnapshot: { stale: true, errorFlags: ['metadata-failed'] } },
        createResolution(),
      ),
    /metadata is invalid/,
  );

  const partialSnapshot: UsdSceneSnapshot = {
    robotMetadataSnapshot: {
      jointCatalogEntries: [
        {
          jointPath: '/Robot/hinge',
          parentLinkPath: '/Robot/base',
          childLinkPath: '/Robot/missing-arm',
        },
      ],
    },
  };
  assert.throws(
    () => assertUsdSceneSnapshotIntegrity(partialSnapshot, createResolution()),
    /articulated metadata is incomplete/,
  );
});
