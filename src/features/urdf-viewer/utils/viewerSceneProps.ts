import type { AssemblyState, RobotFile } from '@/types';
import type { AssemblyScenePlacement, AssemblySceneProjection } from '@/core/robot';
import type { WorkspaceSelection } from '@/types';
import type { ViewerController } from '../hooks/useViewerController';
import type { ToolMode, ViewerProps, ViewerDocumentLoadEvent, ViewerSceneMode } from '../types';
import type { RuntimeRobotObject } from '@/shared/components/3d/runtimeRobotTypes';

interface BuildViewerScenePropsArgs {
  resolvedTheme?: 'light' | 'dark';
  controller: ViewerController;
  active?: boolean;
  sourceFile?: RobotFile | null;
  sourceFormat?: ViewerProps['sourceFormat'];
  allowUrdfXmlFallback?: boolean;
  availableFiles: RobotFile[];
  urdfContent: string;
  assets: Record<string, string>;
  onDocumentLoadEvent?: (event: ViewerDocumentLoadEvent) => void;
  onSceneReadyForDisplay?: () => void;
  retainedRobot?: RuntimeRobotObject | null;
  onRuntimeRobotLoaded?: (robot: RuntimeRobotObject) => void;
  sourceFilePath?: string;
  groundPlaneOffset?: number;
  mode: ViewerSceneMode;
  selection?: ViewerProps['selection'];
  hoveredSelection?: ViewerProps['hoveredSelection'];
  interactionEnabled?: boolean;
  hoverSelectionEnabled?: boolean;
  onHover?: ViewerProps['onHover'];
  onMeshSelect?: ViewerProps['onMeshSelect'];
  onUpdate?: ViewerProps['onUpdate'];
  onJointMotionCommit?: ViewerProps['onJointMotionCommit'];
  robotLinks?: ViewerProps['robotLinks'];
  robotJoints?: ViewerProps['robotJoints'];
  robotData?: ViewerProps['robotData'];
  showCollision?: boolean;
  showCollisionAlwaysOnTop?: boolean;
  focusTarget?: ViewerProps['focusTarget'];
  onCollisionTransformPreview?: ViewerProps['onCollisionTransformPreview'];
  onCollisionTransform?: ViewerProps['onCollisionTransform'];
  isMeshPreview?: boolean;
  ikDragActive?: boolean;
  runtimeInstanceKey?: number;
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

export interface ViewerSceneBaseProps extends BuildViewerScenePropsArgs {
  toolMode: ToolMode;
}

export function buildViewerSceneProps({
  resolvedTheme,
  controller,
  active = true,
  sourceFile,
  sourceFormat,
  allowUrdfXmlFallback = false,
  availableFiles,
  urdfContent,
  assets,
  onDocumentLoadEvent,
  onSceneReadyForDisplay,
  retainedRobot,
  onRuntimeRobotLoaded,
  sourceFilePath,
  groundPlaneOffset = controller.groundPlaneOffset,
  mode,
  selection,
  hoveredSelection,
  interactionEnabled = true,
  hoverSelectionEnabled = true,
  onMeshSelect,
  onUpdate,
  onJointMotionCommit,
  robotLinks,
  robotJoints,
  robotData,
  showCollision,
  showCollisionAlwaysOnTop,
  focusTarget,
  onCollisionTransformPreview,
  onCollisionTransform,
  isMeshPreview = false,
  ikDragActive = false,
  runtimeInstanceKey = 0,
  workspace,
  sceneProjection,
  scenePlacement,
  workspaceSelection,
  onAssemblyTransform,
  onComponentTransform,
  onBridgeTransform,
  pendingAutoGroundComponentIds,
  onAssemblyComponentAutoGroundResolved,
}: BuildViewerScenePropsArgs): ViewerSceneBaseProps {
  return {
    resolvedTheme,
    controller,
    active,
    sourceFile,
    sourceFormat,
    allowUrdfXmlFallback,
    availableFiles,
    urdfContent,
    assets,
    onDocumentLoadEvent,
    onSceneReadyForDisplay,
    retainedRobot,
    onRuntimeRobotLoaded,
    sourceFilePath,
    groundPlaneOffset,
    mode,
    selection,
    hoveredSelection,
    interactionEnabled,
    hoverSelectionEnabled,
    onHover: hoverSelectionEnabled ? controller.handleHoverWrapper : undefined,
    onMeshSelect,
    onUpdate,
    onJointMotionCommit,
    robotLinks,
    robotJoints,
    robotData,
    showCollision,
    showCollisionAlwaysOnTop,
    focusTarget,
    onCollisionTransformPreview,
    onCollisionTransform,
    isMeshPreview,
    ikDragActive,
    runtimeInstanceKey,
    workspace,
    sceneProjection,
    scenePlacement,
    workspaceSelection,
    onAssemblyTransform,
    onComponentTransform,
    onBridgeTransform,
    pendingAutoGroundComponentIds,
    onAssemblyComponentAutoGroundResolved,
    toolMode: controller.toolMode,
  };
}
