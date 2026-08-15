import { JointType, type RobotData } from '@/types/robot';
import type { RobotDofMetadata, RobotJointLimit } from './types';

/**
 * Extract DOF metadata from a parsed {@link RobotData} for Motion Studio.
 *
 * Projection rules:
 * - skip joints whose type is `fixed` (JointType.FIXED === 'fixed')
 * - record finite position bounds only when `lower < upper`
 * - retain finite effort and velocity even for unbounded continuous joints
 * - linkNames come from the canonical definition link names
 */
export function extractDofMetadata(robotData: RobotData): RobotDofMetadata {
  const jointNames: string[] = [];
  const dofNames: string[] = [];
  const jointLimits: Record<string, RobotJointLimit> = {};
  const linkNames = Object.values(robotData.links)
    .map((link) => link.name)
    .filter((name) => name.length > 0);

  for (const joint of Object.values(robotData.joints)) {
    if (joint.type === JointType.FIXED || joint.mimic) continue;
    jointNames.push(joint.name);
    dofNames.push(...getJointDofNames(joint.name, joint.type));

    const lower = joint.limit?.lower;
    const upper = joint.limit?.upper;
    const effort = joint.limit?.effort;
    const velocity = joint.limit?.velocity;
    const projectedLimit: RobotJointLimit = {
      ...(effort !== undefined && Number.isFinite(effort) ? { effort } : {}),
      ...(velocity !== undefined && Number.isFinite(velocity) ? { velocity } : {}),
    };
    if (
      lower !== undefined &&
      upper !== undefined &&
      Number.isFinite(lower) &&
      Number.isFinite(upper) &&
      lower < upper
    ) {
      projectedLimit.lower = lower;
      projectedLimit.upper = upper;
    }
    if (Object.keys(projectedLimit).length > 0) {
      jointLimits[joint.name] = projectedLimit;
    }
  }

  return { jointNames, dofNames, jointLimits, linkNames };
}

function getJointDofNames(jointName: string, type: JointType): string[] {
  switch (type) {
    case JointType.PLANAR:
      return ['x', 'y', 'theta'].map((component) => `${jointName}/${component}`);
    case JointType.FLOATING:
      return ['x', 'y', 'z', 'roll', 'pitch', 'yaw'].map(
        (component) => `${jointName}/${component}`,
      );
    case JointType.BALL:
      return ['qx', 'qy', 'qz', 'qw'].map((component) => `${jointName}/${component}`);
    default:
      return [jointName];
  }
}
