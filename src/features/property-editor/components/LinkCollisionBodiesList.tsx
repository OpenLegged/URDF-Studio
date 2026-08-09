import React from 'react';
import { Eye, EyeOff, Minus, Plus } from 'lucide-react';

import { getCollisionGeometryEntries } from '@/core/robot';
import { translations } from '@/shared/i18n';
import { GeometryType } from '@/types';
import {
  PROPERTY_EDITOR_HELPER_TEXT_CLASS,
  PROPERTY_EDITOR_INPUT_CLASS,
  PROPERTY_EDITOR_SECONDARY_BUTTON_CLASS,
  PROPERTY_EDITOR_SECTION_TITLE_CLASS,
} from './FormControls';

type CollisionGeometryEntry = ReturnType<typeof getCollisionGeometryEntries>[number];

function fillTemplate(template: string, replacements: Record<string, string>): string {
  return Object.entries(replacements).reduce(
    (result, [key, value]) => result.replaceAll(`{${key}}`, value),
    template,
  );
}

function getGeometryTypeLabel(type: GeometryType, t: (typeof translations)['en']): string {
  return type === GeometryType.BOX
    ? t.box
    : type === GeometryType.PLANE
      ? t.plane
      : type === GeometryType.CYLINDER
        ? t.cylinder
        : type === GeometryType.SPHERE
          ? t.sphere
          : type === GeometryType.ELLIPSOID
            ? t.ellipsoid
            : type === GeometryType.CAPSULE
              ? t.capsule
              : type === GeometryType.HFIELD
                ? t.hfield
                : type === GeometryType.SDF
                  ? t.sdf
                  : type === GeometryType.MESH
                    ? t.mesh
                    : t.none;
}

interface CollisionBodyRowProps {
  entry: CollisionGeometryEntry;
  isSelected: boolean;
  isEditing: boolean;
  editingDraft: string;
  renameInputRef: React.RefObject<HTMLInputElement | null>;
  onEditingDraftChange: (value: string) => void;
  onCommitRenaming: () => void;
  onCancelRenaming: () => void;
  onSelect: (objectIndex: number) => void;
  onToggleVisibility: (objectIndex: number, isVisible: boolean) => void;
  onContextMenu: (event: React.MouseEvent<HTMLDivElement>, objectIndex: number) => void;
  t: (typeof translations)['en'];
}

const CollisionBodyRow: React.FC<CollisionBodyRowProps> = ({
  entry,
  isSelected,
  isEditing,
  editingDraft,
  renameInputRef,
  onEditingDraftChange,
  onCommitRenaming,
  onCancelRenaming,
  onSelect,
  onToggleVisibility,
  onContextMenu,
  t,
}) => {
  const geometryTypeLabel = getGeometryTypeLabel(entry.geometry.type, t);
  const collisionLabel = fillTemplate(t.collisionBodyItem, {
    index: String(entry.objectIndex + 1),
  });
  const collisionDisplayName = entry.geometry.name?.trim() || collisionLabel;
  const isVisible = entry.geometry.visible !== false;
  const visibilityActionLabel = `${isVisible ? t.hide : t.show} ${collisionDisplayName}`;

  return (
    <div
      data-collision-list-row={entry.objectIndex}
      className={`flex items-center rounded-md border transition-colors ${
        isSelected
          ? 'border-system-blue/50 bg-system-blue/10'
          : 'border-border-black/60 bg-panel-bg hover:bg-element-hover'
      }`}
      onContextMenu={(event) => onContextMenu(event, entry.objectIndex)}
    >
      {isEditing ? (
        <div className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1">
          <div
            className={`flex h-5.5 w-5.5 shrink-0 items-center justify-center rounded-md border text-[10px] font-semibold ${
              isSelected
                ? 'border-system-blue/40 bg-system-blue/15 text-system-blue'
                : 'border-border-black/60 bg-element-bg/70 text-text-secondary'
            }`}
          >
            {entry.objectIndex + 1}
          </div>
          <div className="min-w-0 flex-1">
            <input
              ref={renameInputRef}
              type="text"
              value={editingDraft}
              aria-label={t.rename}
              onChange={(event) => onEditingDraftChange(event.target.value)}
              onClick={(event) => event.stopPropagation()}
              onBlur={onCommitRenaming}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  onCommitRenaming();
                } else if (event.key === 'Escape') {
                  onCancelRenaming();
                }
              }}
              className={`${PROPERTY_EDITOR_INPUT_CLASS} h-7 w-full min-w-0 px-2 text-[10px]`}
            />
          </div>
        </div>
      ) : (
        <button
          type="button"
          aria-label={collisionDisplayName}
          aria-pressed={isSelected}
          onClick={() => onSelect(entry.objectIndex)}
          className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-system-blue/25"
        >
          <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden whitespace-nowrap">
            <div
              className={`flex h-5.5 w-5.5 shrink-0 items-center justify-center rounded-md border text-[10px] font-semibold ${
                isSelected
                  ? 'border-system-blue/40 bg-system-blue/15 text-system-blue'
                  : 'border-border-black/60 bg-element-bg/70 text-text-secondary'
              }`}
            >
              {entry.objectIndex + 1}
            </div>
            <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden whitespace-nowrap">
              <span className="truncate text-[10px] font-semibold text-text-primary">
                {collisionDisplayName}
              </span>
              {collisionDisplayName !== collisionLabel ? (
                <span className="truncate text-[9px] text-text-tertiary">{collisionLabel}</span>
              ) : null}
              <span className="shrink-0 rounded-sm border border-border-black/50 bg-element-bg/80 px-1 py-0.5 text-[8.5px] font-medium leading-none text-text-secondary">
                {geometryTypeLabel}
              </span>
            </div>
          </div>
        </button>
      )}

      <button
        type="button"
        aria-label={visibilityActionLabel}
        aria-pressed={isVisible}
        title={visibilityActionLabel}
        onClick={() => onToggleVisibility(entry.objectIndex, isVisible)}
        className={`mr-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-system-blue/25 ${
          isVisible
            ? 'bg-system-blue/10 text-system-blue hover:bg-system-blue/15'
            : 'bg-panel-bg text-text-tertiary hover:bg-element-hover hover:text-text-primary'
        }`}
      >
        {isVisible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
};

