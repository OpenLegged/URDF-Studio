import { useRef, useEffect, useCallback } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { getJointActualAngleFromMotionAngle, resolveLinkKey, resolveJointKey } from '@/core/robot';
import { throttle } from '@/shared/utils';
import { requestShadowMapRefresh } from '@/shared/components/3d/scene/shadowMapRefresh';
import type { JointPanelActiveJointOptions } from '@/shared/utils/jointPanelStore';
import { JointType, type InteractionSelection, type UrdfJoint, type UrdfLink } from '@/types';
import { THROTTLE_INTERVAL } from '../constants';
import type {
  MeasureMode,
  ToolMode,
  ViewerInteractiveLayer,
  ViewerPaintFaceHit,
  ViewerSceneMode,
} from '../types';
import { isSingleDofJoint } from '@/shared/utils/jointTypes';
import {
  collectGizmoRaycastTargets,
  isGizmoObject,
  shouldBlockBackgroundInteractionForGizmoHit,
  shouldPreserveSelectionForGizmoPointerDown,
} from '../utils/raycast';
import {
  collectPickTargets,
  collectSelectableHelperTargets,
  findPickIntersections,
  type PickTargetMode,
} from '../utils/pickTargets';
import { resolveInteractionSelectionHit } from '../utils/selectionTargets';
import { resolveHelperSelectionPlan } from '../utils/helperSelectionPlan';
import {
  shouldBlockOrbitForGeometryHit,
  shouldDisableOrbitForDirectJointDrag,
  shouldStartJointDragFromGeometryHit,
} from '../utils/interactionMode';
import {
  isPointerInteractionWithinClickThreshold,
  resolveDeferredSelectionHoverState,
  shouldFinalizePointerInteraction,
  shouldDeferSelectionUntilPointerUp,
} from '../utils/clickSelectionPolicy';
import {
  resolveHoverInteractionResolution,
  type ResolvedHoverInteractionCandidate,
} from '../utils/hoverInteractionResolution';
import {
  collectProjectedHelperInteractionTargets,
  resolveScreenSpaceHelperInteraction,
} from '../utils/screenSpaceHelperInteraction';
import {
  resolveRevoluteDragDelta,
  resolveRevoluteDragStep,
  resolveRevoluteTangentAngleDelta,
} from '../utils/jointDragDelta';
import { createJointDragStoreSync } from '../utils/jointDragStoreSync';
import { createJointDragFrameSync } from '../utils/jointDragFrameSync';
import { resolveActiveViewerJointKeyFromSelection } from '../utils/activeJointSelection';
import { resolveMouseDownSelectionPlan } from '../utils/mouseDownSelectionPlan';
import { resolveIkGeometrySelectionState } from '../utils/ikGeometrySelectionState';
import { resolveHoverMoveEventName } from '../utils/hoverMoveEventName';
import type { ViewerHelperKind } from '../types';
import { resolveDirectHelperInteraction } from '../utils/directHelperInteraction';
import { resolveHelperSelectionIdentity } from '../utils/helperSelectionIdentity';
import { resolveSelectionCommitHoverAction } from '../utils/selectionCommitHoverPolicy';
import { resolveJointDragRuntimeStep } from '../utils/jointDragRuntimeStep';
import { isPassiveSpringJointDragTarget } from '../utils/passiveSpringJointDragTarget';
import {
  armSelectionMissGuard,
  disarmSelectionMissGuard,
  clearSelectionMissGuardTimer,
  scheduleSelectionMissGuardReset,
  shouldDisarmSelectionMissGuardOnPointerMove,
  shouldTreatPointerUpAsBackgroundMiss,
} from '../utils/selectionMissGuard';
import { unwrapContinuousJointAngle } from '@/shared/utils/continuousJointAngle';
import { isRuntimeInteractionEditorLocked } from '../utils/editorInteractionLock';

const JOINT_DRAG_EPSILON = 1e-5;
const MAX_REVOLUTE_DELTA_PER_FRAME = Math.PI / 8;
const MAX_REVOLUTE_DELTA_PER_INPUT = Math.PI;
const JOINT_DRAG_STORE_SYNC_INTERVAL = 16;
const POINTER_TARGET_PREWARM_IDLE_TIMEOUT_MS = 180;
const POINTER_TARGET_PREWARM_SETTLE_FRAMES = 1;

interface PendingPointerSelection {
  resolvedHit: ResolvedHoverInteractionCandidate;
  resolvedLinkObject: THREE.Object3D | null;
  resolvedSubType: 'visual' | 'collision' | undefined;
  clickedJoint: any;
}

export interface UseMouseInteractionOptions {
  enabled?: boolean;
  robot: THREE.Object3D | null;
  robotVersion: number;
  toolMode: ToolMode;
  /** Measure sub-mode; `point` routes free-surface picking through MeasureTool, bypassing selection. */
  measureMode?: MeasureMode;
  mode?: ViewerSceneMode;
  showCollision: boolean;
  showVisual: boolean;
  showCollisionAlwaysOnTop: boolean;
  interactionLayerPriority?: readonly ViewerInteractiveLayer[];
  linkMeshMapRef: React.RefObject<Map<string, THREE.Mesh[]>>;
  robotLinks?: Record<string, UrdfLink>;
  robotJoints?: Record<string, UrdfJoint>;
  onHover?: (
    type: InteractionSelection['type'],
    id: string | null,
    subType?: 'visual' | 'collision',
    objectIndex?: number,
    helperKind?: ViewerHelperKind,
    highlightObjectId?: number,
  ) => void;
  onSelect?: (
    type: Exclude<InteractionSelection['type'], null>,
    id: string,
    subType?: 'visual' | 'collision',
    helperKind?: ViewerHelperKind,
  ) => void;
  onMeshSelect?: (
    linkId: string,
    jointId: string | null,
    objectIndex: number,
    objectType: 'visual' | 'collision',
  ) => void;
  onPaintFace?: (hit: ViewerPaintFaceHit) => void;
  onJointChange?: (name: string, angle: number) => void;
  onJointChangeCommit?: (name: string, angle: number) => void;
  throttleJointChangeDuringDrag?: boolean;
  deferDirectJointRuntimeUpdate?: boolean;
  setIsDragging?: (dragging: boolean) => void;
  setHoverFrozen?: (frozen: boolean) => void;
  setActiveJoint?: (jointName: string | null, options?: JointPanelActiveJointOptions) => void;
  justSelectedRef?: React.RefObject<boolean>;
  isOrbitDragging?: React.RefObject<boolean>;
  isSelectionLockedRef?: React.RefObject<boolean>;
  selection?: InteractionSelection;
  rayIntersectsBoundingBox: (raycaster: THREE.Raycaster, forceRefresh?: boolean) => boolean;
  highlightGeometry: (
    linkName: string | null,
    revert: boolean,
    subType?: 'visual' | 'collision',
    meshToHighlight?: THREE.Object3D | null | number,
    intent?: 'hover' | 'selection',
  ) => void;
  resolveDirectIkHandleLink?: (linkId: string) => string | null;
}

