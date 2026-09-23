import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { useSelectionStore } from '@/store/selectionStore';
import type { UrdfJoint, WorkspaceSelection } from '@/types';

const EMPTY_JOINTS: readonly UrdfJoint[] = [];

/** Subscribe only to entities rendered by this link row and its joint branches. */
export function useTreeNodeSelection(
  componentId: string,
  linkId: string,
  childJoints: readonly UrdfJoint[] = EMPTY_JOINTS,
) {
  const scopeSelection = useMemo(() => {
    const linkIds = new Set([linkId, ...childJoints.map((joint) => joint.childLinkId)]);
    const jointIds = new Set(childJoints.map((joint) => joint.id));
    return (selection: WorkspaceSelection): WorkspaceSelection => {
      const entity = selection?.entity;
      if (
        !entity ||
        (entity.type !== 'link' && entity.type !== 'joint') ||
        entity.componentId !== componentId
      ) return null;
      const ids = entity.type === 'link' ? linkIds : jointIds;
      return ids.has(entity.entityId) ? selection : null;
    };
  }, [childJoints, componentId, linkId]);

  return useSelectionStore(useShallow((state) => ({
    selection: scopeSelection(state.selection),
    hoveredSelection: scopeSelection(state.hoveredSelection),
    attentionSelection: scopeSelection(state.attentionSelection),
  })));
}

/** Keep collapsed ancestors responsive without subscribing them to all hover changes. */
export function useTreeAncestorAttention(
  componentId: string,
  linkId: string,
  joints: Record<string, UrdfJoint>,
): boolean {
  const selector = useMemo(() => {
    let previousAttention: WorkspaceSelection | undefined;
    let isAncestor = false;
    return (state: { attentionSelection: WorkspaceSelection }): boolean => {
      if (state.attentionSelection === previousAttention) return isAncestor;
      previousAttention = state.attentionSelection;
      isAncestor = false;
      const target = previousAttention?.entity;
      if (!target || target.type !== 'link' || target.componentId !== componentId) return false;
      if (target.entityId === linkId) return false;
      let cursor = target.entityId;
      const visited = new Set<string>();
      while (cursor && !visited.has(cursor)) {
        visited.add(cursor);
        const parentJoint = Object.values(joints).find((joint) => joint.childLinkId === cursor);
        if (!parentJoint) break;
        cursor = parentJoint.parentLinkId;
        if (cursor === linkId) {
          isAncestor = true;
          break;
        }
      }
      return isAncestor;
    };
  }, [componentId, joints, linkId]);
  return useSelectionStore(selector);
}
