import React from 'react';

import type {
  AssemblyState,
  InteractionSelection,
  RobotData,
  RobotFile,
  UrdfOrigin,
  WorkspaceSelection,
} from '@/types';
import type { AssemblyScenePlacement, AssemblySceneProjection } from '@/core/robot';
import type {
  ViewerDocumentLoadEvent,
  ViewerHelperKind,
  ViewerRobotSourceFormat,
} from '@/features/editor';
import type { ViewerController } from '@/features/editor';
import type { ViewerResourceScope } from '@/features/editor';
import { ViewerScene } from '@/features/editor';

import { buildUnifiedViewerSceneProps } from '@/app/utils/unifiedViewerSceneProps';
import type { FilePreviewState } from './types';

interface ViewerSceneConnectorProps {
  controller: ViewerController;
  active: boolean;
  activePreview?: FilePreviewState;
  modelInteractionEnabled?: boolean;
  viewerResourceScope: ViewerResourceScope;
  retainedRobot?: import('three').Object3D | null;
  effectiveSourceFile: RobotFile | null | undefined;
  effectiveSourceFilePath?: string;
  effectiveUrdfContent: string;
  effectiveSourceFormat?: ViewerRobotSourceFormat;
  onDocumentLoadEvent?: (event: ViewerDocumentLoadEvent) => void;
  onSceneReadyForDisplay?: () => void;
  onRuntimeRobotLoaded?: (robot: import('three').Object3D) => void;
  mode: 'editor';
  selection?: {
    type: InteractionSelection['type'];
    id: string | null;
    subType?: 'visual' | 'collision';
    objectIndex?: number;
    helperKind?: ViewerHelperKind;
  };
  hoveredSelection?: InteractionSelection;
  onHover?: (
    type: InteractionSelection['type'],
    id: string | null,
    subType?: 'visual' | 'collision',
    objectIndex?: number,
    helperKind?: ViewerHelperKind,
    highlightObjectId?: number,
  ) => void;
  onMeshSelect?: (
    linkId: string,
    jointId: string | null,
    objectIndex: number,
    objectType: 'visual' | 'collision',
  ) => void;
  onUpdate?: (type: 'link' | 'joint', id: string, data: unknown) => void;
  onJointMotionCommit?: (context: import('@/features/editor').ViewerJointChangeContext) => void;
  robot: RobotData;
  showCollision?: boolean;
  showCollisionAlwaysOnTop?: boolean;
  focusTarget?: string | null;
  onCollisionTransformPreview?: (
    linkId: string,
    position: { x: number; y: number; z: number },
    rotation: { r: number; p: number; y: number },
    objectIndex?: number,
  ) => void;
  onCollisionTransform?: (
    linkId: string,
    position: { x: number; y: number; z: number },
    rotation: { r: number; p: number; y: number },
    objectIndex?: number,
  ) => void;
  isMeshPreview?: boolean;
  ikDragActive?: boolean;
  viewerReloadKey?: number;
  /** Omitted only for isolated read-only renderers such as snapshot preview. */
  workspace?: AssemblyState | null;
  sceneProjection?: AssemblySceneProjection | null;
  scenePlacement?: AssemblyScenePlacement | null;
  workspaceSelection?: WorkspaceSelection;
  onAssemblyTransform?: (transform: {
    position: { x: number; y: number; z: number };
    rotation: { r: number; p: number; y: number };
  }) => void;
  onComponentTransform?: (
    componentId: string,
    transform: {
      position: { x: number; y: number; z: number };
      rotation: { r: number; p: number; y: number };
    },
    options?: import('@/types/viewer').UpdateCommitOptions,
  ) => void;
  onBridgeTransform?: (
    bridgeId: string,
    origin: UrdfOrigin,
    options?: import('@/types/viewer').UpdateCommitOptions,
  ) => void;
  pendingAutoGroundComponentIds?: readonly string[];
  onAssemblyComponentAutoGroundResolved?: import('@/features/editor').ViewerProps['onAssemblyComponentAutoGroundResolved'];
  t: typeof import('@/shared/i18n').translations.en;
}

export const ViewerSceneConnector = React.memo(function ViewerSceneConnector({
  controller,
  active,
  activePreview,
  modelInteractionEnabled = true,
  viewerResourceScope,
  retainedRobot,
  effectiveSourceFile,
  effectiveSourceFilePath,
  effectiveUrdfContent,
  effectiveSourceFormat,
  onDocumentLoadEvent,
  onSceneReadyForDisplay,
  onRuntimeRobotLoaded,
  mode,
  selection,
  hoveredSelection,
  onHover,
  onMeshSelect,
  onUpdate,
  onJointMotionCommit,
  robot,
  showCollision,
  showCollisionAlwaysOnTop,
  focusTarget,
  onCollisionTransformPreview,
  onCollisionTransform,
  isMeshPreview = false,
  ikDragActive = false,
  viewerReloadKey = 0,
  workspace,
  sceneProjection,
  scenePlacement,
  workspaceSelection,
  onAssemblyTransform,
  onComponentTransform,
  onBridgeTransform,
  pendingAutoGroundComponentIds,
  onAssemblyComponentAutoGroundResolved,
  t,
}: ViewerSceneConnectorProps) {
  const sceneProps = buildUnifiedViewerSceneProps({
    controller,
    document: {
      viewerResourceScope,
      retainedRobot,
      effectiveSourceFile,
      effectiveSourceFilePath,
      effectiveUrdfContent,
      effectiveSourceFormat,
      onDocumentLoadEvent,
      onSceneReadyForDisplay,
      onRuntimeRobotLoaded,
    },
    interaction: {
      active,
      hasActivePreview: Boolean(activePreview),
      modelInteractionEnabled,
      hoveredSelection,
      mode,
      selection,
      onHover,
      onMeshSelect,
      onUpdate,
      onJointMotionCommit,
      robot,
      showCollision,
      showCollisionAlwaysOnTop,
      focusTarget,
      onCollisionTransformPreview,
      onCollisionTransform,
      isMeshPreview,
      ikDragActive,
      viewerReloadKey,
    },
    workspace: {
      workspace,
      sceneProjection,
      scenePlacement,
      workspaceSelection,
      onAssemblyTransform,
      onComponentTransform,
      onBridgeTransform,
      pendingAutoGroundComponentIds,
      onAssemblyComponentAutoGroundResolved,
    },
  });

  return <ViewerScene {...sceneProps} t={t} />;
});
