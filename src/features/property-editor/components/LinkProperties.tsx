/**
 * LinkProperties - Property editing panel for Link elements.
 * Coordinates the visual, collision, and physics editors for the selected link.
 */
import React from 'react';
import { Box, Eye, Waypoints } from 'lucide-react';

import { translations } from '@/shared/i18n';
import { type Language, useUIStore } from '@/store/uiStore';
import type {
  WorkspaceJointPropertyPatch,
  WorkspaceLinkPropertyPatch,
} from '@/store/workspace/types';
import type {
  AppMode,
  DetailLinkTab,
  InteractionSelection,
  MotorSpec,
  RobotState,
  UrdfLink,
} from '@/types';
import { GeometryEditor } from './GeometryEditor';
import { LinkCollisionBodiesSection } from './LinkCollisionBodiesSection';
import { LinkPhysicsPanel } from './LinkPhysicsPanel';

interface DetailGeometryTabButtonProps {
  icon: React.ComponentType<{ className?: string }>;
  isActive: boolean;
  label: string;
  onClick: () => void;
}

const DetailGeometryTabButton: React.FC<DetailGeometryTabButtonProps> = ({
  icon: Icon,
  isActive,
  label,
  onClick,
}) => (
  <button
    type="button"
    onClick={onClick}
    title={label}
    className={`relative flex min-w-0 flex-1 items-center justify-center gap-1 overflow-hidden rounded-t-lg border-x border-t px-1 py-1 text-[10px] font-semibold transition-colors ${
      isActive
        ? 'z-10 -mb-px border-border-black bg-panel-bg pb-1.5 text-system-blue dark:bg-segmented-active'
        : 'border-transparent bg-transparent text-text-tertiary hover:bg-element-hover hover:text-text-secondary'
    }`}
  >
    <Icon className="h-3 w-3 shrink-0" />
    <span className="min-w-0 truncate leading-tight">{label}</span>
  </button>
);

interface DetailGeometryTabPanelProps {
  activeTab: DetailLinkTab;
  children: React.ReactNode;
  tab: DetailLinkTab;
}

const DetailGeometryTabPanel: React.FC<DetailGeometryTabPanelProps> = ({
  activeTab,
  children,
  tab,
}) => (
  <div
    style={{ display: activeTab === tab ? undefined : 'none' }}
    className="mb-2.5 rounded-b-lg border-x border-b border-border-black bg-panel-bg p-1.5 shadow-sm"
  >
    {children}
  </div>
);

function buildVisualPatch(nextLink: UrdfLink): Partial<UrdfLink> {
  return {
    visual: nextLink.visual,
    visualBodies: nextLink.visualBodies,
  };
}

function buildCollisionPatch(nextLink: UrdfLink): Partial<UrdfLink> {
  return {
    collision: nextLink.collision,
    collisionBodies: nextLink.collisionBodies,
  };
}

interface LinkPropertiesProps {
  componentId: string;
  data: UrdfLink;
  robot: RobotState;
  mode: AppMode;
  selection: RobotState['selection'];
  onUpdate: (
    type: 'link' | 'joint',
    id: string,
    data: WorkspaceLinkPropertyPatch | WorkspaceJointPropertyPatch,
  ) => void;
  onSelect?: (
    type: Exclude<InteractionSelection['type'], null>,
    id: string,
    subType?: 'visual' | 'collision',
  ) => void;
  onSelectGeometry?: (
    linkId: string,
    subType: 'visual' | 'collision',
    objectIndex?: number,
    suppressPulse?: boolean,
    suppressAutoReveal?: boolean,
  ) => void;
  onAddCollisionBody?: (linkId: string) => void;
  motorLibrary: Record<string, MotorSpec[]>;
  assets: Record<string, string>;
  onUploadAsset: (file: File) => void;
  sourceFilePath?: string;
  t: (typeof translations)['en'];
  lang: Language;
}

