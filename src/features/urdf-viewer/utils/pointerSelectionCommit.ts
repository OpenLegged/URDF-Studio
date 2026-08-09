import type * as THREE from 'three';
import type { InteractionSelection, UrdfJoint, UrdfLink } from '@/types';
import type { ToolMode, ViewerHelperKind, ViewerSceneMode } from '../types';
import type { DraggableRuntimeJoint } from './directJointDragController';
import type { ResolvedHoverInteractionCandidate } from './hoverInteractionResolution';
import { resolveHelperSelectionIdentity } from './helperSelectionIdentity';
import { resolveHelperSelectionPlan } from './helperSelectionPlan';
import { resolveIkGeometrySelectionState } from './ikGeometrySelectionState';
import { resolveMouseDownSelectionPlan } from './mouseDownSelectionPlan';
import { resolveSelectionCommitHoverAction } from './selectionCommitHoverPolicy';

export interface PendingPointerSelection {
  resolvedHit: ResolvedHoverInteractionCandidate;
  resolvedLinkObject: THREE.Object3D | null;
  resolvedSubType: 'visual' | 'collision' | undefined;
  clickedJoint: DraggableRuntimeJoint | null;
}

interface CreatePointerSelectionCommitOptions {
  toolMode: ToolMode;
  mode: ViewerSceneMode | undefined;
  robotLinks: Record<string, UrdfLink> | undefined;
  robotJoints: Record<string, UrdfJoint> | undefined;
  resolveDirectIkHandleLink: ((linkId: string) => string | null) | undefined;
  onSelect:
    | ((
        type: Exclude<InteractionSelection['type'], null>,
        id: string,
        subType?: 'visual' | 'collision',
        helperKind?: ViewerHelperKind,
      ) => void)
    | undefined;
  onMeshSelect:
    | ((
        linkId: string,
        jointId: string | null,
        objectIndex: number,
        objectType: 'visual' | 'collision',
      ) => void)
    | undefined;
  highlightGeometry: (
    linkName: string | null,
    revert: boolean,
    subType?: 'visual' | 'collision',
    meshToHighlight?: THREE.Object3D | null | number,
    intent?: 'hover' | 'selection',
  ) => void;
  clearHoveredState: () => void;
  applyHoveredState: (
    hoveredSelection: InteractionSelection,
    highlightTarget?: THREE.Object3D | null,
  ) => void;
}

/** Creates the selection dispatcher used after a pointer hit has been resolved. */
export function createPointerSelectionCommit({
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
}: CreatePointerSelectionCommitOptions) {
  return ({
    resolvedHit,
    resolvedLinkObject,
    resolvedSubType,
    clickedJoint,
  }: PendingPointerSelection) => {
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
        onSelect?.(
          helperSelectionIdentity.type,
          helperSelectionIdentity.id,
          undefined,
          resolvedHit.helperKind,
        );
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
            clickedJoint?.name ?? null,
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
}
