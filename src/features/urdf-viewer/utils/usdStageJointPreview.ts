import type { ViewerRobotDataResolution } from '@/lib/robot-parser/usd/viewerRobotData';
import type { UsdRuntimeJointInfoLike } from './usdRuntimeJointInfo';

export type UsdStageJointInfoLike = UsdRuntimeJointInfoLike;

export interface UsdStageJointPreview {
  activeJointId: string | null;
  jointAngles: Record<string, number>;
}

export function resolveUsdStageJointPreview(
  resolution: ViewerRobotDataResolution | null | undefined,
  linkPath: string | null | undefined,
  jointInfo: UsdStageJointInfoLike | null | undefined,
): UsdStageJointPreview {
  if (!resolution || !linkPath) {
    return {
      activeJointId: null,
      jointAngles: {},
    };
  }

  const activeJointId =
    Object.entries(resolution.childLinkPathByJointId).find(
      ([, childLinkPath]) => childLinkPath === linkPath,
    )?.[0] ?? null;

  if (!activeJointId) {
    return {
      activeJointId: null,
      jointAngles: {},
    };
  }

  const angleDeg = Number(jointInfo?.angleDeg);
  if (!Number.isFinite(angleDeg)) {
    return {
      activeJointId,
      jointAngles: {},
    };
  }

  return {
    activeJointId,
    jointAngles: {
      [activeJointId]: (angleDeg * Math.PI) / 180,
    },
  };
}
