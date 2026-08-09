import React from 'react';

import { getCollisionGeometryEntries, updateCollisionGeometryByObjectIndex } from '@/core/robot';
import type { UrdfLink } from '@/types';

interface CollisionListContextMenuState {
  x: number;
  y: number;
  objectIndex: number;
}

interface UseCollisionBodyRenameOptions {
  data: UrdfLink;
  entries: ReturnType<typeof getCollisionGeometryEntries>;
  onChange: (nextLink: UrdfLink) => void;
  onSelectLink: (subType?: 'collision') => void;
  onSelectGeometry?: (objectIndex: number, suppressPulse?: boolean) => void;
}

export interface CollisionBodyRenameController {
  contextMenu: CollisionListContextMenuState | null;
  setContextMenu: React.Dispatch<React.SetStateAction<CollisionListContextMenuState | null>>;
  editingObjectIndex: number | null;
  editingDraft: string;
  setEditingDraft: React.Dispatch<React.SetStateAction<string>>;
  renameInputRef: React.RefObject<HTMLInputElement | null>;
  beginRenaming: (objectIndex: number) => void;
  cancelRenaming: () => void;
  commitRenaming: () => void;
  handleContextMenu: (event: React.MouseEvent<HTMLDivElement>, objectIndex: number) => void;
}

/** Owns collision-body rename draft, focus, validity, and context-menu cleanup. */
export function useCollisionBodyRename({
  data,
  entries,
  onChange,
  onSelectLink,
  onSelectGeometry,
}: UseCollisionBodyRenameOptions): CollisionBodyRenameController {
  const [contextMenu, setContextMenu] = React.useState<CollisionListContextMenuState | null>(null);
  const [editingObjectIndex, setEditingObjectIndex] = React.useState<number | null>(null);
  const [editingDraft, setEditingDraft] = React.useState('');
  const renameInputRef = React.useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    setContextMenu(null);
    setEditingObjectIndex(null);
    setEditingDraft('');
  }, [data.id]);

  React.useEffect(() => {
    if (!contextMenu) {
      return;
    }

    const closeMenu = () => setContextMenu(null);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeMenu();
      }
    };

    window.addEventListener('click', closeMenu);
    window.addEventListener('resize', closeMenu);
    window.addEventListener('contextmenu', closeMenu);
    window.addEventListener('keydown', onKeyDown);

    return () => {
      window.removeEventListener('click', closeMenu);
      window.removeEventListener('resize', closeMenu);
      window.removeEventListener('contextmenu', closeMenu);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [contextMenu]);

  React.useEffect(() => {
    if (editingObjectIndex === null) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [editingObjectIndex]);

  React.useEffect(() => {
    if (editingObjectIndex === null) {
      return;
    }

    if (!entries.some((entry) => entry.objectIndex === editingObjectIndex)) {
      setEditingObjectIndex(null);
      setEditingDraft('');
    }
  }, [editingObjectIndex, entries]);

  const beginRenaming = React.useCallback(
    (objectIndex: number) => {
      const targetEntry = entries.find((entry) => entry.objectIndex === objectIndex);
      if (!targetEntry) {
        return;
      }

      if (onSelectGeometry) {
        onSelectGeometry(objectIndex, true);
      } else {
        onSelectLink('collision');
      }

      setEditingObjectIndex(objectIndex);
      setEditingDraft(targetEntry.geometry.name?.trim() || '');
    },
    [entries, onSelectGeometry, onSelectLink],
  );

  const cancelRenaming = React.useCallback(() => {
    setEditingObjectIndex(null);
    setEditingDraft('');
  }, []);

  const commitRenaming = React.useCallback(() => {
    if (editingObjectIndex === null) {
      return;
    }

    const normalizedName = editingDraft.trim() || undefined;
    const currentEntry = entries.find((entry) => entry.objectIndex === editingObjectIndex);
    if (!currentEntry) {
      cancelRenaming();
      return;
    }

    if (currentEntry.geometry.name !== normalizedName) {
      onChange(
        updateCollisionGeometryByObjectIndex(data, editingObjectIndex, {
          name: normalizedName,
        }),
      );
    }

    cancelRenaming();
  }, [cancelRenaming, data, editingDraft, editingObjectIndex, entries, onChange]);

  const handleContextMenu = React.useCallback(
    (event: React.MouseEvent<HTMLDivElement>, objectIndex: number) => {
      event.preventDefault();
      event.stopPropagation();

      const maxX = Math.max(8, window.innerWidth - 170 - 8);
      const maxY = Math.max(8, window.innerHeight - 44 - 8);
      setContextMenu({
        objectIndex,
        x: Math.min(event.clientX, maxX),
        y: Math.min(event.clientY, maxY),
      });
    },
    [],
  );

  return {
    contextMenu,
    setContextMenu,
    editingObjectIndex,
    editingDraft,
    setEditingDraft,
    renameInputRef,
    beginRenaming,
    cancelRenaming,
    commitRenaming,
    handleContextMenu,
  };
}
