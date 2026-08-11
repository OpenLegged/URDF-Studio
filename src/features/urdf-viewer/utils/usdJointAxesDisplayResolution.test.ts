import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_JOINT, DEFAULT_LINK, JointType } from '@/types';
import type { ViewerRobotDataResolution } from '@/lib/robot-parser/usd/viewerRobotData';
import { createUsdJointAxesDisplayResolution } from './usdJointAxesDisplayResolution.ts';

function createResolution(originX: number): ViewerRobotDataResolution {
  return {
    stageSourcePath: '/robots/unitree/b2.usd',
    linkIdByPath: {
      '/Robot/base_link': 'base_link',
      '/Robot/hip_link': 'hip_link',
    },
    linkPathById: {
      base_link: '/Robot/base_link',
      hip_link: '/Robot/hip_link',
    },
    jointPathById: {
      hip_joint: '/Robot/joints/hip_joint',
    },
    childLinkPathByJointId: {
      hip_joint: '/Robot/hip_link',
    },
    parentLinkPathByJointId: {
      hip_joint: '/Robot/base_link',
    },
    robotData: {
      name: 'b2',
      rootLinkId: 'base_link',
      links: {
        base_link: {
          ...DEFAULT_LINK,
          id: 'base_link',
          name: 'base_link',
        },
        hip_link: {
          ...DEFAULT_LINK,
          id: 'hip_link',
          name: 'hip_link',
        },
      },
      joints: {
        hip_joint: {
          ...DEFAULT_JOINT,
          id: 'hip_joint',
          name: 'hip_joint',
          type: JointType.REVOLUTE,
          parentLinkId: 'base_link',
          childLinkId: 'hip_link',
          origin: {
            xyz: { x: originX, y: 2, z: 3 },
            rpy: { r: 0.1, p: 0.2, y: 0.3 },
          },
          axis: { x: 0, y: 1, z: 0 },
        },
      },
    },
  };
}

test('createUsdJointAxesDisplayResolution preserves authored joint pivot origins for overlays', () => {
  const authored = createResolution(0.25);
  const resolved = createResolution(4.5);

  assert.ok(resolved.robotData.joints.hip_joint.limit);
  resolved.robotData.joints.hip_joint.limit.upper = 1.75;

  const displayResolution = createUsdJointAxesDisplayResolution(resolved, authored);
  assert.ok(displayResolution);
  assert.notEqual(displayResolution, resolved);
  assert.notEqual(displayResolution?.robotData, resolved.robotData);
  assert.notEqual(displayResolution?.robotData.joints.hip_joint, resolved.robotData.joints.hip_joint);
  assert.equal(displayResolution?.robotData.joints.hip_joint.origin.xyz.x, 0.25);
  assert.equal(displayResolution?.robotData.joints.hip_joint.origin.xyz.y, 2);
  assert.equal(displayResolution?.robotData.joints.hip_joint.origin.rpy.y, 0.3);
  assert.ok(displayResolution.robotData.joints.hip_joint.limit);
  assert.equal(displayResolution.robotData.joints.hip_joint.limit.upper, 1.75);
});

test('createUsdJointAxesDisplayResolution falls back to resolved data when authored metadata is missing', () => {
  const resolved = createResolution(1.5);

  assert.equal(createUsdJointAxesDisplayResolution(resolved, null), resolved);
});
