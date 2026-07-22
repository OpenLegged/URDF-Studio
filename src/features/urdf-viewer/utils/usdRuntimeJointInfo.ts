import { clampJointInteractionValue } from '@/core/robot';
import { JointType } from '@/types';

export interface UsdRuntimeJointInfoLike {
  angleDeg?: number;
  lowerLimitDeg?: number;
  upperLimitDeg?: number;
}

interface UsdRuntimeJointLimitLike {
  lower?: number | null;
  upper?: number | null;
}

interface UsdRuntimeJointLike {
  type?: string | null;
  limit?: UsdRuntimeJointLimitLike | null;
}

export function radiansToDegrees(value: number | null | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? (value * 180) / Math.PI : undefined;
}

export function degreesToRadians(value: number | null | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? (value * Math.PI) / 180 : undefined;
}

export function getUsdRuntimeJointLimitDegrees(
  joint: UsdRuntimeJointLike | null | undefined,
): Pick<UsdRuntimeJointInfoLike, 'lowerLimitDeg' | 'upperLimitDeg'> {
  if (joint?.type === JointType.CONTINUOUS) {
    return {
      lowerLimitDeg: -180,
      upperLimitDeg: 180,
    };
  }

  return {
    lowerLimitDeg: radiansToDegrees(joint?.limit?.lower),
    upperLimitDeg: radiansToDegrees(joint?.limit?.upper),
  };
}

export function createUsdRuntimeJointInfo(
  joint: UsdRuntimeJointLike | null | undefined,
  angleRad: number | null | undefined,
): UsdRuntimeJointInfoLike {
  return {
    angleDeg: radiansToDegrees(angleRad),
    ...getUsdRuntimeJointLimitDegrees(joint),
  };
}

export function clampUsdRuntimeJointAngleDegrees(
  joint: UsdRuntimeJointLike | null | undefined,
  angleDeg: number,
): number {
  if (joint?.type === JointType.CONTINUOUS) {
    return angleDeg;
  }

  const numericAngleDeg = Number(angleDeg);
  if (!Number.isFinite(numericAngleDeg)) {
    return numericAngleDeg;
  }

  const { lowerLimitDeg, upperLimitDeg } = getUsdRuntimeJointLimitDegrees(joint);
  if (!Number.isFinite(lowerLimitDeg) || !Number.isFinite(upperLimitDeg)) {
    return numericAngleDeg;
  }

  return clampJointInteractionValue(numericAngleDeg, lowerLimitDeg, upperLimitDeg);
}

export function resolveUsdRuntimeJointLimitsRadians(
  jointInfo: UsdRuntimeJointInfoLike | null | undefined,
  fallbackLimits: UsdRuntimeJointLimitLike | null | undefined,
) {
  return {
    lower: degreesToRadians(jointInfo?.lowerLimitDeg) ?? fallbackLimits?.lower,
    upper: degreesToRadians(jointInfo?.upperLimitDeg) ?? fallbackLimits?.upper,
  };
}
