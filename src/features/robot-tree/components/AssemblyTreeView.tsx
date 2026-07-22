import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRightLeft,
  Box,
  ChevronDown,
  ChevronRight,
  Cuboid,
  Eye,
  EyeOff,
  Link2,
  LockKeyhole,
  LockKeyholeOpen,
  Plus,
  Trash2,
  Waves,
} from 'lucide-react';

import {
  getTreeRenderRootLinkIds,
  hasComponentEditorLocks,
  isEntityEditorLocked,
} from '@/core/robot';
import { isAssemblyComponentIndividuallyTransformable } from '@/core/robot/assemblyTransforms';
import type { TranslationKeys } from '@/shared/i18n';
import { useSelectionStore } from '@/store/selectionStore';
import type { WorkspacePropertyPatch } from '@/store/workspace/types';
import { areEntityRefsEqual } from '@/types';
import type {
  AppMode,
  AssemblyComponent,
  AssemblyState,
  EntityRef,
  UrdfJoint,
  WorkspaceSelection,
} from '@/types';
import { TreeNode } from './TreeNode';

type LinkRef = Extract<EntityRef, { type: 'link' }>;
type JointRef = Extract<EntityRef, { type: 'joint' }>;

export interface AssemblyTreeViewProps {
  workspace: AssemblyState;
  showGeometryDetailsByDefault?: boolean;
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
  showAssemblyRoot?: boolean;
  mode: AppMode;
  t: TranslationKeys;
  readOnly?: boolean;
}

interface ComponentContentsParams {
  component: AssemblyComponent;
  className: string;
  selection: WorkspaceSelection;
  showGeometryDetailsByDefault: boolean;
  onSelect?: (selection: WorkspaceSelection) => void;
  onHover?: (selection: WorkspaceSelection) => void;
  onSelectGeometry?: AssemblyTreeViewProps['onSelectGeometry'];
  onFocus?: (ref: EntityRef) => void;
  onAddChild: (ref: LinkRef) => void;
  onAddCollisionBody: (ref: LinkRef) => void;
  onDelete: (ref: EntityRef) => void;
  onUpdate: (ref: EntityRef, patch: WorkspacePropertyPatch) => void;
  dispatchSelection: (selection: WorkspaceSelection) => void;
  dispatchHover: (selection: WorkspaceSelection) => void;
  clearHover: () => void;
  mode: AppMode;
  t: TranslationKeys;
  readOnly: boolean;
}

function selectionTargets(selection: WorkspaceSelection, ref: EntityRef): boolean {
  return selection !== null && areEntityRefsEqual(selection.entity, ref);
}

function runOnActivationKey(
  event: React.KeyboardEvent<HTMLElement>,
  action: () => void,
) {
  if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) {
    return;
  }
  event.preventDefault();
  action();
}

function selectionTargetsComponent(
  selection: WorkspaceSelection,
  componentId: string,
): boolean {
  if (!selection) return false;
  const ref = selection.entity;
  return ref.type === 'component'
    ? ref.componentId === componentId
    : (ref.type === 'link' || ref.type === 'joint' || ref.type === 'tendon')
      && ref.componentId === componentId;
}

function buildChildJointsByParent(joints: Record<string, UrdfJoint>) {
  const result: Record<string, UrdfJoint[]> = {};
  Object.values(joints).forEach((joint) => {
    (result[joint.parentLinkId] ??= []).push(joint);
  });
  return result;
}

function getComponentTendons(component: AssemblyComponent) {
  return component.robot.inspectionContext?.mjcf?.tendons ?? [];
}

