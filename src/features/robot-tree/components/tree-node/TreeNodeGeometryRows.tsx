import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Eye, EyeOff, Shapes, Shield } from 'lucide-react';

import {
  getCollisionGeometryEntries,
  getVisualGeometryEntries,
  removeCollisionGeometryByObjectIndex,
  removeVisualGeometryByObjectIndex,
  updateCollisionGeometryByObjectIndex,
  updateVisualGeometryByObjectIndex,
} from '@/core/robot';
import type { CollisionGeometryEntry } from '@/core/robot/collisionBodies';
import type { VisualGeometryEntry } from '@/core/robot/visualBodies';
import type { TranslationKeys } from '@/shared/i18n';
import { useSelectionStore } from '@/store/selectionStore';
import type { WorkspaceLinkPropertyPatch } from '@/store/workspace/types';
import type {
  AppMode,
  EntityRef,
  UrdfLink,
  WorkspaceSelection,
} from '@/types';
import { runOnActivationKey, selectionTargets } from '../../utils/treeSelectionHelpers';
import {
  getGeometryVisibilityButtonClass,
  getTreeConnectorElbowClass,
  getTreeConnectorElbowStyle,
  resolveTreeRowStateClass,
  TREE_LINK_NAME_TEXT_CLASS,
  TREE_RENAME_INPUT_BASE_CLASS,
} from './presentation';
import {
  TreeNodeContextMenu,
  type TreeNodeGeometryContextMenuTarget,
  useTreeNodeContextMenuState,
} from './TreeNodeContextMenu';

type LinkRef = Extract<EntityRef, { type: 'link' }>;
type GeometryEntry = VisualGeometryEntry | CollisionGeometryEntry;
type GeometryKind = 'visual' | 'collision';
type GeometryEditingTarget = {
  subType: GeometryKind;
  objectIndex: number;
};
type GeometryContextMenuState = TreeNodeGeometryContextMenuTarget & {
  currentName: string;
};

interface TreeNodeGeometryRowsProps {
  componentId: string;
  link: UrdfLink;
  mode: AppMode;
  readOnly: boolean;
  editorLocked: boolean;
  t: TranslationKeys;
  onSelect?: (selection: WorkspaceSelection) => void;
  onHover?: (selection: WorkspaceSelection) => void;
  onSelectGeometry?: (
    ref: LinkRef,
    subType: GeometryKind,
    objectIndex?: number,
    suppressPulse?: boolean,
    suppressAutoReveal?: boolean,
  ) => void;
  onUpdate: (ref: LinkRef, patch: WorkspaceLinkPropertyPatch) => void;
}

function selectionTargetsGeometry(
  selection: WorkspaceSelection,
  ref: LinkRef,
  subType: GeometryKind,
  objectIndex: number,
): boolean {
  return selectionTargets(selection, ref)
    && selection?.subType === subType
    && (selection.objectIndex ?? 0) === objectIndex;
}

function getGeometryLabel(
  entry: GeometryEntry,
  subType: GeometryKind,
  t: TranslationKeys,
): string {
  const authoredName = entry.geometry.name?.trim();
  if (authoredName) return authoredName;
  const baseLabel = subType === 'visual' ? t.visualGeometry : t.collision;
  return entry.objectIndex === 0 ? baseLabel : `${baseLabel} ${entry.objectIndex + 1}`;
}

interface GeometryRowModel {
  componentId: string;
  linkId: string;
  linkRef: LinkRef;
  subType: GeometryKind;
  entry: GeometryEntry;
  selection: WorkspaceSelection;
  hoveredSelection: WorkspaceSelection;
  attentionSelection: WorkspaceSelection;
  editing: GeometryEditingTarget | null;
  draft: string;
  isLinkVisible: boolean;
  readOnly: boolean;
  editorLocked: boolean;
  t: TranslationKeys;
}

interface GeometryRowActions {
  select: (subType: GeometryKind, objectIndex: number) => void;
  hover: (selection: WorkspaceSelection) => void;
  clearHover: () => void;
  openMenu: (event: React.MouseEvent, subType: GeometryKind, entry: GeometryEntry) => void;
  updateDraft: (value: string) => void;
  commitRename: (subType: GeometryKind, entry: GeometryEntry, value: string) => void;
  cancelRename: () => void;
  toggleVisibility: (
    event: React.MouseEvent,
    subType: GeometryKind,
    entry: GeometryEntry,
  ) => void;
}

