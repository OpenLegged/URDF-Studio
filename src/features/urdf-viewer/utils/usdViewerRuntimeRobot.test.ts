import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_JOINT, JointType } from '@/types';
import type { ViewerRobotDataResolution } from './viewerRobotData';
import { createUsdViewerRuntimeRobot } from './usdViewerRuntimeRobot.ts';

function createResolution(): ViewerRobotDataResolution {
  return {
    stageSourcePath: '/Robot/runtime.usd',
    linkIdByPath: {
      '/Robot/base_link': 'base_link',
      '/Robot/arm_link': 'arm_link',
    },
    linkPathById: {
      base_link: '/Robot/base_link',
      arm_link: '/Robot/arm_link',
    },
    jointPathById: {
      arm_joint: '/Robot/joints/arm_joint',
    },
    childLinkPathByJointId: {
      arm_joint: '/Robot/arm_link',
    },
    parentLinkPathByJointId: {
      arm_joint: '/Robot/base_link',
    },
    robotData: {
      name: 'runtime_robot',
      rootLinkId: 'base_link',
      links: {},
      joints: {
        arm_joint: {
          ...DEFAULT_JOINT,
          id: 'arm_joint',
          name: 'arm_joint',
          type: JointType.REVOLUTE,
          parentLinkId: 'base_link',
          childLinkId: 'arm_link',
          limit: {
            ...DEFAULT_JOINT.limit,
            lower: -Math.PI / 2,
            upper: Math.PI / 2,
          },
        },
      },
    },
  };
}

function createContinuousResolution(
  initialAngle = Math.PI * 2 + Math.PI / 6,
): ViewerRobotDataResolution {
  const resolution = createResolution();
  resolution.robotData.joints.arm_joint = {
    ...resolution.robotData.joints.arm_joint,
    type: JointType.CONTINUOUS,
    angle: initialAngle,
    limit: {
      ...resolution.robotData.joints.arm_joint.limit,
      lower: 0,
      upper: 0,
    },
  };
  return resolution;
}

test('USD runtime joint preview only schedules render work and defers heavy refresh until commit', () => {
  let applyCalls = 0;
  let renderRequests = 0;
  let scheduledDecorationRefreshes = 0;
  let flushedDecorationRefreshes = 0;
  const jointAngleUpdates: Array<{ linkPath: string; angleDeg: number }> = [];

  const runtimeRobot = createUsdViewerRuntimeRobot({
    resolution: createResolution(),
    linkRotationController: {
      apply: () => {
        applyCalls += 1;
      },
      getJointInfoForLink: () => ({
        angleDeg: 0,
        lowerLimitDeg: -90,
        upperLimitDeg: 90,
      }),
      setJointAngleForLink: (linkPath: string, angleDeg: number) => {
        jointAngleUpdates.push({ linkPath, angleDeg });
        return {
          angleDeg,
          lowerLimitDeg: -90,
          upperLimitDeg: 90,
        };
      },
    },
    requestRender: () => {
      renderRequests += 1;
    },
    scheduleDecorationRefresh: () => {
      scheduledDecorationRefreshes += 1;
    },
    flushDecorationRefresh: () => {
      flushedDecorationRefreshes += 1;
    },
  });

  const joint = runtimeRobot.joints.arm_joint as {
    angle: number;
    parent?: { name?: string };
    parentLinkId?: string;
    setJointValue: (value: number) => void;
    finalizeJointValue?: () => void;
  };

  assert.equal(joint.parentLinkId, 'base_link');
  assert.equal(joint.parent?.name, 'base_link');
  joint.setJointValue(Math.PI / 4);

  assert.equal(joint.angle, Math.PI / 4);
  assert.deepEqual(jointAngleUpdates, [{ linkPath: '/Robot/arm_link', angleDeg: 45 }]);
  assert.equal(renderRequests, 1);
  assert.equal(scheduledDecorationRefreshes, 1);
  assert.equal(flushedDecorationRefreshes, 0);
  assert.equal(applyCalls, 0);

  joint.finalizeJointValue?.();
  assert.equal(flushedDecorationRefreshes, 1);
});

