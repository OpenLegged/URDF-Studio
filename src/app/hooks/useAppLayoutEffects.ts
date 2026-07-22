import { useCallback, useEffect, useRef, useState } from 'react';
import type { DragEvent } from 'react';
import type { AssemblyState, WorkspaceSelection } from '@/types';
import { validateEntityRef } from '@/store/selectionStore';
import { useActiveHistory } from './useActiveHistory';

interface UseAppLayoutEffectsParams {
  workspace: AssemblyState;
  selection: WorkspaceSelection;
  clearSelection: () => void;
  shouldDeferSelectionCleanup?: boolean;
  onFileDrop: (files: File[]) => void;
  onDropError: () => void;
}

function containsFiles(dataTransfer: Pick<DataTransfer, 'types'> | null | undefined): boolean {
  if (!dataTransfer) return false;
  return Array.from(dataTransfer.types ?? []).includes('Files');
}

function captureDroppedFileSystemEntries(items: DataTransferItemList | null | undefined) {
  const entries: FileSystemEntry[] = [];
  if (!items) {
    return entries;
  }

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (item.kind !== 'file' || typeof item.webkitGetAsEntry !== 'function') {
      continue;
    }

    const entry = item.webkitGetAsEntry();
    if (entry) {
      entries.push(entry);
    }
  }

  return entries;
}

export function useAppLayoutEffects({
  workspace,
  selection,
  clearSelection,
  shouldDeferSelectionCleanup = false,
  onFileDrop,
  onDropError,
}: UseAppLayoutEffectsParams) {
  const { undo, redo, canUndo, canRedo } = useActiveHistory();
  const dragLeaveFrameRef = useRef<number | null>(null);
  const [isFileDragActive, setIsFileDragActive] = useState(false);

  const cancelPendingDragLeaveCheck = useCallback(() => {
    if (dragLeaveFrameRef.current !== null) {
      window.cancelAnimationFrame(dragLeaveFrameRef.current);
      dragLeaveFrameRef.current = null;
    }
  }, []);

  const clearFileDragState = useCallback(() => {
    cancelPendingDragLeaveCheck();
    setIsFileDragActive(false);
  }, [cancelPendingDragLeaveCheck]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'z' && !event.shiftKey) {
        if (canUndo) {
          undo();
          event.preventDefault();
        }
      }

      if ((event.metaKey || event.ctrlKey) && event.key === 'z' && event.shiftKey) {
        if (canRedo) {
          redo();
          event.preventDefault();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [canRedo, canUndo, redo, undo]);

  useEffect(() => {
    if (shouldDeferSelectionCleanup) {
      return;
    }

    if (selection && !validateEntityRef(workspace, selection.entity)) {
      clearSelection();
    }
  }, [
    clearSelection,
    selection,
    shouldDeferSelectionCleanup,
    workspace,
  ]);

  useEffect(() => {
    const handleWindowReset = () => {
      clearFileDragState();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        clearFileDragState();
      }
    };

    window.addEventListener('drop', handleWindowReset);
    window.addEventListener('dragend', handleWindowReset);
    window.addEventListener('blur', handleWindowReset);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('drop', handleWindowReset);
      window.removeEventListener('dragend', handleWindowReset);
      window.removeEventListener('blur', handleWindowReset);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      cancelPendingDragLeaveCheck();
    };
  }, [cancelPendingDragLeaveCheck, clearFileDragState]);

  const handleDragEnter = useCallback(
    (event: DragEvent) => {
      if (!containsFiles(event.dataTransfer)) return;

      event.preventDefault();
      event.stopPropagation();

      cancelPendingDragLeaveCheck();
      setIsFileDragActive(true);
    },
    [cancelPendingDragLeaveCheck],
  );

  const handleDragOver = useCallback(
    (event: DragEvent) => {
      if (!containsFiles(event.dataTransfer)) return;

      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = 'copy';
      cancelPendingDragLeaveCheck();

      if (!isFileDragActive) {
        setIsFileDragActive(true);
      }
    },
    [cancelPendingDragLeaveCheck, isFileDragActive],
  );

  const handleDragLeave = useCallback(
    (event: DragEvent) => {
      if (!containsFiles(event.dataTransfer)) return;

      event.preventDefault();
      event.stopPropagation();

      const nextTarget = event.relatedTarget;
      if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) {
        return;
      }

      const currentTarget = event.currentTarget;
      const { clientX, clientY } = event;

      if (
        clientX <= 0 ||
        clientY <= 0 ||
        clientX >= window.innerWidth ||
        clientY >= window.innerHeight
      ) {
        clearFileDragState();
        return;
      }

      cancelPendingDragLeaveCheck();
      dragLeaveFrameRef.current = window.requestAnimationFrame(() => {
        dragLeaveFrameRef.current = null;
        const pointTarget = document.elementFromPoint(clientX, clientY);
        if (!(pointTarget instanceof Node) || !currentTarget.contains(pointTarget)) {
          setIsFileDragActive(false);
        }
      });
    },
    [cancelPendingDragLeaveCheck, clearFileDragState],
  );

  const handleDrop = useCallback(
    async (event: DragEvent) => {
      event.preventDefault();
      event.stopPropagation();
      cancelPendingDragLeaveCheck();
      setIsFileDragActive(false);

      const entries = captureDroppedFileSystemEntries(event.dataTransfer.items);
      if (entries.length === 0) return;

      try {
        const { getDroppedFilesFromEntries } = await import('@/features/file-io');
        const files = await getDroppedFilesFromEntries(entries);
        if (files.length > 0) {
          onFileDrop(files);
        }
      } catch (error) {
        console.error('Failed to process dropped files:', error);
        onDropError();
      }
    },
    [cancelPendingDragLeaveCheck, onDropError, onFileDrop],
  );

  return {
    isFileDragActive,
    handleDragEnter,
    handleDragOver,
    handleDragLeave,
    handleDrop,
  };
}
