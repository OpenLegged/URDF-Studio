import { toRPYObjectFromQuat } from '@/core/parsers/mjcf/mjcfMath';
import { parseQuatAsObject } from '@/core/parsers/mjcf/mjcfUtils';
import type { RobotData, UrdfLink, UrdfOrigin, UrdfVisual } from '@/types';
import { formatQuaternionWxyzFromRpy } from './mjcfSourceFormatters';

type Rpy = { r: number; p: number; y: number };

function rotationsMatch(actual: Rpy, expected: Rpy): boolean {
  const matches = (candidate: Rpy) => actual.r === candidate.r
    && actual.p === candidate.p && actual.y === candidate.y;
  if (matches(expected)) return true;
  // Accept precisely the serialized quaternion's parser result. A tolerance
  // based on a larger rotation component can hide a real tiny change on another axis.
  // Parsing first normalizes the authored tuple with Math.hypot, then the
  // RPY conversion normalizes with Three.js. Reproduce both exact operations.
  const quaternion = parseQuatAsObject(formatQuaternionWxyzFromRpy(expected));
  const represented = toRPYObjectFromQuat(quaternion);
  return Boolean(represented && matches(represented));
}

function alignOrigin(actual: UrdfOrigin, expected: UrdfOrigin | undefined): UrdfOrigin {
  return expected && rotationsMatch(actual.rpy, expected.rpy)
    ? { ...actual, rpy: expected.rpy } : actual;
}

function alignGeometry(actual: UrdfVisual, expected: UrdfVisual | undefined): UrdfVisual {
  return { ...actual, origin: alignOrigin(actual.origin, expected?.origin) };
}

function alignLink(actual: UrdfLink, expected: UrdfLink | undefined): UrdfLink {
  return {
    ...actual,
    visual: alignGeometry(actual.visual, expected?.visual),
    collision: alignGeometry(actual.collision, expected?.collision),
    ...(actual.visualBodies ? { visualBodies: actual.visualBodies.map((value, index) =>
      alignGeometry(value, expected?.visualBodies?.[index])) } : {}),
    ...(actual.collisionBodies ? { collisionBodies: actual.collisionBodies.map((value, index) =>
      alignGeometry(value, expected?.collisionBodies?.[index])) } : {}),
    ...(actual.inertial?.origin ? { inertial: {
      ...actual.inertial,
      origin: alignOrigin(actual.inertial.origin, expected?.inertial?.origin),
    } } : {}),
  };
}

/**
 * MJCF encodes rotations as quaternions, so reparsing necessarily introduces
 * trigonometric roundoff. Accept only the exact RPY or its deterministic
 * quaternion representation before comparing the rest of the source semantics.
 */
export function alignMJCFRotationRoundoff(actual: RobotData, expected: RobotData): RobotData {
  const linksByName = new Map(Object.values(expected.links).map(link => [link.name, link]));
  const jointsByName = new Map(Object.values(expected.joints).map(joint => [joint.name, joint]));
  return {
    ...actual,
    links: Object.fromEntries(Object.entries(actual.links).map(([key, link]) =>
      [key, alignLink(link, linksByName.get(link.name))])),
    joints: Object.fromEntries(Object.entries(actual.joints).map(([key, joint]) => [key, {
      ...joint,
      origin: alignOrigin(joint.origin, jointsByName.get(joint.name)?.origin),
    }])),
  };
}
