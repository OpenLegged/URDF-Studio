import { resolveJointKey } from '@/core/robot/index';
import { isHardPassiveSpringJoint } from '@/core/robot/passiveSpringJoints';
import type { UrdfJoint } from '@/types/index';

type RuntimeJointPassiveSpringMetadata = {
  userData?: {
    mjcfPassiveSpringJoint?: unknown;
    mjcfHardPassiveSpringJoint?: unknown;
  };
};

export function isPassiveSpringJointDragTarget(
  jointNameOrId: string | null | undefined,
  robotJoints: Record<string, UrdfJoint> | null | undefined,
  runtimeJoint?: RuntimeJointPassiveSpringMetadata | null,
): boolean {
  if (!jointNameOrId) {
    return false;
  }

  if (runtimeJoint?.userData?.mjcfHardPassiveSpringJoint === true) {
    return true;
  }

  if (robotJoints) {
    const jointKey = resolveJointKey(robotJoints, jointNameOrId);
    const joint = jointKey ? robotJoints[jointKey] : undefined;
    if (joint) {
      return isHardPassiveSpringJoint(joint);
    }
  }

  return false;
}
