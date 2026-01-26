/**
 * App Effects Hook
 * Handles global side effects like keyboard shortcuts and selection cleanup
 */
import { useEffect } from 'react';
import { useRobotStore, useSelectionStore, useCanUndo, useCanRedo } from '@/store';

/**
 * Hook for keyboard shortcuts (undo/redo)
 */
export function useKeyboardShortcuts() {
  const undo = useRobotStore((state) => state.undo);
  const redo = useRobotStore((state) => state.redo);
  const canUndo = useCanUndo();
  const canRedo = useCanRedo();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Undo: Ctrl+Z
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) {
        if (canUndo) {
          undo();
          e.preventDefault();
        }
      }
      // Redo: Ctrl+Y or Ctrl+Shift+Z
      if ((e.metaKey || e.ctrlKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
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
  const links = useRobotStore((state) => state.links);
  const joints = useRobotStore((state) => state.joints);
  const selection = useSelectionStore((state) => state.selection);
  const clearSelection = useSelectionStore((state) => state.clearSelection);

  useEffect(() => {
    if (selection.id && selection.type) {
      const exists = selection.type === 'link'
        ? links[selection.id]
        : joints[selection.id];
      if (!exists) {
        clearSelection();
      }
    }
  }, [links, joints, selection, clearSelection]);
}

/**
 * Combined hook for all app effects
 */
export function useAppEffects() {
  useKeyboardShortcuts();
  useSelectionCleanup();
}