export interface UseMouseInteractionResult {
  mouseRef: React.RefObject<THREE.Vector2>;
  raycasterRef: React.RefObject<THREE.Raycaster>;
  hoveredLinkRef: React.RefObject<string | null>;
  isDraggingJoint: React.RefObject<boolean>;
  needsRaycastRef: React.RefObject<boolean>;
  lastMousePosRef: React.RefObject<{ x: number; y: number }>;
  pointerButtonsRef: React.RefObject<number>;
}

export function useMouseInteraction({
  enabled = true,
  robot,
  robotVersion,
  toolMode,
  measureMode,
  mode,
  showCollision,
  showVisual,
  showCollisionAlwaysOnTop,
  interactionLayerPriority = [],
  linkMeshMapRef,
  robotLinks,
  robotJoints,
  onHover,
  onSelect,
  onMeshSelect,
  onPaintFace,
  onJointChange,
  onJointChangeCommit,
  throttleJointChangeDuringDrag = false,
  deferDirectJointRuntimeUpdate = false,
  setIsDragging,
  setHoverFrozen,
  setActiveJoint,
  justSelectedRef,
  isOrbitDragging,
  isSelectionLockedRef,
  selection,
  rayIntersectsBoundingBox,
  highlightGeometry,
  resolveDirectIkHandleLink,
}: UseMouseInteractionOptions): UseMouseInteractionResult {
  const { camera, gl, scene, invalidate } = useThree();
  const orbitControls = useThree((state) => state.controls as { enabled?: boolean } | undefined);

  const resolveDraggedRuntimeJointActualAngle = useCallback(
    (jointName: string, runtimeMotionAngle: number) => {
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
    },
    [robotJoints],
  );

  const mouseRef = useRef(new THREE.Vector2(-1000, -1000));
  const raycasterRef = useRef(new THREE.Raycaster());
  const hoveredLinkRef = useRef<string | null>(null);
  const useExternalHover = typeof onHover === 'function';

  // PERFORMANCE: Track last mouse position for state locking (skip small movements)
  const lastMousePosRef = useRef({ x: 0, y: 0 });
  // OPTIMIZATION: Signal that raycast is needed on next frame
  const needsRaycastRef = useRef(false);
  const pointerButtonsRef = useRef(0);

  const isDraggingJoint = useRef(false);
  const dragJoint = useRef<any>(null);
  const dragJointRuntimeValueRef = useRef<number | null>(null);
  const dragHitDistance = useRef(0);
  const lastRayRef = useRef(new THREE.Ray());
  const selectionResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingPointerSelectionRef = useRef<PendingPointerSelection | null>(null);
  const deferredSelectionHoverFrozenRef = useRef(false);
  const pointerInteractionActiveRef = useRef(false);
  const pointerInteractionHitTargetRef = useRef(false);
  const pointerDownPositionRef = useRef<{ x: number; y: number } | null>(null);
  const pointerExceededClickThresholdRef = useRef(false);
  const gizmoPointerDownRef = useRef<{ x: number; y: number } | null>(null);
  const gizmoTargetsRef = useRef<THREE.Object3D[]>([]);
  const gizmoTargetsCacheKeyRef = useRef('');
  const gizmoTargetsUpdatedAtRef = useRef(0);
  const pickTargetCachesRef = useRef<
    Record<
      PickTargetMode,
      {
        key: string;
        updatedAt: number;
        targets: THREE.Object3D[];
      }
    >
  >({
    all: { key: '', updatedAt: 0, targets: [] },
    visual: { key: '', updatedAt: 0, targets: [] },
    collision: { key: '', updatedAt: 0, targets: [] },
  });

  // Keep refs up to date
  const onJointChangeRef = useRef(onJointChange);
  const onJointChangeCommitRef = useRef(onJointChangeCommit);
  const setIsDraggingRef = useRef(setIsDragging);
  const setActiveJointRef = useRef(setActiveJoint);
  const invalidateRef = useRef(invalidate);

  useEffect(() => {
    invalidateRef.current = invalidate;
    onJointChangeRef.current = onJointChange;
    onJointChangeCommitRef.current = onJointChangeCommit;
    setIsDraggingRef.current = setIsDragging;
    setActiveJointRef.current = setActiveJoint;
  }, [invalidate, onJointChange, onJointChangeCommit, setIsDragging, setActiveJoint]);

  const getGizmoTargets = useCallback(() => {
    const nextCacheKey = [
      scene.children.length,
      toolMode,
      mode ?? 'editor',
      selection?.type ?? 'none',
      selection?.id ?? '',
      selection?.helperKind ?? '',
      robot ? 'robot' : 'empty',
    ].join(':');
    const now = performance.now();

    if (gizmoTargetsCacheKeyRef.current !== nextCacheKey || gizmoTargetsRef.current.length === 0) {
      gizmoTargetsRef.current = collectGizmoRaycastTargets(scene);
      gizmoTargetsCacheKeyRef.current = nextCacheKey;
      gizmoTargetsUpdatedAtRef.current = now;
    }

    return gizmoTargetsRef.current;
  }, [mode, robot, scene, selection?.helperKind, selection?.id, selection?.type, toolMode]);

  const getPickTargets = useCallback(
    (targetMode: PickTargetMode) => {
      const cache = pickTargetCachesRef.current[targetMode];
      const nextCacheKey = [
        robotVersion,
        targetMode,
        showCollision ? 'col:1' : 'col:0',
        showVisual ? 'vis:1' : 'vis:0',
        showCollisionAlwaysOnTop ? 'col-top:1' : 'col-top:0',
        linkMeshMapRef.current.size,
      ].join(':');
      const now = performance.now();

      if (cache.key !== nextCacheKey || cache.targets.length === 0) {
        cache.targets = collectPickTargets(linkMeshMapRef.current, targetMode, robot);
        cache.key = nextCacheKey;
        cache.updatedAt = now;
      }

      return cache.targets;
    },
    [linkMeshMapRef, robot, robotVersion, showCollision, showCollisionAlwaysOnTop, showVisual],
  );

  const getHelperTargets = useCallback(() => collectSelectableHelperTargets(robot), [robot]);

  const prewarmPointerInteractionTargets = useCallback(() => {
    if (!robot) {
      return;
    }

    scene.updateMatrixWorld(true);
    getGizmoTargets();
    getPickTargets('all');
    getHelperTargets();
  }, [getGizmoTargets, getHelperTargets, getPickTargets, robot, scene]);

  useEffect(() => {
    if (!robot || typeof window === 'undefined') {
      return;
    }

    const requestIdle =
      typeof window.requestIdleCallback === 'function'
        ? window.requestIdleCallback.bind(window)
        : undefined;
    const cancelIdle =
      typeof window.cancelIdleCallback === 'function'
        ? window.cancelIdleCallback.bind(window)
        : undefined;

    let cancelled = false;
    let frameHandle: number | null = null;
    let idleHandle: number | null = null;
    let timeoutHandle: number | null = null;

    const cancelScheduledWork = () => {
      if (frameHandle !== null) {
        window.cancelAnimationFrame(frameHandle);
        frameHandle = null;
      }

      if (idleHandle !== null && cancelIdle) {
        cancelIdle(idleHandle);
        idleHandle = null;
      }

      if (timeoutHandle !== null) {
        window.clearTimeout(timeoutHandle);
        timeoutHandle = null;
      }
    };

    const runPrewarm = () => {
      if (cancelled) {
        return;
      }

      prewarmPointerInteractionTargets();
    };

    const schedulePrewarm = () => {
      if (cancelled) {
        return;
      }

      if (requestIdle) {
        idleHandle = requestIdle(
          () => {
            idleHandle = null;
            runPrewarm();
          },
          { timeout: POINTER_TARGET_PREWARM_IDLE_TIMEOUT_MS },
        );
        return;
      }

      timeoutHandle = window.setTimeout(() => {
        timeoutHandle = null;
        runPrewarm();
      }, POINTER_TARGET_PREWARM_IDLE_TIMEOUT_MS);
    };

    const waitForStableFrames = (remainingFrames: number) => {
      if (cancelled) {
        return;
      }

      if (remainingFrames <= 0) {
        schedulePrewarm();
        return;
      }

      frameHandle = window.requestAnimationFrame(() => {
        frameHandle = null;
        waitForStableFrames(remainingFrames - 1);
      });
    };

    // Prebuild the heavy raycast target lists before the first pointerdown so
    // direct joint-dragging does not pay the full cost on the user's first drag.
    waitForStableFrames(POINTER_TARGET_PREWARM_SETTLE_FRAMES);

    return () => {
      cancelled = true;
      cancelScheduledWork();
    };
  }, [prewarmPointerInteractionTargets, robot, robotVersion]);

  // Mouse tracking for hover detection AND joint dragging
  useEffect(() => {
    if (!enabled) {
      isDraggingJoint.current = false;
      dragJoint.current = null;
      pointerButtonsRef.current = 0;
      pendingPointerSelectionRef.current = null;
      pointerInteractionActiveRef.current = false;
      pointerInteractionHitTargetRef.current = false;
      pointerDownPositionRef.current = null;
      pointerExceededClickThresholdRef.current = false;
      gizmoPointerDownRef.current = null;
      return undefined;
    }

    const setOrbitControlsEnabled = (enabled: boolean) => {
      if (orbitControls && typeof orbitControls.enabled === 'boolean') {
        orbitControls.enabled = enabled;
      }

      if (!enabled && isOrbitDragging) {
        isOrbitDragging.current = false;
      }
    };

    const updatePointerFromLocalPoint = (localX: number, localY: number): boolean => {
      const width = gl.domElement.clientWidth;
      const height = gl.domElement.clientHeight;
      if (width <= 0 || height <= 0) {
        return false;
      }

      mouseRef.current.x = (localX / width) * 2 - 1;
      mouseRef.current.y = -(localY / height) * 2 + 1;
      raycasterRef.current.setFromCamera(mouseRef.current, camera);
      return true;
    };

    const clearPendingPointerSelection = ({
      disarmGuard = false,
    }: {
      disarmGuard?: boolean;
    } = {}) => {
      pendingPointerSelectionRef.current = null;
      pointerDownPositionRef.current = null;
      pointerExceededClickThresholdRef.current = false;

      if (disarmGuard) {
        disarmSelectionMissGuard(justSelectedRef, selectionResetTimerRef);
      }
    };

    const freezeDeferredSelectionHover = () => {
      if (deferredSelectionHoverFrozenRef.current) {
        return;
      }

      deferredSelectionHoverFrozenRef.current = true;
      setHoverFrozen?.(true);
    };

    const releaseDeferredSelectionHover = () => {
      if (!deferredSelectionHoverFrozenRef.current) {
        return;
      }

      deferredSelectionHoverFrozenRef.current = false;
      setHoverFrozen?.(false);
    };

    const clearHoveredState = () => {
      hoveredLinkRef.current = null;
      (hoveredLinkRef as any).currentMesh = null;
      (hoveredLinkRef as any).currentObjectIndex = null;
      (hoveredLinkRef as any).currentSubType = null;
      onHover?.(null, null);
    };

    const applyHoveredState = (
      hoveredSelection: InteractionSelection,
      highlightTarget?: THREE.Object3D | null,
    ) => {
      hoveredLinkRef.current =
        hoveredSelection.type === 'link' && hoveredSelection.id ? hoveredSelection.id : null;
      (hoveredLinkRef as any).currentMesh = highlightTarget ?? null;
      (hoveredLinkRef as any).currentObjectIndex = hoveredSelection.objectIndex ?? null;
      (hoveredLinkRef as any).currentSubType = hoveredSelection.subType ?? null;
      onHover?.(
        hoveredSelection.type,
        hoveredSelection.id,
        hoveredSelection.subType,
        hoveredSelection.objectIndex,
        hoveredSelection.helperKind,
        hoveredSelection.highlightObjectId,
      );
    };

    const shouldBlockOrbitForPointer = (localX: number, localY: number) => {
      if (!robot) return false;

      const isStandardSelectionMode = [
        'select',
        'translate',
        'rotate',
        'universal',
        'measure',
        'paint',
      ].includes(toolMode || 'select');
      if (!isStandardSelectionMode) return false;
      if (!shouldBlockOrbitForGeometryHit(toolMode || 'select', measureMode)) {
        return false;
      }

      if (!updatePointerFromLocalPoint(localX, localY)) {
        return false;
      }

      const gizmoTargets = getGizmoTargets();
      const nearestSceneHit =
        gizmoTargets.length > 0
          ? raycasterRef.current.intersectObjects(gizmoTargets, false)[0]
          : undefined;
      if (nearestSceneHit && isGizmoObject(nearestSceneHit.object)) {
        // Only block orbit when a visible gizmo handle is actually targeted.
        // The TransformControls picker meshes extend far beyond the visible
        // handles; blocking orbit for those would prevent camera rotation in
        // a large area around the gizmo.
        if (shouldBlockBackgroundInteractionForGizmoHit(nearestSceneHit.object)) {
          return true;
        }
      }

      const pickTargets = getPickTargets('all');
      if (pickTargets.length > 0 && !rayIntersectsBoundingBox(raycasterRef.current, true)) {
        return false;
      }

      return (
        findPickIntersections(
          robot,
          raycasterRef.current,
          pickTargets,
          'all',
          false,
          interactionLayerPriority,
        ).length > 0
      );
    };

    const handlePointerDownCapture = (event: PointerEvent) => {
      pointerButtonsRef.current = event.buttons;
      if (event.button !== 0) {
        return;
      }

      if (shouldBlockOrbitForPointer(event.offsetX, event.offsetY)) {
        setOrbitControlsEnabled(false);
      }
    };

    const jointDragStoreSync = createJointDragStoreSync({
      onDragChange: (jointName, angle) => {
        onJointChangeRef.current?.(jointName, angle);
      },
      onDragCommit: (jointName, angle) => {
        onJointChangeCommitRef.current?.(jointName, angle);
      },
      // Keep drag motion fully local in Three.js, but cap React/store sync to once per frame.
      throttleChanges: throttleJointChangeDuringDrag,
      intervalMs: JOINT_DRAG_STORE_SYNC_INTERVAL,
    });

    const jointDragFrameSync = createJointDragFrameSync({
      onFrame: (localX, localY) => {
        if (!updatePointerFromLocalPoint(localX, localY)) {
          return;
        }
        moveRay(raycasterRef.current.ray);
        invalidateRef.current();
      },
    });

    const tempWorldQuat = new THREE.Quaternion();
    const tempAxisWorld = new THREE.Vector3();
    const tempPivotPoint = new THREE.Vector3();
    const tempPlane = new THREE.Plane();
    const tempProjStart = new THREE.Vector3();
    const tempProjEnd = new THREE.Vector3();
    const tempCross = new THREE.Vector3();
    const tempDelta = new THREE.Vector3();
    const tempPrevHitPoint = new THREE.Vector3();
    const tempNewHitPoint = new THREE.Vector3();
    const tempTangentWorld = new THREE.Vector3();
    const tempCameraView = new THREE.Vector3();
    const tempCameraForward = new THREE.Vector3();

    const syncJointWorldFrame = (joint: any) => {
      const axis = joint.axis || new THREE.Vector3(0, 0, 1);
      joint.getWorldQuaternion(tempWorldQuat);

      tempAxisWorld.copy(axis).applyQuaternion(tempWorldQuat).normalize();
      tempPivotPoint.setFromMatrixPosition(joint.matrixWorld);
    };

    const isRuntimeJointObject = (object: THREE.Object3D | null): boolean =>
      Boolean(object && ((object as any).isURDFJoint || (object as any).type === 'URDFJoint'));

    const findParentLinkForJoint = (jointObject: THREE.Object3D): THREE.Object3D | null => {
      let parentLink: THREE.Object3D | null = jointObject.parent;
      while (parentLink && parentLink !== robot) {
        if ((parentLink as any).isURDFLink || (parentLink as any).type === 'URDFLink') {
          return parentLink;
        }
        parentLink = parentLink.parent;
      }

      return null;
    };

    function resolveControllableJoint(jointObject: THREE.Object3D): any {
      // Skip non-interactive joints and passive MJCF spring hinges; direct
      // link dragging should drive the nearest controllable parent joint.
      if (
        !isSingleDofJoint(jointObject) ||
        isPassiveSpringJointDragTarget(jointObject.name, robotJoints, jointObject)
      ) {
        return findParentJoint(findParentLinkForJoint(jointObject));
      }

      return jointObject;
    }

    /**
     * Find the parent joint of a link (for drag rotation)
     */
    function findParentJoint(linkObject: THREE.Object3D | null): any {
      if (!linkObject) return null;

      let current: THREE.Object3D | null = linkObject.parent;

      while (current && current !== robot) {
        if (isRuntimeJointObject(current)) {
          return resolveControllableJoint(current);
        }

        current = current.parent;
      }

      return null;
    }

    const applyResolvedSelection = ({
      resolvedHit,
      resolvedLinkObject,
      resolvedSubType,
      clickedJoint,
    }: PendingPointerSelection) => {
      armSelectionMissGuard(justSelectedRef);
      const committedHoverAction = resolveSelectionCommitHoverAction(resolvedHit);

      if (committedHoverAction.mode === 'preserve') {
        applyHoveredState(committedHoverAction.hoveredSelection, resolvedHit.highlightTarget);
      }

      if (onSelect || onMeshSelect) {
        if (resolvedHit.targetKind === 'helper') {
          if (resolvedHit.type === 'tendon') {
            clearHoveredState();
            return;
          }
          const helperSelectionPlan = resolveHelperSelectionPlan({
            fallbackType: resolvedHit.type,
            fallbackId: resolvedHit.id,
            helperKind: resolvedHit.helperKind,
            linkObject: resolvedLinkObject,
          });
          const helperSelectionIdentity = resolveHelperSelectionIdentity(
            helperSelectionPlan.selectTarget,
            robotLinks,
            robotJoints,
          );
          if (onSelect) {
            onSelect(
              helperSelectionIdentity.type,
              helperSelectionIdentity.id,
              undefined,
              resolvedHit.helperKind,
            );
          }
        } else if (resolvedSubType && resolvedHit.type === 'link') {
          const { preferredIkHandleLinkId } = resolveIkGeometrySelectionState({
            toolMode,
            hitType: resolvedHit.type,
            hitSubType: resolvedSubType,
            linkId: resolvedHit.linkId,
            fallbackId: resolvedHit.id,
            resolveDirectIkHandleLink,
          });
          const selectionPlan = resolveMouseDownSelectionPlan({
            mode,
            linkName: resolvedHit.linkId ?? resolvedHit.id,
            jointName: clickedJoint?.name ?? null,
            subType: resolvedSubType,
            preferredIkHandleLinkId,
          });
          const shouldDispatchMeshSelection =
            selectionPlan.shouldSyncMeshSelection && typeof onMeshSelect === 'function';

          if (onSelect && !shouldDispatchMeshSelection) {
            const selectTarget = selectionPlan.selectTarget;
            if (selectTarget.type === 'joint') {
              onSelect('joint', selectTarget.id);
            } else {
              onSelect('link', selectTarget.id, selectTarget.subType, selectTarget.helperKind);
            }
          }

          if (shouldDispatchMeshSelection) {
            onMeshSelect(
              resolvedHit.linkId ?? resolvedHit.id,
              clickedJoint ? clickedJoint.name : null,
              resolvedHit.objectIndex ?? 0,
              resolvedSubType,
            );
          }

          if (selectionPlan.shouldApplyImmediateGeometryHighlight && resolvedHit.linkId) {
            highlightGeometry(
              resolvedHit.linkId,
              false,
              resolvedSubType,
              resolvedHit.highlightTarget ?? resolvedHit.objectIndex,
              'selection',
            );
          }
        } else if (resolvedHit.type === 'tendon') {
          onSelect?.('tendon', resolvedHit.id);
        }

        if (committedHoverAction.mode === 'clear') {
          clearHoveredState();
        }
      }
    };

    const syncActiveJointFromCurrentSelection = () => {
      if (!setActiveJointRef.current) {
        return;
      }

      const activeJointKey = resolveActiveViewerJointKeyFromSelection(
        (robot as { joints?: Parameters<typeof resolveActiveViewerJointKeyFromSelection>[0] } | null)
          ?.joints,
        selection,
      );

      if (activeJointKey) {
        setActiveJointRef.current(activeJointKey);
      }
    };

    const getRevoluteDelta = (joint: any, startPt: THREE.Vector3, endPt: THREE.Vector3): number => {
      syncJointWorldFrame(joint);
      tempPlane.setFromNormalAndCoplanarPoint(tempAxisWorld, tempPivotPoint);

      tempPlane.projectPoint(startPt, tempProjStart);
      tempPlane.projectPoint(endPt, tempProjEnd);

      tempProjStart.sub(tempPivotPoint);
      tempProjEnd.sub(tempPivotPoint);

      if (
        tempProjStart.lengthSq() <= JOINT_DRAG_EPSILON ||
        tempProjEnd.lengthSq() <= JOINT_DRAG_EPSILON
      ) {
        return 0;
      }

      tempCross.crossVectors(tempProjStart, tempProjEnd);
      const worldDelta = Math.atan2(tempCross.dot(tempAxisWorld), tempProjStart.dot(tempProjEnd));
      tempCameraView.copy(camera.position).sub(startPt);
      if (tempCameraView.lengthSq() <= JOINT_DRAG_EPSILON) {
        camera.getWorldDirection(tempCameraView).multiplyScalar(-1);
      } else {
        tempCameraView.normalize();
      }

      camera.getWorldDirection(tempCameraForward);
      tempTangentWorld.copy(tempCameraForward).cross(tempAxisWorld);
      const tangentDistance =
        tempTangentWorld.lengthSq() > JOINT_DRAG_EPSILON
          ? tempTangentWorld.normalize().dot(tempDelta.subVectors(endPt, startPt))
          : 0;
      const tangentDelta =
        Math.abs(tangentDistance) > JOINT_DRAG_EPSILON
          ? resolveRevoluteTangentAngleDelta({
              tangentDistance,
              startRadius: tempProjStart.length(),
              endRadius: tempProjEnd.length(),
              epsilon: JOINT_DRAG_EPSILON,
            })
          : 0;

      return resolveRevoluteDragDelta({
        worldDelta,
        tangentDelta,
        planeFacingRatio: Math.abs(tempCameraView.dot(tempAxisWorld)),
        epsilon: JOINT_DRAG_EPSILON,
        // Keep a generous singularity guard here. The smaller per-frame safety
        // step is applied below without discarding the remaining pointer travel.
        maxDelta: MAX_REVOLUTE_DELTA_PER_INPUT,
      });
    };

    const getPrismaticDelta = (
      joint: any,
      startPt: THREE.Vector3,
      endPt: THREE.Vector3,
    ): number => {
      syncJointWorldFrame(joint);
      tempDelta.subVectors(endPt, startPt);
      return tempDelta.dot(tempAxisWorld);
    };

    let pendingRevoluteDelta = 0;
    let revoluteDeltaFrameHandle: number | null = null;

    const applyJointDelta = (delta: number) => {
      if (!dragJoint.current || Math.abs(delta) <= JOINT_DRAG_EPSILON) {
        return;
      }

      const step = resolveJointDragRuntimeStep({
        currentRuntimeValue: dragJointRuntimeValueRef.current,
        fallbackRuntimeValue: dragJoint.current.angle ?? dragJoint.current.jointValue ?? 0,
        delta,
        jointType: dragJoint.current.jointType,
        limit: dragJoint.current.limit,
        deferRuntimeUpdate: deferDirectJointRuntimeUpdate,
        epsilon: JOINT_DRAG_EPSILON,
      });

      if (step.changed && dragJoint.current.setJointValue) {
        const newAngle = step.nextRuntimeValue;
        dragJointRuntimeValueRef.current = newAngle;
        if (step.shouldApplyRuntimeUpdate) {
          dragJoint.current.setJointValue(newAngle);
          requestShadowMapRefresh(gl);
        }
        jointDragStoreSync.emit(
          dragJoint.current.name,
          resolveDraggedRuntimeJointActualAngle(dragJoint.current.name, newAngle),
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
        if (!isDraggingJoint.current || !dragJoint.current) {
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
        invalidateRef.current();
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
      if (!isDraggingJoint.current || !dragJoint.current) return;

      let delta = 0;
      const jt = dragJoint.current.jointType;

      if (jt === 'revolute' || jt === 'continuous') {
        lastRayRef.current.at(dragHitDistance.current, tempPrevHitPoint);
        toRay.at(dragHitDistance.current, tempNewHitPoint);
        delta = getRevoluteDelta(dragJoint.current, tempPrevHitPoint, tempNewHitPoint);
      } else if (jt === 'prismatic') {
        lastRayRef.current.at(dragHitDistance.current, tempPrevHitPoint);
        toRay.at(dragHitDistance.current, tempNewHitPoint);
        delta = getPrismaticDelta(dragJoint.current, tempPrevHitPoint, tempNewHitPoint);
      }

      if (jt === 'revolute' || jt === 'continuous') {
        applyRevoluteJointDelta(delta);
      } else {
        applyJointDelta(delta);
      }

      lastRayRef.current.copy(toRay);
    };

    // Core mouse move logic (will be throttled for hover, but immediate for dragging)
    const handleMouseMoveCore = (e: MouseEvent | PointerEvent) => {
      lastMousePosRef.current.x = e.clientX;
      lastMousePosRef.current.y = e.clientY;

      // Point mode resolves its own hover preview inside MeasureTool; skip the
      // selection-store hover raycast so no object highlight appears.
      if (toolMode === 'measure' && measureMode === 'point') {
        return;
      }

      if (!updatePointerFromLocalPoint(e.offsetX, e.offsetY)) {
        return;
      }
      needsRaycastRef.current = true;

      if (!isOrbitDragging?.current) {
        invalidateRef.current();
      }
    };

    // Throttled version for hover detection
    const throttledMouseMove = throttle(handleMouseMoveCore, THROTTLE_INTERVAL);

    // Full handler: immediate for joint dragging, throttled for hover
    const handleMouseMove = (e: MouseEvent | PointerEvent) => {
      pointerButtonsRef.current = e.buttons;
      if (
        shouldDisarmSelectionMissGuardOnPointerMove({
          justSelected: justSelectedRef?.current === true,
          pointerButtons: e.buttons,
          dragging: isDraggingJoint.current,
          hasPendingSelection: pendingPointerSelectionRef.current !== null,
          hasResetTimer: selectionResetTimerRef.current !== null,
        })
      ) {
        disarmSelectionMissGuard(justSelectedRef, selectionResetTimerRef);
      }
      if (
        pendingPointerSelectionRef.current &&
        pointerDownPositionRef.current &&
        !pointerExceededClickThresholdRef.current
      ) {
        const deferredHoverState = resolveDeferredSelectionHoverState({
          hasPendingSelection: true,
          alreadyExceededClickThreshold: pointerExceededClickThresholdRef.current,
          startX: pointerDownPositionRef.current.x,
          startY: pointerDownPositionRef.current.y,
          endX: e.clientX,
          endY: e.clientY,
        });

        pointerExceededClickThresholdRef.current = deferredHoverState.pointerExceededClickThreshold;

        if (deferredHoverState.shouldClearHover) {
          clearHoveredState();
        }
      }
      if (isDraggingJoint.current && dragJoint.current) {
        // Apply the leading event immediately so demand rendering does not trail
        // the pointer by a full frame, then coalesce only the remaining burst.
        jointDragFrameSync.schedule(e.offsetX, e.offsetY);
      } else {
        // Throttled for normal hover detection
        throttledMouseMove(e);
      }
    };

    const handleMouseDown = (e: MouseEvent) => {
      if (!robot) return;
      if (isSelectionLockedRef?.current) return;
      if (e.button !== 0) return;

      const isPointerResolvableMode = [
        'select',
        'translate',
        'rotate',
        'universal',
        'measure',
        'paint',
        'view',
      ].includes(toolMode || 'select');

      if (!isPointerResolvableMode) return;

      // Free-point measuring captures raw surface points inside MeasureTool; never
      // resolve a selection / highlight / joint-drag from these clicks.
      if (toolMode === 'measure' && measureMode === 'point') return;

      clearPendingPointerSelection();

      if (!updatePointerFromLocalPoint(e.offsetX, e.offsetY)) {
        return;
      }
      pointerInteractionActiveRef.current = true;
      pointerInteractionHitTargetRef.current = false;
      pointerDownPositionRef.current = { x: e.clientX, y: e.clientY };
      pointerExceededClickThresholdRef.current = false;
      lastMousePosRef.current = { x: e.clientX, y: e.clientY };

      // IMPORTANT:
      // TransformControls gizmo is not a child of `robot`.
      // If we only raycast `robot`, clicking gizmo will "pass through" and select
      // underlying collision/visual meshes by mistake.
      const gizmoTargets = getGizmoTargets();
      const pickTargets = getPickTargets('all');
      const helperTargets = getHelperTargets();
      const nearestSceneHit =
        gizmoTargets.length > 0
          ? raycasterRef.current.intersectObjects(gizmoTargets, false)[0]
          : undefined;
      if (shouldPreserveSelectionForGizmoPointerDown(nearestSceneHit?.object ?? null)) {
        pointerInteractionHitTargetRef.current = true;
        // TransformControls lives outside the robot pick tree, so R3F can still
        // emit pointer-missed for a valid gizmo click. Keep the current joint
        // selection alive through this interaction instead of clearing it.
        // Only visible gizmo handles should capture the click here; invisible
        // picker meshes extend beyond the rendered handles and should still let
        // background clicks dismiss the controller.
        gizmoPointerDownRef.current = { x: e.clientX, y: e.clientY };
        armSelectionMissGuard(justSelectedRef);
        syncActiveJointFromCurrentSelection();
        return;
      }

      let resolvedHit: ResolvedHoverInteractionCandidate | null = null;
      let helperInteraction: ResolvedHoverInteractionCandidate | null | undefined;
      const getHelperInteraction = () => {
        if (helperInteraction !== undefined) {
          return helperInteraction;
        }

        helperInteraction = resolveDirectHelperInteraction({
          robot,
          raycaster: raycasterRef.current,
          helperTargets,
          interactionLayerPriority,
        });
        const canvasRect = gl.domElement.getBoundingClientRect();
        const projectedHelperInteraction = resolveScreenSpaceHelperInteraction({
          pointerClientX: e.clientX,
          pointerClientY: e.clientY,
          projectedHelpers: collectProjectedHelperInteractionTargets({
            robot,
            camera,
            canvasRect,
          }),
          interactionLayerPriority,
        });
        const helperCandidates = [helperInteraction, projectedHelperInteraction].filter(
          (candidate): candidate is ResolvedHoverInteractionCandidate =>
            candidate !== null &&
            !isRuntimeInteractionEditorLocked(candidate, robotLinks, robotJoints),
        );
        helperInteraction =
          helperCandidates.length > 0
            ? resolveHoverInteractionResolution(helperCandidates, interactionLayerPriority)
                .primaryInteraction
            : null;
        return helperInteraction;
      };

      if (pickTargets.length > 0 && !rayIntersectsBoundingBox(raycasterRef.current, true)) {
        if (toolMode === 'paint') {
          disarmSelectionMissGuard(justSelectedRef, selectionResetTimerRef);
          return;
        }
        resolvedHit = getHelperInteraction();
      } else {
        const intersections = findPickIntersections(
          robot,
          raycasterRef.current,
          pickTargets,
          'all',
          false,
          interactionLayerPriority,
        );
        const resolvedCandidates: ResolvedHoverInteractionCandidate[] = intersections.reduce<
          ResolvedHoverInteractionCandidate[]
        >((candidates, rayHit) => {
          const selectionHit = resolveInteractionSelectionHit(robot, rayHit.object);
          if (
            selectionHit &&
            !isRuntimeInteractionEditorLocked(selectionHit, robotLinks, robotJoints)
          ) {
            candidates.push({
              ...selectionHit,
              distance: rayHit.distance,
            });
          }
          return candidates;
        }, []);
        const nextHelperInteraction = getHelperInteraction();

        ({ primaryInteraction: resolvedHit } = resolveHoverInteractionResolution(
          nextHelperInteraction
            ? resolvedCandidates.concat(nextHelperInteraction)
            : resolvedCandidates,
          interactionLayerPriority,
        ));

        if (toolMode === 'paint') {
          const paintIntersection = intersections.find((intersection) => {
            if (intersection.faceIndex === undefined || intersection.faceIndex === null) {
              return false;
            }

            if (!(intersection.object instanceof THREE.Mesh)) {
              return false;
            }

            const selectionHit = resolveInteractionSelectionHit(robot, intersection.object);
            return (
              selectionHit?.type === 'link' &&
              selectionHit.subType === 'visual' &&
              !isRuntimeInteractionEditorLocked(
                selectionHit,
                robotLinks,
                robotJoints,
              )
            );
          });

          if (!paintIntersection) {
            disarmSelectionMissGuard(justSelectedRef, selectionResetTimerRef);
            return;
          }

          const paintSelectionHit = resolveInteractionSelectionHit(robot, paintIntersection.object);
          if (!paintSelectionHit?.linkId) {
            disarmSelectionMissGuard(justSelectedRef, selectionResetTimerRef);
            return;
          }
          if (!(paintIntersection.object instanceof THREE.Mesh)) {
            disarmSelectionMissGuard(justSelectedRef, selectionResetTimerRef);
            return;
          }

          onPaintFace?.({
            linkId: paintSelectionHit.linkId,
            objectIndex: paintSelectionHit.objectIndex ?? 0,
            mesh: paintIntersection.object,
            faceIndex: paintIntersection.faceIndex as number,
          });
          pointerInteractionHitTargetRef.current = true;
          clearHoveredState();
          e.preventDefault();
          e.stopPropagation();
          return;
        }
      }

      if (!resolvedHit) {
        disarmSelectionMissGuard(justSelectedRef, selectionResetTimerRef);
        return;
      }

      pointerInteractionHitTargetRef.current = true;

      const resolvedLinkObject = resolvedHit.linkObject ?? null;
      const resolvedSubType = resolvedHit.subType;
      const clickedJoint = (() => {
        if (resolvedHit.type === 'joint') {
          const canonicalJointId = resolveJointKey(robotJoints ?? {}, resolvedHit.id);
          const jointName = canonicalJointId
            ? (robotJoints?.[canonicalJointId]?.name ?? resolvedHit.id)
            : resolvedHit.id;
          const jointObject = robot?.getObjectByName(jointName) ?? null;
          if (
            jointObject &&
            isRuntimeJointObject(jointObject)
          ) {
            return resolveControllableJoint(jointObject);
          }
          return null;
        }

        if (resolvedHit.targetKind !== 'geometry' || resolvedSubType === 'collision') {
          return null;
        }

        const canonicalLinkId =
          resolveLinkKey(robotLinks ?? {}, resolvedHit.linkId ?? resolvedHit.id) ??
          resolvedHit.linkId ??
          resolvedHit.id;
        const runtimeLinkName =
          robotLinks?.[canonicalLinkId]?.name ?? resolvedHit.linkId ?? resolvedHit.id;
        const runtimeLinkObject =
          resolvedLinkObject ?? robot?.getObjectByName(runtimeLinkName) ?? null;

        return findParentJoint(runtimeLinkObject);
      })();

      const pendingSelection: PendingPointerSelection = {
        resolvedHit,
        resolvedLinkObject,
        resolvedSubType,
        clickedJoint,
      };
      const { geometryIkSelectionActive, preferredIkHandleLinkId } =
        resolveIkGeometrySelectionState({
          toolMode,
          hitType: resolvedHit.type,
          hitSubType: resolvedSubType,
          linkId: resolvedHit.linkId,
          fallbackId: resolvedHit.id,
          resolveDirectIkHandleLink,
        });
      const prefersIkHandleSelection =
        resolvedHit.type === 'link' && Boolean(resolvedSubType) && Boolean(preferredIkHandleLinkId);
      const allowsViewModeIkSelection =
        toolMode === 'view' &&
        (prefersIkHandleSelection ||
          (resolvedHit.targetKind === 'helper' && resolvedHit.helperKind === 'ik-handle'));

      if (toolMode === 'view' && !allowsViewModeIkSelection) {
        disarmSelectionMissGuard(justSelectedRef, selectionResetTimerRef);
        return;
      }

      const hasDirectJointDragTarget =
        !geometryIkSelectionActive &&
        toolMode !== 'view' &&
        Boolean(clickedJoint) &&
        !resolvedHit.screenSpaceProjected &&
        shouldStartJointDragFromGeometryHit(toolMode || 'select');
      const hasHelperTarget = resolvedHit.targetKind === 'helper';
      const shouldDeferSelection = shouldDeferSelectionUntilPointerUp(
        toolMode || 'select',
        hasDirectJointDragTarget,
        allowsViewModeIkSelection,
        hasHelperTarget,
      );

      if (shouldDeferSelection) {
        armSelectionMissGuard(justSelectedRef);
        freezeDeferredSelectionHover();
        pendingPointerSelectionRef.current = pendingSelection;
        pointerDownPositionRef.current = { x: e.clientX, y: e.clientY };
        pointerExceededClickThresholdRef.current = false;
        return;
      }

      applyResolvedSelection(pendingSelection);

      const joint =
        toolMode === 'view' ||
        geometryIkSelectionActive ||
        !shouldStartJointDragFromGeometryHit(toolMode || 'select') ||
        resolvedHit.screenSpaceProjected
          ? null
          : clickedJoint;

      if (joint) {
        cancelPendingRevoluteDelta();
        isDraggingJoint.current = true;
        dragJoint.current = joint;
        dragJointRuntimeValueRef.current = Number(joint.angle ?? joint.jointValue ?? 0);
        dragHitDistance.current = resolvedHit.distance;
        lastRayRef.current.copy(raycasterRef.current.ray);
        if (shouldDisableOrbitForDirectJointDrag(toolMode || 'select', true)) {
          // Direct joint dragging starts from robot geometry, not the
          // gizmo picker path, so explicitly suspend orbit before the
          // first move.
          setOrbitControlsEnabled(false);
        }
        setIsDraggingRef.current?.(true);
        if (setActiveJointRef.current) {
          setActiveJointRef.current(joint.name, {
            autoScroll: false,
            suppressNextAutoScroll: true,
          });
        }
        e.preventDefault();
        e.stopPropagation();
      }
    };

    const handleMouseUp = () => {
      pointerButtonsRef.current = 0;
      const shouldFinalizeInteraction = shouldFinalizePointerInteraction({
        interactionStarted: pointerInteractionActiveRef.current,
        dragging: isDraggingJoint.current,
        hasPendingSelection: pendingPointerSelectionRef.current !== null,
      });

      if (!shouldFinalizeInteraction) {
        return;
      }

      pointerInteractionActiveRef.current = false;
      let shouldResetSelectionMissGuard = justSelectedRef?.current === true;
      const interactionHitTarget = pointerInteractionHitTargetRef.current;
      pointerInteractionHitTargetRef.current = false;

      // Capture empty-click state before the refs below are cleared.
      // An empty click is one where no gizmo, mesh, or helper was hit,
      // no deferred selection is pending, and no joint drag is active.
      // Additionally, if the pointer landed on a gizmo (invisible picker)
      // but the user dragged to orbit instead of clicking, the movement
      // threshold prevents accidental deselection.
      const gizmoDown = gizmoPointerDownRef.current;
      gizmoPointerDownRef.current = null;
      const wasGizmoDrag =
        gizmoDown !== null &&
        !isPointerInteractionWithinClickThreshold({
          startX: gizmoDown.x,
          startY: gizmoDown.y,
          endX: lastMousePosRef.current.x,
          endY: lastMousePosRef.current.y,
        });
      const pointerDownPosition = pointerDownPositionRef.current;
      const pointerMovedBeyondClickThreshold =
        pointerExceededClickThresholdRef.current ||
        (pointerDownPosition !== null &&
          !isPointerInteractionWithinClickThreshold({
            startX: pointerDownPosition.x,
            startY: pointerDownPosition.y,
            endX: lastMousePosRef.current.x,
            endY: lastMousePosRef.current.y,
          }));
      const wasEmptyClick = shouldTreatPointerUpAsBackgroundMiss({
        hasPendingSelection: pendingPointerSelectionRef.current !== null,
        dragging: isDraggingJoint.current,
        interactionHitTarget,
        wasGizmoDrag,
        pointerMovedBeyondClickThreshold,
      });

      if (pendingPointerSelectionRef.current) {
        const pendingSelection = pendingPointerSelectionRef.current;
        const shouldCommitPendingSelection = !pointerMovedBeyondClickThreshold;
        clearPendingPointerSelection();

        if (shouldCommitPendingSelection) {
          applyResolvedSelection(pendingSelection);
          releaseDeferredSelectionHover();
          shouldResetSelectionMissGuard = true;
        } else {
          releaseDeferredSelectionHover();
          shouldResetSelectionMissGuard = false;
          disarmSelectionMissGuard(justSelectedRef, selectionResetTimerRef);
        }
      }

      if (isDraggingJoint.current) {
        jointDragFrameSync.flush();
        flushPendingRevoluteDelta();
        const committedRuntimeValue = dragJointRuntimeValueRef.current;

        const commitPayload = dragJoint.current
          ? {
              name: dragJoint.current.name,
              angle: resolveDraggedRuntimeJointActualAngle(
                dragJoint.current.name,
                committedRuntimeValue ??
                  dragJoint.current.angle ??
                  dragJoint.current.jointValue ??
                  0,
              ),
            }
          : null;

        isDraggingJoint.current = false;
        dragJoint.current = null;
        dragJointRuntimeValueRef.current = null;
        setIsDraggingRef.current?.(false);

        if (commitPayload) {
          jointDragStoreSync.commit(commitPayload.name, commitPayload.angle);
        }
      }

      if (wasEmptyClick) {
        shouldResetSelectionMissGuard = false;
        disarmSelectionMissGuard(justSelectedRef, selectionResetTimerRef);
      }

      if (shouldResetSelectionMissGuard && justSelectedRef?.current) {
        scheduleSelectionMissGuardReset({
          justSelectedRef,
          timerRef: selectionResetTimerRef,
          onReset: () => {
            needsRaycastRef.current = true;
            invalidateRef.current();
          },
        });
      } else {
        clearSelectionMissGuardTimer(selectionResetTimerRef);
      }

      // When clicking on empty space (no gizmo hit, no mesh hit, no joint
      // drag), clear the selection so the transform gizmo disappears.  This
      // provides a fallback deselection path that works even if R3F's
      // onPointerMissed does not fire (e.g. when gizmo picker meshes cause
      // useFrame hover suppression to disable orbit controls, which can
      // interfere with R3F's click-detection cycle).
      if (wasEmptyClick) {
        onSelect?.('link', '');
      }

      pointerDownPositionRef.current = null;
      pointerExceededClickThresholdRef.current = false;
      setOrbitControlsEnabled(true);
      needsRaycastRef.current = true;
      invalidateRef.current();
    };

    const handleWindowBlur = () => {
      pointerButtonsRef.current = 0;
      handleMouseUp();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        handleMouseUp();
      }
    };

    const handleMouseLeave = () => {
      const shouldFinalizeInteraction = shouldFinalizePointerInteraction({
        interactionStarted: pointerInteractionActiveRef.current,
        dragging: isDraggingJoint.current,
        hasPendingSelection: pendingPointerSelectionRef.current !== null,
      });
      pointerButtonsRef.current = 0;
      mouseRef.current.set(-1000, -1000);

      if (hoveredLinkRef.current) {
        const hoveredSubType =
          ((hoveredLinkRef as any).currentSubType as 'visual' | 'collision' | null) ?? undefined;
        if (!useExternalHover) {
          highlightGeometry(
            hoveredLinkRef.current,
            true,
            hoveredSubType,
            (hoveredLinkRef as any).currentMesh,
          );
        }
        hoveredLinkRef.current = null;
        (hoveredLinkRef as any).currentMesh = null;
        (hoveredLinkRef as any).currentObjectIndex = null;
        (hoveredLinkRef as any).currentSubType = null;
        onHover?.(null, null);
      }

      if (shouldFinalizeInteraction) {
        handleMouseUp();
      }
    };

    const hoverMoveEventName = resolveHoverMoveEventName(
      typeof window !== 'undefined' ? window : undefined,
    );

    gl.domElement.addEventListener('pointerdown', handlePointerDownCapture, true);
    gl.domElement.addEventListener(hoverMoveEventName, handleMouseMove as EventListener, {
      passive: true,
    });
    gl.domElement.addEventListener('mousedown', handleMouseDown);
    gl.domElement.addEventListener('mouseup', handleMouseUp);
    gl.domElement.addEventListener('mouseleave', handleMouseLeave);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('pointerup', handleMouseUp);
    window.addEventListener('blur', handleWindowBlur);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      // Cancel throttled handler to prevent pending callbacks
      throttledMouseMove.cancel();
      jointDragFrameSync.cancel();
      cancelPendingRevoluteDelta();
      jointDragStoreSync.dispose();
      dragJointRuntimeValueRef.current = null;
      clearSelectionMissGuardTimer(selectionResetTimerRef);
      releaseDeferredSelectionHover();
      setOrbitControlsEnabled(true);
      gl.domElement.removeEventListener('pointerdown', handlePointerDownCapture, true);
      gl.domElement.removeEventListener(hoverMoveEventName, handleMouseMove as EventListener);
      gl.domElement.removeEventListener('mousedown', handleMouseDown);
      gl.domElement.removeEventListener('mouseup', handleMouseUp);
      gl.domElement.removeEventListener('mouseleave', handleMouseLeave);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('pointerup', handleMouseUp);
      window.removeEventListener('blur', handleWindowBlur);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      gizmoTargetsRef.current = [];
      gizmoTargetsCacheKeyRef.current = '';
      gizmoTargetsUpdatedAtRef.current = 0;
      pickTargetCachesRef.current.all.key = '';
      pickTargetCachesRef.current.all.updatedAt = 0;
      pickTargetCachesRef.current.all.targets = [];
      pickTargetCachesRef.current.visual.key = '';
      pickTargetCachesRef.current.visual.updatedAt = 0;
      pickTargetCachesRef.current.visual.targets = [];
      pickTargetCachesRef.current.collision.key = '';
      pickTargetCachesRef.current.collision.updatedAt = 0;
      pickTargetCachesRef.current.collision.targets = [];
    };
  }, [
    enabled,
    gl,
    camera,
    scene,
    robot,
    robotVersion,
    orbitControls,
    onHover,
    onSelect,
    onMeshSelect,
    onPaintFace,
    highlightGeometry,
    toolMode,
    measureMode,
    mode,
    justSelectedRef,
    isOrbitDragging,
    isSelectionLockedRef,
    selection,
    showCollision,
    showCollisionAlwaysOnTop,
    showVisual,
    interactionLayerPriority,
    linkMeshMapRef,
    robotJoints,
    robotLinks,
    resolveDirectIkHandleLink,
    useExternalHover,
    throttleJointChangeDuringDrag,
    deferDirectJointRuntimeUpdate,
    rayIntersectsBoundingBox,
    getGizmoTargets,
    getHelperTargets,
    getPickTargets,
  ]);

  return {
    mouseRef,
    raycasterRef,
    hoveredLinkRef,
    isDraggingJoint,
    needsRaycastRef,
    lastMousePosRef,
    pointerButtonsRef,
  };
}
