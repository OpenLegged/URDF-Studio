import type { RefObject } from 'react';
import * as THREE from 'three';
import { getJointActualAngleFromMotionAngle, resolveJointKey } from '@/core/robot';
import { requestShadowMapRefresh } from '@/shared/components/3d/scene/shadowMapRefresh';
import { unwrapContinuousJointAngle } from '@/shared/utils/continuousJointAngle';
import type { JointPanelActiveJointOptions } from '@/shared/utils/jointPanelStore';
import { JointType, type UrdfJoint } from '@/types';
import {
  createDirectJointDragGeometry,
  JOINT_DRAG_EPSILON,
} from './directJointDragGeometry';
import {
  createDirectJointDragJointResolver,
  type DraggableRuntimeJoint,
} from './directJointDragJointResolver';
import { resolveRevoluteDragStep } from './jointDragDelta';
import { createJointDragFrameSync } from './jointDragFrameSync';
import { resolveJointDragRuntimeStep } from './jointDragRuntimeStep';
import { createJointDragStoreSync } from './jointDragStoreSync';

const MAX_REVOLUTE_DELTA_PER_FRAME = Math.PI / 8;
const JOINT_DRAG_STORE_SYNC_INTERVAL = 16;

export type { DraggableRuntimeJoint } from './directJointDragJointResolver';

interface DirectJointDragState {
  isDraggingJoint: RefObject<boolean>;
  dragJoint: RefObject<DraggableRuntimeJoint | null>;
  runtimeValue: RefObject<number | null>;
  hitDistance: RefObject<number>;
  lastRay: RefObject<THREE.Ray>;
}

interface CreateDirectJointDragControllerOptions {
  state: DirectJointDragState;
  robot: THREE.Object3D | null;
  robotJoints: Record<string, UrdfJoint> | undefined;
  camera: THREE.Camera;
  renderer: THREE.WebGLRenderer;
  throttleChanges: boolean;
  deferRuntimeUpdate: boolean;
  updatePointerFromLocalPoint: (localX: number, localY: number) => boolean;
  getCurrentRay: () => THREE.Ray;
  onChange: (jointName: string, angle: number) => void;
  onCommit: (jointName: string, angle: number) => void;
  onDraggingChange: (dragging: boolean) => void;
  onActiveJointChange: (
    jointName: string,
    options: JointPanelActiveJointOptions,
  ) => void;
  invalidate: () => void;
}

function readRuntimeJointFallback(joint: DraggableRuntimeJoint): number {
  // Preserve the pre-extraction runtime fallback exactly. Some loaders expose
  // jointValue as an array; the legacy path passed that value through here and
  // only coerced it when a drag session started.
  return (joint.angle ?? joint.jointValue ?? 0) as number;
}

function resolveActualAngle(
  robotJoints: Record<string, UrdfJoint> | undefined,
  jointName: string,
  runtimeMotionAngle: number,
): number {
  const sourceJoints = robotJoints ?? {};
  const jointKey = resolveJointKey(sourceJoints, jointName) ?? jointName;
  const sourceJoint = sourceJoints[jointKey];
  if (!sourceJoint) {
    return runtimeMotionAngle;
  }

  const actualAngle = getJointActualAngleFromMotionAngle(sourceJoint, runtimeMotionAngle);
  if (sourceJoint.type !== JointType.CONTINUOUS) {
    return actualAngle;
  }

  const referenceAngle = Number(sourceJoint.angle ?? actualAngle);
  return Number.isFinite(referenceAngle)
    ? unwrapContinuousJointAngle(actualAngle, referenceAngle)
    : actualAngle;
}

function resolveCommitPayload(
  robotJoints: Record<string, UrdfJoint> | undefined,
  joint: DraggableRuntimeJoint | null,
  runtimeValue: number | null,
): { name: string; angle: number } | null {
  if (!joint) {
    return null;
  }
  return {
    name: joint.name,
    angle: resolveActualAngle(
      robotJoints,
      joint.name,
      runtimeValue ?? readRuntimeJointFallback(joint),
    ),
  };
}

