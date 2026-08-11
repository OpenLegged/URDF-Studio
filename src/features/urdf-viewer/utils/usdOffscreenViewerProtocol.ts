import type { InteractionSelection, RobotData, RobotFile, UsdSceneSnapshot } from '@/types';
import type {
  ToolMode,
  ViewerDocumentLoadEvent,
  ViewerInteractiveLayer,
  UsdLoadingProgress,
} from '../types';
import type { ViewerRobotDataResolution } from '@/lib/robot-parser/usd/viewerRobotData';
import type { UsdStageOpenPreparationWorkerContextSnapshot } from './usdStageOpenPreparationWorkerPayload';
import type { UsdOffscreenCameraState } from './usdOffscreenCameraState';
import type { PreparedUsdExportCacheWorkerPayload } from './usdPreparedExportCacheWorkerTransfer';
import type { UsdBakedScene } from '@/types';

type OffscreenViewerSourceFile = Pick<RobotFile, 'name' | 'content' | 'blobUrl'>;
export type UsdOffscreenViewerSessionId = number;
export type UsdOffscreenViewerCompletionMode = 'interactive' | 'complete';
export type OffscreenViewerInteractionSelection = Pick<
  InteractionSelection,
  'type' | 'id' | 'subType' | 'objectIndex' | 'helperKind'
>;

export interface UsdOffscreenViewerInteractionState {
  toolMode: ToolMode;
  selection: OffscreenViewerInteractionSelection | null;
  hoveredSelection: OffscreenViewerInteractionSelection | null;
  hoverSelectionEnabled: boolean;
  interactionLayerPriority: ViewerInteractiveLayer[];
}

export interface UsdOffscreenViewerInitRequest {
  type: 'init';
  sessionId: UsdOffscreenViewerSessionId;
  /**
   * `scene` publishes the composed OpenUSD scene snapshot without hydrating
   * RobotData or preparing robot export caches. The default remains `robot`
   * for existing model-editor callers.
   */
  projectionMode?: 'robot' | 'scene';
  canvas: OffscreenCanvas;
  width: number;
  height: number;
  devicePixelRatio: number;
  theme: 'light' | 'dark';
  active: boolean;
  groundPlaneOffset: number;
  showVisual: boolean;
  showCollision: boolean;
  showCollisionAlwaysOnTop: boolean;
  showOrigins: boolean;
  showOriginsOverlay: boolean;
  originSize: number;
  sourceFile: OffscreenViewerSourceFile;
  completionMode?: UsdOffscreenViewerCompletionMode;
  forceHydraFullDraw?: boolean;
  stageOpenContextKey?: string;
  stageOpenContext?: UsdStageOpenPreparationWorkerContextSnapshot | null;
  stageOpenContextCacheHit?: boolean;
  initialInteractionState?: UsdOffscreenViewerInteractionState | null;
}

export interface UsdOffscreenViewerResizeRequest {
  type: 'resize';
  sessionId: UsdOffscreenViewerSessionId;
  width: number;
  height: number;
  devicePixelRatio: number;
}

export interface UsdOffscreenViewerPointerDownRequest {
  type: 'pointer-down';
  sessionId: UsdOffscreenViewerSessionId;
  pointerId: number;
  button: number;
  localX: number;
  localY: number;
}

export interface UsdOffscreenViewerPointerMoveRequest {
  type: 'pointer-move';
  sessionId: UsdOffscreenViewerSessionId;
  pointerId: number;
  buttons: number;
  localX: number;
  localY: number;
}

export interface UsdOffscreenViewerPointerUpRequest {
  type: 'pointer-up';
  sessionId: UsdOffscreenViewerSessionId;
  pointerId: number;
  buttons: number;
  localX: number;
  localY: number;
}

export interface UsdOffscreenViewerPointerLeaveRequest {
  type: 'pointer-leave';
  sessionId: UsdOffscreenViewerSessionId;
}

export interface UsdOffscreenViewerWheelRequest {
  type: 'wheel';
  sessionId: UsdOffscreenViewerSessionId;
  deltaY: number;
}

export interface UsdOffscreenViewerSetVisibilityRequest {
  type: 'set-visibility';
  sessionId: UsdOffscreenViewerSessionId;
  showVisual: boolean;
  showCollision: boolean;
  showCollisionAlwaysOnTop: boolean;
}

export interface UsdOffscreenViewerSetDecorationStateRequest {
  type: 'set-decoration-state';
  sessionId: UsdOffscreenViewerSessionId;
  showOrigins: boolean;
  showOriginsOverlay: boolean;
  originSize: number;
}

export interface UsdOffscreenViewerSetGroundOffsetRequest {
  type: 'set-ground-offset';
  sessionId: UsdOffscreenViewerSessionId;
  groundPlaneOffset: number;
}

export interface UsdOffscreenViewerSetActiveRequest {
  type: 'set-active';
  sessionId: UsdOffscreenViewerSessionId;
  active: boolean;
}

export interface UsdOffscreenViewerAutoFitGroundRequest {
  type: 'auto-fit-ground';
  sessionId: UsdOffscreenViewerSessionId;
}

export interface UsdOffscreenViewerSetInteractionStateRequest {
  type: 'set-interaction-state';
  sessionId: UsdOffscreenViewerSessionId;
  toolMode: UsdOffscreenViewerInteractionState['toolMode'];
  selection: UsdOffscreenViewerInteractionState['selection'];
  hoveredSelection: UsdOffscreenViewerInteractionState['hoveredSelection'];
  hoverSelectionEnabled: UsdOffscreenViewerInteractionState['hoverSelectionEnabled'];
  interactionLayerPriority: UsdOffscreenViewerInteractionState['interactionLayerPriority'];
}