test('USD runtime joint skips redundant work when the requested angle is unchanged', () => {
  let renderRequests = 0;
  let scheduledDecorationRefreshes = 0;
  let setJointAngleCalls = 0;

  const runtimeRobot = createUsdViewerRuntimeRobot({
    resolution: createResolution(),
    linkRotationController: {
      apply: () => {},
      getJointInfoForLink: () => ({
        angleDeg: 0,
        lowerLimitDeg: -90,
        upperLimitDeg: 90,
      }),
      setJointAngleForLink: () => {
        setJointAngleCalls += 1;
        return {
          angleDeg: 0,
          lowerLimitDeg: -90,
          upperLimitDeg: 90,
        };
      },
    },
    requestRender: () => {
      renderRequests += 1;
    },
    scheduleDecorationRefresh: () => {
      scheduledDecorationRefreshes += 1;
    },
  });

  const joint = runtimeRobot.joints.arm_joint as {
    setJointValue: (value: number) => void;
  };

  joint.setJointValue(0);

  assert.equal(setJointAngleCalls, 0);
  assert.equal(renderRequests, 0);
  assert.equal(scheduledDecorationRefreshes, 0);
});

test('USD runtime joint defaults to neutral when RobotState has no authored angle', () => {
  const jointAngleUpdates: Array<{ linkPath: string; angleDeg: number }> = [];

  const runtimeRobot = createUsdViewerRuntimeRobot({
    resolution: createResolution(),
    linkRotationController: {
      apply: () => {},
      getJointInfoForLink: () => ({
        angleDeg: 45,
        lowerLimitDeg: 10,
        upperLimitDeg: 90,
      }),
      setJointAngleForLink: (linkPath: string, angleDeg: number) => {
        jointAngleUpdates.push({ linkPath, angleDeg });
        return {
          angleDeg,
          lowerLimitDeg: 10,
          upperLimitDeg: 90,
        };
      },
    },
  });

  const joint = runtimeRobot.joints.arm_joint as {
    angle: number;
  };

  assert.equal(joint.angle, 0);
  assert.deepEqual(jointAngleUpdates, []);
});

test('USD runtime joint writes back the clamped runtime angle without re-emitting selection sync', () => {
  const jointAngleUpdates: Array<{
    angleDeg: number;
    linkPath: string;
    options?: { emitSelectionChanged?: boolean };
  }> = [];

  const runtimeRobot = createUsdViewerRuntimeRobot({
    resolution: createResolution(),
    linkRotationController: {
      apply: () => {},
      getJointInfoForLink: () => ({
        angleDeg: 0,
        lowerLimitDeg: -90,
        upperLimitDeg: 90,
      }),
      setJointAngleForLink: (
        linkPath: string,
        angleDeg: number,
        options?: { emitSelectionChanged?: boolean },
      ) => {
        jointAngleUpdates.push({ linkPath, angleDeg, options });
        return {
          angleDeg: 30,
          lowerLimitDeg: -90,
          upperLimitDeg: 90,
        };
      },
    },
  });

  const joint = runtimeRobot.joints.arm_joint as {
    angle: number;
    setJointValue: (value: number) => void;
  };

  joint.setJointValue(Math.PI / 4);

  assert.equal(joint.angle, Math.PI / 6);
  assert.deepEqual(jointAngleUpdates, [
    {
      linkPath: '/Robot/arm_link',
      angleDeg: 45,
      options: { emitSelectionChanged: false },
    },
  ]);
});

test('USD runtime continuous joint keeps the accumulated angle while driving the wrapped runtime pose', () => {
  const jointAngleUpdates: Array<{
    angleDeg: number;
    linkPath: string;
  }> = [];
  const initialAngle = Math.PI * 2 + Math.PI / 6;
  const nextAngle = initialAngle + Math.PI / 2;

  const runtimeRobot = createUsdViewerRuntimeRobot({
    resolution: createContinuousResolution(initialAngle),
    linkRotationController: {
      apply: () => {},
      getJointInfoForLink: () => ({
        angleDeg: 30,
      }),
      setJointAngleForLink: (linkPath: string, angleDeg: number) => {
        jointAngleUpdates.push({ linkPath, angleDeg });
        return {
          angleDeg,
        };
      },
    },
  });

  const joint = runtimeRobot.joints.arm_joint as {
    angle: number;
    setJointValue: (value: number) => void;
  };

  assert.ok(Math.abs(joint.angle - initialAngle) < 1e-12);

  // The runtime is reset to the initial angle during creation, so one update
  // is already recorded before any explicit setJointValue call.
  const baselineUpdates = jointAngleUpdates.length;

  joint.setJointValue(nextAngle);

  assert.ok(Math.abs(joint.angle - nextAngle) < 1e-12);
  assert.equal(jointAngleUpdates.length, baselineUpdates + 1);
  const lastUpdate = jointAngleUpdates[jointAngleUpdates.length - 1];
  assert.equal(lastUpdate?.linkPath, '/Robot/arm_link');
  assert.ok(Math.abs((lastUpdate?.angleDeg ?? 0) - 120) < 1e-9);
});