function GeometryRenameInput({
  ariaLabel,
  value,
  onChange,
  onCommit,
  onCancel,
}: {
  ariaLabel: string;
  value: string;
  onChange: (value: string) => void;
  onCommit: (value: string) => void;
  onCancel: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  return (
    <input
      ref={inputRef}
      value={value}
      aria-label={ariaLabel}
      className={`${TREE_LINK_NAME_TEXT_CLASS} ${TREE_RENAME_INPUT_BASE_CLASS} min-w-0 flex-1 bg-input-bg border-border-strong text-text-primary focus:border-system-blue`}
      onChange={(event) => onChange(event.currentTarget.value)}
      onBlur={(event) => onCommit(event.currentTarget.value)}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === 'Enter') onCommit(event.currentTarget.value);
        if (event.key === 'Escape') onCancel();
      }}
    />
  );
}

function GeometryRow({ model, actions }: {
  model: GeometryRowModel;
  actions: GeometryRowActions;
}) {
  const {
    componentId,
    linkId,
    linkRef,
    subType,
    entry,
    selection,
    hoveredSelection,
    attentionSelection,
    editing,
    draft,
    isLinkVisible,
    readOnly,
    editorLocked,
    t,
  } = model;
  const target: WorkspaceSelection = { entity: linkRef, subType, objectIndex: entry.objectIndex };
  const selected = selectionTargetsGeometry(selection, linkRef, subType, entry.objectIndex);
  const hovered = selectionTargetsGeometry(
    hoveredSelection,
    linkRef,
    subType,
    entry.objectIndex,
  );
  const attention = selectionTargetsGeometry(
    attentionSelection,
    linkRef,
    subType,
    entry.objectIndex,
  );
  const locallyVisible = entry.geometry.visible !== false;
  const inheritedHidden = !isLinkVisible && locallyVisible;
  const effectivelyVisible = isLinkVisible && locallyVisible;
  const label = getGeometryLabel(entry, subType, t);
  const isVisual = subType === 'visual';
  const isEditing = editing?.subType === subType && editing.objectIndex === entry.objectIndex;

  return (
    <div
      data-testid={`tree-geometry-${componentId}-${linkId}-${subType}${
        entry.objectIndex === 0 ? '' : `-${entry.objectIndex}`
      }`}
      className={`relative mx-1 my-0.5 flex min-w-0 items-center rounded-md px-2 py-0.5 transition-all duration-200 ${readOnly ? 'cursor-default' : 'cursor-pointer'} ${resolveTreeRowStateClass(
        'text-text-secondary dark:text-text-tertiary',
        { isHovered: hovered, isSelected: selected, isAttentionHighlighted: attention },
      )}`}
      style={{ marginLeft: '12px' }}
      title={label}
      role={readOnly || isEditing ? undefined : 'button'}
      aria-label={label}
      tabIndex={readOnly || isEditing ? undefined : 0}
      onClick={readOnly || isEditing
        ? undefined
        : () => actions.select(subType, entry.objectIndex)}
      onKeyDown={readOnly || isEditing
        ? undefined
        : (event) => runOnActivationKey(
            event,
            () => actions.select(subType, entry.objectIndex),
          )}
      onMouseEnter={readOnly ? undefined : () => actions.hover(target)}
      onMouseLeave={readOnly ? undefined : actions.clearHover}
      onContextMenu={readOnly || editorLocked
        ? undefined
        : (event) => actions.openMenu(event, subType, entry)}
    >
      <div
        className={getTreeConnectorElbowClass(selected || attention)}
        style={getTreeConnectorElbowStyle(12)}
      />
      <div
        className={`mr-1 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border transition-colors ${
          isVisual
            ? selected || hovered || attention
              ? 'border-emerald-500/20 bg-emerald-500/15 dark:border-emerald-400/20 dark:bg-emerald-400/15'
              : 'border-transparent bg-emerald-500/10 dark:bg-emerald-400/10'
            : selected || hovered || attention
              ? 'border-amber-500/20 bg-amber-500/15 dark:border-amber-400/20 dark:bg-amber-400/15'
              : 'border-transparent bg-amber-500/10 dark:bg-amber-400/10'
        }`}
      >
        {isVisual ? (
          <Shapes size={9} className="text-emerald-600 dark:text-emerald-300" />
        ) : (
          <Shield size={9} className="text-amber-600 dark:text-amber-300" />
        )}
      </div>
      {isEditing ? (
        <GeometryRenameInput
          ariaLabel={`rename-geometry-${componentId}-${linkId}-${subType}-${entry.objectIndex}`}
          value={draft}
          onChange={actions.updateDraft}
          onCommit={(value) => actions.commitRename(subType, entry, value)}
          onCancel={actions.cancelRename}
        />
      ) : (
        <span className="min-w-0 flex-1 truncate text-[10px] font-medium">{label}</span>
      )}
      {!readOnly && !editorLocked ? (
        <button
          type="button"
          aria-label={`toggle-geometry-visibility-${componentId}-${linkId}-${subType}-${entry.objectIndex}`}
          className={getGeometryVisibilityButtonClass(effectivelyVisible, { inheritedHidden })}
          data-visibility-source={inheritedHidden ? 'inherited' : 'local'}
          title={locallyVisible ? t.hide : t.show}
          onClick={(event) => actions.toggleVisibility(event, subType, entry)}
        >
          {effectivelyVisible ? <Eye size={10} /> : <EyeOff size={10} />}
        </button>
      ) : null}
    </div>
  );
}

