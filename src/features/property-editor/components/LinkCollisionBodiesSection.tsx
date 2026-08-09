import React from 'react';
import { Edit3 } from 'lucide-react';

import {
  appendCollisionBody,
  getCollisionGeometryEntries,
  removeCollisionGeometryByObjectIndex,
  updateCollisionGeometryByObjectIndex,
} from '@/core/robot';
import { ContextMenuFrame, ContextMenuItem } from '@/shared/components/ui';
import { translations } from '@/shared/i18n';
import type { UrdfLink } from '@/types';
import { LinkCollisionBodiesList } from './LinkCollisionBodiesList';
import { useCollisionBodyRename } from './useCollisionBodyRename';

interface LinkCollisionBodiesSectionProps {
  data: UrdfLink;
  isActive: boolean;
  selectedObjectIndex?: number;
  onChange: (nextLink: UrdfLink) => void;
  onSelectLink: (subType?: 'collision') => void;
  onSelectGeometry?: (
    objectIndex: number,
    suppressPulse?: boolean,
    suppressAutoReveal?: boolean,
  ) => void;
  onAddCollisionBody?: () => void;
  t: (typeof translations)['en'];
}

/** Coordinates collision-body list mutations while rename state owns its own lifecycle. */
export const LinkCollisionBodiesSection: React.FC<LinkCollisionBodiesSectionProps> = ({
  data,
  isActive,
  selectedObjectIndex,
  onChange,
  onSelectLink,
  onSelectGeometry,
  onAddCollisionBody,
  t,
}) => {
  const entries = React.useMemo(() => getCollisionGeometryEntries(data), [data]);
  const effectiveSelectedObjectIndex = selectedObjectIndex ?? entries[0]?.objectIndex ?? 0;
  const rename = useCollisionBodyRename({
    data,
    entries,
    onChange,
    onSelectLink,
    onSelectGeometry,
  });

  const handleSelect = React.useCallback(
    (objectIndex: number) => {
      if (onSelectGeometry) {
        onSelectGeometry(objectIndex);
        return;
      }
      onSelectLink('collision');
    },
    [onSelectGeometry, onSelectLink],
  );

  const handleToggleVisibility = React.useCallback(
    (objectIndex: number, isVisible: boolean) => {
      onChange(
        updateCollisionGeometryByObjectIndex(data, objectIndex, {
          visible: !isVisible,
        }),
      );

      if (onSelectGeometry) {
        // Keep the editor focused without forcing the global collision overlay visible.
        onSelectGeometry(objectIndex, true, true);
        return;
      }
      onSelectLink('collision');
    },
    [data, onChange, onSelectGeometry, onSelectLink],
  );

  const handleAdd = React.useCallback(() => {
    if (onAddCollisionBody) {
      onAddCollisionBody();
      return;
    }

    const nextLink = appendCollisionBody(data);
    const nextEntries = getCollisionGeometryEntries(nextLink);
    onChange(nextLink);
    onSelectGeometry?.(Math.max(0, nextEntries.length - 1));
  }, [data, onAddCollisionBody, onChange, onSelectGeometry]);

  const handleDelete = React.useCallback(() => {
    if (entries.length === 0) {
      return;
    }

    const {
      link: nextLink,
      removed,
      nextObjectIndex,
    } = removeCollisionGeometryByObjectIndex(data, effectiveSelectedObjectIndex);
    if (!removed) {
      return;
    }

    onChange(nextLink);
    if (nextObjectIndex === null) {
      onSelectLink();
    } else if (onSelectGeometry) {
      onSelectGeometry(nextObjectIndex);
    } else {
      onSelectLink('collision');
    }
  }, [
    data,
    effectiveSelectedObjectIndex,
    entries.length,
    onChange,
    onSelectGeometry,
    onSelectLink,
  ]);

  return (
    <>
      {isActive ? (
        <LinkCollisionBodiesList
          dataId={data.id}
          entries={entries}
          selectedObjectIndex={effectiveSelectedObjectIndex}
          editingObjectIndex={rename.editingObjectIndex}
          editingDraft={rename.editingDraft}
          renameInputRef={rename.renameInputRef}
          onEditingDraftChange={rename.setEditingDraft}
          onCommitRenaming={rename.commitRenaming}
          onCancelRenaming={rename.cancelRenaming}
          onSelect={handleSelect}
          onToggleVisibility={handleToggleVisibility}
          onContextMenu={rename.handleContextMenu}
          onAdd={handleAdd}
          onDelete={handleDelete}
          t={t}
        />
      ) : null}

      <ContextMenuFrame position={rename.contextMenu}>
        <ContextMenuItem
          onClick={() => {
            if (!rename.contextMenu) {
              return;
            }
            rename.beginRenaming(rename.contextMenu.objectIndex);
            rename.setContextMenu(null);
          }}
          icon={<Edit3 size={12} />}
        >
          {t.rename}
        </ContextMenuItem>
      </ContextMenuFrame>
    </>
  );
};
