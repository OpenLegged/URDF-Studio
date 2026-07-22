import { useCallback, useEffect } from 'react';
import * as THREE from 'three';

import { radToDeg } from '@/core/robot/transforms';
import {
  computeBridgeOriginFromSnapFrames,
  computePointCoincidentOrigin,
  type JointAlignmentDelta,
} from '@/core/robot/jointPickAlignment';
import { useJointPickSessionStore, type JointPickSide } from '@/store/jointPickSessionStore';

export type JointAlignMode = 'smartAlign' | 'pointCoincident';

interface UseJointPickControllerOptions {
  isOpen: boolean;
  enabled: boolean;
  parentComponentId: string;
  parentLinkId: string;
  childComponentId: string;
  childLinkId: string;
  alignment?: JointAlignmentDelta;
  alignMode?: JointAlignMode;
  setParentCompId: (value: string) => void;
  setParentLinkId: (value: string) => void;
  setChildCompId: (value: string) => void;
  setChildLinkId: (value: string) => void;
  setPickTarget: (value: JointPickSide) => void;
  applyPickedOrigin: (
    position: { x: number; y: number; z: number },
    rotationDeg: { r: number; p: number; y: number },
  ) => void;
}

function matrixFrom(serialized: number[]): THREE.Matrix4 {
  return new THREE.Matrix4().fromArray(serialized);
}

/**
 * Bridges the joint-pick session store and the bridge-create draft: mirrors the
 * relation into the session, blocks normal selection while picking, and converts
 * the two committed snap frames into the bridge joint origin (xyz + rpy).
 */
export function useJointPickController({
  isOpen,
  enabled,
  parentComponentId,
  parentLinkId,
  childComponentId,
  childLinkId,
  alignment,
  alignMode = 'smartAlign',
  setParentCompId,
  setParentLinkId,
  setChildCompId,
  setChildLinkId,
  setPickTarget,
  applyPickedOrigin,
}: UseJointPickControllerOptions) {
  const active = useJointPickSessionStore((state) => state.active);
  const side = useJointPickSessionStore((state) => state.side);
  const mode = useJointPickSessionStore((state) => state.mode);
  const snapFilter = useJointPickSessionStore((state) => state.snapFilter);
  const parentSnap = useJointPickSessionStore((state) => state.parentSnap);
  const childSnap = useJointPickSessionStore((state) => state.childSnap);
  const startPickAction = useJointPickSessionStore((state) => state.startPick);
  const setActive = useJointPickSessionStore((state) => state.setActive);
  const setModeAction = useJointPickSessionStore((state) => state.setMode);
  const setSnapFilterAction = useJointPickSessionStore((state) => state.setSnapFilter);
  const setRelation = useJointPickSessionStore((state) => state.setRelation);
  const clearSideAction = useJointPickSessionStore((state) => state.clearSide);
  const reset = useJointPickSessionStore((state) => state.reset);

  // Mirror the chosen relation so the pick layer can auto-route clicks to the
  // parent or child side and drop snaps only when they no longer match.
  useEffect(() => {
    if (!isOpen || !enabled) {
      return;
    }
    setRelation(
      parentComponentId || null,
      parentLinkId || null,
      childComponentId || null,
      childLinkId || null,
    );
  }, [
    childComponentId,
    childLinkId,
    enabled,
    isOpen,
    parentComponentId,
    parentLinkId,
    setRelation,
  ]);

  // Tear the session down when the modal closes.
  useEffect(() => {
    if (isOpen) {
      return;
    }
    reset();
  }, [isOpen, reset]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    setActive(enabled);
  }, [enabled, isOpen, setActive]);

  useEffect(() => {
    if (!isOpen || !enabled || !parentSnap) {
      return;
    }

    if (parentSnap.componentId !== parentComponentId) {
      setParentCompId(parentSnap.componentId);
    }
    if (parentSnap.linkId !== parentLinkId) {
      setParentLinkId(parentSnap.linkId);
    }
    setPickTarget('child');
  }, [
    enabled,
    isOpen,
    parentComponentId,
    parentLinkId,
    parentSnap,
    setParentCompId,
    setParentLinkId,
    setPickTarget,
  ]);

  useEffect(() => {
    if (!isOpen || !enabled || !childSnap) {
      return;
    }

    if (childSnap.componentId !== childComponentId) {
      setChildCompId(childSnap.componentId);
    }
    if (childSnap.linkId !== childLinkId) {
      setChildLinkId(childSnap.linkId);
    }
    if (!parentComponentId || !parentLinkId) {
      setPickTarget('parent');
    }
  }, [
    childComponentId,
    childLinkId,
    childSnap,
    enabled,
    isOpen,
    parentComponentId,
    parentLinkId,
    setChildCompId,
    setChildLinkId,
    setPickTarget,
  ]);

  // Derive the joint origin whenever both sides have a committed snap.
  useEffect(() => {
    if (!isOpen || !enabled || !parentSnap || !childSnap) {
      return;
    }

    const parentLinkWorld = matrixFrom(parentSnap.linkWorldMatrix);
    const childLinkWorld = matrixFrom(childSnap.linkWorldMatrix);

    const result =
      alignMode === 'pointCoincident'
        ? computePointCoincidentOrigin({
            parentSnapPointWorld: new THREE.Vector3(
              parentSnap.pointWorld.x,
              parentSnap.pointWorld.y,
              parentSnap.pointWorld.z,
            ),
            childSnapPointWorld: new THREE.Vector3(
              childSnap.pointWorld.x,
              childSnap.pointWorld.y,
              childSnap.pointWorld.z,
            ),
            parentLinkWorld,
            childLinkWorld,
          })
        : computeBridgeOriginFromSnapFrames({
            parentSnapWorld: matrixFrom(parentSnap.poseWorldMatrix),
            childSnapWorld: matrixFrom(childSnap.poseWorldMatrix),
            parentLinkWorld,
            childLinkWorld,
            alignment,
          });

    const { position, rotation } = result.transform;
    applyPickedOrigin(position, {
      r: radToDeg(rotation.r),
      p: radToDeg(rotation.p),
      y: radToDeg(rotation.y),
    });
  }, [alignMode, alignment, applyPickedOrigin, childSnap, enabled, isOpen, parentSnap]);

  const startPick = useCallback(
    (nextSide: JointPickSide) => {
      startPickAction(nextSide);
    },
    [startPickAction],
  );

  const cancelPick = useCallback(() => {
    setActive(false);
  }, [setActive]);

  return {
    active,
    side,
    mode,
    snapFilter,
    parentSnap,
    childSnap,
    startPick,
    cancelPick,
    setMode: setModeAction,
    setSnapFilter: setSnapFilterAction,
    clearSide: clearSideAction,
  };
}
