import { LayoutGrid, Trees } from 'lucide-react';
import type { RefObject } from 'react';
import type { TreeEditorTranslations } from './treeEditorTypes';

interface TreeEditorHeaderProps {
  currentName: string;
  isEditingName: boolean;
  nameDraft: string;
  nameInputRef: RefObject<HTMLInputElement | null>;
  nameLabel: string;
  namePlaceholder: string;
  onCancelNameEditing: () => void;
  onCommitNameEditing: () => void;
  onNameDraftChange: (value: string) => void;
  onSetStructureTab: () => void;
  onSetWorkspaceTab: () => void;
  onStartNameEditing: () => void;
  sidebarTab: 'structure' | 'workspace';
  t: TreeEditorTranslations;
}

export function TreeEditorHeader({
  currentName,
  isEditingName,
  nameDraft,
  nameInputRef,
  nameLabel,
  namePlaceholder,
  onCancelNameEditing,
  onCommitNameEditing,
  onNameDraftChange,
  onSetStructureTab,
  onSetWorkspaceTab,
  onStartNameEditing,
  sidebarTab,
  t,
}: TreeEditorHeaderProps) {
  return (
    <>
      <div className="px-3 py-2 bg-panel-bg border-b border-border-black shrink-0">
        <div className="flex items-center justify-between gap-3">
          <span className="shrink-0 text-[10px] text-text-tertiary font-semibold tracking-[0.02em]">
            {t.modeLabel}
          </span>
          <div className="inline-flex w-max max-w-full shrink-0 rounded-lg bg-segmented-bg p-0.5">
            <button
              onClick={onSetStructureTab}
              className={`flex-none flex items-center justify-center gap-1.5 px-4 py-1 rounded-md text-[10px] font-semibold tracking-[0.02em] transition-colors duration-150 ${
                sidebarTab === 'structure'
                  ? 'bg-segmented-active text-system-blue shadow-sm'
                  : 'text-text-tertiary hover:text-text-primary dark:text-text-tertiary dark:hover:text-text-secondary'
              }`}
            >
              <Trees size={13} />
              {t.simpleMode}
            </button>
            <button
              onClick={onSetWorkspaceTab}
              className={`flex-none flex items-center justify-center gap-1.5 px-4 py-1 rounded-md text-[10px] font-semibold tracking-[0.02em] transition-colors duration-150 ${
                sidebarTab === 'workspace'
                  ? 'bg-segmented-active text-system-blue shadow-sm'
                  : 'text-text-tertiary hover:text-text-primary dark:text-text-tertiary dark:hover:text-text-secondary'
              }`}
            >
              <LayoutGrid size={13} />
              {t.proMode}
            </button>
          </div>
        </div>
      </div>

      <div className="px-3 py-2 bg-panel-bg border-b border-border-black shrink-0">
        <div className="flex items-center gap-2">
          <label className="shrink-0 text-[10px] text-text-tertiary font-semibold tracking-[0.02em]">
            {nameLabel}
          </label>
          {isEditingName ? (
            <input
              ref={nameInputRef}
              type="text"
              value={nameDraft}
              onChange={(event) => onNameDraftChange(event.target.value)}
              onBlur={onCommitNameEditing}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  onCommitNameEditing();
                } else if (event.key === 'Escape') {
                  onCancelNameEditing();
                }
              }}
              className="flex-1 min-w-0 bg-input-bg focus:bg-panel-bg text-[13px] font-medium text-text-primary px-2 py-1 rounded-md border border-border-strong focus:border-system-blue outline-none transition-colors"
              placeholder={namePlaceholder}
            />
          ) : (
            <button
              type="button"
              onClick={onStartNameEditing}
              className="flex-1 min-w-0 text-left text-[13px] font-medium text-text-primary hover:text-system-blue transition-colors truncate"
              title={currentName || namePlaceholder}
            >
              {currentName || namePlaceholder}
            </button>
          )}
        </div>
      </div>
    </>
  );
}
