import * as THREE from 'three';

import type { UrdfJoint } from '../../../types/index.ts';
import { escapeUsdString, formatUsdFloat, formatUsdTuple, quaternionToUsdTuple } from './usdTextFormatting.ts';
import {
  createJointAxisAlignmentQuaternion,
  type UsdJointAxisToken,
} from './usdJointAxisUtils.ts';
import { radiansToDegrees } from './usdUnitConversion.ts';

const USD_PHYSICS_AXIS_INSTANCE_ORDER = ['transX', 'transY', 'transZ', 'rotX', 'rotY', 'rotZ'];

export function sortUsdPhysicsAxisInstances(left: string, right: string): number {
  const leftIndex = USD_PHYSICS_AXIS_INSTANCE_ORDER.indexOf(left);
  const rightIndex = USD_PHYSICS_AXIS_INSTANCE_ORDER.indexOf(right);
  if (leftIndex >= 0 || rightIndex >= 0) {
    return (
      (leftIndex >= 0 ? leftIndex : Number.MAX_SAFE_INTEGER) -
      (rightIndex >= 0 ? rightIndex : Number.MAX_SAFE_INTEGER)
    );
  }
  return left.localeCompare(right);
}

export function getUsdPhysicsAxisKeys(value: Record<string, unknown> | null | undefined): string[] {
  if (!value || typeof value !== 'object') {
    return [];
  }
  return Object.keys(value)
    .filter((key) => /^[A-Za-z0-9_]+$/.test(key))
    .sort(sortUsdPhysicsAxisInstances);
}

export function formatOptionalUsdNumber(value: number | null | undefined): string | null {
  return Number.isFinite(Number(value)) ? formatUsdFloat(Number(value)) : null;
}

export function getPlanarJointLimitAxes(
  axisToken: UsdJointAxisToken,
): Record<string, { low: number; high: number }> {
  const lockedAxesByNormal: Record<
    UsdJointAxisToken,
    readonly ['transX' | 'transY' | 'transZ', 'rotX' | 'rotY' | 'rotZ', 'rotX' | 'rotY' | 'rotZ']
  > = {
    X: ['transX', 'rotY', 'rotZ'],
    Y: ['transY', 'rotX', 'rotZ'],
    Z: ['transZ', 'rotX', 'rotY'],
  };

  return Object.fromEntries(
    lockedAxesByNormal[axisToken].map((axis) => [axis, { low: 1, high: -1 }]),
  );
}

export function supportsPhysxMimicJoint(joint: UrdfJoint): boolean {
  const jointType = String(joint.type || '').toLowerCase();
  return jointType === 'revolute' || jointType === 'prismatic';
}

export function normalizeUsdPhysicsQuaternionWxyz(
  value: ArrayLike<number> | null | undefined,
): THREE.Quaternion | null {
  if (!value || typeof value.length !== 'number' || value.length < 4) {
    return null;
  }

  const w = Number(value[0]);
  const x = Number(value[1]);
  const y = Number(value[2]);
  const z = Number(value[3]);
  if (![w, x, y, z].every((entry) => Number.isFinite(entry))) {
    return null;
  }

  const quaternion = new THREE.Quaternion(x, y, z, w);
  if (!Number.isFinite(quaternion.lengthSq()) || quaternion.lengthSq() <= 1e-12) {
    return null;
  }

  return quaternion.normalize();
}

export function resolveUsdPhysicsLocalPos1(joint: UrdfJoint): [number, number, number] {
  const source = joint.usdPhysics?.localPos1;
  if (!source) {
    return [0, 0, 0];
  }

  const x = Number(source.x);
  const y = Number(source.y);
  const z = Number(source.z);
  if (![x, y, z].every((entry) => Number.isFinite(entry))) {
    return [0, 0, 0];
  }

  return [x, y, z];
}

export type UsdJointTypeName =
  | 'PhysicsJoint'
  | 'PhysicsFixedJoint'
  | 'PhysicsRevoluteJoint'
  | 'PhysicsPrismaticJoint'
  | 'PhysicsSphericalJoint'
  | 'PhysicsDistanceJoint';

