import {
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  FileCode,
  Network,
  Plus,
  Shapes,
  Shield,
} from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';

import type { TranslationKeys } from '@/shared/i18n';
import type { AppMode, AssemblyState, EntityRef, WorkspaceSelection } from '@/types';
import { AssemblyTreeView } from '../AssemblyTreeView';
import { TreeStructureGraphDialog } from './TreeStructureGraphDialog';
import type { WorkspacePropertyPatch } from '@/store/workspace/types';
import { useSelectionStore } from '@/store/selectionStore';

type LinkRef = Extract<EntityRef, { type: 'link' }>;

interface TreeEditorStructureSectionProps {
  workspace: AssemblyState;
  activeComponentId: string;
  isOpen: boolean;
  showStructureGraph?: boolean;
  structureTreeShowGeometryDetails: boolean;
  showVisual: boolean;
  showStructureFilePath?: boolean;
  currentFileName?: string;
  mode: AppMode;
  t: TranslationKeys;
  onToggleOpen: () => void;
  onToggleGeometryDetails: () => void;
  onAddChildFromSelection: () => void;
  onToggleVisuals: () => void;
  onSelect?: (selection: WorkspaceSelection) => void;
  onHover?: (selection: WorkspaceSelection) => void;
  onSelectGeometry?: (
    ref: LinkRef,
    subType: 'visual' | 'collision',
    objectIndex?: number,
    suppressPulse?: boolean,
    suppressAutoReveal?: boolean,
  ) => void;
  onFocus?: (ref: EntityRef) => void;
  onAddChild: (ref: LinkRef) => void;
  onAddCollisionBody: (ref: LinkRef) => void;
  onDelete: (ref: EntityRef) => void;
  onUpdate: (ref: EntityRef, patch: WorkspacePropertyPatch) => void;
  onCreateBridge?: () => void;
  onPrefetchCreateBridge?: () => void;
  isReadOnly?: boolean;
  onCloseStructureGraph?: () => void;
}

