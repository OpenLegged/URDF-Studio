/**
 * Editor geometry/collision/measurement subdomain module (urdf-viewer directory)
 * 3D visualization for loaded robot documents with URDF/MJCF runtime models
 */
export { RobotModel } from './components/RobotModel';
export { JointControlItem } from './components/JointControlItem';
export { JointInteraction } from './components/JointInteraction';
export { ViewerToolbar } from './components/ViewerToolbar';
export { MeasureTool } from './components/MeasureTool.tsx';
export { GeometryTransformControls } from './components/CollisionTransformControls';
export { ViewerScene } from './components/ViewerScene';
export { ViewerPanels } from './components/ViewerPanels';

export * from './types';
export { useViewerController, useResponsivePanelLayout } from './hooks';
export type { ViewerController } from './hooks';
export { resolveDefaultViewerToolMode } from './utils/scopedToolMode';
export type { ScopedToolModeState } from './utils/scopedToolMode';
export { shouldNotifyVisualTransformLock } from './utils/geometryTransformPolicy';
export { buildViewerSceneProps } from './utils/viewerSceneProps';
export type { ViewerSceneBaseProps } from './utils/viewerSceneProps';
export {
  buildViewerRobotLinksScopeSignature,
  createStableViewerResourceScope,
} from './utils/viewerResourceScope';
export type { ViewerResourceScope } from './utils/viewerResourceScope';
export { computeCameraFrame } from './utils/cameraFrame';
export {
  EMPTY_RENDERER_SELECTION,
  groupProjectedJointMotionByComponent,
  isWorkspaceTransformSelection,
  projectJointPreviewToWorkspaceComponents,
  projectWorkspaceJointMotionToRenderer,
  projectWorkspaceSelectionToRenderer,
  resolveRendererSelectionToWorkspace,
  resolveWorkspaceFocusTarget,
} from './utils/workspaceSceneProjection';
export type {
  ProjectedWorkspaceJointMotionState,
  RendererJointInteractionPreview,
  WorkspaceJointMotionGroup,
} from './utils/workspaceSceneProjection';