export function appendUsdJointLimitAttributes({
  joint,
  typeName,
  usdLimitAxes,
  usdLimitAxisKeys,
  lines,
  childIndent,
}: {
  joint: UrdfJoint;
  typeName: UsdJointTypeName;
  usdLimitAxes: Record<string, { low?: number | null; high?: number | null }>;
  usdLimitAxisKeys: string[];
  lines: string[];
  childIndent: string;
}): void {
  const finiteJointLower = formatOptionalUsdNumber(joint.limit?.lower);
  const finiteJointUpper = formatOptionalUsdNumber(joint.limit?.upper);
  const hasFiniteJointBounds = finiteJointLower !== null && finiteJointUpper !== null;

  if (
    typeName === 'PhysicsRevoluteJoint' &&
    String(joint.type || '').toLowerCase() !== 'continuous' &&
    hasFiniteJointBounds
  ) {
    lines.push(
      `${childIndent}float physics:lowerLimit = ${formatUsdFloat(
        radiansToDegrees(Number(joint.limit?.lower)),
      )}`,
    );
    lines.push(
      `${childIndent}float physics:upperLimit = ${formatUsdFloat(
        radiansToDegrees(Number(joint.limit?.upper)),
      )}`,
    );
  } else if (typeName === 'PhysicsPrismaticJoint' && hasFiniteJointBounds) {
    lines.push(`${childIndent}float physics:lowerLimit = ${finiteJointLower}`);
    lines.push(`${childIndent}float physics:upperLimit = ${finiteJointUpper}`);
  }

  usdLimitAxisKeys.forEach((axis) => {
    const limit = usdLimitAxes[axis];
    const low = formatOptionalUsdNumber(limit?.low);
    const high = formatOptionalUsdNumber(limit?.high);
    if (low !== null) {
      lines.push(`${childIndent}float limit:${axis}:physics:low = ${low}`);
    }
    if (high !== null) {
      lines.push(`${childIndent}float limit:${axis}:physics:high = ${high}`);
    }
  });
}

export function appendUsdJointDriveAttributes({
  joint,
  driveInstanceName,
  driveStiffness,
  driveDamping,
  driveMaxForce,
  shouldEmitDrive,
  usdDriveAxisKeys,
  lines,
  childIndent,
  isIsaacSim,
}: {
  joint: UrdfJoint;
  driveInstanceName: 'angular' | 'linear' | null;
  driveStiffness: number | null;
  driveDamping: number | null;
  driveMaxForce: number | null;
  shouldEmitDrive: boolean;
  usdDriveAxisKeys: string[];
  lines: string[];
  childIndent: string;
  isIsaacSim: boolean;
}): void {
  if (shouldEmitDrive && driveInstanceName) {
    lines.push(`${childIndent}uniform token drive:${driveInstanceName}:physics:type = "force"`);
    if (driveStiffness !== null) {
      lines.push(
        `${childIndent}float drive:${driveInstanceName}:physics:stiffness = ${formatUsdFloat(
          driveStiffness,
        )}`,
      );
    }
    if (driveDamping !== null) {
      lines.push(
        `${childIndent}float drive:${driveInstanceName}:physics:damping = ${formatUsdFloat(
          driveDamping,
        )}`,
      );
    }
    if (driveMaxForce !== null) {
      lines.push(
        `${childIndent}float drive:${driveInstanceName}:physics:maxForce = ${formatUsdFloat(
          driveMaxForce,
        )}`,
      );
    }
    if (isIsaacSim) {
      lines.push(`${childIndent}float drive:${driveInstanceName}:physics:targetPosition = 0`);
    }
  }

  usdDriveAxisKeys.forEach((axis) => {
    const drive = joint.usdPhysics?.driveAxes?.[axis];
    const driveType = String(drive?.type || '').trim();
    if (driveType) {
      lines.push(
        `${childIndent}uniform token drive:${axis}:physics:type = "${escapeUsdString(driveType)}"`,
      );
    }
    (['stiffness', 'damping', 'maxForce', 'targetPosition', 'targetVelocity'] as const).forEach(
      (propertyName) => {
        const formatted = formatOptionalUsdNumber(drive?.[propertyName]);
        if (formatted !== null) {
          lines.push(`${childIndent}float drive:${axis}:physics:${propertyName} = ${formatted}`);
        }
      },
    );
  });
}

