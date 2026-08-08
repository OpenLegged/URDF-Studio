import { useRef, useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { resolveLinkKey, resolveJointKey } from '@/core/robot';
import { throttle } from '@/shared/utils';
import type { JointPanelActiveJointOptions } from '@/shared/utils/jointPanelStore';
import type { InteractionSelection, UrdfJoint, UrdfLink } from '@/types';
import { THROTTLE_INTERVAL } from '../constants';
import type {
  MeasureMode,
  ToolMode,
  ViewerInteractiveLayer,
  ViewerPaintFaceHit,
  ViewerSceneMode,
} from '../types';
import {
  isGizmoObject,
  shouldBlockBackgroundInteractionForGizmoHit,
  shouldPreserveSelectionForGizmoPointerDown,
} from '../utils/raycast';
import { findPickIntersections } from '../utils/pickTargets';
import {
  shouldBlockOrbitForGeometryHit,
  shouldDisableOrbitForDirectJointDrag,
  shouldStartJointDragFromGeometryHit,
} from '../utils/interactionMode';
import {
  resolveDeferredSelectionHoverState,
  shouldFinalizePointerInteraction,
  shouldDeferSelectionUntilPointerUp,
} from '../utils/clickSelectionPolicy';
import { resolveActiveViewerJointKeyFromSelection } from '../utils/activeJointSelection';
import { resolveIkGeometrySelectionState } from '../utils/ikGeometrySelectionState';
import { resolveHoverMoveEventName } from '../utils/hoverMoveEventName';
import type { ViewerHelperKind } from '../types';
import { resolveDirectHelperInteraction } from '../utils/directHelperInteraction';
import {
  armSelectionMissGuard,
  disarmSelectionMissGuard,
  clearSelectionMissGuardTimer,
  shouldDisarmSelectionMissGuardOnPointerMove,
} from '../utils/selectionMissGuard';
import { usePointerInteractionTargets } from './usePointerInteractionTargets';
import {
  createDirectJointDragController,
  type DraggableRuntimeJoint,
} from '../utils/directJointDragController';
import { resolvePointerDownHit } from '../utils/pointerDownHitResolution';
import {
  createPointerSelectionCommit,
  type PendingPointerSelection,
} from '../utils/pointerSelectionCommit';
import { createPointerInteractionFinalizer } from '../utils/pointerInteractionFinalizer';

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
  const dragJoint = useRef<DraggableRuntimeJoint | null>(null);
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

  const { getGizmoTargets, getHelperTargets, getPickTargets } =
    usePointerInteractionTargets({
      robot,
      robotVersion,
      scene,
      toolMode,
      mode,
      selection,
      showCollision,
      showVisual,
      showCollisionAlwaysOnTop,
      linkMeshMapRef,
    });

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

      if (
        resolveDirectHelperInteraction({
          robot,
          raycaster: raycasterRef.current,
          helperTargets: getHelperTargets(),
          interactionLayerPriority,
        })
      ) {
        return true;
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
          false,
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

    const jointDragController = createDirectJointDragController({
      state: {
        isDraggingJoint,
        dragJoint,
        runtimeValue: dragJointRuntimeValueRef,
        hitDistance: dragHitDistance,
        lastRay: lastRayRef,
      },
      robot,
      robotJoints,
      camera,
      renderer: gl,
      throttleChanges: throttleJointChangeDuringDrag,
      deferRuntimeUpdate: deferDirectJointRuntimeUpdate,
      updatePointerFromLocalPoint,
      getCurrentRay: () => raycasterRef.current.ray,
      onChange: (jointName, angle) => onJointChangeRef.current?.(jointName, angle),
      onCommit: (jointName, angle) => onJointChangeCommitRef.current?.(jointName, angle),
      onDraggingChange: (dragging) => setIsDraggingRef.current?.(dragging),
      onActiveJointChange: (jointName, options) =>
        setActiveJointRef.current?.(jointName, options),
      invalidate: () => invalidateRef.current(),
    });

    const commitPointerSelection = createPointerSelectionCommit({
      toolMode,
      mode,
      robotLinks,
      robotJoints,
      resolveDirectIkHandleLink,
      onSelect,
      onMeshSelect,
      highlightGeometry,
      clearHoveredState,
      applyHoveredState,
    });
    const applyResolvedSelection = (pendingSelection: PendingPointerSelection) => {
      armSelectionMissGuard(justSelectedRef);
      commitPointerSelection(pendingSelection);
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
        jointDragController.schedulePointerMove(e.offsetX, e.offsetY);
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

      const hitResolution = resolvePointerDownHit({
        robot,
        camera,
        canvas: gl.domElement,
        raycaster: raycasterRef.current,
        pickTargets,
        helperTargets,
        interactionLayerPriority,
        robotLinks,
        robotJoints,
        toolMode,
        rayIntersectsBoundingBox,
        pointerClientX: e.clientX,
        pointerClientY: e.clientY,
      });
      if (hitResolution.kind === 'miss') {
        disarmSelectionMissGuard(justSelectedRef, selectionResetTimerRef);
        return;
      }
      if (hitResolution.kind === 'paint') {
        onPaintFace?.(hitResolution.hit);
        pointerInteractionHitTargetRef.current = true;
        clearHoveredState();
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      const resolvedHit = hitResolution.hit;

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
          return jointDragController.resolveJointObject(jointObject);
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

        return jointDragController.findParentJoint(runtimeLinkObject);
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
        jointDragController.start(joint, resolvedHit.distance, raycasterRef.current.ray, () => {
          if (shouldDisableOrbitForDirectJointDrag(toolMode || 'select', true)) {
            // Direct joint dragging starts from robot geometry, not the
            // gizmo picker path, so explicitly suspend orbit before the
            // first move.
            setOrbitControlsEnabled(false);
          }
        });
        e.preventDefault();
        e.stopPropagation();
      }
    };

    const handleMouseUp = createPointerInteractionFinalizer({
      state: {
        pointerButtonsRef,
        pointerInteractionActiveRef,
        pointerInteractionHitTargetRef,
        gizmoPointerDownRef,
        lastMousePosRef,
        pointerDownPositionRef,
        pointerExceededClickThresholdRef,
        pendingPointerSelectionRef,
        isDraggingJointRef: isDraggingJoint,
        justSelectedRef,
        selectionResetTimerRef,
        needsRaycastRef,
      },
      clearPendingPointerSelection,
      applyResolvedSelection,
      releaseDeferredSelectionHover,
      finishJointDrag: () => {
        jointDragController.finish();
      },
      setOrbitControlsEnabled,
      invalidate: () => invalidateRef.current(),
      onSelect,
    });

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
      jointDragController.dispose();
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
