import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveUsdStageJointPreview } from './usdStageJointPreview.ts';
import type { ViewerRobotDataResolution } from '@/lib/robot-parser/usd/viewerRobotData';

function createResolution(): ViewerRobotDataResolution {
  return {
    robotData: {
      name: 'test',
      links: {},
      joints: {},
      materials: {},
      rootLinkId: 'base_link',
    },
    stageSourcePath: '/robot.usd',
    linkIdByPath: {
      '/Robot/base_link': 'base_link',
      '/Robot/arm_link': 'arm_link',
    },
    linkPathById: {
      base_link: '/Robot/base_link',
      arm_link: '/Robot/arm_link',
    },
    jointPathById: {
      shoulder_joint: '/Robot/shoulder_joint',
    },
    childLinkPathByJointId: {
      shoulder_joint: '/Robot/arm_link',
    },
    parentLinkPathByJointId: {
      shoulder_joint: '/Robot/base_link',
    },
  };
}

test('resolveUsdStageJointPreview returns the active joint id and preview angle in radians', () => {
  const result = resolveUsdStageJointPreview(createResolution(), '/Robot/arm_link', { angleDeg: 45 });

  assert.equal(result.activeJointId, 'shoulder_joint');
  assert.ok(Math.abs(result.jointAngles.shoulder_joint - Math.PI / 4) < 1e-9);
});

test('resolveUsdStageJointPreview still returns the active joint when angle preview is unavailable', () => {
  const result = resolveUsdStageJointPreview(createResolution(), '/Robot/arm_link', null);

  assert.equal(result.activeJointId, 'shoulder_joint');
  assert.deepEqual(result.jointAngles, {});
});

test('resolveUsdStageJointPreview returns an empty payload for unknown links', () => {
  const result = resolveUsdStageJointPreview(createResolution(), '/Robot/unknown_link', { angleDeg: 12 });

  assert.equal(result.activeJointId, null);
  assert.deepEqual(result.jointAngles, {});
});
