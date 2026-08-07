/** Canonical workspace property editor orchestrator. */
import React from 'react';
import { ChevronLeft, ChevronRight, FileCode } from 'lucide-react';

import type {
  AppMode,
  AssemblyComponent,
  AssemblyState,
  BridgeJoint,
  EntityRef,
  InteractionSelection,
  MotorSpec,
  RobotMjcfInspectionTendonSummary,
  RobotState,
  UrdfJoint,
  UrdfLink,
  WorkspaceSelection,
} from '@/types';
import type {
  WorkspaceAssemblyPropertyPatch,
  WorkspaceComponentPropertyPatch,
  WorkspaceJointPropertyPatch,
  WorkspaceLinkPropertyPatch,
  WorkspacePropertyPatch,
} from '@/store/workspace/types';
import { translations } from '@/shared/i18n';
import { Checkbox } from '@/shared/components/ui';
import type { Language } from '@/store/uiStore';
import { useResizablePanel } from '../hooks/useResizablePanel';
import {
  PROPERTY_EDITOR_INLINE_FIELD_LABEL_CLASS,
  PROPERTY_EDITOR_INPUT_CLASS,
  PROPERTY_EDITOR_PANEL_EYEBROW_CLASS,
  PROPERTY_EDITOR_PANEL_TITLE_CLASS,
  ReadonlyStatField,
  StaticSection,
} from './FormControls';
import { LinkProperties } from './LinkProperties';
import { JointProperties } from './JointProperties';
import { TendonProperties } from './TendonProperties';
import { TransformFields } from './TransformFields';

type LinkEntityRef = Extract<EntityRef, { type: 'link' }>;

export type PropertyEditorTarget =
  | {
      kind: 'assembly';
      ref: Extract<EntityRef, { type: 'assembly' }>;
      data: AssemblyState;
    }
  | {
      kind: 'component';
      ref: Extract<EntityRef, { type: 'component' }>;
      data: AssemblyComponent;
    }
  | { kind: 'bridge'; ref: Extract<EntityRef, { type: 'bridge' }>; data: BridgeJoint }
  | {
      kind: 'link';
      ref: Extract<EntityRef, { type: 'link' }>;
      data: UrdfLink;
      component: AssemblyState['components'][string];
    }
  | {
      kind: 'joint';
      ref: Extract<EntityRef, { type: 'joint' }>;
      data: UrdfJoint;
      component: AssemblyState['components'][string];
    }
  | {
      kind: 'tendon';
      ref: Extract<EntityRef, { type: 'tendon' }>;
      data: RobotMjcfInspectionTendonSummary;
      component: AssemblyState['components'][string];
    }
  | null;

export type {
  WorkspaceAssemblyPropertyPatch,
  WorkspaceComponentPropertyPatch,
  WorkspaceJointPropertyPatch,
  WorkspaceLinkPropertyPatch,
  WorkspacePropertyPatch,
};

function mergeJointPropertyPatch(
  joint: UrdfJoint,
  patch: WorkspaceJointPropertyPatch,
): UrdfJoint {
  return {
    ...joint,
    ...patch,
    origin: patch.origin
      ? {
          ...joint.origin,
          ...patch.origin,
          xyz: { ...joint.origin.xyz, ...patch.origin.xyz },
          rpy: { ...joint.origin.rpy, ...patch.origin.rpy },
        }
      : joint.origin,
    axis: patch.axis ? { ...(joint.axis ?? { x: 0, y: 0, z: 1 }), ...patch.axis } : joint.axis,
    limit: patch.limit ? { ...(joint.limit ?? { lower: 0, upper: 0, effort: 0, velocity: 0 }), ...patch.limit } : joint.limit,
    dynamics: patch.dynamics ? { ...joint.dynamics, ...patch.dynamics } : joint.dynamics,
    hardware: patch.hardware ? { ...joint.hardware, ...patch.hardware } : joint.hardware,
  };
}

