import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

import {
  resolveDirectManipulableLinkIkJointIds,
  resolveLinkIkHandleDescriptor,
  solveLinkIkPositionTarget,
} from '@/core/robot';
import type {
  RobotClosedLoopConstraint,
  RobotMaterialState,
  RobotState,
  UrdfJoint,
  UrdfLink,
} from '@/types';
import { UnifiedTransformControls } from './UnifiedTransformControls';

import {
  cloneLinkIkDragKinematicState,
  createEmptyLinkIkDragKinematicState,
  diffLinkIkDragKinematicState,
  hasMeaningfulLinkIkTargetDelta,
  hasLinkIkKinematicStateChanges,
  hasRestorableLinkIkPreviewKinematicState,
  resolveClosedLoopAwareLinkIkPreviewState,
  resolveLinkIkCommittedStateEpsilon,
  resolveLinkIkSolveRequestOptions,
  shouldAcceptLinkIkSolveState,
  shouldScheduleLinkIkPreviewSolve,
} from './linkIkDragPreview';

type LinkIkKinematicOverrides = {
  angles: Record<string, number>;
  quaternions: Record<string, NonNullable<RobotState['joints'][string]['quaternion']>>;
};

interface RobotHistorySnapshot {
  name: string;
  links: Record<string, UrdfLink>;
  joints: Record<string, UrdfJoint>;
  rootLinkId: string;
  materials?: Record<string, RobotMaterialState>;
  closedLoopConstraints?: RobotClosedLoopConstraint[];
}

interface LinkIkTransformControlsProps {
  selectedLinkId: string | null;
  selectedHandle: THREE.Object3D | null;
  selectedLinkObject?: THREE.Object3D | null;
  selectedAnchorLocal?: { x: number; y: number; z: number } | null;
  coordinateRoot: THREE.Object3D | null;
  ikRobotState: Pick<
    RobotState,
    'links' | 'joints' | 'rootLinkId' | 'closedLoopConstraints'
  > | null;
  enabled?: boolean;
  historyLabel?: string;
  setIsDragging?: (dragging: boolean) => void;
  createHistorySnapshot?: () => RobotHistorySnapshot | null;
  onPreviewKinematicOverrides?: (overrides: LinkIkKinematicOverrides) => void;
  onCommitKinematicOverrides?: (
    overrides: LinkIkKinematicOverrides,
    historySnapshot: RobotHistorySnapshot,
    historyLabel: string,
  ) => void;
  onClearPreviewKinematicOverrides?: () => void;
}

const SELECTED_IK_GIZMO_SIZE = 1.05;

