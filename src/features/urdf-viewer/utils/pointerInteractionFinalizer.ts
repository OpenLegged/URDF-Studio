import type { RefObject } from 'react';
import type { InteractionSelection } from '@/types';
import {
  isPointerInteractionWithinClickThreshold,
  shouldFinalizePointerInteraction,
} from './clickSelectionPolicy';
import type { PendingPointerSelection } from './pointerSelectionCommit';
import {
  clearSelectionMissGuardTimer,
  disarmSelectionMissGuard,
  scheduleSelectionMissGuardReset,
  shouldTreatPointerUpAsBackgroundMiss,
} from './selectionMissGuard';

interface PointerInteractionFinalizerState {
  pointerButtonsRef: RefObject<number>;
  pointerInteractionActiveRef: RefObject<boolean>;
  pointerInteractionHitTargetRef: RefObject<boolean>;
  gizmoPointerDownRef: RefObject<{ x: number; y: number } | null>;
  lastMousePosRef: RefObject<{ x: number; y: number }>;
  pointerDownPositionRef: RefObject<{ x: number; y: number } | null>;
  pointerExceededClickThresholdRef: RefObject<boolean>;
  pendingPointerSelectionRef: RefObject<PendingPointerSelection | null>;
  isDraggingJointRef: RefObject<boolean>;
  justSelectedRef: RefObject<boolean> | undefined;
  selectionResetTimerRef: RefObject<ReturnType<typeof setTimeout> | null>;
  needsRaycastRef: RefObject<boolean>;
}

interface CreatePointerInteractionFinalizerOptions {
  state: PointerInteractionFinalizerState;
  clearPendingPointerSelection: () => void;
  applyResolvedSelection: (selection: PendingPointerSelection) => void;
  releaseDeferredSelectionHover: () => void;
  finishJointDrag: () => void;
  setOrbitControlsEnabled: (enabled: boolean) => void;
  invalidate: () => void;
  onSelect:
    | ((type: Exclude<InteractionSelection['type'], null>, id: string) => void)
    | undefined;
}

/** Creates the pointer-up transaction that commits, cancels, or dismisses one gesture. */
export function createPointerInteractionFinalizer({
  state,
  clearPendingPointerSelection,
  applyResolvedSelection,
  releaseDeferredSelectionHover,
  finishJointDrag,
  setOrbitControlsEnabled,
  invalidate,
  onSelect,
}: CreatePointerInteractionFinalizerOptions) {
  return () => {
    state.pointerButtonsRef.current = 0;
    const shouldFinalizeInteraction = shouldFinalizePointerInteraction({
      interactionStarted: state.pointerInteractionActiveRef.current,
      dragging: state.isDraggingJointRef.current,
      hasPendingSelection: state.pendingPointerSelectionRef.current !== null,
    });
    if (!shouldFinalizeInteraction) {
      return;
    }

    state.pointerInteractionActiveRef.current = false;
    let shouldResetSelectionMissGuard = state.justSelectedRef?.current === true;
    const interactionHitTarget = state.pointerInteractionHitTargetRef.current;
    state.pointerInteractionHitTargetRef.current = false;

    const gizmoDown = state.gizmoPointerDownRef.current;
    state.gizmoPointerDownRef.current = null;
    const wasGizmoDrag =
      gizmoDown !== null &&
      !isPointerInteractionWithinClickThreshold({
        startX: gizmoDown.x,
        startY: gizmoDown.y,
        endX: state.lastMousePosRef.current.x,
        endY: state.lastMousePosRef.current.y,
      });
    const pointerDownPosition = state.pointerDownPositionRef.current;
    const pointerMovedBeyondClickThreshold =
      state.pointerExceededClickThresholdRef.current ||
      (pointerDownPosition !== null &&
        !isPointerInteractionWithinClickThreshold({
          startX: pointerDownPosition.x,
          startY: pointerDownPosition.y,
          endX: state.lastMousePosRef.current.x,
          endY: state.lastMousePosRef.current.y,
        }));
    const wasEmptyClick = shouldTreatPointerUpAsBackgroundMiss({
      hasPendingSelection: state.pendingPointerSelectionRef.current !== null,
      dragging: state.isDraggingJointRef.current,
      interactionHitTarget,
      wasGizmoDrag,
      pointerMovedBeyondClickThreshold,
    });

    if (state.pendingPointerSelectionRef.current) {
      const pendingSelection = state.pendingPointerSelectionRef.current;
      const shouldCommitPendingSelection = !pointerMovedBeyondClickThreshold;
      clearPendingPointerSelection();
      if (shouldCommitPendingSelection) {
        applyResolvedSelection(pendingSelection);
        releaseDeferredSelectionHover();
        shouldResetSelectionMissGuard = true;
      } else {
        releaseDeferredSelectionHover();
        shouldResetSelectionMissGuard = false;
        disarmSelectionMissGuard(state.justSelectedRef, state.selectionResetTimerRef);
      }
    }

    if (state.isDraggingJointRef.current) {
      finishJointDrag();
    }
    if (wasEmptyClick) {
      shouldResetSelectionMissGuard = false;
      disarmSelectionMissGuard(state.justSelectedRef, state.selectionResetTimerRef);
    }

    if (shouldResetSelectionMissGuard && state.justSelectedRef?.current) {
      scheduleSelectionMissGuardReset({
        justSelectedRef: state.justSelectedRef,
        timerRef: state.selectionResetTimerRef,
        onReset: () => {
          state.needsRaycastRef.current = true;
          invalidate();
        },
      });
    } else {
      clearSelectionMissGuardTimer(state.selectionResetTimerRef);
    }

    if (wasEmptyClick) {
      onSelect?.('link', '');
    }

    state.pointerDownPositionRef.current = null;
    state.pointerExceededClickThresholdRef.current = false;
    setOrbitControlsEnabled(true);
    state.needsRaycastRef.current = true;
    invalidate();
  };
}
