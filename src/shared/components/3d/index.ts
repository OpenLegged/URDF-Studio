/**
 * Shared 3D Components
 * Components for 3D rendering shared by the unified editor viewer pipeline.
 */

// Mesh Renderers
export {
  STLRenderer,
  OBJRenderer,
  DAERenderer,
  GLTFRenderer,
  useLoadingManager,
} from './MeshRenderers';
export { MeshAssetNode } from './MeshAssetNode';
export { preloadManagedMeshAsset } from './meshAssetPreload';

// Scene Utilities
export {
  HoverInvalidator,
  CanvasResizeSync,
  SnapshotManager,
  DEFAULT_SNAPSHOT_CAPTURE_OPTIONS,
  SNAPSHOT_ASPECT_RATIO_PRESETS,
  SNAPSHOT_BACKGROUND_STYLES,
  SNAPSHOT_DOF_MODES,
  SNAPSHOT_DETAIL_LEVELS,
  SNAPSHOT_ENVIRONMENT_PRESETS,
  SNAPSHOT_GROUND_STYLES,
  SNAPSHOT_IMAGE_FORMATS,
  SNAPSHOT_IMAGE_QUALITY_MAX,
  SNAPSHOT_IMAGE_QUALITY_MIN,
  SNAPSHOT_IMAGE_QUALITY_STEP,
  SNAPSHOT_LONG_EDGE_INPUT_STEP,
  SNAPSHOT_MAX_LONG_EDGE_INPUT,
  SNAPSHOT_SHADOW_STYLES,
  createSnapshotCaptureAbortError,
  isSnapshotCaptureAbortError,
  normalizeSnapshotAspectRatioPreset,
  normalizeSnapshotCaptureOptions,
  normalizeSnapshotImageQuality,
  normalizeSnapshotLongEdgePx,
  resolveSnapshotAspectRatio,
  resolveSnapshotLongEdgeDimensions,
  type SnapshotAspectRatioPreset,
  resolveSnapshotPreviewCaptureOptions,
  type SnapshotBackgroundStyle,
  type SnapshotCaptureAction,
  type SnapshotCaptureOptions,
  type SnapshotCaptureProgress,
  type SnapshotCaptureProgressPhase,
  type SnapshotCaptureRequest,
  type SnapshotCaptureRunControls,
  type SnapshotDofMode,
  type SnapshotDetailLevel,
  type SnapshotEnvironmentPreset,
  type SnapshotGroundStyle,
  type SnapshotImageFormat,
  type SnapshotPreviewAction,
  type SnapshotPreviewResult,
  type SnapshotShadowStyle,
  NeutralStudioEnvironment,
  SceneLighting,
  SemanticOutlineProvider,
  useSemanticOutline,
  GroundShadowPlane,
  ReferenceGrid,
  AdaptiveGroundPlane,
  SnapshotContactShadows,
  SnapshotExportLook,
  SceneCompileWarmup,
  INTERACTION_DPR_CAP,
  INTERACTION_RECOVERY_DELAY_MS,
  RESTING_DPR_CAP,
  resolveCanvasDpr,
  useAdaptiveInteractionQuality,
  useWorkspaceCanvasInteractionState,
  WorkspaceCanvasInteractionStateProvider,
  WorkspaceOrbitControls,
  DEFAULT_WORKSPACE_OVERLAY_GIZMO_MARGIN,
  VIEWER_CORNER_OVERLAY_CLASS_NAME,
  WORKSPACE_OVERLAY_EDGE_GAP_PX,
  WORKSPACE_OVERLAY_GIZMO_MARGIN_PX,
  WORKSPACE_OVERLAY_LEFT_EDGE_GAP,
  WORKSPACE_OVERLAY_LEFT_INSET_VAR,
  WORKSPACE_OVERLAY_RIGHT_EDGE_GAP,
  WORKSPACE_OVERLAY_RIGHT_INSET_VAR,
  resolveWorkspaceOverlayGizmoMargin,
  resolveWorkspaceOverlayInsetOffset,
  resolveWorkspaceOverlaySafeAreaStyle,
  type WorkspaceOverlayGizmoMargin,
  type WorkspaceOverlaySafeAreaInput,
  type WorkspaceOverlaySafeAreaStyle,
  LIGHTING_CONFIG,
  STUDIO_ENVIRONMENT_INTENSITY,
  WORKSPACE_CANVAS_BACKGROUND,
  WORKSPACE_DEFAULT_CAMERA_FOV,
  WORKSPACE_DEFAULT_CAMERA_POSITION,
  WORKSPACE_DEFAULT_CAMERA_UP,
} from './SceneUtilities';
export type { SemanticOutlineIntent } from './SceneUtilities';
export {
  UnifiedTransformControls,
  VISUALIZER_UNIFIED_GIZMO_SIZE,
} from './UnifiedTransformControls';
export { LinkIkTransformControls } from './LinkIkTransformControls';
export { LoadingHud } from './LoadingHud';
export {
  buildLoadingHudState,
  hasDeterminateLoadingCounts,
  normalizeLoadingProgress,
  resolveLoadingProgressMode,
  shouldUseIndeterminateStreamingMeshProgress,
} from './loadingHudState';

// Visualization Helpers
export * from './helpers';

export { WorkspaceCanvas } from './workspace';
export {
  applyWorkspaceCameraSnapshot,
  captureWorkspaceCameraSnapshot,
  resolveWorkspaceCameraRenderViewOffset,
  resolveSnapshotPreviewSurfaceSize,
  resolveWorkspaceVisibleViewportRect,
  resolveWorkspaceCanvasEnvironmentIntensity,
  useWorkspaceCanvasTheme,
} from './workspace';
export type { WorkspaceCanvasEnvironmentIntensityByTheme } from './workspace';
export type {
  WorkspaceCameraRenderViewOffset,
  WorkspaceCameraSnapshot,
  WorkspaceCameraVisibleViewport,
} from './workspace';

export { UsageGuide } from './UsageGuide';
export { ViewModeBadge } from './ViewModeBadge';
export { TransformConfirmOverlay } from './TransformConfirmOverlay';
export { TransformConfirmHtmlOverlay } from './TransformConfirmHtmlOverlay';