export const LinkIkTransformControls = memo(function LinkIkTransformControls({
  selectedLinkId,
  selectedHandle,
  selectedLinkObject = null,
  selectedAnchorLocal = null,
  coordinateRoot,
  ikRobotState,
  enabled = true,
  historyLabel = 'IK handle drag',
  setIsDragging,
  createHistorySnapshot,
  onPreviewKinematicOverrides,
  onCommitKinematicOverrides,
  onClearPreviewKinematicOverrides,
}: LinkIkTransformControlsProps) {
  const { invalidate } = useThree();
  const transformRef = useRef<any>(null);
  const translateProxyRef = useRef<THREE.Group | null>(null);
  const activeLinkIdRef = useRef<string | null>(null);
  const isDraggingRef = useRef(false);
  const didMutateRef = useRef(false);
  const skipNextPreviewRestoreRef = useRef(false);
  const historySnapshotRef = useRef<RobotHistorySnapshot | null>(null);
  const worldPositionRef = useRef(new THREE.Vector3());
  const localPositionRef = useRef(new THREE.Vector3());
  const handleAnchorLocalRef = useRef(new THREE.Vector3());
  const pendingTargetWorldPositionRef = useRef<THREE.Vector3 | null>(null);
  const lastSolvedTargetWorldPositionRef = useRef<THREE.Vector3 | null>(null);
  const dragStartWorldPositionRef = useRef<THREE.Vector3 | null>(null);
  const dragHasMeaningfulMotionRef = useRef(false);
  const solveFrameRef = useRef<number | null>(null);
  const finishDragRef = useRef<() => void>(() => undefined);
  const clearPreviewOverridesRef = useRef<() => void>(() => undefined);
  const resetSolveQueueRef = useRef<() => void>(() => undefined);
  // Mirror the detached-goal workflow used in closed-chain-ik-js:
  // solve against the drag-start snapshot, but keep the latest accepted
  // preview state around as the next seed so the gizmo stays responsive.
  const previewSolveStateRef = useRef(createEmptyLinkIkDragKinematicState());
  const committedPreviewStateRef = useRef(createEmptyLinkIkDragKinematicState());
  const [translateProxy, setTranslateProxy] = useState<THREE.Group | null>(null);
  const hasSelectedAnchorTarget = Boolean(
    selectedHandle || (selectedLinkObject && selectedAnchorLocal),
  );
  const proxyPosition = useMemo(() => {
    if (selectedHandle) {
      const worldPosition = new THREE.Vector3();
      selectedHandle.updateMatrixWorld(true);
      selectedHandle.getWorldPosition(worldPosition);
      return [worldPosition.x, worldPosition.y, worldPosition.z] as const;
    }

    if (selectedLinkObject && selectedAnchorLocal) {
      const worldPosition = new THREE.Vector3(
        selectedAnchorLocal.x,
        selectedAnchorLocal.y,
        selectedAnchorLocal.z,
      );
      selectedLinkObject.updateMatrixWorld(true);
      selectedLinkObject.localToWorld(worldPosition);
      return [worldPosition.x, worldPosition.y, worldPosition.z] as const;
    }

    return null;
  }, [selectedAnchorLocal, selectedHandle, selectedLinkObject]);

  const syncTranslateProxy = useCallback(
    (
      proxyTarget: THREE.Object3D | null,
      handle = selectedHandle,
      linkObject = selectedLinkObject,
      anchorLocal = selectedAnchorLocal,
    ) => {
      if (!proxyTarget) {
        return;
      }

      if (handle) {
        handle.updateMatrixWorld(true);
        handle.getWorldPosition(worldPositionRef.current);
      } else if (linkObject && anchorLocal) {
        linkObject.updateMatrixWorld(true);
        handleAnchorLocalRef.current.set(anchorLocal.x, anchorLocal.y, anchorLocal.z);
        worldPositionRef.current.copy(handleAnchorLocalRef.current);
        linkObject.localToWorld(worldPositionRef.current);
      } else {
        return;
      }

      proxyTarget.position.copy(worldPositionRef.current);
      proxyTarget.quaternion.identity();
      proxyTarget.scale.setScalar(1);
      proxyTarget.updateMatrixWorld(true);
    },
    [selectedAnchorLocal, selectedHandle, selectedLinkObject],
  );

  const handleTranslateProxyRef = useCallback(
    (proxy: THREE.Group | null) => {
      translateProxyRef.current = proxy;
      setTranslateProxy(proxy);
      syncTranslateProxy(proxy);
    },
    [syncTranslateProxy],
  );

  const cancelScheduledSolve = useCallback(() => {
    if (
      solveFrameRef.current !== null &&
      typeof window !== 'undefined' &&
      typeof window.cancelAnimationFrame === 'function'
    ) {
      window.cancelAnimationFrame(solveFrameRef.current);
    }

    solveFrameRef.current = null;
  }, []);

  const resetSolveQueue = useCallback(() => {
    cancelScheduledSolve();
    pendingTargetWorldPositionRef.current = null;
    lastSolvedTargetWorldPositionRef.current = null;
    dragStartWorldPositionRef.current = null;
    dragHasMeaningfulMotionRef.current = false;
    previewSolveStateRef.current = createEmptyLinkIkDragKinematicState();
    committedPreviewStateRef.current = createEmptyLinkIkDragKinematicState();
  }, [cancelScheduledSolve]);

  useEffect(() => {
    resetSolveQueueRef.current = resetSolveQueue;
  }, [resetSolveQueue]);

  const clearPreviewOverrides = useCallback(() => {
    if (hasRestorableLinkIkPreviewKinematicState(committedPreviewStateRef.current)) {
      onClearPreviewKinematicOverrides?.();
    }
    committedPreviewStateRef.current = createEmptyLinkIkDragKinematicState();
  }, [onClearPreviewKinematicOverrides]);

  useEffect(() => {
    clearPreviewOverridesRef.current = clearPreviewOverrides;
  }, [clearPreviewOverrides]);

  const readProxyWorldPosition = useCallback(() => {
    const proxy = translateProxyRef.current;
    if (!proxy) {
      return null;
    }

    proxy.updateMatrixWorld(true);
    return proxy.getWorldPosition(worldPositionRef.current);
  }, []);

  const buildBaseKinematicState = useCallback(
    (
      baseRobot: Pick<RobotState, 'joints'>,
      nextState: ReturnType<typeof cloneLinkIkDragKinematicState>,
    ) => ({
      angles: Object.fromEntries(
        Object.keys(nextState.angles).map((jointId) => [
          jointId,
          baseRobot.joints[jointId]?.angle ?? 0,
        ]),
      ),
      quaternions: Object.fromEntries(
        Object.keys(nextState.quaternions)
          .map((jointId) => [jointId, baseRobot.joints[jointId]?.quaternion])
          .filter(([, quaternion]) => Boolean(quaternion)),
      ),
    }),
    [],
  );

  const resolvePreviewLimitedJointIds = useCallback(
    (
      baseRobot: Pick<RobotState, 'links' | 'joints' | 'rootLinkId'>,
      activeLinkId: string,
    ): ReadonlySet<string> | undefined => {
      const jointIds =
        resolveDirectManipulableLinkIkJointIds(baseRobot, activeLinkId) ??
        resolveLinkIkHandleDescriptor(baseRobot, activeLinkId)?.jointIds ??
        [];

      return jointIds.length > 0 ? new Set(jointIds) : undefined;
    },
    [],
  );

  const applyIkToTarget = useCallback(
    (targetWorldPosition: THREE.Vector3, preview: boolean) => {
      const activeLinkId = activeLinkIdRef.current ?? selectedLinkId;
      const baseRobot = ikRobotState;
      if (!coordinateRoot || !activeLinkId || !baseRobot) {
        return;
      }

      coordinateRoot.updateMatrixWorld(true);
      localPositionRef.current.copy(targetWorldPosition);
      coordinateRoot.worldToLocal(localPositionRef.current);

      if (!lastSolvedTargetWorldPositionRef.current) {
        lastSolvedTargetWorldPositionRef.current = new THREE.Vector3();
      }
      lastSolvedTargetWorldPositionRef.current.copy(targetWorldPosition);

      const solveSeedState = previewSolveStateRef.current;
      const result = solveLinkIkPositionTarget(baseRobot, {
        linkId: activeLinkId,
        anchorLocal: selectedAnchorLocal ?? undefined,
        targetWorldPosition: {
          x: localPositionRef.current.x,
          y: localPositionRef.current.y,
          z: localPositionRef.current.z,
        },
        seedAngles: hasLinkIkKinematicStateChanges(solveSeedState)
          ? solveSeedState.angles
          : undefined,
        seedQuaternions: hasLinkIkKinematicStateChanges(solveSeedState)
          ? solveSeedState.quaternions
          : undefined,
        ...resolveLinkIkSolveRequestOptions(preview),
      });

      if (result.failureReason === 'numerical-failure') {
        return;
      }

      const nextSolveState = cloneLinkIkDragKinematicState({
        angles: result.angles,
        quaternions: result.quaternions,
      });
      if (
        !shouldAcceptLinkIkSolveState({
          seedState: solveSeedState,
          nextState: nextSolveState,
          preview,
          converged: result.converged,
          failureReason: result.failureReason,
        })
      ) {
        return;
      }

      const previewBaseState = buildBaseKinematicState(baseRobot, nextSolveState);
      const nextAppliedState = preview
        ? resolveClosedLoopAwareLinkIkPreviewState({
            baseRobot,
            previousState: {
              angles: {
                ...previewBaseState.angles,
                ...committedPreviewStateRef.current.angles,
              },
              quaternions: {
                ...previewBaseState.quaternions,
                ...committedPreviewStateRef.current.quaternions,
              },
            },
            nextSolveState,
            limitedJointIds: resolvePreviewLimitedJointIds(baseRobot, activeLinkId),
          })
        : nextSolveState;
      previewSolveStateRef.current = nextAppliedState;
      const changedOverrides = diffLinkIkDragKinematicState(
        committedPreviewStateRef.current,
        nextAppliedState,
        resolveLinkIkCommittedStateEpsilon(preview),
      );

      if (!hasLinkIkKinematicStateChanges(changedOverrides)) {
        return;
      }

      didMutateRef.current = true;
      onPreviewKinematicOverrides?.(nextAppliedState);
      committedPreviewStateRef.current = nextAppliedState;
      invalidate();
    },
    [
      coordinateRoot,
      ikRobotState,
      invalidate,
      onPreviewKinematicOverrides,
      resolvePreviewLimitedJointIds,
      selectedAnchorLocal,
      selectedLinkId,
    ],
  );

  const schedulePreviewSolve = useCallback(() => {
    if (!isDraggingRef.current) {
      return;
    }

    const nextTargetWorldPosition = readProxyWorldPosition();
    if (!nextTargetWorldPosition) {
      return;
    }
    const dragStartWorldPosition = dragStartWorldPositionRef.current;
    if (!dragStartWorldPosition) {
      return;
    }

    const hasMeaningfulDragMotion =
      dragHasMeaningfulMotionRef.current ||
      hasMeaningfulLinkIkTargetDelta(dragStartWorldPosition, nextTargetWorldPosition);

    const shouldSchedule = shouldScheduleLinkIkPreviewSolve({
      pendingTargetWorldPosition: pendingTargetWorldPositionRef.current,
      lastSolvedTargetWorldPosition: lastSolvedTargetWorldPositionRef.current,
      nextTargetWorldPosition,
      hasMeaningfulDragMotion,
    });

    if (!shouldSchedule) {
      return;
    }

    dragHasMeaningfulMotionRef.current = hasMeaningfulDragMotion;

    if (!pendingTargetWorldPositionRef.current) {
      pendingTargetWorldPositionRef.current = new THREE.Vector3();
    }
    pendingTargetWorldPositionRef.current.copy(nextTargetWorldPosition);

    if (solveFrameRef.current !== null) {
      return;
    }

    const runSolve = () => {
      solveFrameRef.current = null;

      const queuedTarget = pendingTargetWorldPositionRef.current;
      pendingTargetWorldPositionRef.current = null;
      if (!queuedTarget || !isDraggingRef.current) {
        return;
      }

      applyIkToTarget(queuedTarget, true);

      if (!pendingTargetWorldPositionRef.current) {
        return;
      }

      if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
        runSolve();
        return;
      }

      solveFrameRef.current = window.requestAnimationFrame(runSolve);
    };

    if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
      runSolve();
      return;
    }

    solveFrameRef.current = window.requestAnimationFrame(runSolve);
  }, [applyIkToTarget, readProxyWorldPosition]);

  const flushFinalSolve = useCallback(() => {
    cancelScheduledSolve();
    pendingTargetWorldPositionRef.current = null;
    const finalTargetWorldPosition = readProxyWorldPosition();
    if (!finalTargetWorldPosition) {
      return;
    }
    const dragStartWorldPosition = dragStartWorldPositionRef.current;
    if (!dragStartWorldPosition) {
      return;
    }

    const hasMeaningfulDragMotion =
      dragHasMeaningfulMotionRef.current ||
      hasMeaningfulLinkIkTargetDelta(dragStartWorldPosition, finalTargetWorldPosition);
    if (!hasMeaningfulDragMotion) {
      return;
    }

    dragHasMeaningfulMotionRef.current = true;

    applyIkToTarget(finalTargetWorldPosition, false);
  }, [applyIkToTarget, cancelScheduledSolve, readProxyWorldPosition]);

  const beginDrag = useCallback(() => {
    if (
      !enabled ||
      !selectedLinkId ||
      !hasSelectedAnchorTarget ||
      !coordinateRoot ||
      !ikRobotState
    ) {
      return false;
    }

    if (!historySnapshotRef.current) {
      historySnapshotRef.current = createHistorySnapshot?.() ?? null;
    }
    activeLinkIdRef.current = selectedLinkId;
    didMutateRef.current = false;
    skipNextPreviewRestoreRef.current = false;
    isDraggingRef.current = true;
    resetSolveQueue();
    const dragStartWorldPosition = readProxyWorldPosition();
    if (dragStartWorldPosition) {
      if (!dragStartWorldPositionRef.current) {
        dragStartWorldPositionRef.current = new THREE.Vector3();
      }
      dragStartWorldPositionRef.current.copy(dragStartWorldPosition);
    }
    previewSolveStateRef.current = createEmptyLinkIkDragKinematicState();
    committedPreviewStateRef.current = createEmptyLinkIkDragKinematicState();
    setIsDragging?.(true);
    return true;
  }, [
    coordinateRoot,
    createHistorySnapshot,
    enabled,
    hasSelectedAnchorTarget,
    ikRobotState,
    readProxyWorldPosition,
    resetSolveQueue,
    selectedLinkId,
    setIsDragging,
  ]);

  const finishDrag = useCallback(() => {
    if (!isDraggingRef.current) {
      return;
    }

    flushFinalSolve();
    isDraggingRef.current = false;
    activeLinkIdRef.current = null;
    setIsDragging?.(false);

    const baseRobot = ikRobotState;
    const nextSolveState = previewSolveStateRef.current;
    const nextCommittedOverrides =
      didMutateRef.current && baseRobot
        ? diffLinkIkDragKinematicState(
            buildBaseKinematicState(baseRobot, nextSolveState),
            nextSolveState,
            resolveLinkIkCommittedStateEpsilon(false),
          )
        : createEmptyLinkIkDragKinematicState();

    if (
      hasLinkIkKinematicStateChanges(nextCommittedOverrides) &&
      historySnapshotRef.current &&
      onCommitKinematicOverrides
    ) {
      skipNextPreviewRestoreRef.current = true;
      onCommitKinematicOverrides(nextCommittedOverrides, historySnapshotRef.current, historyLabel);
    }

    historySnapshotRef.current = null;
    didMutateRef.current = false;
    syncTranslateProxy(translateProxyRef.current);
    resetSolveQueue();
    invalidate();
  }, [
    buildBaseKinematicState,
    flushFinalSolve,
    historyLabel,
    ikRobotState,
    invalidate,
    onCommitKinematicOverrides,
    resetSolveQueue,
    setIsDragging,
    syncTranslateProxy,
  ]);

  useEffect(() => {
    finishDragRef.current = finishDrag;
  }, [finishDrag]);

  const handleDraggingChanged = useCallback(
    (event?: { value?: boolean }) => {
      if (event?.value) {
        beginDrag();
        return;
      }

      finishDrag();
    },
    [beginDrag, finishDrag],
  );

  const handleObjectChange = useCallback(() => {
    if (!isDraggingRef.current) {
      return;
    }

    schedulePreviewSolve();
  }, [schedulePreviewSolve]);

  useEffect(() => {
    if (!isDraggingRef.current) {
      syncTranslateProxy(translateProxyRef.current);
      if (skipNextPreviewRestoreRef.current) {
        skipNextPreviewRestoreRef.current = false;
      } else {
        clearPreviewOverrides();
      }
      resetSolveQueue();
    }
  }, [clearPreviewOverrides, resetSolveQueue, selectedHandle, selectedLinkId, syncTranslateProxy]);

  useEffect(() => {
    return () => {
      if (isDraggingRef.current) {
        finishDragRef.current();
        return;
      }

      clearPreviewOverridesRef.current();
      resetSolveQueueRef.current();
    };
  }, []);

  // Synchronize the proxy before rendering without taking ownership of the
  // render loop. A positive priority suppresses R3F's default canvas draw,
  // including when this disabled control returns null below.
  useFrame(() => {
    if (!isDraggingRef.current) {
      syncTranslateProxy(translateProxyRef.current);
    }
  });

  if (!enabled || !selectedLinkId || !hasSelectedAnchorTarget || !coordinateRoot || !ikRobotState) {
    return null;
  }

  return (
    <>
      <group ref={handleTranslateProxyRef} position={proxyPosition ?? undefined} />
      {translateProxy ? (
        <UnifiedTransformControls
          ref={transformRef}
          object={translateProxy}
          mode="translate"
          size={SELECTED_IK_GIZMO_SIZE}
          translateSpace="world"
          hoverStyle="stock"
          displayStyle="stock"
          enabled={enabled}
          onObjectChange={handleObjectChange}
          onDraggingChanged={handleDraggingChanged}
        />
      ) : null}
    </>
  );
});
