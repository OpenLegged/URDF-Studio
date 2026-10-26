import { getJointType, getSingleDofJointEntries } from './jointTypes';

export type JointPoseFormat = 'json' | 'csv';

interface JointPoseSourceJoint {
  name?: string;
  urdfName?: string;
  type?: unknown;
  jointType?: unknown;
  angle?: number;
  jointValue?: number | number[] | null;
}

export interface JointPoseSource {
  name?: string;
  joints?: Record<string, JointPoseSourceJoint>;
}

export interface JointPoseValue {
  id: string;
  name: string;
  type: string;
  position: number;
  unit: 'rad' | 'm';
}

export interface JointPose {
  version: 1;
  robot: string;
  joints: readonly JointPoseValue[];
}

function requireFinitePosition(value: number, jointId: string): number {
  if (!Number.isFinite(value)) {
    throw new Error(`Joint "${jointId}" has a non-finite pose position.`);
  }
  return value;
}

/** Capture the same actual values consumed by the panel, independently of its display unit. */
export function buildJointPose(
  robot: JointPoseSource,
  jointAngles: Readonly<Record<string, number>>,
  robotName = robot.name ?? 'robot',
): JointPose {
  return {
    version: 1,
    robot: robotName.trim() || 'robot',
    joints: getSingleDofJointEntries(robot.joints).map(([id, joint]) => {
      const name = joint.name || joint.urdfName || id;
      const rawValue = Array.isArray(joint.jointValue) ? joint.jointValue[0] : joint.jointValue;
      const position = Object.hasOwn(jointAngles, id)
        ? jointAngles[id]
        : joint.name && Object.hasOwn(jointAngles, joint.name)
          ? jointAngles[joint.name]
          : (joint.angle ?? rawValue ?? 0);
      const type = getJointType(joint);
      return {
        id,
        name,
        type,
        position: requireFinitePosition(position, id),
        unit: type === 'prismatic' ? 'm' : 'rad',
      };
    }),
  };
}

/** Serialize without rounding. CSV includes a UTF-8 BOM for spreadsheet applications. */
export function serializeJointPose(pose: JointPose, format: JointPoseFormat): string {
  pose.joints.forEach((joint) => requireFinitePosition(joint.position, joint.id));
  if (format === 'json') {
    return JSON.stringify(pose, null, 2) + '\n';
  }
  const csvCell = (value: string | number) => {
    // CSV quoting does not stop spreadsheet formulas. Only label strings need
    // a text marker; numeric positions (including negatives) remain numeric.
    const text = typeof value === 'string' && /^[\s\p{Cc}]*[=+\-@]/u.test(value)
      ? `'${value}` : String(value);
    return `"${text.replaceAll('"', '""')}"`;
  };
  const rows = pose.joints.map((joint) =>
    [joint.id, joint.name, joint.type, joint.position, joint.unit].map(csvCell).join(','),
  );
  return '\uFEFFjoint_id,joint_name,joint_type,position,unit\r\n' + rows.join('\r\n') + '\r\n';
}

export function jointPoseFileName(name: string, format: JointPoseFormat): string | null {
  const base = Array.from(name.trim().replace(/\.(?:json|csv)$/i, ''), (character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127 ? '_' : character;
  })
    .join('')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/[.\s]+$/g, '');
  return base ? `${base}.${format}` : null;
}