function renderComponentContents({
  component,
  className,
  selection,
  showGeometryDetailsByDefault,
  onSelect,
  onHover,
  onSelectGeometry,
  onFocus,
  onAddChild,
  onAddCollisionBody,
  onDelete,
  onUpdate,
  dispatchSelection,
  dispatchHover,
  clearHover,
  mode,
  t,
  readOnly,
}: ComponentContentsParams) {
  const childJointsByParent = buildChildJointsByParent(component.robot.joints);
  const rootLinkIds = getTreeRenderRootLinkIds({
    ...component.robot,
    selection: { type: null, id: null },
  });
  const tendons = getComponentTendons(component);

  return (
    <div className={className}>
      {rootLinkIds.map((rootLinkId) => (
        <div
          key={rootLinkId}
          style={{ containIntrinsicSize: '320px', contentVisibility: 'auto' }}
        >
          <TreeNode
            componentId={component.id}
            linkId={rootLinkId}
            robot={component.robot}
            showGeometryDetailsByDefault={showGeometryDetailsByDefault}
            childJointsByParent={childJointsByParent}
            onSelect={onSelect}
            onHover={onHover}
            onSelectGeometry={onSelectGeometry}
            onFocus={onFocus}
            onAddChild={onAddChild}
            onAddCollisionBody={onAddCollisionBody}
            onDelete={onDelete as (ref: LinkRef | JointRef) => void}
            onUpdate={onUpdate as (
              ref: LinkRef | JointRef,
              patch: WorkspacePropertyPatch,
            ) => void}
            mode={mode}
            t={t}
            readOnly={readOnly}
            componentDisplayNamePrefix={component.name}
            inheritedEditorLockSource={component.editorLocked ? 'component' : undefined}
          />
        </div>
      ))}
      {tendons.map((tendon) => {
        const tendonRef: EntityRef = {
          type: 'tendon',
          componentId: component.id,
          entityId: tendon.name,
        };
        const selected = selectionTargets(selection, tendonRef);
        return (
          <button
            type="button"
            disabled={readOnly}
            key={tendon.name}
            data-testid={`tree-tendon-${component.id}-${tendon.name}`}
            className={`mx-1 my-0.5 flex w-[calc(100%_-_0.5rem)] items-center gap-1.5 rounded-md px-2 py-1 text-left text-[11px] transition-all duration-200 ${
              selected
                ? 'bg-system-blue/10 text-text-primary shadow-sm ring-1 ring-inset ring-system-blue/20 dark:bg-system-blue/20 dark:ring-system-blue/30'
                : 'text-text-tertiary hover:bg-element-hover/80 hover:text-text-primary hover:ring-1 hover:ring-inset hover:ring-border-black/60'
            }`}
            onClick={readOnly ? undefined : () => dispatchSelection({ entity: tendonRef })}
            onMouseEnter={readOnly ? undefined : () => dispatchHover({ entity: tendonRef })}
            onMouseLeave={readOnly ? undefined : clearHover}
          >
            <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded border border-violet-500/20 bg-violet-500/10 text-violet-600 dark:text-violet-300">
              <Waves size={9} />
            </span>
            <span className="min-w-0 flex-1 truncate font-medium">{tendon.name}</span>
          </button>
        );
      })}
    </div>
  );
}

