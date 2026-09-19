import { JointType, type RobotData } from '@/types';
import { canGenerateUrdf } from './urdf/urdfExportSupport';

/**
 * Closed-loop constraints cannot be expressed in URDF/Xacro source, so robots
 * carrying them must fall back to a loop-capable format (SDF or MJCF).
 */
export function canPreserveClosedLoopsInSource(
  robot: Pick<RobotData, 'closedLoopConstraints'>,
  format: 'urdf' | 'xacro' | 'mjcf' | 'sdf',
): boolean {
  if (format === 'mjcf') {
    return (robot.closedLoopConstraints ?? []).every(constraint =>
      constraint.type !== 'joint' ||
      constraint.jointType === JointType.FIXED || constraint.jointType === JointType.BALL);
  }
  if (format === 'sdf') return true;
  return (robot.closedLoopConstraints?.length ?? 0) === 0;
}

/** Internal source views must not use a generator that drops or changes joint types. */
export function canPreserveJointTypesInSource(
  robot: Pick<RobotData, 'joints' | 'closedLoopConstraints'>,
  format: 'urdf' | 'xacro' | 'mjcf' | 'sdf',
): boolean {
  if (!canPreserveClosedLoopsInSource(robot, format)) return false;
  if (format === 'urdf' || format === 'xacro') {
    return canGenerateUrdf(robot);
  }
  return Object.values(robot.joints).every(joint => {
    const type = String(joint.type);
    if (type === 'free') return false;
    return format === 'mjcf' ? type !== JointType.PLANAR : type !== JointType.FLOATING;
  });
}