export function TreeEditorStructureSection({
  workspace,
  activeComponentId,
  isOpen,
  showStructureGraph = false,
  structureTreeShowGeometryDetails,
  showVisual,
  showStructureFilePath = false,
  currentFileName,
  mode,
  t,
  onToggleOpen,
  onToggleGeometryDetails,
  onAddChildFromSelection,
  onToggleVisuals,
  onSelect,
  onHover,
  onSelectGeometry,
  onFocus,
  onAddChild,
  onAddCollisionBody,
  onDelete,
  onUpdate,
  onCreateBridge,
  onPrefetchCreateBridge,
  isReadOnly = false,
  onCloseStructureGraph,
}: TreeEditorStructureSectionProps) {
  const [graphOpen, setGraphOpen] = useState(showStructureGraph);
  const isSimplifiedWorkspace = Object.keys(workspace.components).length === 1
    && Object.keys(workspace.bridges).length === 0;
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => setGraphOpen(showStructureGraph), [showStructureGraph]);

  // Scroll the structure tree to the row that matches the canonical selection whenever the
  // attention pulse fires (canvas click / programmatic selection). Tree-internal clicks only
  // update `selection` without pulsing, so they don't trigger a scroll.
  useEffect(() => {
    if (!isOpen) return;
    let lastScrolledKey: string | null = null;
    return useSelectionStore.subscribe((state, previousState) => {
      if (state.attentionSelection === previousState.attentionSelection) return;
      const target = state.selection?.entity;
      if (!target || (target.type !== 'link' && target.type !== 'joint')) return;
      if (!('componentId' in target)) return;
      const key = `${target.type}:${target.componentId}:${target.entityId}`;
      if (key === lastScrolledKey) return;
      lastScrolledKey = key;
      // Wait one frame so auto-expanding ancestors (TreeNode/AssemblyTreeView) has a chance to
      // mount the target row before we try to scroll it into view.
      window.requestAnimationFrame(() => {
        const testId = target.type === 'link'
          ? `tree-link-${target.componentId}-${target.entityId}`
          : `tree-joint-${target.componentId}-${target.entityId}`;
        const row = scrollContainerRef.current?.querySelector<HTMLElement>(
          `[data-testid="${testId}"]`,
        );
        row?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
  }, [isOpen]);

  const handleHeaderKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return;
    event.preventDefault();
    onToggleOpen();
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col" style={{ flex: isOpen ? '1 1 0%' : '0 0 auto' }}>
      <div
        className="flex h-8 items-center justify-between gap-2 px-2.5 bg-element-bg dark:bg-element-bg cursor-pointer select-none"
        onClick={onToggleOpen}
        onKeyDown={handleHeaderKeyDown}
        role="button"
        aria-label={t.structureTree}
        tabIndex={0}
      >
        <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
          {isOpen ? (
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-text-tertiary" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-text-tertiary" />
          )}
          <span className="shrink-0 text-[11px] leading-none font-semibold text-text-secondary tracking-[0.02em]">
            {t.structureTree}
          </span>
          {isReadOnly ? (
            <span className="shrink-0 rounded-md border border-system-blue/20 bg-system-blue/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-system-blue">
              {t.preview}
            </span>
          ) : null}
          {showStructureFilePath ? (
            <div
              className="flex min-w-0 max-w-full flex-1 items-center gap-1 overflow-hidden rounded-md border border-border-black bg-white px-1.5 py-0.5 dark:bg-panel-bg"
              title={currentFileName}
              onClick={(event) => event.stopPropagation()}
              onMouseDown={(event) => event.stopPropagation()}
              onKeyDown={(event) => event.stopPropagation()}
              role="button"
              aria-label={currentFileName ?? t.structureTree}
              tabIndex={-1}
            >
              <FileCode className="h-3 w-3 shrink-0 text-system-blue" />
              <input
                type="text"
                readOnly
                value={currentFileName ?? ''}
                aria-label={currentFileName ?? ''}
                spellCheck={false}
                className="allow-text-selection min-w-0 flex-1 bg-transparent text-[9px] leading-none font-medium text-text-secondary outline-none dark:text-text-tertiary cursor-text"
                onFocus={(event) => event.currentTarget.select()}
                onClick={(event) => {
                  event.stopPropagation();
                  event.currentTarget.select();
                }}
                onMouseDown={(event) => event.stopPropagation()}
              />
            </div>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            className={`flex h-5 w-5 items-center justify-center rounded-md transition-colors ${
              graphOpen
                ? 'bg-system-blue/10 text-system-blue ring-1 ring-inset ring-system-blue/20'
                : 'text-text-tertiary hover:bg-element-hover hover:text-text-primary'
            }`}
            title={t.openStructureGraph}
            aria-label={t.openStructureGraph}
            onClick={(event) => {
              event.stopPropagation();
              setGraphOpen(true);
            }}
          >
            <Network size={13} />
          </button>
          <button
            type="button"
            className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 transition-colors ${
              structureTreeShowGeometryDetails
                ? 'bg-element-hover text-text-primary ring-1 ring-inset ring-border-black/60'
                : 'text-text-tertiary hover:bg-element-hover hover:text-text-primary'
            }`}
            title={structureTreeShowGeometryDetails ? t.hideGeometryDetails : t.showGeometryDetails}
            aria-label={structureTreeShowGeometryDetails ? t.hideGeometryDetails : t.showGeometryDetails}
            onClick={(event) => {
              event.stopPropagation();
              onToggleGeometryDetails();
            }}
          >
            <Shapes size={11} />
            <Shield size={11} />
          </button>
          {!isReadOnly && isSimplifiedWorkspace ? (
            <button
              type="button"
              className="p-0.5 bg-system-blue-solid hover:bg-system-blue-hover text-white rounded-md transition-colors shadow-sm"
              title={t.addChildLink}
              aria-label={t.addChildLink}
              onClick={(event) => {
                event.stopPropagation();
                onAddChildFromSelection();
              }}
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          ) : null}
          {!isReadOnly && isSimplifiedWorkspace ? (
            <button
              type="button"
              className="flex h-5 w-5 items-center justify-center rounded text-text-tertiary transition-colors hover:bg-element-hover hover:text-text-primary"
              title={showVisual ? t.hideAllVisuals : t.showAllVisuals}
              aria-label={showVisual ? t.hideAllVisuals : t.showAllVisuals}
              onClick={(event) => {
                event.stopPropagation();
                onToggleVisuals();
              }}
            >
              {showVisual ? <Eye size={14} /> : <EyeOff size={14} />}
            </button>
          ) : null}
        </div>
      </div>

      {isOpen ? (
        <div
          ref={scrollContainerRef}
          className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden bg-white py-2 dark:bg-panel-bg custom-scrollbar"
        >
          <AssemblyTreeView
            workspace={workspace}
            showGeometryDetailsByDefault={structureTreeShowGeometryDetails}
            onSelect={onSelect}
            onHover={onHover}
            onSelectGeometry={onSelectGeometry}
            onFocus={onFocus}
            onAddChild={onAddChild}
            onAddCollisionBody={onAddCollisionBody}
            onDelete={onDelete}
            onUpdate={onUpdate}
            onCreateBridge={onCreateBridge}
            onPrefetchCreateBridge={onPrefetchCreateBridge}
            showAssemblyRoot={false}
            mode={mode}
            t={t}
            readOnly={isReadOnly}
          />
        </div>
      ) : null}

      <TreeStructureGraphDialog
        isOpen={graphOpen}
        onClose={() => {
          setGraphOpen(false);
          onCloseStructureGraph?.();
        }}
        workspace={workspace}
        activeComponentId={activeComponentId}
        t={t}
        onSelect={onSelect}
        onFocus={onFocus}
      />
    </div>
  );
}