export function appendUsdJointPhysxAttributes({
  joint,
  driveInstanceName,
  maxJointVelocity,
  jointFriction,
  jointArmature,
  shouldEmitPhysxMimic,
  mimicAxisInstance,
  mimicReferenceJointPath,
  lines,
  childIndent,
}: {
  joint: UrdfJoint;
  driveInstanceName: 'angular' | 'linear' | null;
  maxJointVelocity: number | null;
  jointFriction: number | null;
  jointArmature: number | null;
  shouldEmitPhysxMimic: boolean;
  mimicAxisInstance: string;
  mimicReferenceJointPath?: string;
  lines: string[];
  childIndent: string;
}): void {
  if (maxJointVelocity !== null) {
    lines.push(
      `${childIndent}float physxJoint:maxJointVelocity = ${formatUsdFloat(maxJointVelocity)}`,
    );
  }
  if (jointFriction !== null) {
    lines.push(`${childIndent}float physxJoint:jointFriction = ${formatUsdFloat(jointFriction)}`);
  }
  if (jointArmature !== null) {
    lines.push(`${childIndent}float physxJoint:armature = ${formatUsdFloat(jointArmature)}`);
  }
  if (!shouldEmitPhysxMimic || !mimicReferenceJointPath) {
    return;
  }

  const multiplier = Number.isFinite(joint.mimic?.multiplier) ? Number(joint.mimic?.multiplier) : 1;
  const sourceOffset = Number.isFinite(joint.mimic?.offset) ? Number(joint.mimic?.offset) : 0;
  const offset = driveInstanceName === 'angular' ? -radiansToDegrees(sourceOffset) : -sourceOffset;
  lines.push(
    `${childIndent}float physxMimicJoint:${mimicAxisInstance}:gearing = ${formatUsdFloat(
      -multiplier,
    )}`,
  );
  lines.push(
    `${childIndent}float physxMimicJoint:${mimicAxisInstance}:offset = ${formatUsdFloat(offset)}`,
  );
  lines.push(
    `${childIndent}prepend rel physxMimicJoint:${mimicAxisInstance}:referenceJoint = <${mimicReferenceJointPath}>`,
  );
}

export function appendUsdJointFrameAttributes({
  joint,
  supportsAxisFrame,
  axisToken,
  lines,
  childIndent,
}: {
  joint: UrdfJoint;
  supportsAxisFrame: boolean;
  axisToken: UsdJointAxisToken;
  lines: string[];
  childIndent: string;
}): void {
  const originQuaternion = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(
      joint.origin?.rpy?.r ?? 0,
      joint.origin?.rpy?.p ?? 0,
      joint.origin?.rpy?.y ?? 0,
      'ZYX',
    ),
  );
  const localRot1Quaternion =
    normalizeUsdPhysicsQuaternionWxyz(joint.usdPhysics?.localRot1Wxyz) ??
    (supportsAxisFrame
      ? createJointAxisAlignmentQuaternion(joint.axis, axisToken)
      : new THREE.Quaternion());
  const localRot0Quaternion = originQuaternion.clone().multiply(localRot1Quaternion);
  const localPos1 = resolveUsdPhysicsLocalPos1(joint);
  const localPos0 = new THREE.Vector3(localPos1[0], localPos1[1], localPos1[2])
    .applyQuaternion(originQuaternion)
    .add(
      new THREE.Vector3(
        joint.origin?.xyz?.x ?? 0,
        joint.origin?.xyz?.y ?? 0,
        joint.origin?.xyz?.z ?? 0,
      ),
    );

  lines.push(`${childIndent}point3f physics:localPos0 = ${formatUsdTuple(localPos0.toArray())}`);
  lines.push(
    `${childIndent}custom point3f urdf:originXyz = ${formatUsdTuple([
      joint.origin?.xyz?.x ?? 0,
      joint.origin?.xyz?.y ?? 0,
      joint.origin?.xyz?.z ?? 0,
    ])}`,
  );
  lines.push(
    `${childIndent}custom quatf urdf:originQuatWxyz = ${quaternionToUsdTuple(originQuaternion)}`,
  );
  lines.push(
    `${childIndent}quatf physics:localRot0 = ${quaternionToUsdTuple(localRot0Quaternion)}`,
  );
  lines.push(`${childIndent}point3f physics:localPos1 = ${formatUsdTuple(localPos1)}`);
  lines.push(
    `${childIndent}quatf physics:localRot1 = ${quaternionToUsdTuple(localRot1Quaternion)}`,
  );
}