export const TreeNodeGeometryRows = memo(function TreeNodeGeometryRows({
  componentId,
  link,
  mode,
  readOnly,
  editorLocked,
  t,
  onSelect,
  onHover,
  onSelectGeometry,
  onUpdate,
}: TreeNodeGeometryRowsProps) {
  const selection = useSelectionStore((state) => state.selection);
  const hoveredSelection = useSelectionStore((state) => state.hoveredSelection);
  const attentionSelection = useSelectionStore((state) => state.attentionSelection);
  const setSelection = useSelectionStore((state) => state.setSelection);
  const setHoveredSelection = useSelectionStore((state) => state.setHoveredSelection);
  const clearHover = useSelectionStore((state) => state.clearHover);
  const [editing, setEditing] = useState<GeometryEditingTarget | null>(null);
  const [draft, setDraft] = useState('');
  const contextMenu = useTreeNodeContextMenuState<GeometryContextMenuState>();
  const linkRef: LinkRef = { type: 'link', componentId, entityId: link.id };
  const visualEntries = useMemo(() => getVisualGeometryEntries(link), [link]);
  const collisionEntries = useMemo(() => getCollisionGeometryEntries(link), [link]);
  const isLinkVisible = link.visible !== false;

  const dispatchSelection = (next: WorkspaceSelection) => {
    if (onSelect) onSelect(next);
    else setSelection(next);
  };
  const dispatchHover = (next: WorkspaceSelection) => {
    if (onHover) onHover(next);
    else setHoveredSelection(next);
  };
  const clearCanonicalHover = () => {
    if (onHover) onHover(null);
    else clearHover();
  };
  const selectGeometry = (subType: GeometryKind, objectIndex: number) => {
    const target: WorkspaceSelection = { entity: linkRef, subType, objectIndex };
    dispatchSelection(target);
    onSelectGeometry?.(linkRef, subType, objectIndex);
  };
  const findContextEntry = (): GeometryEntry | null => {
    const target = contextMenu.target;
    if (!target) return null;
    const entries = target.subType === 'visual' ? visualEntries : collisionEntries;
    return entries.find(({ objectIndex }) => objectIndex === target.objectIndex) ?? null;
  };
  const beginRename = () => {
    const target = contextMenu.target;
    const entry = findContextEntry();
    if (!target || !entry) return;
    selectGeometry(target.subType, target.objectIndex);
    setDraft(entry.geometry.name?.trim() ?? '');
    setEditing({ subType: target.subType, objectIndex: target.objectIndex });
    contextMenu.close();
  };
  const commitRename = (subType: GeometryKind, entry: GeometryEntry, nextDraft: string) => {
    const normalizedName = nextDraft.trim() || undefined;
    if (entry.geometry.name !== normalizedName) {
      const nextLink = subType === 'visual'
        ? updateVisualGeometryByObjectIndex(link, entry.objectIndex, { name: normalizedName })
        : updateCollisionGeometryByObjectIndex(link, entry.objectIndex, { name: normalizedName });
      onUpdate(linkRef, nextLink);
    }
    setEditing(null);
  };
  const deleteGeometry = () => {
    const target = contextMenu.target;
    if (!target || !findContextEntry()) {
      contextMenu.close();
      return;
    }
    const result = target.subType === 'visual'
      ? removeVisualGeometryByObjectIndex(link, target.objectIndex)
      : removeCollisionGeometryByObjectIndex(link, target.objectIndex);
    if (result.removed) {
      onUpdate(linkRef, result.link);
      if (selectionTargetsGeometry(selection, linkRef, target.subType, target.objectIndex)) {
        dispatchSelection(result.nextObjectIndex === null
          ? { entity: linkRef }
          : {
              entity: linkRef,
              subType: target.subType,
              objectIndex: result.nextObjectIndex,
            });
      }
    }
    contextMenu.close();
  };
  const toggleVisibility = (
    event: React.MouseEvent,
    subType: GeometryKind,
    entry: GeometryEntry,
  ) => {
    event.stopPropagation();
    const visible = entry.geometry.visible !== false;
    if (subType === 'visual') {
      if (entry.bodyIndex === null) {
        onUpdate(linkRef, { visual: { visible: !visible } });
      } else {
        const visualBodies = [...(link.visualBodies ?? [])];
        visualBodies[entry.bodyIndex] = { ...visualBodies[entry.bodyIndex], visible: !visible };
        onUpdate(linkRef, { visualBodies });
      }
      return;
    }
    if (entry.bodyIndex === null) {
      onUpdate(linkRef, { collision: { visible: !visible } });
    } else {
      const collisionBodies = [...(link.collisionBodies ?? [])];
      collisionBodies[entry.bodyIndex] = {
        ...collisionBodies[entry.bodyIndex],
        visible: !visible,
      };
      onUpdate(linkRef, { collisionBodies });
    }
  };
  const openContextMenu = (
    event: React.MouseEvent,
    subType: GeometryKind,
    entry: GeometryEntry,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    selectGeometry(subType, entry.objectIndex);
    contextMenu.open({
      type: 'geometry',
      x: event.clientX,
      y: event.clientY,
      currentName: entry.geometry.name?.trim() ?? '',
      subType,
      objectIndex: entry.objectIndex,
      geometryType: entry.geometry.type,
    });
  };
  const entries: Array<{ subType: GeometryKind; entry: GeometryEntry }> = [
    ...visualEntries.map((entry) => ({ subType: 'visual' as const, entry })),
    ...collisionEntries.map((entry) => ({ subType: 'collision' as const, entry })),
  ];
  const rowActions: GeometryRowActions = {
    select: selectGeometry,
    hover: dispatchHover,
    clearHover: clearCanonicalHover,
    openMenu: openContextMenu,
    updateDraft: setDraft,
    commitRename,
    cancelRename: () => setEditing(null),
    toggleVisibility,
  };

  return (
    <>
      {entries.map(({ subType, entry }) => (
        <GeometryRow
          key={`${subType}:${entry.objectIndex}`}
          model={{
            componentId,
            linkId: link.id,
            linkRef,
            subType,
            entry,
            selection,
            hoveredSelection,
            attentionSelection,
            editing,
            draft,
            isLinkVisible,
            readOnly,
            editorLocked,
            t,
          }}
          actions={rowActions}
        />
      ))}
      {!readOnly && !editorLocked && mode === 'editor' && contextMenu.target ? (
        <TreeNodeContextMenu
          target={contextMenu.target}
          t={t}
          onRename={beginRename}
          onDeleteGeometry={deleteGeometry}
        />
      ) : null}
    </>
  );
});
