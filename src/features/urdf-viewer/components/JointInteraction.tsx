import React, { useRef, useState, useMemo, useEffect, useCallback } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { UnifiedTransformControls } from '@/shared/components/3d';
import { useSnapshotRenderActive } from '@/shared/components/3d/scene/SnapshotRenderContext';
import { hasEffectivelyFiniteJointLimits } from '@/shared/utils/jointUnits';
import {
  clampJointInteractionValue,
  extractSignedAngleAroundAxis,
  getJointActualAngleFromMotionAngle,
  getJointMotionAngleFromActualAngle,
} from '@/core/robot';
import type { JointInteractionProps } from '../types';
import { resolveJointInteractionControlMode } from '../utils/jointInteractionControlsShared';
import { resolveLocalTransformGizmoSizing } from '../utils/localTransformGizmoSizing';

// A joint is single-DOF, so its gizmo only needs to frame the joint axis — not
// the whole robot. Keep it well below the visualizer baseline so it sits around
// the joint instead of swallowing small models (it previously rendered several
// times the robot's size). The free-rotate E-ring/trackball are disabled too
// (showRotateFreeHandles=false), since a joint can only turn about its axis.
const JOINT_GIZMO_SIZING = resolveLocalTransformGizmoSizing('joint');
const JOINT_TRANSLATE_GIZMO_SIZE = JOINT_GIZMO_SIZING.translateSize;
const JOINT_ROTATE_GIZMO_SIZE = JOINT_GIZMO_SIZING.rotateSize;
const JOINT_GIZMO_THICKNESS_SCALE = JOINT_GIZMO_SIZING.thicknessScale;
const JOINT_GIZMO_SHOW_ROTATE_FREE_HANDLES = JOINT_GIZMO_SIZING.showRotateFreeHandles;

