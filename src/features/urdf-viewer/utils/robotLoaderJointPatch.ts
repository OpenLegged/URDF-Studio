import * as THREE from 'three';
import { URDFJoint as RuntimeURDFJoint } from '@/core/parsers/urdf/loader';
import { hasFiniteJointLimitBounds, normalizeJointLimitOrder } from '@/core/robot';
import type { JointPatchCandidate } from './robotLoaderDiff';
import { applyOriginToJoint } from './robotLoaderPatchUtils';

function getCurrentJointValues(joint: RuntimeURDFJoint): number[] {
  const jointValue = (
    joint as RuntimeURDFJoint & {
      jointValue?: unknown;
      angle?: number;
    }
  ).jointValue;

  if (Array.isArray(jointValue)) {
    return jointValue.filter((value): value is number => typeof value === 'number');
  }

  if (typeof jointValue === 'number') {
    return [jointValue];
  }

  if (typeof (joint as RuntimeURDFJoint & { angle?: number }).angle === 'number') {
    return [(joint as RuntimeURDFJoint & { angle?: number }).angle as number];
  }

  return [];
}

type RuntimeJointLookup = {
  joints: Record<string, RuntimeURDFJoint>;
  jointList: RuntimeURDFJoint[];
};

function createRuntimeJointLookup(robotModel: THREE.Object3D): RuntimeJointLookup | null {
  const joints = (robotModel as any).joints as Record<string, RuntimeURDFJoint> | undefined;
  const jointSet = new Set<RuntimeURDFJoint>();

  Object.values(joints ?? {}).forEach((joint) => {
    if (joint) {
      jointSet.add(joint);
    }
  });

  robotModel.traverse((child) => {
    if ((child as { isURDFJoint?: boolean }).isURDFJoint === true) {
      jointSet.add(child as RuntimeURDFJoint);
    }
  });

  if (!joints && jointSet.size === 0) {
    return null;
  }

  return {
    joints: joints ?? {},
    jointList: Array.from(jointSet),
  };
}

function findUniqueRuntimeJoint(
  jointList: RuntimeURDFJoint[],
  predicate: (joint: RuntimeURDFJoint) => boolean,
): RuntimeURDFJoint | null {
  let match: RuntimeURDFJoint | null = null;

  for (const joint of jointList) {
    if (!predicate(joint)) {
      continue;
    }
    if (match && match !== joint) {
      return null;
    }
    match = joint;
  }

  return match;
}

function resolveRuntimeJoint(
  lookup: RuntimeJointLookup,
  patch: JointPatchCandidate,
): RuntimeURDFJoint | null {
  const { joints, jointList } = lookup;
  const stableJointId = patch.jointId || patch.jointData.id || patch.previousJointData.id;
  if (stableJointId && joints[stableJointId]) {
    return joints[stableJointId];
  }

  // The runtime joints map is keyed by joint *name*, but a stable jointId is
  // unique per joint and is populated on userData at build time. Prefer the
  // exact stable-id match before the name fallback so an in-flight rename (name
  // changed in the store, runtime still on the old name) or cross-model name
  // collision still resolves the correct joint and keeps the edit incremental
  // instead of forcing a full rebuild (the multi-model snap-back).
  if (stableJointId) {
    const byStableId = Object.entries(joints).find(([, joint]) => {
      const runtimeJointId =
        typeof joint.userData?.jointId === 'string' ? joint.userData.jointId.trim() : '';
      return runtimeJointId === stableJointId;
    });
    if (byStableId) {
      return byStableId[1];
    }

    const traversedByStableId = findUniqueRuntimeJoint(jointList, (joint) => {
      const runtimeJointId =
        typeof joint.userData?.jointId === 'string' ? joint.userData.jointId.trim() : '';
      return runtimeJointId === stableJointId;
    });
    if (traversedByStableId) {
      return traversedByStableId;
    }
  }

  if (patch.jointName && joints[patch.jointName]) {
    return joints[patch.jointName];
  }

  const resolvedEntry = Object.entries(joints).find(([, joint]) => joint.name === patch.jointName);
  if (resolvedEntry) {
    return resolvedEntry[1];
  }

  return findUniqueRuntimeJoint(jointList, (joint) => {
    const jointWithNames = joint as RuntimeURDFJoint & { urdfName?: string };
    return (
      joint.name === patch.jointName ||
      jointWithNames.urdfName === patch.jointName ||
      joint.userData?.displayName === patch.jointName
    );
  });
}