export const AssemblyTreeView = memo(function AssemblyTreeView({
  workspace,
  showGeometryDetailsByDefault = false,
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
  showAssemblyRoot = true,
  mode,
  t,
  readOnly = false,
}: AssemblyTreeViewProps) {
  const selection = useSelectionStore((state) => state.selection);
  const hoveredSelection = useSelectionStore((state) => state.hoveredSelection);
  const attentionSelection = useSelectionStore((state) => state.attentionSelection);
  const setSelection = useSelectionStore((state) => state.setSelection);
  const setHoveredSelection = useSelectionStore((state) => state.setHoveredSelection);
  const clearHover = useSelectionStore((state) => state.clearHover);
  const components = useMemo(() => Object.values(workspace.components), [workspace.components]);
  const bridges = useMemo(() => Object.values(workspace.bridges), [workspace.bridges]);
  const simplified = components.length === 1 && bridges.length === 0;
  const [expandedComponents, setExpandedComponents] = useState<Set<string>>(
    () => new Set(simplified && components[0] ? [components[0].id] : []),
  );
  const [bridgesExpanded, setBridgesExpanded] = useState(true);
  const [editing, setEditing] = useState<EntityRef | null>(null);
  const [draft, setDraft] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!simplified || !components[0]) return;
    setExpandedComponents((current) => current.has(components[0].id)
      ? current
      : new Set([...current, components[0].id]));
  }, [components, simplified]);

  // When the canvas selects an entity inside a collapsed component, expand that component so the
  // target row mounts and can be scrolled into view. Driven by attentionSelection (pulse) so
  // tree-internal clicks don't fight the user's own collapse/expand actions.
  useEffect(() => {
    const target = attentionSelection?.entity;
    if (!target || !('componentId' in target)) return;
    const targetComponentId = target.componentId;
    if (!workspace.components[targetComponentId]) return;
    setExpandedComponents((current) => current.has(targetComponentId)
      ? current
      : new Set([...current, targetComponentId]));
  }, [attentionSelection, workspace.components]);

  useEffect(() => {
    if (!editing) return;
    const frame = window.requestAnimationFrame(() => {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [editing]);

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
  const beginRename = (ref: EntityRef, name: string, editorLocked = false) => {
    if (readOnly || editorLocked) return;
    setDraft(name);
    setEditing(ref);
  };
  const commitRename = (ref: EntityRef, currentName: string, value = draft) => {
    const name = value.trim();
    if (name && name !== currentName) onUpdate(ref, { name });
    setEditing(null);
  };
  const toggleComponent = (componentId: string) => {
    setExpandedComponents((current) => {
      const next = new Set(current);
      if (next.has(componentId)) next.delete(componentId);
      else next.add(componentId);
      return next;
    });
  };

  const itemHoverClass =
    'hover:bg-element-hover/80 hover:text-text-primary hover:ring-1 hover:ring-inset hover:ring-border-black/60';
  const itemHoveredClass =
    'bg-element-hover/80 text-text-primary ring-1 ring-inset ring-border-black/60';
  const itemSelectedClass =
    'bg-system-blue/10 text-text-primary shadow-sm ring-1 ring-inset ring-system-blue/20 dark:bg-system-blue/20 dark:ring-system-blue/30';
  const itemAttentionClass =
    'bg-system-blue/15 text-text-primary shadow-sm ring-1 ring-inset ring-system-blue/30 dark:bg-system-blue/25 dark:ring-system-blue/40';
  const renameInputClassName =
    'select-text text-[11px] font-medium leading-normal flex-1 min-w-0 px-1 py-0.5 rounded border outline-none transition-colors bg-input-bg border-border-strong text-text-primary focus:border-system-blue';
  const assemblyRef: EntityRef = { type: 'assembly' };
  const singleComponent = simplified ? components[0] ?? null : null;

  const componentContents = (component: AssemblyComponent, className: string) =>
    renderComponentContents({
      component,
      className,
      selection,
      showGeometryDetailsByDefault,
      onSelect,
      onHover,
      onSelectGeometry,
      onFocus,
      onAddChild,
      onAddCollisionBody,
      onDelete,
      onUpdate,
      dispatchSelection,
      dispatchHover,
      clearHover: clearCanonicalHover,
      mode,
      t,
      readOnly,
    });

  return (
    <div
      className="@container space-y-1 select-none"
      data-testid="assembly-tree"
      data-simplified={simplified ? 'true' : 'false'}
    >
      {!simplified && showAssemblyRoot ? (
        <div
          data-testid="assembly-tree-root"
          className={`mx-1 my-0.5 flex items-center rounded-md bg-element-bg px-2 py-1 text-text-primary transition-colors ${readOnly ? 'cursor-default' : 'cursor-pointer'} ${
            selectionTargets(attentionSelection, assemblyRef)
              ? itemAttentionClass
              : selectionTargets(selection, assemblyRef)
                ? itemSelectedClass
                : selectionTargets(hoveredSelection, assemblyRef)
                  ? itemHoveredClass
                  : itemHoverClass
          }`}
          onClick={readOnly ? undefined : () => dispatchSelection({ entity: assemblyRef })}
          onMouseEnter={readOnly ? undefined : () => dispatchHover({ entity: assemblyRef })}
          onMouseLeave={readOnly ? undefined : clearCanonicalHover}
          onDoubleClick={readOnly ? undefined : () => beginRename(assemblyRef, workspace.name)}
          onKeyDown={readOnly
            ? undefined
            : (event) => runOnActivationKey(
                event,
                () => dispatchSelection({ entity: assemblyRef }),
              )}
          role={readOnly ? undefined : 'button'}
          aria-label={workspace.name}
          tabIndex={readOnly ? undefined : 0}
        >
          <Cuboid size={14} className="mr-1.5 shrink-0 text-system-blue" />
          {editing?.type === 'assembly' ? (
            <input
              ref={renameInputRef}
              aria-label="rename-assembly"
              value={draft}
              className={renameInputClassName}
              onChange={(event) => setDraft(event.currentTarget.value)}
              onBlur={(event) => commitRename(assemblyRef, workspace.name, event.currentTarget.value)}
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => {
                if (event.key === 'Enter') commitRename(assemblyRef, workspace.name);
                if (event.key === 'Escape') setEditing(null);
              }}
            />
          ) : (
            <span className="min-w-0 flex-1 truncate text-[11px] font-medium leading-normal">
              {workspace.name}
            </span>
          )}
        </div>
      ) : null}

      {singleComponent ? (
        <>
          <div
            data-testid={`tree-robot-root-${singleComponent.id}`}
            className={`group mx-1 my-0.5 flex items-center rounded-md bg-element-bg px-2 py-1 text-text-primary transition-colors ${readOnly ? 'cursor-default' : 'cursor-pointer'} ${
              selectionTargets(attentionSelection, {
                type: 'component',
                componentId: singleComponent.id,
              })
                ? itemAttentionClass
                : selectionTargetsComponent(selection, singleComponent.id)
                  ? itemSelectedClass
                  : selectionTargetsComponent(hoveredSelection, singleComponent.id)
                    ? itemHoveredClass
                    : itemHoverClass
            }`}
            onClick={readOnly ? undefined : () => dispatchSelection({
              entity: { type: 'component', componentId: singleComponent.id },
            })}
            onMouseEnter={readOnly ? undefined : () => dispatchHover({
              entity: { type: 'component', componentId: singleComponent.id },
            })}
            onMouseLeave={readOnly ? undefined : clearCanonicalHover}
            onDoubleClick={readOnly
              ? undefined
              : () => beginRename(
                  { type: 'component', componentId: singleComponent.id },
                  singleComponent.name,
                  singleComponent.editorLocked === true,
                )}
            onKeyDown={readOnly
              ? undefined
              : (event) => runOnActivationKey(event, () => dispatchSelection({
                  entity: { type: 'component', componentId: singleComponent.id },
                }))}
            role={readOnly ? undefined : 'button'}
            aria-label={singleComponent.name}
            tabIndex={readOnly ? undefined : 0}
          >
            <Cuboid size={14} className="mr-1.5 shrink-0 text-system-blue" />
            {editing?.type === 'component'
            && editing.componentId === singleComponent.id ? (
              <input
                ref={renameInputRef}
                aria-label={`rename-component-${singleComponent.id}`}
                value={draft}
                className={renameInputClassName}
                onChange={(event) => setDraft(event.currentTarget.value)}
                onBlur={(event) => commitRename(
                  { type: 'component', componentId: singleComponent.id },
                  singleComponent.name,
                  event.currentTarget.value,
                )}
                onClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    commitRename(
                      { type: 'component', componentId: singleComponent.id },
                      singleComponent.name,
                    );
                  }
                  if (event.key === 'Escape') setEditing(null);
                }}
              />
            ) : (
              <span
                className="min-w-0 flex-1 truncate text-[11px] font-medium leading-normal"
                title={singleComponent.name}
              >
                {singleComponent.name}
              </span>
            )}
            {!readOnly ? (
              <div className="ml-1 flex shrink-0 items-center gap-0.5">
                <button
                  type="button"
                  aria-label={`toggle-component-${singleComponent.id}`}
                  className="h-5 w-5 rounded p-1 text-text-tertiary transition-colors hover:bg-system-blue/10 hover:text-text-primary dark:hover:bg-system-blue/20"
                  title={singleComponent.visible !== false ? t.hide : t.show}
                  onClick={(event) => {
                    event.stopPropagation();
                    onUpdate(
                      { type: 'component', componentId: singleComponent.id },
                      { visible: singleComponent.visible === false },
                    );
                  }}
                >
                  {singleComponent.visible !== false ? <Eye size={12} /> : <EyeOff size={12} />}
                </button>
                <button
                  type="button"
                  aria-label={`toggle-component-editor-lock-${singleComponent.id}`}
                  aria-pressed={singleComponent.editorLocked === true}
                  className={`h-5 w-5 rounded p-1 transition-colors ${
                    singleComponent.editorLocked === true
                      ? 'bg-amber-500/10 text-amber-600 hover:bg-amber-500/20 dark:text-amber-300'
                      : 'text-text-tertiary hover:bg-system-blue/10 hover:text-text-primary dark:hover:bg-system-blue/20'
                  }`}
                  title={singleComponent.editorLocked === true
                    ? t.unlockEditing
                    : t.lockEditing}
                  onClick={(event) => {
                    event.stopPropagation();
                    onUpdate(
                      { type: 'component', componentId: singleComponent.id },
                      {
                        editorLocked: singleComponent.editorLocked !== true,
                      },
                    );
                  }}
                >
                  {singleComponent.editorLocked === true
                    ? <LockKeyhole size={12} />
                    : <LockKeyholeOpen size={12} />}
                </button>
              </div>
            ) : null}
          </div>
          {componentContents(singleComponent, 'ml-1 border-l border-border-black')}
        </>
      ) : (
        <div className="mt-1 space-y-0.5">
          {components.map((component) => {
            const componentRef: EntityRef = { type: 'component', componentId: component.id };
            const expanded = expandedComponents.has(component.id);
            const isVisible = component.visible !== false;
            const selected = selectionTargetsComponent(selection, component.id);
            const hovered = selectionTargetsComponent(hoveredSelection, component.id);
            const attention = selectionTargetsComponent(attentionSelection, component.id);
            const transformable = isAssemblyComponentIndividuallyTransformable(
              workspace,
              component.id,
            );
            const hasLockedContent = hasComponentEditorLocks(component);
            const rowStateClass = attention
              ? itemAttentionClass
              : selected
                ? itemSelectedClass
                : hovered
                  ? itemHoveredClass
                  : itemHoverClass;

            return (
              <div key={component.id} data-testid={`tree-component-${component.id}`}>
                <div
                  className={`group mx-1 flex items-center gap-1.5 rounded-md px-2 py-1 transition-all duration-200 ${readOnly ? 'cursor-default' : 'cursor-pointer'} ${rowStateClass} ${
                    isVisible ? '' : 'opacity-60'
                  }`}
                  onClick={readOnly ? undefined : () => dispatchSelection({ entity: componentRef })}
                  onMouseEnter={readOnly ? undefined : () => dispatchHover({ entity: componentRef })}
                  onMouseLeave={readOnly ? undefined : clearCanonicalHover}
                  onDoubleClick={readOnly || component.editorLocked === true
                    ? undefined
                    : () => beginRename(
                        componentRef,
                        component.name,
                        component.editorLocked === true,
                      )}
                  onKeyDown={readOnly
                    ? undefined
                    : (event) => runOnActivationKey(
                        event,
                        () => dispatchSelection({ entity: componentRef }),
                      )}
                  role={readOnly ? undefined : 'button'}
                  aria-label={component.name}
                  tabIndex={readOnly ? undefined : 0}
                >
                  <button
                    type="button"
                    className="flex items-center justify-center rounded p-0.5 text-text-tertiary hover:bg-element-hover"
                    onClick={(event) => {
                      event.stopPropagation();
                      toggleComponent(component.id);
                    }}
                    aria-label={expanded
                      ? `${t.collapse} ${component.name}`
                      : `${t.expand} ${component.name}`}
                  >
                    {expanded ? (
                      <ChevronDown size={12} className="text-text-tertiary" />
                    ) : (
                      <ChevronRight size={12} className="text-text-tertiary" />
                    )}
                  </button>
                  <Box size={12} className="shrink-0 text-system-blue" />
                  {editing?.type === 'component' && editing.componentId === component.id ? (
                    <input
                      ref={renameInputRef}
                      aria-label={`rename-component-${component.id}`}
                      value={draft}
                      className={renameInputClassName}
                      onChange={(event) => setDraft(event.currentTarget.value)}
                      onBlur={(event) => commitRename(
                        componentRef,
                        component.name,
                        event.currentTarget.value,
                      )}
                      onClick={(event) => event.stopPropagation()}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') commitRename(componentRef, component.name);
                        if (event.key === 'Escape') setEditing(null);
                      }}
                    />
                  ) : (
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      <span
                        className="min-w-0 flex-1 truncate text-[11px] font-medium text-text-primary"
                        title={component.name}
                      >
                        {component.name}
                      </span>
                      {!transformable ? (
                        <span
                          className="relative inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300"
                          title={t.bridgedComponentLockedHint}
                          role="img"
                          aria-label={t.bridgedComponentLockedHint}
                        >
                          <Link2 size={10} strokeWidth={2.5} aria-hidden="true" />
                          <span className="absolute -right-0.5 -bottom-0.5 flex h-2 w-2 items-center justify-center rounded-full border border-background-primary bg-background-primary text-amber-600 dark:text-amber-300">
                            <LockKeyhole size={5.5} strokeWidth={3} aria-hidden="true" />
                          </span>
                        </span>
                      ) : null}
                    </div>
                  )}
                  {!readOnly ? (
                    <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                      <button
                        type="button"
                        aria-label={`toggle-component-${component.id}`}
                        className="rounded p-1 text-text-tertiary transition-colors hover:bg-element-hover"
                        title={isVisible ? t.hide : t.show}
                        onClick={(event) => {
                          event.stopPropagation();
                          onUpdate(componentRef, { visible: !component.visible });
                        }}
                      >
                        {isVisible ? <Eye size={12} /> : <EyeOff size={12} />}
                      </button>
                      <button
                        type="button"
                        aria-label={`toggle-component-editor-lock-${component.id}`}
                        aria-pressed={component.editorLocked === true}
                        className={`rounded p-1 transition-colors ${
                          component.editorLocked === true
                            ? 'bg-amber-500/10 text-amber-600 hover:bg-amber-500/20 dark:text-amber-300'
                            : 'text-text-tertiary hover:bg-element-hover'
                        }`}
                        title={component.editorLocked === true
                          ? t.unlockEditing
                          : t.lockEditing}
                        onClick={(event) => {
                          event.stopPropagation();
                          onUpdate(componentRef, {
                            editorLocked: component.editorLocked !== true,
                          });
                        }}
                      >
                        {component.editorLocked === true
                          ? <LockKeyhole size={12} />
                          : <LockKeyholeOpen size={12} />}
                      </button>
                      <button
                        type="button"
                        aria-label={`delete-component-${component.id}`}
                        disabled={hasLockedContent}
                        className={`rounded p-1 transition-colors ${
                          hasLockedContent
                            ? 'cursor-not-allowed text-text-tertiary/40'
                            : 'text-red-500 hover:bg-red-100 dark:hover:bg-red-900/30'
                        }`}
                        title={hasLockedContent
                          ? t.editingLockedMessage
                          : t.deleteBranch}
                        onClick={(event) => {
                          event.stopPropagation();
                          onDelete(componentRef);
                        }}
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ) : null}
                </div>
                {expanded
                  ? componentContents(
                      component,
                      'ml-4 border-l border-border-black/70',
                    )
                  : null}
              </div>
            );
          })}
        </div>
      )}

      {!simplified ? (
        <div data-testid="assembly-tree-bridges" className="mt-2">
          <div
            className={`group flex min-w-0 cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 transition-all duration-200 ${itemHoverClass}`}
            onClick={() => setBridgesExpanded((value) => !value)}
            onKeyDown={(event) => runOnActivationKey(
              event,
              () => setBridgesExpanded((value) => !value),
            )}
            role="button"
            aria-label={t.bridges}
            tabIndex={0}
          >
            {bridgesExpanded ? (
              <ChevronDown size={12} className="shrink-0 text-text-tertiary" />
            ) : (
              <ChevronRight size={12} className="shrink-0 text-text-tertiary" />
            )}
            <Link2 size={12} className="shrink-0 text-green-500" />
            <span className="min-w-0 flex-1 truncate text-[11px] font-semibold tracking-[0.02em] text-text-tertiary">
              {t.bridges}
            </span>
            <span className="mr-1 shrink-0 text-[10px] text-text-tertiary">
              {bridges.length}
            </span>
            {!readOnly && onCreateBridge ? (
              <button
                type="button"
                className="group/btn flex shrink-0 items-center gap-1 rounded border border-system-blue/25 bg-system-blue/10 px-1.5 py-0.5 text-system-blue transition-colors hover:bg-system-blue/15 dark:border-system-blue/35 dark:bg-system-blue/20 dark:hover:bg-system-blue/25"
                title={t.createBridge}
                aria-label={t.createBridge}
                onPointerEnter={onPrefetchCreateBridge}
                onPointerDown={onPrefetchCreateBridge}
                onFocus={onPrefetchCreateBridge}
                onClick={(event) => {
                  event.stopPropagation();
                  onCreateBridge();
                }}
              >
                <Plus size={10} strokeWidth={3} />
                <span className="hidden text-[9px] font-semibold tracking-[0.01em] @[260px]:inline">
                  {t.add}
                </span>
              </button>
            ) : null}
          </div>
          {bridgesExpanded ? (
            <div className="mt-0.5 ml-2 space-y-0.5 border-l border-border-black">
              {bridges.length === 0 ? (
                <div className="px-4 py-2 text-[10px] italic text-text-tertiary">{t.none}</div>
              ) : bridges.map((bridge) => {
                const bridgeRef: EntityRef = { type: 'bridge', bridgeId: bridge.id };
                const selected = selectionTargets(selection, bridgeRef);
                const hovered = selectionTargets(hoveredSelection, bridgeRef);
                const attention = selectionTargets(attentionSelection, bridgeRef);
                const editorLocked = isEntityEditorLocked(workspace, bridgeRef);
                const rowStateClass = attention
                  ? itemAttentionClass
                  : selected
                    ? itemSelectedClass
                    : hovered
                      ? itemHoveredClass
                      : itemHoverClass;
                return (
                  <div
                    key={bridge.id}
                    data-testid={`tree-bridge-${bridge.id}`}
                    className={`group mx-1 flex items-center gap-1.5 rounded-md px-2 py-1 text-text-secondary transition-all duration-200 ${readOnly ? 'cursor-default' : 'cursor-pointer'} ${rowStateClass}`}
                    title={`${bridge.parentComponentId}/${bridge.parentLinkId} → ${bridge.childComponentId}/${bridge.childLinkId}`}
                    onClick={readOnly ? undefined : () => dispatchSelection({ entity: bridgeRef })}
                    onMouseEnter={readOnly ? undefined : () => dispatchHover({ entity: bridgeRef })}
                    onMouseLeave={readOnly ? undefined : clearCanonicalHover}
                    onDoubleClick={readOnly || editorLocked
                      ? undefined
                      : () => beginRename(bridgeRef, bridge.name, editorLocked)}
                    onKeyDown={readOnly
                      ? undefined
                      : (event) => runOnActivationKey(
                          event,
                          () => dispatchSelection({ entity: bridgeRef }),
                        )}
                    role={readOnly ? undefined : 'button'}
                    aria-label={bridge.name}
                    tabIndex={readOnly ? undefined : 0}
                  >
                    <ArrowRightLeft size={12} className="shrink-0 text-orange-500 dark:text-orange-300" />
                    {editing?.type === 'bridge' && editing.bridgeId === bridge.id ? (
                      <input
                        ref={renameInputRef}
                        aria-label={`rename-bridge-${bridge.id}`}
                        value={draft}
                        className={renameInputClassName}
                        onChange={(event) => setDraft(event.currentTarget.value)}
                        onBlur={(event) => commitRename(
                          bridgeRef,
                          bridge.name,
                          event.currentTarget.value,
                        )}
                        onClick={(event) => event.stopPropagation()}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') commitRename(bridgeRef, bridge.name);
                          if (event.key === 'Escape') setEditing(null);
                        }}
                      />
                    ) : (
                      <span className="min-w-0 flex-1 truncate text-[11px] font-medium">
                        {bridge.name}
                      </span>
                    )}
                    {!readOnly ? (
                      <button
                        type="button"
                        aria-label={`delete-bridge-${bridge.id}`}
                        disabled={editorLocked}
                        className={`rounded p-1 opacity-0 transition-opacity group-hover:opacity-100 ${
                          editorLocked
                            ? 'cursor-not-allowed text-text-tertiary/40'
                            : 'text-red-500 hover:bg-red-100 dark:hover:bg-red-900/30'
                        }`}
                        title={editorLocked ? t.editingLockedMessage : t.deleteBranch}
                        onClick={(event) => {
                          event.stopPropagation();
                          onDelete(bridgeRef);
                        }}
                      >
                        <Trash2 size={12} />
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
});