export const LinkProperties: React.FC<LinkPropertiesProps> = ({
  componentId,
  data,
  robot,
  selection,
  onUpdate,
  onSelect,
  onSelectGeometry,
  onAddCollisionBody,
  assets,
  onUploadAsset,
  sourceFilePath,
  t,
  lang,
}) => {
  const linkTab = useUIStore((state) => state.detailLinkTab);
  const setDetailLinkTab = useUIStore((state) => state.setDetailLinkTab);
  const selectedCollisionObjectIndex =
    selection.type === 'link' && selection.id === data.id && selection.subType === 'collision'
      ? (selection.objectIndex ?? 0)
      : undefined;

  const handleVisualGeometryUpdate = React.useCallback(
    (nextLink: UrdfLink) => {
      onUpdate('link', selection.id!, buildVisualPatch(nextLink));
    },
    [onUpdate, selection.id],
  );

  const handleCollisionGeometryUpdate = React.useCallback(
    (nextLink: UrdfLink) => {
      onUpdate('link', selection.id!, buildCollisionPatch(nextLink));
    },
    [onUpdate, selection.id],
  );

  const handleCollisionListChange = React.useCallback(
    (nextLink: UrdfLink) => {
      onUpdate('link', data.id, buildCollisionPatch(nextLink));
    },
    [data.id, onUpdate],
  );

  const handleSelectLink = React.useCallback(
    (subType?: 'collision') => {
      onSelect?.('link', data.id, subType);
    },
    [data.id, onSelect],
  );

  const handleSelectCollisionGeometry = React.useCallback(
    (objectIndex: number, suppressPulse?: boolean, suppressAutoReveal?: boolean) => {
      onSelectGeometry?.(data.id, 'collision', objectIndex, suppressPulse, suppressAutoReveal);
    },
    [data.id, onSelectGeometry],
  );

  return (
    <div>
      <div className="mb-0 flex items-stretch gap-0.5 rounded-t-lg border border-border-black bg-element-bg px-0.5 pt-0.5">
        <div className="w-px" />
        <DetailGeometryTabButton
          icon={Eye}
          isActive={linkTab === 'visual'}
          label={t.visualGeometry}
          onClick={() => setDetailLinkTab('visual')}
        />
        <DetailGeometryTabButton
          icon={Box}
          isActive={linkTab === 'collision'}
          label={t.collisionGeometry}
          onClick={() => setDetailLinkTab('collision')}
        />
        <DetailGeometryTabButton
          icon={Waypoints}
          isActive={linkTab === 'physics'}
          label={t.physics}
          onClick={() => setDetailLinkTab('physics')}
        />
      </div>

      <DetailGeometryTabPanel activeTab={linkTab} tab="visual">
        {linkTab === 'visual' ? (
          <GeometryEditor
            componentId={componentId}
            data={data}
            robot={robot}
            category="visual"
            onUpdate={handleVisualGeometryUpdate}
            assets={assets}
            onUploadAsset={onUploadAsset}
            sourceFilePath={sourceFilePath}
            t={t}
            lang={lang}
            isTabbed
            onLinkNameChange={(name) => onUpdate('link', selection.id!, { name })}
          />
        ) : null}
      </DetailGeometryTabPanel>

      <DetailGeometryTabPanel activeTab={linkTab} tab="collision">
        <div className={linkTab === 'collision' ? 'space-y-2' : undefined}>
          <LinkCollisionBodiesSection
            data={data}
            isActive={linkTab === 'collision'}
            selectedObjectIndex={selectedCollisionObjectIndex}
            onChange={handleCollisionListChange}
            onSelectLink={handleSelectLink}
            onSelectGeometry={onSelectGeometry ? handleSelectCollisionGeometry : undefined}
            onAddCollisionBody={onAddCollisionBody ? () => onAddCollisionBody(data.id) : undefined}
            t={t}
          />
          {linkTab === 'collision' ? (
            <GeometryEditor
              componentId={componentId}
              data={data}
              robot={robot}
              category="collision"
              onUpdate={handleCollisionGeometryUpdate}
              assets={assets}
              onUploadAsset={onUploadAsset}
              sourceFilePath={sourceFilePath}
              t={t}
              lang={lang}
              isTabbed
              showCollisionDeleteAction={false}
            />
          ) : null}
        </div>
      </DetailGeometryTabPanel>

      <DetailGeometryTabPanel activeTab={linkTab} tab="physics">
        <LinkPhysicsPanel
          data={data}
          robot={robot}
          selection={selection}
          onUpdate={onUpdate}
          t={t}
          lang={lang}
        />
      </DetailGeometryTabPanel>
    </div>
  );
};