function applyJointPatch(joint: RuntimeURDFJoint, patch: JointPatchCandidate): void {
  const currentValues = getCurrentJointValues(joint);
  const jointWithMutableState = joint as RuntimeURDFJoint & {
    axis?: THREE.Vector3;
    angle?: number;
    ignoreLimits?: boolean;
    limit?: {
      lower: number;
      upper: number;
      effort?: number;
      velocity?: number;
    };
    urdfName?: string;
  };
  const jointAxis = jointWithMutableState.axis ?? new THREE.Vector3(1, 0, 0);
  jointWithMutableState.axis = jointAxis;
  const jointLimit =
    jointWithMutableState.limit ?? (jointWithMutableState.limit = { lower: 0, upper: 0 });
  const jointDisplayName = patch.jointData.name || patch.jointName || joint.name;
  const jointId =
    patch.jointId || patch.jointData.id || patch.previousJointData.id || joint.userData?.jointId;

  if (!joint.userData) {
    joint.userData = {};
  }
  joint.name = jointDisplayName;
  jointWithMutableState.urdfName = jointDisplayName;
  joint.userData.displayName = jointDisplayName;
  if (jointId) {
    joint.userData.jointId = jointId;
  }

  joint.jointType = patch.jointData.type as RuntimeURDFJoint['jointType'];
  applyOriginToJoint(joint, patch.jointData.origin);
  joint.origPosition = joint.position.clone();
  joint.origQuaternion = joint.quaternion.clone();

  if (joint.jointType !== 'fixed') {
    joint.jointValue = null;
  }

  const axis = patch.jointData.axis;
  const axisLengthSq = axis ? axis.x * axis.x + axis.y * axis.y + axis.z * axis.z : 0;
  if (axis && axisLengthSq > 0) {
    jointAxis.set(axis.x, axis.y, axis.z).normalize();
  } else if (joint.jointType === 'planar') {
    jointAxis.set(0, 0, 1);
  } else {
    jointAxis.set(1, 0, 0);
  }

  const nextLimit = patch.jointData.limit;
  if (nextLimit) {
    const orderedLimit = normalizeJointLimitOrder(nextLimit);
    if (hasFiniteJointLimitBounds(orderedLimit)) {
      jointLimit.lower = orderedLimit.lower;
      jointLimit.upper = orderedLimit.upper;
      jointWithMutableState.ignoreLimits = false;
    } else {
      jointLimit.lower = 0;
      jointLimit.upper = 0;
      jointWithMutableState.ignoreLimits =
        joint.jointType === 'revolute' || joint.jointType === 'prismatic';
    }
    if (typeof orderedLimit.effort === 'number' && Number.isFinite(orderedLimit.effort)) {
      jointLimit.effort = orderedLimit.effort;
    } else {
      delete jointLimit.effort;
    }
    if (typeof orderedLimit.velocity === 'number' && Number.isFinite(orderedLimit.velocity)) {
      jointLimit.velocity = orderedLimit.velocity;
    } else {
      delete jointLimit.velocity;
    }
  } else {
    jointLimit.lower = 0;
    jointLimit.upper = 0;
    delete jointLimit.effort;
    delete jointLimit.velocity;
    jointWithMutableState.ignoreLimits =
      joint.jointType === 'revolute' || joint.jointType === 'prismatic';
  }

  switch (joint.jointType) {
    case 'fixed':
      joint.position.copy(joint.origPosition);
      joint.quaternion.copy(joint.origQuaternion);
      joint.jointValue = [];
      joint.matrixWorldNeedsUpdate = true;
      break;
    case 'continuous':
    case 'revolute':
    case 'prismatic':
      joint.setJointValue(currentValues[0] ?? 0);
      break;
    case 'planar':
      joint.setJointValue(currentValues[0] ?? 0, currentValues[1] ?? 0, currentValues[2] ?? 0);
      break;
    case 'floating':
      joint.setJointValue(
        currentValues[0] ?? 0,
        currentValues[1] ?? 0,
        currentValues[2] ?? 0,
        currentValues[3] ?? 0,
        currentValues[4] ?? 0,
        currentValues[5] ?? 0,
      );
      break;
    default:
      break;
  }
}

export function patchJointsInPlace(
  robotModel: THREE.Object3D,
  patches: JointPatchCandidate[],
  invalidate: () => void,
): boolean {
  if (patches.length === 0) {
    return false;
  }

  const lookup = createRuntimeJointLookup(robotModel);
  if (!lookup) {
    return false;
  }

  const runtimeJoints = patches.map((patch) => resolveRuntimeJoint(lookup, patch));
  if (runtimeJoints.some((joint) => !joint)) {
    return false;
  }

  patches.forEach((patch, index) => {
    applyJointPatch(runtimeJoints[index]!, patch);
  });

  robotModel.updateMatrixWorld(true);
  invalidate();
  return true;
}

export function patchJointInPlace(
  robotModel: THREE.Object3D,
  patch: JointPatchCandidate,
  invalidate: () => void,
): boolean {
  return patchJointsInPlace(robotModel, [patch], invalidate);
}
