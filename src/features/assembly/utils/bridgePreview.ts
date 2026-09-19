import * as THREE from 'three';
import { degToRad, radToDeg } from '@/core/robot/transforms';
import { BRIDGE_PREVIEW_ID } from '@/shared/utils/assembly/bridgePreviewId';
import {
  DEFAULT_JOINT,
  JointType,
  type BridgeJoint,
  type JointHardwareInterface,
  type JointQuaternion,
  type UrdfOrigin,
  type UrdfJoint,
  type Vector3,
} from '@/types';

export { BRIDGE_PREVIEW_ID };

export type BridgeRotationMode = 'euler_deg' | 'quaternion';

export interface BridgePreviewDraft {
  name?: string;
  parentComponentId: string;
  parentLinkId: string;
  childComponentId: string;
  childLinkId: string;
  jointType: JointType;
  hardwareInterface?: JointHardwareInterface;
  originXyz: Vector3;
  axis?: Vector3;
  limitLower?: number;
  limitUpper?: number;
  limitEffort?: number;
  limitVelocity?: number;
  rotationMode: BridgeRotationMode;
  rotationEulerDeg: { r: number; p: number; y: number };
  rotationQuaternion: JointQuaternion;
}

const URDF_EULER_ORDER: THREE.EulerOrder = 'ZYX';
const DEFAULT_QUATERNION: JointQuaternion = { x: 0, y: 0, z: 0, w: 1 };
const FULL_LIMIT_JOINT_TYPES = new Set<JointType>([JointType.REVOLUTE, JointType.PRISMATIC]);
const EFFORT_VELOCITY_LIMIT_JOINT_TYPES = new Set<JointType>([
  JointType.REVOLUTE,
  JointType.PRISMATIC,
  JointType.CONTINUOUS,
]);
const BRIDGE_DEFAULT_HARDWARE: UrdfJoint['hardware'] = {
  armature: 0,
  brand: '',
  motorType: 'None',
  motorId: '',
  motorDirection: 1,
};

function normalizeZero(value: number): number {
  return Object.is(value, -0) || Math.abs(value) < Number.EPSILON ? 0 : value;
}

export function normalizeBridgeQuaternion(value: JointQuaternion): JointQuaternion {
  const quaternion = new THREE.Quaternion(value.x, value.y, value.z, value.w);
  if (quaternion.lengthSq() === 0) {
    return DEFAULT_QUATERNION;
  }

  quaternion.normalize();
  return {
    x: normalizeZero(quaternion.x),
    y: normalizeZero(quaternion.y),
    z: normalizeZero(quaternion.z),
    w: normalizeZero(quaternion.w),
  };
}

export function bridgeEulerDegreesToQuaternion(value: {
  r: number;
  p: number;
  y: number;
}): JointQuaternion {
  const quaternion = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(degToRad(value.r), degToRad(value.p), degToRad(value.y), URDF_EULER_ORDER),
  );

  return normalizeBridgeQuaternion({
    x: quaternion.x,
    y: quaternion.y,
    z: quaternion.z,
    w: quaternion.w,
  });
}

export function bridgeQuaternionToEulerDegrees(value: JointQuaternion): {
  r: number;
  p: number;
  y: number;
} {
  const normalized = normalizeBridgeQuaternion(value);
  const euler = new THREE.Euler().setFromQuaternion(
    new THREE.Quaternion(normalized.x, normalized.y, normalized.z, normalized.w),
    URDF_EULER_ORDER,
  );

  return {
    r: normalizeZero(radToDeg(euler.x)),
    p: normalizeZero(radToDeg(euler.y)),
    y: normalizeZero(radToDeg(euler.z)),
  };
}

export function buildBridgeOriginFromDraft(draft: BridgePreviewDraft): UrdfOrigin {
  const quatXyzw =
    draft.rotationMode === 'quaternion'
      ? normalizeBridgeQuaternion(draft.rotationQuaternion)
      : bridgeEulerDegreesToQuaternion(draft.rotationEulerDeg);

  const eulerDegrees =
    draft.rotationMode === 'quaternion'
      ? bridgeQuaternionToEulerDegrees(quatXyzw)
      : draft.rotationEulerDeg;

  return {
    xyz: {
      x: draft.originXyz.x,
      y: draft.originXyz.y,
      z: draft.originXyz.z,
    },
    rpy: {
      r: degToRad(eulerDegrees.r),
      p: degToRad(eulerDegrees.p),
      y: degToRad(eulerDegrees.y),
    },
    quatXyzw,
  };
}

export function buildBridgeJointFromDraft(
  draft: BridgePreviewDraft,
  id = BRIDGE_PREVIEW_ID,
): UrdfJoint | null {
  if (
    !draft.parentComponentId ||
    !draft.parentLinkId ||
    !draft.childComponentId ||
    !draft.childLinkId ||
    // Same-component bridges are valid self-loop closed loops; only the
    // degenerate same-link pairing is rejected.
    (draft.parentComponentId === draft.childComponentId &&
      draft.parentLinkId === draft.childLinkId)
  ) {
    return null;
  }

  const includeFullLimit = FULL_LIMIT_JOINT_TYPES.has(draft.jointType);
  const includeEffortVelocityLimit = EFFORT_VELOCITY_LIMIT_JOINT_TYPES.has(draft.jointType);
  const limit = includeFullLimit
    ? {
        lower: draft.limitLower ?? DEFAULT_JOINT.limit?.lower ?? -1.57,
        upper: draft.limitUpper ?? DEFAULT_JOINT.limit?.upper ?? 1.57,
        effort: draft.limitEffort ?? DEFAULT_JOINT.limit?.effort ?? 100,
        velocity: draft.limitVelocity ?? DEFAULT_JOINT.limit?.velocity ?? 10,
      }
    : includeEffortVelocityLimit
      ? ({
          effort: draft.limitEffort ?? DEFAULT_JOINT.limit?.effort ?? 100,
          velocity: draft.limitVelocity ?? DEFAULT_JOINT.limit?.velocity ?? 10,
        } as UrdfJoint['limit'])
      : undefined;

  return {
    ...DEFAULT_JOINT,
    id,
    name: draft.name?.trim() || id,
    type: draft.jointType,
    parentLinkId: draft.parentLinkId,
    childLinkId: draft.childLinkId,
    origin: buildBridgeOriginFromDraft(draft),
    axis: draft.axis ?? DEFAULT_JOINT.axis,
    limit,
    hardware: {
      ...BRIDGE_DEFAULT_HARDWARE,
      ...(draft.hardwareInterface ? { hardwareInterface: draft.hardwareInterface } : {}),
    },
  };
}

export function buildBridgePreview(draft: BridgePreviewDraft): BridgeJoint | null {
  const joint = buildBridgeJointFromDraft(draft, BRIDGE_PREVIEW_ID);
  if (!joint) {
    return null;
  }

  return {
    id: BRIDGE_PREVIEW_ID,
    name: draft.name?.trim() || BRIDGE_PREVIEW_ID,
    parentComponentId: draft.parentComponentId,
    parentLinkId: draft.parentLinkId,
    childComponentId: draft.childComponentId,
    childLinkId: draft.childLinkId,
    joint,
  };
}
