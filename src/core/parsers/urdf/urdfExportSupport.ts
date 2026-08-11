import type { RobotState } from '@/types';

const UNSUPPORTED_URDF_JOINT_TYPES: ReadonlySet<string> = new Set(['ball', 'free']);

export function findUnsupportedUrdfJoint(robot: Partial<Pick<RobotState, 'joints'>>): {
  jointId: string;
  jointName: string;
  jointType: string;
} | null {
  for (const [jointId, joint] of Object.entries(robot.joints ?? {})) {
    const jointType = String(joint.type || '').toLowerCase();
    if (UNSUPPORTED_URDF_JOINT_TYPES.has(jointType)) {
      return {
        jointId,
        jointName: joint.name || jointId,
        jointType,
      };
    }
  }

  return null;
}

export function buildUnsupportedUrdfJointErrorMessage(
  jointName: string,
  jointType: string,
): string {
  return `[URDF export] Joint "${jointName}" uses unsupported ${jointType} type.`;
}

export function createUnsupportedUrdfJointError(jointName: string, jointType: string): Error {
  return new Error(buildUnsupportedUrdfJointErrorMessage(jointName, jointType));
}

export function canGenerateUrdf(robot: Partial<Pick<RobotState, 'joints'>>): boolean {
  return findUnsupportedUrdfJoint(robot) === null;
}