interface LinkCollisionBodiesListProps {
  dataId: string;
  entries: CollisionGeometryEntry[];
  selectedObjectIndex: number;
  editingObjectIndex: number | null;
  editingDraft: string;
  renameInputRef: React.RefObject<HTMLInputElement | null>;
  onEditingDraftChange: (value: string) => void;
  onCommitRenaming: () => void;
  onCancelRenaming: () => void;
  onSelect: (objectIndex: number) => void;
  onToggleVisibility: (objectIndex: number, isVisible: boolean) => void;
  onContextMenu: (event: React.MouseEvent<HTMLDivElement>, objectIndex: number) => void;
  onAdd: () => void;
  onDelete: () => void;
  t: (typeof translations)['en'];
}

/** Pure collision-body list rendering; mutations and lifecycle remain with its controller. */
export const LinkCollisionBodiesList: React.FC<LinkCollisionBodiesListProps> = ({
  dataId,
  entries,
  selectedObjectIndex,
  editingObjectIndex,
  editingDraft,
  renameInputRef,
  onEditingDraftChange,
  onCommitRenaming,
  onCancelRenaming,
  onSelect,
  onToggleVisibility,
  onContextMenu,
  onAdd,
  onDelete,
  t,
}) => (
  <div className="mb-2.5">
    <div className="mb-1.5 flex items-center justify-between gap-2">
      <h3 className={PROPERTY_EDITOR_SECTION_TITLE_CLASS}>{t.collisionBodiesList}</h3>
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-label={t.deleteCollisionGeometry}
          title={t.deleteCollisionGeometry}
          onClick={onDelete}
          disabled={entries.length === 0}
          className={`${PROPERTY_EDITOR_SECONDARY_BUTTON_CLASS} w-6 border-danger-border bg-danger-soft px-0 text-danger hover:border-danger-border hover:bg-danger-soft hover:text-danger-hover focus-visible:ring-danger/20`}
        >
          <Minus className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          aria-label={t.addCollisionBody}
          title={t.addCollisionBody}
          onClick={onAdd}
          className={`${PROPERTY_EDITOR_SECONDARY_BUTTON_CLASS} w-6 px-0`}
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>

    {entries.length ? (
      <div className="max-h-48 overflow-y-auto rounded-lg border border-border-black bg-panel-bg/70 p-1 custom-scrollbar">
        <div className="space-y-1 pr-0.5">
          {entries.map((entry) => (
            <CollisionBodyRow
              key={`${dataId}:collision:${entry.objectIndex}`}
              entry={entry}
              isSelected={selectedObjectIndex === entry.objectIndex}
              isEditing={editingObjectIndex === entry.objectIndex}
              editingDraft={editingDraft}
              renameInputRef={renameInputRef}
              onEditingDraftChange={onEditingDraftChange}
              onCommitRenaming={onCommitRenaming}
              onCancelRenaming={onCancelRenaming}
              onSelect={onSelect}
              onToggleVisibility={onToggleVisibility}
              onContextMenu={onContextMenu}
              t={t}
            />
          ))}
        </div>
      </div>
    ) : (
      <div className="rounded-md border border-dashed border-border-black/60 bg-element-bg/60 px-3 py-2">
        <p className={PROPERTY_EDITOR_HELPER_TEXT_CLASS}>{t.collisionBodyEmpty}</p>
      </div>
    )}
  </div>
);
