import React from 'react';
import type { Group as ThreeGroup, Object3D as ThreeObject3D } from 'three';

import type {
  AssemblyState,
  InteractionSelection,
  RobotData,
  UrdfOrigin,
  WorkspaceSelection,
} from '@/types';
import type { AssemblyScenePlacement, AssemblySceneProjection } from '@/core/robot';
import type {
  ViewerDocumentLoadEvent,
  ViewerHelperKind,
  ViewerRobotSourceFormat,
} from '@/features/editor';
import type { useViewerController } from '@/features/editor';
import type { ViewerResourceScope } from '@/features/editor';

import { LazyViewerSceneConnector } from './modeModuleLoaders';
import type { FilePreviewState } from './types';

interface UnifiedViewerSceneRootsProps {
  shouldRenderViewerScene: boolean;
  viewerGroupRef: React.RefObject<ThreeGroup | null>;
  viewerVisible: boolean;
  viewerController: ReturnType<typeof useViewerController>;
  activePreview?: FilePreviewState;
  modelInteractionEnabled?: boolean;
  viewerResourceScope: ViewerResourceScope;
  retainedRobot: ThreeObject3D | null;
  effectiveSourceFile: import('@/types').RobotFile | null | undefined;
  effectiveSourceFilePath?: string;
  effectiveUrdfContent: string;
  effectiveSourceFormat?: ViewerRobotSourceFormat;
  onDocumentLoadEvent?: (event: ViewerDocumentLoadEvent) => void;
  onSceneReadyForDisplay?: () => void;
  onRuntimeRobotLoaded?: (robot: ThreeObject3D) => void;
  viewerSceneMode: 'editor';
  selection?: InteractionSelection;
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
  viewerReloadKey?: number;
  workspace: AssemblyState;
  sceneProjection: AssemblySceneProjection;
  scenePlacement: AssemblyScenePlacement;
  workspaceSelection: WorkspaceSelection;
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
  ikDragActive: boolean;
}

export function UnifiedViewerSceneRoots({
  shouldRenderViewerScene,
  viewerGroupRef,
  viewerVisible,
  viewerController,
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
  viewerSceneMode,
  selection,
  hoveredSelection,
  onHover,
  onMeshSelect,
  onUpdate,
  onJointMotionCommit,
  robot,
  focusTarget,
  onCollisionTransformPreview,
  onCollisionTransform,
  isMeshPreview = false,
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
  ikDragActive,
}: UnifiedViewerSceneRootsProps) {
  return shouldRenderViewerScene ? (
    <group key="viewer-scene-root" ref={viewerGroupRef} visible={viewerVisible}>
      <React.Suspense fallback={null}>
        <LazyViewerSceneConnector
          controller={viewerController}
          active={viewerVisible}
          activePreview={activePreview}
          modelInteractionEnabled={modelInteractionEnabled}
          viewerResourceScope={viewerResourceScope}
          retainedRobot={retainedRobot}
          effectiveSourceFile={effectiveSourceFile}
          effectiveSourceFilePath={effectiveSourceFilePath}
          effectiveUrdfContent={effectiveUrdfContent}
          effectiveSourceFormat={effectiveSourceFormat}
          onDocumentLoadEvent={onDocumentLoadEvent}
          onSceneReadyForDisplay={onSceneReadyForDisplay}
          onRuntimeRobotLoaded={onRuntimeRobotLoaded}
          mode={viewerSceneMode}
          selection={selection}
          hoveredSelection={hoveredSelection}
          onHover={onHover}
          onMeshSelect={onMeshSelect}
          onUpdate={onUpdate}
          onJointMotionCommit={onJointMotionCommit}
          robot={robot}
          focusTarget={focusTarget}
          onCollisionTransformPreview={onCollisionTransformPreview}
          onCollisionTransform={onCollisionTransform}
          isMeshPreview={isMeshPreview}
          ikDragActive={ikDragActive}
          viewerReloadKey={viewerReloadKey}
          workspace={workspace}
          sceneProjection={sceneProjection}
          scenePlacement={scenePlacement}
          workspaceSelection={workspaceSelection}
          onAssemblyTransform={onAssemblyTransform}
          onComponentTransform={onComponentTransform}
          onBridgeTransform={onBridgeTransform}
          pendingAutoGroundComponentIds={pendingAutoGroundComponentIds}
          onAssemblyComponentAutoGroundResolved={onAssemblyComponentAutoGroundResolved}
          t={t}
        />
      </React.Suspense>
    </group>
  ) : null;
}
