/**
 * App Effects Hook
 * Handles global side effects like keyboard shortcuts and selection cleanup
 */
import { useEffect, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { useUIStore } from '@/store';
import { useAssetsStore } from '@/store/assetsStore';
import {
  matchesSelection,
  repairWorkspaceSelection,
  useSelectionStore,
  validateEntityRef,
} from '@/store/selectionStore';
import { useWorkspaceStore } from '@/store/workspaceStore';
import { useActiveHistory } from './useActiveHistory';
import { synchronizeWorkspaceComponentSourceDrafts } from './workspace-source-sync/component_source_draft_sync';

/**
 * Hook for keyboard shortcuts (undo/redo)
 */
export function useKeyboardShortcuts() {
  const { undo, redo, canUndo, canRedo } = useActiveHistory();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Undo: Ctrl+Z
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) {
        if (canUndo) {
          undo();
          e.preventDefault();
        }
      }
      // Redo: Ctrl+Shift+Z
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && e.shiftKey) {
        if (canRedo) {
          redo();
          e.preventDefault();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undo, redo, canUndo, canRedo]);
}

/**
 * Hook to clean up selection when selected item is deleted
 */
export function useSelectionCleanup() {
  const { workspace, activeComponentId } = useWorkspaceStore(
    useShallow((state) => ({
      workspace: state.workspace,
      activeComponentId: state.activeComponentId,
    })),
  );
  const selectionSession = useSelectionStore(
    useShallow((state) => ({
      selection: state.selection,
      hoveredSelection: state.hoveredSelection,
      deferredHoveredSelection: state.deferredHoveredSelection,
      attentionSelection: state.attentionSelection,
      focusTarget: state.focusTarget,
    })),
  );

  useEffect(() => {
    const repairedSelection = repairWorkspaceSelection(
      workspace,
      selectionSession.selection,
      activeComponentId,
    );
    const validSelection = (candidate: typeof selectionSession.hoveredSelection) =>
      candidate === null || validateEntityRef(workspace, candidate.entity);
    const validFocus =
      selectionSession.focusTarget === null
      || validateEntityRef(workspace, selectionSession.focusTarget);

    useSelectionStore.setState((state) => {
      const nextHovered = validSelection(selectionSession.hoveredSelection)
        ? selectionSession.hoveredSelection
        : null;
      const nextDeferred = validSelection(selectionSession.deferredHoveredSelection)
        ? selectionSession.deferredHoveredSelection
        : null;
      const nextAttention = validSelection(selectionSession.attentionSelection)
        ? selectionSession.attentionSelection
        : null;
      const nextFocus = validFocus ? selectionSession.focusTarget : null;
      if (
        matchesSelection(state.selection, repairedSelection)
        && matchesSelection(state.hoveredSelection, nextHovered)
        && matchesSelection(state.deferredHoveredSelection, nextDeferred)
        && matchesSelection(state.attentionSelection, nextAttention)
        && state.focusTarget === nextFocus
      ) {
        return state;
      }
      return {
        ...state,
        selection: repairedSelection,
        hoveredSelection: nextHovered,
        deferredHoveredSelection: nextDeferred,
        attentionSelection: nextAttention,
        focusTarget: nextFocus,
      };
    });
  }, [activeComponentId, selectionSession, workspace]);
}

/** Keep component-owned source drafts aligned across undo/redo and external mutations. */
export function useComponentSourceDraftCleanup() {
  const { workspace, revision, jointMotionRevision } = useWorkspaceStore(
    useShallow((state) => ({
      workspace: state.workspace,
      revision: state.revision,
      jointMotionRevision: state.jointMotionRevision,
    })),
  );
  const componentSourceDrafts = useAssetsStore((state) => state.componentSourceDrafts);
  const previousRef = useRef({
    revision,
    jointMotionRevision,
    componentSourceDrafts,
  });

  useEffect(() => {
    const previous = previousRef.current;
    previousRef.current = { revision, jointMotionRevision, componentSourceDrafts };
    const revisionDelta = revision - previous.revision;
    const jointMotionRevisionDelta = jointMotionRevision - previous.jointMotionRevision;
    if (
      componentSourceDrafts === previous.componentSourceDrafts
      && revisionDelta > 0
      && revisionDelta === jointMotionRevisionDelta
    ) {
      return;
    }
    synchronizeWorkspaceComponentSourceDrafts();
  }, [componentSourceDrafts, jointMotionRevision, revision, workspace]);
}

/**
 * Hook to listen for system theme changes
 */
export function useSystemThemeListener() {
  const theme = useUIStore((state) => state.theme);
  const setTheme = useUIStore((state) => state.setTheme);

  useEffect(() => {
    if (theme !== 'system') return;

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    const handleChange = () => {
      // Re-apply theme to update class based on new system preference
      setTheme('system');
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [theme, setTheme]);
}

/**
 * Combined hook for all app effects
 */
export function useAppEffects() {
  useKeyboardShortcuts();
  useSelectionCleanup();
  useComponentSourceDraftCleanup();
  useSystemThemeListener();
}