/** Owns the mutable runtime state, RAF work, and store sync for direct joint dragging. */
export function createDirectJointDragController({
  state,
  robot,
  robotJoints,
  camera,
  renderer,
  throttleChanges,
  deferRuntimeUpdate,
  updatePointerFromLocalPoint,
  getCurrentRay,
  onChange,
  onCommit,
  onDraggingChange,
  onActiveJointChange,
  invalidate,
}: CreateDirectJointDragControllerOptions) {
  const jointDragStoreSync = createJointDragStoreSync({
    onDragChange: onChange,
    onDragCommit: onCommit,
    throttleChanges,
    intervalMs: JOINT_DRAG_STORE_SYNC_INTERVAL,
  });
  const tempPrevHitPoint = new THREE.Vector3();
  const tempNewHitPoint = new THREE.Vector3();
  const jointDragGeometry = createDirectJointDragGeometry(camera);
  const { findParentJoint, resolveJointObject } = createDirectJointDragJointResolver({
    robot,
    robotJoints,
  });

  let pendingRevoluteDelta = 0;
  let revoluteDeltaFrameHandle: number | null = null;

  const applyJointDelta = (delta: number) => {
    const joint = state.dragJoint.current;
    if (!joint || Math.abs(delta) <= JOINT_DRAG_EPSILON) {
      return;
    }

    const step = resolveJointDragRuntimeStep({
      currentRuntimeValue: state.runtimeValue.current,
      fallbackRuntimeValue: readRuntimeJointFallback(joint),
      delta,
      jointType: joint.jointType ?? '',
      limit: joint.limit,
      deferRuntimeUpdate,
      epsilon: JOINT_DRAG_EPSILON,
    });
    if (step.changed && joint.setJointValue) {
      state.runtimeValue.current = step.nextRuntimeValue;
      if (step.shouldApplyRuntimeUpdate) {
        joint.setJointValue(step.nextRuntimeValue);
        requestShadowMapRefresh(renderer);
      }
      jointDragStoreSync.emit(
        joint.name,
        resolveActualAngle(robotJoints, joint.name, step.nextRuntimeValue),
      );
    }
  };

  const cancelPendingRevoluteDelta = () => {
    if (revoluteDeltaFrameHandle !== null) {
      window.cancelAnimationFrame(revoluteDeltaFrameHandle);
      revoluteDeltaFrameHandle = null;
    }
    pendingRevoluteDelta = 0;
  };

  const schedulePendingRevoluteDelta = () => {
    if (
      revoluteDeltaFrameHandle !== null ||
      Math.abs(pendingRevoluteDelta) <= JOINT_DRAG_EPSILON
    ) {
      return;
    }

    revoluteDeltaFrameHandle = window.requestAnimationFrame(() => {
      revoluteDeltaFrameHandle = null;
      if (!state.isDraggingJoint.current || !state.dragJoint.current) {
        pendingRevoluteDelta = 0;
        return;
      }
      const dragStep = resolveRevoluteDragStep({
        pendingDelta: pendingRevoluteDelta,
        maxStep: MAX_REVOLUTE_DELTA_PER_FRAME,
        epsilon: JOINT_DRAG_EPSILON,
      });
      pendingRevoluteDelta = dragStep.pendingDelta;
      applyJointDelta(dragStep.appliedDelta);
      invalidate();
      schedulePendingRevoluteDelta();
    });
  };

  const applyRevoluteJointDelta = (delta: number) => {
    const dragStep = resolveRevoluteDragStep({
      pendingDelta: pendingRevoluteDelta,
      nextDelta: delta,
      maxStep: MAX_REVOLUTE_DELTA_PER_FRAME,
      epsilon: JOINT_DRAG_EPSILON,
    });
    pendingRevoluteDelta = dragStep.pendingDelta;
    applyJointDelta(dragStep.appliedDelta);
    schedulePendingRevoluteDelta();
  };

  const flushPendingRevoluteDelta = () => {
    if (revoluteDeltaFrameHandle !== null) {
      window.cancelAnimationFrame(revoluteDeltaFrameHandle);
      revoluteDeltaFrameHandle = null;
    }
    while (Math.abs(pendingRevoluteDelta) > JOINT_DRAG_EPSILON) {
      const dragStep = resolveRevoluteDragStep({
        pendingDelta: pendingRevoluteDelta,
        maxStep: MAX_REVOLUTE_DELTA_PER_FRAME,
        epsilon: JOINT_DRAG_EPSILON,
      });
      pendingRevoluteDelta = dragStep.pendingDelta;
      applyJointDelta(dragStep.appliedDelta);
    }
  };

  const moveRay = (toRay: THREE.Ray) => {
    const joint = state.dragJoint.current;
    if (!state.isDraggingJoint.current || !joint) {
      return;
    }

    let delta = 0;
    const jointType = joint.jointType;
    state.lastRay.current.at(state.hitDistance.current, tempPrevHitPoint);
    toRay.at(state.hitDistance.current, tempNewHitPoint);
    if (jointType === 'revolute' || jointType === 'continuous') {
      delta = jointDragGeometry.resolveRevoluteDelta(
        joint,
        tempPrevHitPoint,
        tempNewHitPoint,
      );
      applyRevoluteJointDelta(delta);
    } else if (jointType === 'prismatic') {
      delta = jointDragGeometry.resolvePrismaticDelta(
        joint,
        tempPrevHitPoint,
        tempNewHitPoint,
      );
      applyJointDelta(delta);
    }
    state.lastRay.current.copy(toRay);
  };

  const jointDragFrameSync = createJointDragFrameSync({
    onFrame: (localX, localY) => {
      if (!updatePointerFromLocalPoint(localX, localY)) {
        return;
      }
      moveRay(getCurrentRay());
      invalidate();
    },
  });

  return {
    findParentJoint,
    resolveJointObject,
    schedulePointerMove(localX: number, localY: number) {
      jointDragFrameSync.schedule(localX, localY);
    },
    start(
      joint: DraggableRuntimeJoint,
      hitDistance: number,
      ray: THREE.Ray,
      beforeNotify: () => void,
    ) {
      cancelPendingRevoluteDelta();
      state.isDraggingJoint.current = true;
      state.dragJoint.current = joint;
      state.runtimeValue.current = Number(readRuntimeJointFallback(joint));
      state.hitDistance.current = hitDistance;
      state.lastRay.current.copy(ray);
      beforeNotify();
      onDraggingChange(true);
      onActiveJointChange(joint.name, {
        autoScroll: false,
        suppressNextAutoScroll: true,
      });
    },
    finish() {
      const joint = state.dragJoint.current;
      if (!state.isDraggingJoint.current) {
        return false;
      }

      jointDragFrameSync.flush();
      flushPendingRevoluteDelta();
      const commitPayload = resolveCommitPayload(
        robotJoints,
        joint,
        state.runtimeValue.current,
      );

      state.isDraggingJoint.current = false;
      state.dragJoint.current = null;
      state.runtimeValue.current = null;
      onDraggingChange(false);
      if (commitPayload) {
        jointDragStoreSync.commit(commitPayload.name, commitPayload.angle);
      }
      return true;
    },
    dispose() {
      jointDragFrameSync.cancel();
      cancelPendingRevoluteDelta();
      jointDragStoreSync.dispose();
      state.runtimeValue.current = null;
    },
  };
}
