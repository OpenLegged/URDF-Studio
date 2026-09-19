import * as THREE from 'three';

import {
  JointType,
  type RobotClosedLoopJointConstraint,
  type UrdfOrigin,
  type Vector3,
} from '@/types';

export const SDF_CLOSED_LOOP_NAMESPACE = 'https://urdf-studio.com/schema/sdf/closed-loop/1';

export interface SdfClosedLoopMetadata {
  jointType: JointType;
  anchorLocalA: Vector3;
  origin?: UrdfOrigin;
  referencePosition: number;
}

function vectorText(vector: Vector3): string {
  return [vector.x, vector.y, vector.z].join(' ');
}

function readTuple(element: Element, name: string, count: number): number[] | undefined {
  const text = element.getAttribute(name);
  if (text === null) return undefined;
  const values = text.trim().split(/\s+/).map(Number);
  if (values.length !== count || !values.every(Number.isFinite)) {
    throw new Error(`Closed-loop metadata attribute "${name}" must contain ${count} finite numbers.`);
  }
  return values;
}

export function parseSdfClosedLoopMetadata(joint: Element): SdfClosedLoopMetadata | undefined {
  const metadata = Array.from(joint.children).find((element) =>
    element.namespaceURI === SDF_CLOSED_LOOP_NAMESPACE && element.localName === 'closed_loop');
  if (!metadata) return undefined;
  const jointType = metadata.getAttribute('joint_type');
  if (!Object.values(JointType).some((type) => type === jointType)) {
    throw new Error('Closed-loop metadata has an invalid joint type.');
  }
  const anchor = readTuple(metadata, 'anchor_a', 3);
  if (!anchor) throw new Error('Closed-loop metadata is missing its parent anchor.');
  const pose = readTuple(metadata, 'origin', 6);
  const quaternion = readTuple(metadata, 'quaternion_xyzw', 4);
  const reference = readTuple(metadata, 'reference_position', 1);
  return {
    jointType: jointType as JointType,
    anchorLocalA: { x: anchor[0], y: anchor[1], z: anchor[2] },
    referencePosition: reference?.[0] ?? 0,
    ...(pose ? { origin: {
      xyz: { x: pose[0], y: pose[1], z: pose[2] },
      rpy: { r: pose[3], p: pose[4], y: pose[5] },
      ...(quaternion ? { quatXyzw: {
        x: quaternion[0], y: quaternion[1], z: quaternion[2], w: quaternion[3],
      } } : {}),
    } } : {}),
  };
}

export function generateSdfClosedLoopMetadata(
  constraint: RobotClosedLoopJointConstraint,
  referencePosition: number,
): string {
  const attributes = [
    `joint_type="${constraint.jointType}"`,
    `anchor_a="${vectorText(constraint.anchorLocalA)}"`,
    `reference_position="${referencePosition}"`,
  ];
  if (constraint.origin) {
    const { xyz, rpy, quatXyzw } = constraint.origin;
    attributes.push(`origin="${vectorText(xyz)} ${rpy.r} ${rpy.p} ${rpy.y}"`);
    if (quatXyzw) {
      attributes.push(`quaternion_xyzw="${vectorText(quatXyzw)} ${quatXyzw.w}"`);
    }
  }
  return `      <urdf_studio:closed_loop ${attributes.join(' ')} />`;
}

export function closedLoopOriginQuaternion(origin?: UrdfOrigin): THREE.Quaternion {
  if (origin?.quatXyzw) {
    const { x, y, z, w } = origin.quatXyzw;
    return new THREE.Quaternion(x, y, z, w).normalize();
  }
  return new THREE.Quaternion().setFromEuler(new THREE.Euler(
    origin?.rpy.r ?? 0, origin?.rpy.p ?? 0, origin?.rpy.y ?? 0, 'ZYX',
  ));
}

function resolveLimitedAngle(angle: number, limit: RobotClosedLoopJointConstraint['limit']): number {
  const turns = 2 * Math.PI;
  const lower = limit?.lower ?? -Infinity;
  const upper = limit?.upper ?? Infinity;
  let candidate = angle;
  if (angle < lower) candidate += Math.ceil((lower - angle) / turns) * turns;
  if (angle > upper) candidate -= Math.ceil((angle - upper) / turns) * turns;
  return candidate >= lower && candidate <= upper ? candidate : angle;
}

/** SDF's native zero coordinate is the exported configuration. Keep the editor
 * zero frame separately and shift native limits by the exported coordinate. */
export function getSdfClosedLoopJointFrame(
  constraint: RobotClosedLoopJointConstraint,
  parentWorld: THREE.Matrix4,
  childWorld: THREE.Matrix4,
): { pose: UrdfOrigin; referencePosition: number } {
  const parentRotation = new THREE.Quaternion().setFromRotationMatrix(parentWorld);
  const childRotation = new THREE.Quaternion().setFromRotationMatrix(childWorld);
  const jointRotation = parentRotation.clone().multiply(closedLoopOriginQuaternion(constraint.origin));
  const localRotation = childRotation.clone().invert().multiply(jointRotation);
  const rpy = new THREE.Euler().setFromQuaternion(localRotation, 'ZYX');
  const axis = new THREE.Vector3(
    constraint.axis?.x ?? 1, constraint.axis?.y ?? 0, constraint.axis?.z ?? 0,
  ).normalize();
  let referencePosition = 0;
  if (constraint.jointType === JointType.PRISMATIC) {
    const anchorA = new THREE.Vector3().copy(constraint.anchorLocalA).applyMatrix4(parentWorld);
    const anchorB = new THREE.Vector3().copy(constraint.anchorLocalB).applyMatrix4(childWorld);
    referencePosition = anchorB.sub(anchorA).dot(axis.clone().applyQuaternion(jointRotation));
  } else if (constraint.jointType === JointType.REVOLUTE || constraint.jointType === JointType.CONTINUOUS) {
    const relative = jointRotation.clone().invert().multiply(childRotation);
    referencePosition = 2 * Math.atan2(
      relative.x * axis.x + relative.y * axis.y + relative.z * axis.z, relative.w,
    );
    referencePosition = Math.atan2(Math.sin(referencePosition), Math.cos(referencePosition));
    if (constraint.jointType === JointType.REVOLUTE) {
      referencePosition = resolveLimitedAngle(referencePosition, constraint.limit);
    }
  }
  return {
    pose: {
      xyz: { ...constraint.anchorLocalB },
      rpy: { r: rpy.x, p: rpy.y, y: rpy.z },
    },
    referencePosition,
  };
}
