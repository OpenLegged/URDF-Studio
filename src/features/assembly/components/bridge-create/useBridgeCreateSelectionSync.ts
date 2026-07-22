import { useCallback, useEffect, useRef } from 'react';

import { useSelectionStore } from '@/store/selectionStore';
import { useWorkspaceStore } from '@/store/workspaceStore';
import { entityRefKey, type BridgeJoint, type WorkspaceSelection } from '@/types';
import {
  resolveBridgePickAssignment,
  resolveBridgeSelectionTarget,
  type BridgePickTarget,
} from '../../utils/bridgeSelection';

interface UseBridgeCreateSelectionSyncOptions {
  parentCompId: string;
  childCompId: string;
  childLinkId: string;
  handleClose: () => void;
  enabled: boolean;
  isOpen: boolean;
  onPreviewChange?: (bridge: BridgeJoint | null) => void;
  pickTarget: BridgePickTarget;
  setChildCompId: (value: string) => void;
  setChildLinkId: (value: string) => void;
  setParentCompId: (value: string) => void;
  setParentLinkId: (value: string) => void;
  setPickTarget: (value: BridgePickTarget) => void;
}

function getSelectionSignature(selection: WorkspaceSelection): string | null {
  if (!selection) {
    return null;
  }

  return [
    entityRefKey(selection.entity),
    selection.subType ?? '',
    selection.objectIndex ?? '',
    selection.helperKind ?? '',
    selection.highlightObjectId ?? '',
  ].join(':');
}

export function useBridgeCreateSelectionSync({
  parentCompId,
  childCompId,
  childLinkId,
  enabled,
  handleClose,
  isOpen,
  onPreviewChange,
  pickTarget,
  setChildCompId,
  setChildLinkId,
  setParentCompId,
  setParentLinkId,
  setPickTarget,
}: UseBridgeCreateSelectionSyncOptions) {
  const workspace = useWorkspaceStore((state) => state.workspace);
  const selection = useSelectionStore((state) => state.selection);
  const setInteractionGuard = useSelectionStore((state) => state.setInteractionGuard);
  const clearSelection = useSelectionStore((state) => state.clearSelection);
  const clearHover = useSelectionStore((state) => state.clearHover);
  const lastAppliedSelectionRef = useRef<string | null>(null);

  const resetSelectionSyncState = useCallback(() => {
    lastAppliedSelectionRef.current = null;
  }, []);

  useEffect(() => {
    if (!isOpen) {
      resetSelectionSyncState();
      setInteractionGuard(null);
      onPreviewChange?.(null);
      return undefined;
    }

    if (!enabled) {
      resetSelectionSyncState();
      setInteractionGuard(null);
      return undefined;
    }

    // Bridge picking starts clean so a selection made before opening the
    // dialog cannot silently fill either endpoint.
    clearSelection();
    clearHover();
    lastAppliedSelectionRef.current = null;
  }, [
    clearHover,
    clearSelection,
    enabled,
    isOpen,
    onPreviewChange,
    resetSelectionSyncState,
    setInteractionGuard,
  ]);

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        handleClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleClose, isOpen]);

  useEffect(() => {
    if (!isOpen || !enabled) {
      return undefined;
    }

    setInteractionGuard((nextSelection) => {
      const resolvedSelection = resolveBridgeSelectionTarget(workspace, nextSelection);
      if (!resolvedSelection) {
        return false;
      }

      return Boolean(
        resolveBridgePickAssignment({
          selectedComponentId: resolvedSelection.componentId,
          parentComponentId: parentCompId,
          childComponentId: childCompId,
          preferredTarget: pickTarget,
        }),
      );
    });

    return () => {
      setInteractionGuard(null);
    };
  }, [childCompId, enabled, isOpen, parentCompId, pickTarget, setInteractionGuard, workspace]);

  useEffect(() => {
    if (!isOpen || !enabled) {
      return;
    }

    // The open effect clears the store synchronously, but this effect belongs
    // to the render that still captured the pre-open selection. Only consume
    // a selection that is still the live store value; a subsequent deliberate
    // click (including the same link) creates a new live value and is accepted.
    if (selection !== useSelectionStore.getState().selection) {
      return;
    }

    const resolvedSelection = resolveBridgeSelectionTarget(workspace, selection);
    if (!resolvedSelection) {
      return;
    }

    const assignmentTarget = resolveBridgePickAssignment({
      selectedComponentId: resolvedSelection.componentId,
      parentComponentId: parentCompId,
      childComponentId: childCompId,
      preferredTarget: pickTarget,
    });
    if (!assignmentTarget) {
      return;
    }

    const canonicalSelectionSignature = getSelectionSignature(selection);
    if (!canonicalSelectionSignature) {
      return;
    }
    const selectionSignature = `${assignmentTarget}:${canonicalSelectionSignature}`;
    if (lastAppliedSelectionRef.current === selectionSignature) {
      return;
    }

    lastAppliedSelectionRef.current = selectionSignature;

    if (assignmentTarget === 'parent') {
      setParentCompId(resolvedSelection.componentId);
      setParentLinkId(resolvedSelection.linkId);
      if (!childCompId || !childLinkId) {
        setPickTarget('child');
      }
      return;
    }

    setChildCompId(resolvedSelection.componentId);
    setChildLinkId(resolvedSelection.linkId);
    if (!parentCompId) {
      setPickTarget('parent');
    }
  }, [
    childCompId,
    childLinkId,
    enabled,
    isOpen,
    parentCompId,
    pickTarget,
    selection,
    setChildCompId,
    setChildLinkId,
    setParentCompId,
    setParentLinkId,
    setPickTarget,
    workspace,
  ]);

  return { resetSelectionSyncState };
}
