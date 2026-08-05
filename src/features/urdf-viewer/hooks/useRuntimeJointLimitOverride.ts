import { useEffect } from 'react';

import { hasFiniteJointLimitBounds } from '@/core/robot';

interface LimitOverridableRuntimeJoint {
  jointType?: string;
  type?: string;
  ignoreLimits?: boolean;
  limit?: { lower?: number; upper?: number } | null;
}

interface UseRuntimeJointLimitOverrideParams {
  joints: Record<string, LimitOverridableRuntimeJoint> | null | undefined;
  ignoreLimits: boolean;
  requestSceneRefresh: () => void;
}

/** Position limits only exist for these runtime joint types. */
function isPositionLimitedJoint(joint: LimitOverridableRuntimeJoint): boolean {
  const jointType = joint.jointType ?? joint.type;
  return jointType === 'revolute' || jointType === 'prismatic';
}

/**
 * Mirror the temporary limit override onto the live runtime joints.
 *
 * Turning the override off restores each joint to the rule the runtime builder
 * uses (`ignoreLimits = !hasFiniteLimits`) rather than a blanket `false`, so
 * joints that never had finite limits keep travelling freely.
 */
export function useRuntimeJointLimitOverride({
  joints,
  ignoreLimits,
  requestSceneRefresh,
}: UseRuntimeJointLimitOverrideParams): void {
  useEffect(() => {
    if (!joints) {
      return;
    }

    let changed = false;
    Object.values(joints).forEach((joint) => {
      if (!joint || !isPositionLimitedJoint(joint)) {
        return;
      }

      const nextIgnoreLimits = ignoreLimits || !hasFiniteJointLimitBounds(joint.limit);
      if (joint.ignoreLimits !== nextIgnoreLimits) {
        joint.ignoreLimits = nextIgnoreLimits;
        changed = true;
      }
    });

    if (changed) {
      requestSceneRefresh();
    }
  }, [ignoreLimits, joints, requestSceneRefresh]);
}
