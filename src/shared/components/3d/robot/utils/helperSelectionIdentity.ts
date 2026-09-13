import { resolveLinkKey, resolveJointKey } from '@/core/robot/index';
import type { UrdfJoint, UrdfLink } from '@/types/index';

export interface HelperSelectionTargetIdentity {
  type: 'link' | 'joint';
  id: string;
}

export function resolveHelperSelectionIdentity(
  target: HelperSelectionTargetIdentity,
  robotLinks?: Record<string, UrdfLink>,
  robotJoints?: Record<string, UrdfJoint>,
): HelperSelectionTargetIdentity {
  if (target.type === 'joint') {
    return {
      type: 'joint',
      id: resolveJointKey(robotJoints ?? {}, target.id) ?? target.id,
    };
  }

  return {
    type: 'link',
    id: resolveLinkKey(robotLinks ?? {}, target.id) ?? target.id,
  };
}
