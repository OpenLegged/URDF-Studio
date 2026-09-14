import { convertMjcfAngle } from '@/core/parsers/mjcf/mjcfMath';
import { JointType, type RobotData } from '@/types';

function alignAngle(actual: number | undefined, expected: number | undefined): number | undefined {
  if (actual === undefined || expected === undefined) return actual;
  // The source formatter writes radians * 180 / PI; accept only the parser's
  // deterministic degree conversion, not neighboring values within an epsilon.
  const represented = convertMjcfAngle((expected * 180) / Math.PI, 'degree');
  return actual === expected || actual === represented ? expected : actual;
}

/** Only call for angular limits serialized through a degree-based MJCF source. */
export function alignMJCFJointLimitRoundoff(actual: RobotData, expected: RobotData): RobotData {
  const expectedJoints = new Map(Object.values(expected.joints).map(joint => [joint.name, joint]));
  return {
    ...actual,
    joints: Object.fromEntries(Object.entries(actual.joints).map(([key, joint]) => {
      const target = expectedJoints.get(joint.name);
      if (!joint.limit || !target?.limit || ![
        JointType.REVOLUTE, JointType.CONTINUOUS, JointType.BALL,
      ].includes(joint.type)) return [key, joint];
      return [key, { ...joint, limit: {
        ...joint.limit,
        lower: alignAngle(joint.limit.lower, target.limit.lower),
        upper: alignAngle(joint.limit.upper, target.limit.upper),
      } }];
    })),
  };
}
