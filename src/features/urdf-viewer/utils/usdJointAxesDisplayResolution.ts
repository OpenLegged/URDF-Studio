import type { ViewerRobotDataResolution } from '@/lib/robot-parser/usd/viewerRobotData';

function cloneOrigin(origin: ViewerRobotDataResolution['robotData']['joints'][string]['origin']) {
  return {
    xyz: { ...origin.xyz },
    rpy: { ...origin.rpy },
  };
}

function originsEqual(
  left: ViewerRobotDataResolution['robotData']['joints'][string]['origin'],
  right: ViewerRobotDataResolution['robotData']['joints'][string]['origin'],
) {
  return left.xyz.x === right.xyz.x
    && left.xyz.y === right.xyz.y
    && left.xyz.z === right.xyz.z
    && left.rpy.r === right.rpy.r
    && left.rpy.p === right.rpy.p
    && left.rpy.y === right.rpy.y;
}

export function createUsdJointAxesDisplayResolution(
  resolved: ViewerRobotDataResolution | null | undefined,
  authored: ViewerRobotDataResolution | null | undefined,
): ViewerRobotDataResolution | null {
  if (!resolved) {
    return null;
  }

  if (!authored?.robotData?.joints) {
    return resolved;
  }

  let changed = false;
  const joints = Object.fromEntries(
    Object.entries(resolved.robotData.joints).map(([jointId, joint]) => {
      const authoredOrigin = authored.robotData.joints[jointId]?.origin;
      if (!authoredOrigin) {
        return [jointId, joint];
      }

      if (originsEqual(joint.origin, authoredOrigin)) {
        return [jointId, joint];
      }

      changed = true;
      return [jointId, {
        ...joint,
        origin: cloneOrigin(authoredOrigin),
      }];
    }),
  );

  if (!changed) {
    return resolved;
  }

  return {
    ...resolved,
    robotData: {
      ...resolved.robotData,
      joints,
    },
  };
}