function hasOwnEntry(record: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

/** Resolve canonical refs by exact owner and source-local ID only. */
export function resolvePropertyEditorTarget(
  workspace: AssemblyState,
  selection: WorkspaceSelection,
): PropertyEditorTarget {
  const ref = selection?.entity;
  if (!ref) return null;

  if (ref.type === 'assembly') {
    return { kind: 'assembly', ref, data: workspace };
  }
  if (ref.type === 'component') {
    const component = hasOwnEntry(workspace.components, ref.componentId)
      ? workspace.components[ref.componentId]
      : undefined;
    return component ? { kind: 'component', ref, data: component } : null;
  }
  if (ref.type === 'bridge') {
    const bridge = hasOwnEntry(workspace.bridges, ref.bridgeId)
      ? workspace.bridges[ref.bridgeId]
      : undefined;
    return bridge ? { kind: 'bridge', ref, data: bridge } : null;
  }

  const component = hasOwnEntry(workspace.components, ref.componentId)
    ? workspace.components[ref.componentId]
    : undefined;
  if (!component) return null;
  if (ref.type === 'link') {
    const link = hasOwnEntry(component.robot.links, ref.entityId)
      ? component.robot.links[ref.entityId]
      : undefined;
    return link ? { kind: 'link', ref, data: link, component } : null;
  }
  if (ref.type === 'joint') {
    const joint = hasOwnEntry(component.robot.joints, ref.entityId)
      ? component.robot.joints[ref.entityId]
      : undefined;
    return joint ? { kind: 'joint', ref, data: joint, component } : null;
  }
  const tendon = component.robot.inspectionContext?.mjcf?.tendons.find(
    (entry) => entry.name === ref.entityId,
  );
  return tendon ? { kind: 'tendon', ref, data: tendon, component } : null;
}

export interface PropertyEditorProps {
  workspace: AssemblyState;
  selection: WorkspaceSelection;
  onUpdate: (ref: EntityRef, patch: WorkspacePropertyPatch) => void;
  onSelect?: (selection: WorkspaceSelection) => void;
  onSelectGeometry?: (
    ref: LinkEntityRef,
    subType: 'visual' | 'collision',
    objectIndex?: number,
    suppressPulse?: boolean,
    suppressAutoReveal?: boolean,
  ) => void;
  onAddCollisionBody?: (ref: LinkEntityRef) => void;
  mode: AppMode;
  assets: Record<string, string>;
  onUploadAsset: (file: File) => void;
  motorLibrary: Record<string, MotorSpec[]>;
  lang: Language;
  collapsed?: boolean;
  onToggle?: () => void;
  readOnlyMessage?: string;
  readOnlyBadge?: string;
  jointTypeLocked?: boolean;
  sourceFilePath?: string;
}

interface BridgePropertiesProps {
  bridge: BridgeJoint;
  bridgeRef: Extract<EntityRef, { type: 'bridge' }>;
  mode: AppMode;
  motorLibrary: Record<string, MotorSpec[]>;
  t: (typeof translations)['en'];
  lang: Language;
  onUpdate: PropertyEditorProps['onUpdate'];
  jointTypeLocked?: boolean;
}

export function BridgeProperties({
  bridge,
  bridgeRef,
  mode,
  motorLibrary,
  t,
  lang,
  onUpdate,
  jointTypeLocked = false,
}: BridgePropertiesProps) {
  return (
    <div className="space-y-1.5" data-testid="bridge-properties">
      <StaticSection title={t.structureGraphBridge}>
        <label className="flex items-center gap-2 text-[10px] text-text-secondary">
          <span className="w-20 shrink-0">{t.name}</span>
          <input
            aria-label={t.name}
            value={bridge.name}
            onChange={(event) => onUpdate(bridgeRef, { name: event.currentTarget.value })}
            className={PROPERTY_EDITOR_INPUT_CLASS}
          />
        </label>
        <ReadonlyStatField
          label={t.parentComponent}
          value={`${bridge.parentComponentId} / ${bridge.parentLinkId}`}
        />
        <ReadonlyStatField
          label={t.childComponent}
          value={`${bridge.childComponentId} / ${bridge.childLinkId}`}
        />
      </StaticSection>
      <JointProperties
        data={bridge.joint}
        mode={mode}
        selection={{ type: 'joint', id: bridge.joint.id }}
        onUpdate={(_type, _id, jointPatch) => onUpdate(bridgeRef, {
          joint: mergeJointPropertyPatch(bridge.joint, jointPatch),
        })}
        motorLibrary={motorLibrary}
        t={t}
        lang={lang}
        jointTypeLocked={jointTypeLocked}
      />
    </div>
  );
}

interface TransformEditorProps {
  transform: AssemblyState['transform'];
  onChange: (transform: AssemblyState['transform']) => void;
  lang: Language;
  title?: string;
  description?: string;
}

function TransformEditor({
  transform,
  onChange,
  lang,
  title,
  description,
}: TransformEditorProps) {
  const t = translations[lang];
  return (
    <StaticSection title={title ?? t.propertyTransform}>
      <div className="space-y-1">
        {description ? (
          <p className="text-[10px] leading-4 text-text-tertiary">{description}</p>
        ) : null}
        <TransformFields
          lang={lang}
          positionValue={transform.position}
          rotationValue={transform.rotation}
          onPositionChange={(position) => onChange({
            ...transform,
            position: {
              x: position.x ?? transform.position.x,
              y: position.y ?? transform.position.y,
              z: position.z ?? transform.position.z,
            },
          })}
          onRotationChange={(rotation) => onChange({ ...transform, rotation })}
        />
      </div>
    </StaticSection>
  );
}

interface AssemblyPropertiesProps {
  workspace: AssemblyState;
  refValue: Extract<EntityRef, { type: 'assembly' }>;
  lang: Language;
  onUpdate: PropertyEditorProps['onUpdate'];
}

export function AssemblyProperties({ workspace, refValue, lang, onUpdate }: AssemblyPropertiesProps) {
  const t = translations[lang];
  return (
    <div data-testid="assembly-properties" className="space-y-1.5">
      <StaticSection title={t.structureGraphAssembly}>
        <label className="flex items-center gap-2 text-[10px] text-text-secondary">
          <span className="w-20 shrink-0">{t.name}</span>
          <input
            aria-label={t.name}
            value={workspace.name}
            onChange={(event) => onUpdate(refValue, { name: event.currentTarget.value })}
            className={PROPERTY_EDITOR_INPUT_CLASS}
          />
        </label>
      </StaticSection>
      <TransformEditor
        transform={workspace.transform}
        onChange={(transform) => onUpdate(refValue, { transform })}
        lang={lang}
      />
    </div>
  );
}

interface ComponentPropertiesProps {
  component: AssemblyComponent;
  refValue: Extract<EntityRef, { type: 'component' }>;
  incomingBridge?: BridgeJoint;
  lang: Language;
  onUpdate: PropertyEditorProps['onUpdate'];
}

const COMPONENT_PROPERTY_ROW_CLASS =
  'grid min-w-0 grid-cols-[minmax(0,5rem)_minmax(0,1fr)] items-center gap-2';

function getSourceFileDisplayName(sourceFile: string | null, fallback: string): string {
  if (!sourceFile) return fallback;
  const normalizedPath = sourceFile.replace(/\\/g, '/');
  return normalizedPath.slice(normalizedPath.lastIndexOf('/') + 1) || sourceFile;
}

export function ComponentProperties({
  component,
  refValue,
  incomingBridge,
  lang,
  onUpdate,
}: ComponentPropertiesProps) {
  const t = translations[lang];
  const transform = incomingBridge
    ? {
        position: { ...incomingBridge.joint.origin.xyz },
        rotation: { ...incomingBridge.joint.origin.rpy },
      }
    : component.transform;
  const transformTitle = incomingBridge
    ? t.componentBridgeAttachmentTransform
    : undefined;
  const transformDescription = incomingBridge
    ? t.componentBridgePlacementControlledBy.replace('{name}', incomingBridge.name)
    : undefined;
  const sourceFileTitle = component.sourceFile ?? t.none;
  const sourceFileDisplayName = getSourceFileDisplayName(component.sourceFile, t.none);

  return (
    <div data-testid="component-properties" className="space-y-1.5">
      <StaticSection
        title={t.structureGraphComponent}
        contentClassName="grid gap-y-1 border-t border-border-black bg-panel-bg p-1.5"
      >
        <label data-testid="component-name-row" className={COMPONENT_PROPERTY_ROW_CLASS}>
          <span className={`${PROPERTY_EDITOR_INLINE_FIELD_LABEL_CLASS} min-w-0 truncate`}>
            {t.componentDisplayName}
          </span>
          <input
            aria-label={t.componentDisplayName}
            value={component.name}
            onChange={(event) => onUpdate(refValue, { name: event.currentTarget.value })}
            className={`${PROPERTY_EDITOR_INPUT_CLASS} min-w-0`}
          />
        </label>
        <div
          data-testid="component-source-file-row"
          className={COMPONENT_PROPERTY_ROW_CLASS}
        >
          <span className={`${PROPERTY_EDITOR_INLINE_FIELD_LABEL_CLASS} min-w-0 truncate`}>
            {t.componentSourceFile}
          </span>
          <div
            data-testid="component-source-file-value"
            className="flex h-[22px] min-w-0 w-full items-center gap-1 overflow-hidden rounded-md border border-border-strong bg-element-bg/60 px-1.5 text-[10px] leading-4 text-text-primary"
            title={sourceFileTitle}
          >
            <FileCode aria-hidden="true" className="h-3 w-3 shrink-0 text-system-blue" />
            <span className="block min-w-0 truncate font-mono" dir="ltr">
              {sourceFileDisplayName}
            </span>
          </div>
        </div>
        <div
          data-testid="component-visibility-row"
          className={COMPONENT_PROPERTY_ROW_CLASS}
        >
          <span className={`${PROPERTY_EDITOR_INLINE_FIELD_LABEL_CLASS} min-w-0 truncate`}>
            {t.visible}
          </span>
          <Checkbox
            ariaLabel={t.visible}
            checked={component.visible}
            onChange={(visible) => onUpdate(refValue, { visible })}
            className="min-w-0 justify-self-start"
          />
        </div>
      </StaticSection>
      <TransformEditor
        transform={transform}
        onChange={(nextTransform) => {
          if (incomingBridge) {
            const currentOrigin = incomingBridge.joint.origin;
            const rotationChanged =
              currentOrigin.rpy.r !== nextTransform.rotation.r
              || currentOrigin.rpy.p !== nextTransform.rotation.p
              || currentOrigin.rpy.y !== nextTransform.rotation.y;
            onUpdate(
              { type: 'bridge', bridgeId: incomingBridge.id },
              {
                joint: {
                  origin: {
                    xyz: { ...nextTransform.position },
                    rpy: { ...nextTransform.rotation },
                    ...(rotationChanged
                      ? { quatXyzw: undefined }
                      : currentOrigin.quatXyzw
                        ? { quatXyzw: { ...currentOrigin.quatXyzw } }
                        : {}),
                  },
                },
              },
            );
            return;
          }
          onUpdate(refValue, { transform: nextTransform });
        }}
        lang={lang}
        title={transformTitle}
        description={transformDescription}
      />
    </div>
  );
}

function toLocalSelection(selection: WorkspaceSelection): InteractionSelection {
  const ref = selection?.entity;
  if (!ref || (ref.type !== 'link' && ref.type !== 'joint' && ref.type !== 'tendon')) {
    return { type: null, id: null };
  }
  return {
    type: ref.type,
    id: ref.entityId,
    subType: selection.subType,
    objectIndex: selection.objectIndex,
    helperKind: selection.helperKind,
    highlightObjectId: selection.highlightObjectId,
  };
}

export const PropertyEditor: React.FC<PropertyEditorProps> = ({
  workspace,
  selection,
  onUpdate,
  onSelect,
  onSelectGeometry,
  mode,
  assets,
  onUploadAsset,
  motorLibrary,
  lang,
  collapsed,
  onToggle,
  readOnlyMessage,
  readOnlyBadge,
  jointTypeLocked = false,
  onAddCollisionBody,
  sourceFilePath,
}) => {
  const target = resolvePropertyEditorTarget(workspace, selection);
  const componentTarget = target && 'component' in target ? target : null;
  const componentId = componentTarget?.ref.componentId ?? null;
  const incomingComponentBridge = target?.kind === 'component'
    ? Object.values(workspace.bridges).find(
        (bridge) => bridge.childComponentId === target.ref.componentId,
      )
    : undefined;
  const localSelection = toLocalSelection(selection);
  const localRobot: RobotState | null = componentTarget
    ? { ...componentTarget.component.robot, selection: localSelection }
    : null;
  const handleLocalUpdate = React.useCallback(
    (
      type: 'link' | 'joint',
      entityId: string,
      patch: WorkspaceLinkPropertyPatch | WorkspaceJointPropertyPatch,
    ) => {
      if (!componentId) return;
      onUpdate({ type, componentId, entityId }, patch);
    },
    [componentId, onUpdate],
  );
  const handleLocalSelect = React.useCallback(
    (
      type: Exclude<InteractionSelection['type'], null>,
      entityId: string,
      subType?: 'visual' | 'collision',
    ) => {
      if (!componentId) return;
      onSelect?.({ entity: { type, componentId, entityId }, subType });
    },
    [componentId, onSelect],
  );
  const handleGeometrySelect = React.useCallback(
    (
      linkId: string,
      subType: 'visual' | 'collision',
      objectIndex?: number,
      suppressPulse?: boolean,
      suppressAutoReveal?: boolean,
    ) => {
      if (!componentId) return;
      onSelectGeometry?.(
        { type: 'link', componentId, entityId: linkId },
        subType,
        objectIndex,
        suppressPulse,
        suppressAutoReveal,
      );
    },
    [componentId, onSelectGeometry],
  );
  const handleAddCollisionBody = React.useCallback(
    (linkId: string) => {
      if (!componentId) return;
      onAddCollisionBody?.({ type: 'link', componentId, entityId: linkId });
    },
    [componentId, onAddCollisionBody],
  );
  const t = translations[lang];
  const unsupportedMessage = selection && !target
        ? t.propertyEntityMissing
        : t.selectLinkJointOrTendon;
  const headerName = target?.data.name;
  const targetKind = target
    ? {
        assembly: t.structureGraphAssembly,
        component: t.structureGraphComponent,
        bridge: t.structureGraphBridge,
        link: t.structureGraphLink,
        joint: t.structureGraphJoint,
        tendon: t.propertyEntityTendon,
      }[target.kind]
    : null;
  const { sidebarRef, width, isDragging, handleResizeMouseDown } = useResizablePanel();
  const isReadOnly = Boolean(readOnlyMessage);
  const canRenderEditor = Boolean(
    target && !isReadOnly,
  );
  const effectiveSourceFilePath = componentTarget?.component.sourceFile
    ?? sourceFilePath
    ?? undefined;

  return (
    <div
      ref={sidebarRef}
      data-testid="property-editor-sidebar"
      className={`bg-element-bg dark:bg-panel-bg border-l border-border-black flex flex-col h-full z-20 relative will-change-transform ${collapsed ? 'translate-x-full pointer-events-auto' : 'translate-x-0 pointer-events-auto'} ${isDragging ? '' : 'transition-transform duration-200 ease-out motion-reduce:transition-none'}`}
      style={{
        width: `${width}px`,
        minWidth: `${width}px`,
        flex: `0 0 ${width}px`,
        contain: 'layout style',
      }}
    >
      <button
        onClick={(event) => {
          event.stopPropagation();
          onToggle?.();
        }}
        className="pointer-events-auto absolute -left-4 top-1/2 -translate-y-1/2 w-4 h-16 bg-panel-bg hover:bg-system-blue-solid hover:text-white border border-border-strong rounded-l-lg shadow-md flex flex-col items-center justify-center z-50 cursor-pointer text-text-tertiary transition-colors group"
        title={collapsed ? t.properties : t.collapseSidebar}
      >
        <div className="flex flex-col gap-0.5 items-center">
          <div className="w-1 h-1 rounded-full bg-text-tertiary/40 group-hover:bg-white/80" />
          {collapsed ? <ChevronLeft className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          <div className="w-1 h-1 rounded-full bg-text-tertiary/40 group-hover:bg-white/80" />
        </div>
      </button>

      <div
        data-testid="property-editor-sidebar-content"
        className="h-full w-full flex flex-col overflow-hidden"
        aria-hidden={collapsed ? true : undefined}
        inert={collapsed ? true : undefined}
      >
        <div style={{ width: `${width}px` }} className="h-full flex flex-col bg-element-bg dark:bg-panel-bg">
          <div className="w-full flex h-8 items-center justify-between px-2 border-b border-border-black bg-panel-bg shrink-0 relative z-30">
            <span className={PROPERTY_EDITOR_PANEL_EYEBROW_CLASS}>{t.properties}</span>
            {isReadOnly ? (
              <span className="ui-static-copy-guard ml-1.5 rounded-md border border-system-blue/20 bg-system-blue/10 px-1.5 py-px text-[9px] font-semibold tracking-[0.02em] text-system-blue">
                {readOnlyBadge ?? t.preview}
              </span>
            ) : null}
            {target && headerName ? (
              <div className="ml-1.5 flex min-w-0 flex-1 items-center gap-1.5">
                <span className="ui-static-copy-guard rounded-md bg-system-blue/10 px-1.5 py-px text-[9px] font-semibold capitalize tracking-[0.02em] text-system-blue">
                  {targetKind}
                </span>
                <h2 className={`${PROPERTY_EDITOR_PANEL_TITLE_CLASS} truncate`}>{headerName}</h2>
              </div>
            ) : null}
          </div>

          {!canRenderEditor ? (
            <div className="w-full flex-1 flex items-center justify-center p-8 text-text-tertiary text-center">
              <p className="ui-static-copy-guard text-xs italic leading-5">
                {readOnlyMessage ?? unsupportedMessage}
              </p>
            </div>
          ) : (
            <div className="w-full min-h-0 flex-1 overflow-y-auto custom-scrollbar p-1 space-y-1.5">
              {target?.kind === 'link' && localRobot ? (
                <LinkProperties
                  componentId={target.component.id}
                  data={target.data}
                  robot={localRobot}
                  mode={mode}
                  selection={localSelection}
                  onUpdate={handleLocalUpdate}
                  onSelect={handleLocalSelect}
                  onSelectGeometry={handleGeometrySelect}
                  onAddCollisionBody={handleAddCollisionBody}
                  motorLibrary={motorLibrary}
                  assets={assets}
                  onUploadAsset={onUploadAsset}
                  sourceFilePath={effectiveSourceFilePath}
                  t={t}
                  lang={lang}
                />
              ) : target?.kind === 'joint' ? (
                <JointProperties
                  data={target.data}
                  mode={mode}
                  selection={localSelection}
                  onUpdate={handleLocalUpdate}
                  motorLibrary={motorLibrary}
                  t={t}
                  lang={lang}
                  jointTypeLocked={jointTypeLocked}
                />
              ) : target?.kind === 'tendon' ? (
                <TendonProperties
                  data={target.data}
                  lang={lang}
                  onUpdate={(patch) => onUpdate(target.ref, patch)}
                />
              ) : target?.kind === 'bridge' ? (
                <BridgeProperties
                  bridge={target.data}
                  bridgeRef={target.ref}
                  mode={mode}
                  motorLibrary={motorLibrary}
                  t={t}
                  lang={lang}
                  onUpdate={onUpdate}
                  jointTypeLocked={jointTypeLocked}
                />
              ) : target?.kind === 'assembly' ? (
                <AssemblyProperties
                  workspace={target.data}
                  refValue={target.ref}
                  lang={lang}
                  onUpdate={onUpdate}
                />
              ) : target?.kind === 'component' ? (
                <ComponentProperties
                  component={target.data}
                  refValue={target.ref}
                  incomingBridge={incomingComponentBridge}
                  lang={lang}
                  onUpdate={onUpdate}
                />
              ) : null}
            </div>
          )}
        </div>
      </div>

      {!collapsed ? (
        <button
          type="button"
          data-testid="property-editor-sidebar-resize-handle"
          aria-label={t.resize}
          className="group absolute left-0 top-0 bottom-0 z-40 w-2 cursor-col-resize border-0 bg-transparent p-0"
          onMouseDown={handleResizeMouseDown}
        >
          <span
            data-testid="property-editor-sidebar-resize-rail"
            className="pointer-events-none absolute left-0 top-0 bottom-0 w-px bg-transparent transition-colors group-hover:bg-system-blue/50 group-active:bg-system-blue/60"
          />
        </button>
      ) : null}
    </div>
  );
};