export const JointInteraction: React.FC<JointInteractionProps> = ({
  joint,
  value,
  transformMode = 'select',
  onChange,
  onCommit,
  setIsDragging,
  onInteractionLockChange,
}) => {
  const transformRef = useRef<any>(null);
  const dummyRef = useRef<THREE.Object3D>(new THREE.Object3D());
  const lastValueRef = useRef<number>(value);
  const isDragging = useRef(false);
  const unlockTimerRef = useRef<number | null>(null);
  const [, forceUpdate] = useState(0);
  const { invalidate } = useThree();
  const snapshotRenderActive = useSnapshotRenderActive();

  const axisNormalized = useMemo(() => {
    if (!joint) {
      return new THREE.Vector3(1, 0, 0);
    }

    const axis = joint.axis;
    if (axis instanceof THREE.Vector3) {
      return axis.clone().normalize();
    } else if (axis && typeof axis.x === 'number') {
      return new THREE.Vector3(axis.x, axis.y, axis.z).normalize();
    }
    return new THREE.Vector3(1, 0, 0);
  }, [joint]);

  const dominantAxis = useMemo((): 'X' | 'Y' | 'Z' => {
    const absX = Math.abs(axisNormalized.x);
    const absY = Math.abs(axisNormalized.y);
    const absZ = Math.abs(axisNormalized.z);
    if (absX >= absY && absX >= absZ) return 'X';
    if (absY >= absX && absY >= absZ) return 'Y';
    return 'Z';
  }, [axisNormalized]);

  const controlMode = useMemo(
    () => resolveJointInteractionControlMode(transformMode, joint?.jointType ?? joint?.type),
    [joint?.jointType, joint?.type, transformMode],
  );

  const controlAxisVector = useMemo(() => {
    const axis = new THREE.Vector3(1, 0, 0);
    if (dominantAxis === 'Y') axis.set(0, 1, 0);
    if (dominantAxis === 'Z') axis.set(0, 0, 1);
    return axis;
  }, [dominantAxis]);

  const displayedMotionAngle = useMemo(
    () => (joint ? getJointMotionAngleFromActualAngle(joint, value) : 0),
    [joint, value],
  );
  const isInteractionVisible = Boolean(joint && !snapshotRenderActive && controlMode);

  const updateDummyTransform = useCallback(() => {
    if (dummyRef.current && joint) {
      try {
        if (!isDragging.current || controlMode === 'rotate') {
          joint.getWorldPosition(dummyRef.current.position);
        }

        if (!isDragging.current) {
          const parent = joint.parent;
          if (parent) {
            parent.getWorldQuaternion(dummyRef.current.quaternion);
          } else {
            joint.getWorldQuaternion(dummyRef.current.quaternion);
          }

          const alignQ = new THREE.Quaternion().setFromUnitVectors(
            controlAxisVector,
            axisNormalized,
          );
          dummyRef.current.quaternion.multiply(alignQ);

          if (controlMode === 'rotate') {
            const rotQ = new THREE.Quaternion().setFromAxisAngle(
              controlAxisVector,
              displayedMotionAngle,
            );
            dummyRef.current.quaternion.multiply(rotQ);
          }
        }

        dummyRef.current.updateMatrixWorld(true);
      } catch (e) {
        console.error('JointInteraction:updateDummyTransform failed', e);
      }
    }
  }, [axisNormalized, controlAxisVector, controlMode, displayedMotionAngle, joint]);

  useEffect(() => {
    if (!isInteractionVisible) return;
    forceUpdate((n) => n + 1);
  }, [isInteractionVisible]);

  useEffect(() => {
    if (!isInteractionVisible) return;
    updateDummyTransform();
    invalidate();
  }, [isInteractionVisible, updateDummyTransform, invalidate]);

  const clearUnlockTimer = useCallback(() => {
    if (unlockTimerRef.current !== null && typeof window !== 'undefined') {
      window.clearTimeout(unlockTimerRef.current);
      unlockTimerRef.current = null;
    }
  }, []);

  const lockInteraction = useCallback(() => {
    clearUnlockTimer();
    onInteractionLockChange?.(true);
  }, [clearUnlockTimer, onInteractionLockChange]);

  const unlockInteraction = useCallback(
    (defer = false) => {
      clearUnlockTimer();

      if (!onInteractionLockChange) {
        return;
      }

      if (defer && typeof window !== 'undefined') {
        unlockTimerRef.current = window.setTimeout(() => {
          unlockTimerRef.current = null;
          onInteractionLockChange(false);
        }, 0);
        return;
      }

      onInteractionLockChange(false);
    },
    [clearUnlockTimer, onInteractionLockChange],
  );

  useEffect(() => {
    if (!isInteractionVisible) return;
    return () => {
      isDragging.current = false;
      unlockInteraction();
      setIsDragging?.(false);
    };
  }, [isInteractionVisible, joint, setIsDragging, unlockInteraction]);

  const handleChange = useCallback(() => {
    if (!joint || !controlMode || !dummyRef.current || !isDragging.current) return;

    try {
      let newValue: number;

      if (controlMode === 'rotate') {
        const parent = joint.parent;
        const parentQuat = new THREE.Quaternion();
        if (parent) {
          parent.getWorldQuaternion(parentQuat);
        } else {
          joint.getWorldQuaternion(parentQuat);
        }

        const alignQ = new THREE.Quaternion().setFromUnitVectors(controlAxisVector, axisNormalized);
        const zeroQuat = parentQuat.clone().multiply(alignQ);
        const deltaQuat = zeroQuat.clone().invert().multiply(dummyRef.current.quaternion);
        const motionAngle = extractSignedAngleAroundAxis(deltaQuat, controlAxisVector);
        newValue = getJointActualAngleFromMotionAngle(joint, motionAngle);
      } else {
        const parent = joint.parent;
        const localPosition = dummyRef.current.position.clone();
        if (parent) {
          parent.worldToLocal(localPosition);
        }

        const localAxis = axisNormalized
          .clone()
          .applyQuaternion(
            joint.origQuaternion instanceof THREE.Quaternion
              ? joint.origQuaternion
              : joint.quaternion,
          )
          .normalize();
        const currentActualValue = Number.isFinite(Number(joint.angle ?? joint.jointValue))
          ? Number(joint.angle ?? joint.jointValue)
          : value;
        const currentMotionValue = getJointMotionAngleFromActualAngle(joint, currentActualValue);
        const originLocalPosition =
          joint.origPosition instanceof THREE.Vector3
            ? joint.origPosition.clone()
            : joint.position.clone().addScaledVector(localAxis, -currentMotionValue);
        const motionDistance = localPosition.sub(originLocalPosition).dot(localAxis);
        newValue = getJointActualAngleFromMotionAngle(joint, motionDistance);
      }

      const limit = joint.limit;
      const hasFiniteLimit = hasEffectivelyFiniteJointLimits(limit);
      if ((joint.jointType === 'revolute' || joint.jointType === 'prismatic') && hasFiniteLimit) {
        const motionValue = getJointMotionAngleFromActualAngle(joint, newValue);
        const clampedMotionValue = clampJointInteractionValue(
          motionValue,
          limit.lower,
          limit.upper,
        );
        newValue = getJointActualAngleFromMotionAngle(joint, clampedMotionValue);
      }

      if (Math.abs(newValue - lastValueRef.current) > 0.001) {
        lastValueRef.current = newValue;
        onChange(newValue);
      }
    } catch (e) {
      console.error('Error in JointInteraction handleChange:', e);
    }
  }, [axisNormalized, controlAxisVector, controlMode, joint, onChange, value]);

  useEffect(() => {
    if (!isInteractionVisible) return;
    lastValueRef.current = value;
  }, [isInteractionVisible, value]);

  if (!joint || snapshotRenderActive || !controlMode) return null;

  return (
    <>
      <primitive object={dummyRef.current} />
      <UnifiedTransformControls
        ref={transformRef}
        object={dummyRef.current}
        mode={controlMode}
        showX={dominantAxis === 'X'}
        showY={dominantAxis === 'Y'}
        showZ={dominantAxis === 'Z'}
        size={controlMode === 'rotate' ? JOINT_ROTATE_GIZMO_SIZE : JOINT_TRANSLATE_GIZMO_SIZE}
        space="local"
        hoverStyle="single-axis"
        displayStyle="thick-primary"
        displayThicknessScale={JOINT_GIZMO_THICKNESS_SCALE}
        showRotateFreeHandles={JOINT_GIZMO_SHOW_ROTATE_FREE_HANDLES}
        onMouseDown={() => {
          isDragging.current = true;
          lockInteraction();
          setIsDragging?.(true);
        }}
        onMouseUp={() => {
          isDragging.current = false;
          setIsDragging?.(false);
          unlockInteraction(true);
          if (onCommit) onCommit(lastValueRef.current);
        }}
        onObjectChange={handleChange}
      />
    </>
  );
};
