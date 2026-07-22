import { memo } from 'react';
import { Edit3, Plus, Shapes, Shield, Trash2 } from 'lucide-react';

import type { TranslationKeys } from '@/shared/i18n';
import { ContextMenuFrame, ContextMenuItem } from '@/shared/components/ui';

export interface TreeNodeContextMenuTarget {
  type: 'link' | 'joint';
  x: number;
  y: number;
  hasVisual: boolean;
  hasCollision: boolean;
}

interface TreeNodeContextMenuProps {
  target: TreeNodeContextMenuTarget | null;
  t: TranslationKeys;
  onRename: () => void;
  onAddChild: () => void;
  onAddCollision: () => void;
  onDelete: () => void;
  onDeleteLinkGeometry: (subType: 'visual' | 'collision') => void;
}

export const TreeNodeContextMenu = memo(function TreeNodeContextMenu({
  target,
  t,
  onRename,
  onAddChild,
  onAddCollision,
  onDelete,
  onDeleteLinkGeometry,
}: TreeNodeContextMenuProps) {
  if (!target) return null;

  return (
    <ContextMenuFrame position={{ x: target.x, y: target.y }}>
      <ContextMenuItem onClick={onRename} icon={<Edit3 size={12} />}>
        {t.rename}
      </ContextMenuItem>
      <ContextMenuItem onClick={onAddChild} icon={<Plus size={12} />}>
        {t.addChildLink}
      </ContextMenuItem>
      {target.type === 'link' && target.hasVisual ? (
        <ContextMenuItem
          onClick={() => onDeleteLinkGeometry('visual')}
          icon={<Shapes size={12} />}
          tone="danger"
        >
          {t.deleteVisualGeometry}
        </ContextMenuItem>
      ) : null}
      {target.type === 'link' && target.hasCollision ? (
        <ContextMenuItem
          onClick={() => onDeleteLinkGeometry('collision')}
          icon={<Shield size={12} />}
          tone="danger"
        >
          {t.deleteCollisionGeometry}
        </ContextMenuItem>
      ) : null}
      <ContextMenuItem onClick={onAddCollision} icon={<Shield size={12} />}>
        {t.addCollisionBody}
      </ContextMenuItem>
      <ContextMenuItem onClick={onDelete} icon={<Trash2 size={12} />} tone="danger">
        {t.deleteBranch}
      </ContextMenuItem>
    </ContextMenuFrame>
  );
});
