import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Edit3, Plus, Shapes, Shield, Trash2 } from 'lucide-react';

import type { TranslationKeys } from '@/shared/i18n';
import { ContextMenuFrame, ContextMenuItem } from '@/shared/components/ui';
import { GeometryType } from '@/types';

const TREE_NODE_CONTEXT_MENU_OPEN_EVENT = 'urdf-studio:tree-node-context-menu-open';

export type TreeNodeEntityContextMenuTarget = {
  type: 'link' | 'joint';
  x: number;
  y: number;
  hasVisual: boolean;
  hasCollision: boolean;
};

export type TreeNodeGeometryContextMenuTarget = {
  type: 'geometry';
  x: number;
  y: number;
  subType: 'visual' | 'collision';
  objectIndex: number;
  geometryType: GeometryType;
};

export type TreeNodeContextMenuTarget =
  | TreeNodeEntityContextMenuTarget
  | TreeNodeGeometryContextMenuTarget;

type TreeNodeContextMenuProps =
  | {
      target: TreeNodeEntityContextMenuTarget;
      t: TranslationKeys;
      onRename: () => void;
      onAddChild: () => void;
      onAddCollision: () => void;
      onDelete: () => void;
      onDeleteLinkGeometry: (subType: 'visual' | 'collision') => void;
    }
  | {
      target: TreeNodeGeometryContextMenuTarget;
      t: TranslationKeys;
      onRename: () => void;
      onDeleteGeometry: () => void;
    };

export function useTreeNodeContextMenuState<T>() {
  const [target, setTarget] = useState<T | null>(null);
  const ownerRef = useRef(Symbol('tree-node-context-menu'));
  const close = useCallback(() => setTarget(null), []);
  const open = useCallback((nextTarget: T) => {
    window.dispatchEvent(new window.CustomEvent(TREE_NODE_CONTEXT_MENU_OPEN_EVENT, {
      detail: ownerRef.current,
    }));
    setTarget(nextTarget);
  }, []);

  useEffect(() => {
    if (!target) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    const handleOtherMenuOpen = (event: Event) => {
      const owner = (event as CustomEvent<symbol>).detail;
      if (owner !== ownerRef.current) close();
    };

    window.addEventListener('click', close);
    window.addEventListener('resize', close);
    window.addEventListener('contextmenu', close);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener(TREE_NODE_CONTEXT_MENU_OPEN_EVENT, handleOtherMenuOpen);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('resize', close);
      window.removeEventListener('contextmenu', close);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener(TREE_NODE_CONTEXT_MENU_OPEN_EVENT, handleOtherMenuOpen);
    };
  }, [close, target]);

  return { close, open, target };
}

export const TreeNodeContextMenu = memo(function TreeNodeContextMenu(
  props: TreeNodeContextMenuProps,
) {
  const { t, onRename } = props;
  if ('onDeleteGeometry' in props) {
    const target = props.target;
    return (
      <ContextMenuFrame position={{ x: target.x, y: target.y }}>
        <ContextMenuItem onClick={onRename} icon={<Edit3 size={12} />}>
          {t.rename}
        </ContextMenuItem>
        <ContextMenuItem
          onClick={props.onDeleteGeometry}
          icon={<Trash2 size={12} />}
          tone="danger"
        >
          {target.subType === 'visual' && target.geometryType === GeometryType.MESH
            ? t.deleteMesh
            : target.subType === 'visual'
              ? t.deleteVisualGeometry
              : t.deleteCollisionGeometry}
        </ContextMenuItem>
      </ContextMenuFrame>
    );
  }

  const target = props.target;
  return (
    <ContextMenuFrame position={{ x: target.x, y: target.y }}>
      <ContextMenuItem onClick={onRename} icon={<Edit3 size={12} />}>
        {t.rename}
      </ContextMenuItem>
      <ContextMenuItem onClick={props.onAddChild} icon={<Plus size={12} />}>
        {t.addChildLink}
      </ContextMenuItem>
      {target.type === 'link' && target.hasVisual ? (
        <ContextMenuItem
          onClick={() => props.onDeleteLinkGeometry('visual')}
          icon={<Shapes size={12} />}
          tone="danger"
        >
          {t.deleteVisualGeometry}
        </ContextMenuItem>
      ) : null}
      {target.type === 'link' && target.hasCollision ? (
        <ContextMenuItem
          onClick={() => props.onDeleteLinkGeometry('collision')}
          icon={<Shield size={12} />}
          tone="danger"
        >
          {t.deleteCollisionGeometry}
        </ContextMenuItem>
      ) : null}
      <ContextMenuItem onClick={props.onAddCollision} icon={<Shield size={12} />}>
        {t.addCollisionBody}
      </ContextMenuItem>
      <ContextMenuItem onClick={props.onDelete} icon={<Trash2 size={12} />} tone="danger">
        {t.deleteBranch}
      </ContextMenuItem>
    </ContextMenuFrame>
  );
});
