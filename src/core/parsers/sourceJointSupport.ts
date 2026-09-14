import { JointType, type RobotData } from '@/types';
import { canGenerateUrdf } from './urdf/urdfExportSupport';

/** Internal source views must not use a generator that drops or changes joint types. */
export function canPreserveJointTypesInSource(
  robot: Pick<RobotData, 'joints'>,
  format: 'urdf' | 'xacro' | 'mjcf' | 'sdf',
): boolean {
  if (format === 'urdf' || format === 'xacro') return canGenerateUrdf(robot);
  return Object.values(robot.joints).every(joint => {
    const type = String(joint.type);
    if (type === 'free') return false;
    return format === 'mjcf' ? type !== JointType.PLANAR : type !== JointType.FLOATING;
  });
}
