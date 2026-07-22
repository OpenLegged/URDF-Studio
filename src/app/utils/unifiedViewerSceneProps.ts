import type { Object3D as ThreeObject3D } from 'three';
import type { ViewerDocumentLoadEvent, ViewerProps } from '@/features/editor';
import type { ViewerController } from '@/features/editor';
import { buildViewerSceneProps, type ViewerSceneBaseProps } from '@/features/editor';
import type { ViewerResourceScope } from '@/features/editor';
import type { AssemblyState, RobotData, RobotFile, WorkspaceSelection } from '@/types';
import type { AssemblyScenePlacement, AssemblySceneProjection } from '@/core/robot';

export const EMPTY_VIEWER_SELECTION = {
  type: null,
  id: null,
} satisfies NonNullable<ViewerProps['selection']>;

export interface UnifiedViewerSceneDocumentInput {
  viewerResourceScope: ViewerResourceScope;
  retainedRobot?: ThreeObject3D | null;
  effectiveSourceFile: RobotFile | null | undefined;
  effectiveSourceFilePath?: string;
  effectiveUrdfContent: string;
  effectiveSourceFormat?: ViewerProps['sourceFormat'];
  onDocumentLoadEvent?: (event: ViewerDocumentLoadEvent) => void;
  onSceneReadyForDisplay?: () => void;
  onRuntimeRobotLoaded?: (robot: ThreeObject3D) => void;
}

export interface UnifiedViewerSceneInteractionInput {
  active: boolean;
  hasActivePreview: boolean;
  modelInteractionEnabled?: boolean;
  hoveredSelection?: ViewerProps['hoveredSelection'];
  mode: 'editor';
  selection?: ViewerProps['selection'];
  onHover?: ViewerProps['onHover'];
  onMeshSelect?: ViewerProps['onMeshSelect'];
  onUpdate?: ViewerProps['onUpdate'];
  onJointMotionCommit?: ViewerProps['onJointMotionCommit'];
  robot: RobotData;
  showCollision?: boolean;
  showCollisionAlwaysOnTop?: boolean;
  focusTarget?: string | null;
  onCollisionTransformPreview?: ViewerProps['onCollisionTransformPreview'];
  onCollisionTransform?: ViewerProps['onCollisionTransform'];
  isMeshPreview?: boolean;
  ikDragActive?: boolean;
  viewerReloadKey?: number;
}

export interface UnifiedViewerSceneWorkspaceInput {
  workspace?: AssemblyState | null;
  sceneProjection?: AssemblySceneProjection | null;
  scenePlacement?: AssemblyScenePlacement | null;
  workspaceSelection?: WorkspaceSelection;
  onAssemblyTransform?: ViewerProps['onAssemblyTransform'];
  onComponentTransform?: ViewerProps['onComponentTransform'];
  onBridgeTransform?: ViewerProps['onBridgeTransform'];
  pendingAutoGroundComponentIds?: ViewerProps['pendingAutoGroundComponentIds'];
  onAssemblyComponentAutoGroundResolved?: ViewerProps['onAssemblyComponentAutoGroundResolved'];
}

interface BuildUnifiedViewerScenePropsArgs {
  controller: ViewerController;
  document: UnifiedViewerSceneDocumentInput;
  interaction: UnifiedViewerSceneInteractionInput;
  workspace?: UnifiedViewerSceneWorkspaceInput;
}

export function buildUnifiedViewerSceneProps({
  controller,
  document,
  interaction,
  workspace: workspaceInput = {},
}: BuildUnifiedViewerScenePropsArgs): ViewerSceneBaseProps {
  const {
    viewerResourceScope,
    retainedRobot,
    effectiveSourceFile,
    effectiveSourceFilePath,
    effectiveUrdfContent,
    effectiveSourceFormat,
    onDocumentLoadEvent,
    onSceneReadyForDisplay,
    onRuntimeRobotLoaded,
  } = document;
  const {
    active,
    hasActivePreview,
    modelInteractionEnabled = true,
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
    isMeshPreview = false,
    ikDragActive = false,
    viewerReloadKey = 0,
  } = interaction;
  const {
    workspace,
    sceneProjection,
    scenePlacement,
    workspaceSelection,
    onAssemblyTransform,
    onComponentTransform,
    onBridgeTransform,
    pendingAutoGroundComponentIds,
    onAssemblyComponentAutoGroundResolved,
  } = workspaceInput;
  const blocksReadOnlyModelInteraction = hasActivePreview || !modelInteractionEnabled;
  const previewBlocksInteraction = blocksReadOnlyModelInteraction || !active;
  const shouldRenderFromStructuredRobotState = !hasActivePreview;

  return buildViewerSceneProps({
    controller,
    active,
    sourceFile: effectiveSourceFile,
    availableFiles: viewerResourceScope.availableFiles,
    urdfContent: effectiveUrdfContent,
    sourceFormat: effectiveSourceFormat,
    allowUrdfXmlFallback: hasActivePreview,
    assets: viewerResourceScope.assets,
    onDocumentLoadEvent,
    onSceneReadyForDisplay,
    retainedRobot,
    onRuntimeRobotLoaded,
    sourceFilePath: effectiveSourceFilePath,
    mode: hasActivePreview ? 'editor' : mode,
    selection: blocksReadOnlyModelInteraction ? EMPTY_VIEWER_SELECTION : selection,
    hoveredSelection: blocksReadOnlyModelInteraction ? undefined : hoveredSelection,
    interactionEnabled: !previewBlocksInteraction,
    hoverSelectionEnabled: !previewBlocksInteraction,
    onHover: previewBlocksInteraction ? undefined : onHover,
    onMeshSelect: previewBlocksInteraction ? undefined : onMeshSelect,
    onUpdate: blocksReadOnlyModelInteraction ? undefined : onUpdate,
    onJointMotionCommit: blocksReadOnlyModelInteraction ? undefined : onJointMotionCommit,
    robotLinks: shouldRenderFromStructuredRobotState ? robot.links : undefined,
    robotJoints: shouldRenderFromStructuredRobotState ? robot.joints : undefined,
    robotData: shouldRenderFromStructuredRobotState ? robot : null,
    showCollision,
    showCollisionAlwaysOnTop,
    focusTarget,
    onCollisionTransformPreview: blocksReadOnlyModelInteraction
      ? undefined
      : onCollisionTransformPreview,
    onCollisionTransform: blocksReadOnlyModelInteraction ? undefined : onCollisionTransform,
    isMeshPreview: hasActivePreview ? false : isMeshPreview,
    ikDragActive: blocksReadOnlyModelInteraction ? false : ikDragActive,
    runtimeInstanceKey: viewerReloadKey,
    workspace: blocksReadOnlyModelInteraction ? null : (workspace ?? null),
    sceneProjection: blocksReadOnlyModelInteraction ? null : (sceneProjection ?? null),
    scenePlacement: blocksReadOnlyModelInteraction ? null : (scenePlacement ?? null),
    workspaceSelection: blocksReadOnlyModelInteraction ? null : workspaceSelection,
    onAssemblyTransform: blocksReadOnlyModelInteraction ? undefined : onAssemblyTransform,
    onComponentTransform: blocksReadOnlyModelInteraction ? undefined : onComponentTransform,
    onBridgeTransform: blocksReadOnlyModelInteraction ? undefined : onBridgeTransform,
    pendingAutoGroundComponentIds: blocksReadOnlyModelInteraction
      ? []
      : pendingAutoGroundComponentIds,
    onAssemblyComponentAutoGroundResolved: blocksReadOnlyModelInteraction
      ? undefined
      : onAssemblyComponentAutoGroundResolved,
  });
}