export interface UsdOffscreenViewerSetJointAngleRequest {
  type: 'set-joint-angle';
  sessionId: UsdOffscreenViewerSessionId;
  jointId: string;
  angleRad: number;
}

export interface UsdOffscreenViewerSetCameraStateRequest {
  type: 'set-camera-state';
  sessionId: UsdOffscreenViewerSessionId;
  cameraState: UsdOffscreenCameraState;
}

export interface UsdOffscreenViewerPrewarmRuntimeRequest {
  type: 'prewarm-runtime';
}

export interface UsdOffscreenViewerDisposeStageRequest {
  type: 'dispose-stage';
  sessionId: UsdOffscreenViewerSessionId;
}

export interface UsdOffscreenViewerDisposeRequest {
  type: 'dispose';
}

export type UsdOffscreenViewerWorkerRequest =
  | UsdOffscreenViewerInitRequest
  | UsdOffscreenViewerResizeRequest
  | UsdOffscreenViewerPointerDownRequest
  | UsdOffscreenViewerPointerMoveRequest
  | UsdOffscreenViewerPointerUpRequest
  | UsdOffscreenViewerPointerLeaveRequest
  | UsdOffscreenViewerWheelRequest
  | UsdOffscreenViewerSetVisibilityRequest
  | UsdOffscreenViewerSetDecorationStateRequest
  | UsdOffscreenViewerSetGroundOffsetRequest
  | UsdOffscreenViewerAutoFitGroundRequest
  | UsdOffscreenViewerSetActiveRequest
  | UsdOffscreenViewerSetInteractionStateRequest
  | UsdOffscreenViewerSetJointAngleRequest
  | UsdOffscreenViewerSetCameraStateRequest
  | UsdOffscreenViewerPrewarmRuntimeRequest
  | UsdOffscreenViewerDisposeStageRequest
  | UsdOffscreenViewerDisposeRequest;

export interface UsdOffscreenViewerProgressResponse {
  type: 'progress';
  sessionId: UsdOffscreenViewerSessionId;
  progress: UsdLoadingProgress;
}

export interface UsdOffscreenViewerDocumentLoadResponse {
  type: 'document-load';
  sessionId: UsdOffscreenViewerSessionId;
  event: ViewerDocumentLoadEvent;
}

export interface UsdOffscreenViewerRobotDataResponse {
  type: 'robot-data';
  sessionId: UsdOffscreenViewerSessionId;
  resolution: ViewerRobotDataResolution;
  robotData?: RobotData | null;
  preparedCache?: PreparedUsdExportCacheWorkerPayload | null;
  preparedCachePending?: boolean;
  deferredSceneSnapshotPending?: boolean;
}

export interface UsdOffscreenViewerPreparedCacheResponse {
  type: 'prepared-cache';
  sessionId: UsdOffscreenViewerSessionId;
  stageSourcePath: string | null;
  preparedCache: PreparedUsdExportCacheWorkerPayload | null;
  error?: string | null;
}

export interface UsdOffscreenViewerSceneSnapshotResponse {
  type: 'scene-snapshot';
  sessionId: UsdOffscreenViewerSessionId;
  stageSourcePath: string | null;
  bakedScene?: UsdBakedScene;
  snapshot: UsdSceneSnapshot;
}

export interface UsdOffscreenViewerSelectionChangeResponse {
  type: 'selection-change';
  sessionId: UsdOffscreenViewerSessionId;
  selection: OffscreenViewerInteractionSelection | null;
  meshSelection: {
    linkId: string;
    objectIndex: number;
    objectType: 'visual' | 'collision';
  } | null;
}

export interface UsdOffscreenViewerHoverChangeResponse {
  type: 'hover-change';
  sessionId: UsdOffscreenViewerSessionId;
  hoveredSelection: OffscreenViewerInteractionSelection | null;
}

export interface UsdOffscreenViewerJointAnglesChangeResponse {
  type: 'joint-angles-change';
  sessionId: UsdOffscreenViewerSessionId;
  jointAngles: Record<string, number>;
}

export interface UsdOffscreenViewerCameraStateResponse {
  type: 'camera-state';
  sessionId: UsdOffscreenViewerSessionId;
  cameraState: UsdOffscreenCameraState;
}

export interface UsdOffscreenViewerFatalErrorResponse {
  type: 'fatal-error';
  sessionId: UsdOffscreenViewerSessionId;
  error: string;
}

export type UsdOffscreenViewerLoadDebugStatus = 'pending' | 'resolved' | 'rejected';

export interface UsdOffscreenViewerLoadDebugEntry {
  sourceFileName: string;
  step: string;
  status: UsdOffscreenViewerLoadDebugStatus;
  timestamp: number;
  durationMs?: number;
  detail?: Record<string, unknown> | null;
}

export interface UsdOffscreenViewerLoadDebugResponse {
  type: 'load-debug';
  sessionId?: UsdOffscreenViewerSessionId;
  entry: UsdOffscreenViewerLoadDebugEntry;
}

export type UsdOffscreenViewerWorkerResponse =
  | UsdOffscreenViewerProgressResponse
  | UsdOffscreenViewerDocumentLoadResponse
  | UsdOffscreenViewerRobotDataResponse
  | UsdOffscreenViewerPreparedCacheResponse
  | UsdOffscreenViewerSceneSnapshotResponse
  | UsdOffscreenViewerSelectionChangeResponse
  | UsdOffscreenViewerHoverChangeResponse
  | UsdOffscreenViewerJointAnglesChangeResponse
  | UsdOffscreenViewerCameraStateResponse
  | UsdOffscreenViewerFatalErrorResponse
  | UsdOffscreenViewerLoadDebugResponse;
