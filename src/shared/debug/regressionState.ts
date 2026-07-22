import type {
  InteractionHelperKind,
  InteractionSelection,
  RobotFile,
  RobotState,
  UsdSceneSnapshot,
} from '@/types';
import type { RuntimeRobotObject } from '@/shared/components/3d/runtimeRobotTypes';

type HighlightMode = 'link' | 'collision';

export interface RegressionViewerFlags {
  showCollision?: boolean;
  showCollisionAlwaysOnTop?: boolean;
  showVisual?: boolean;
  showCenterOfMass?: boolean;
  showCoMOverlay?: boolean;
  centerOfMassSize?: number;
  showInertia?: boolean;
  showInertiaOverlay?: boolean;
  showOrigins?: boolean;
  showOriginsOverlay?: boolean;
  originSize?: number;
  showJointAxes?: boolean;
  showJointAxesOverlay?: boolean;
  jointAxisSize?: number;
  highlightMode?: HighlightMode;
  modelOpacity?: number;
}

export interface AppRegressionHandlers {
  getAvailableFiles: () => RobotFile[];
  getSelectedFile: () => RobotFile | null;
  getUsdSceneSnapshot: (fileName: string) => UsdSceneSnapshot | null;
  getDocumentLoadState: () => {
    status: string;
    fileName?: string | null;
    format?: string | null;
    error?: string | null;
  } | null;
  getRobotState: () =>
    | (Pick<RobotState, 'name' | 'links' | 'joints' | 'rootLinkId'> & {
        selection?: InteractionSelection;
      })
    | null;
  getInteractionState?: () => {
    selection: InteractionSelection;
    hoveredSelection: InteractionSelection;
  } | null;
  getAssetDebugState?: () => {
    appAssetKeys: string[];
    preparedUsdCacheKeysByFile: Record<string, string[]>;
  };
  resetFixtureFiles?: () => void;
  seedFixtureFile?: (file: {
    name: string;
    content: string;
    format: RobotFile['format'];
    blobUrl?: string;
    addFileContent?: boolean;
  }) => { availableFileCount: number };
  loadRobotByName: (fileName: string) => Promise<{ loaded: boolean; selectedFile?: string | null }>;
}

interface ViewerControllerSnapshot {
  jointAngles: Record<string, number>;
  activeJoint: string | null;
  toolMode: string | null;
  highlightMode: HighlightMode;
  flags: Required<RegressionViewerFlags>;
}

export interface ViewerRegressionHandlers {
  getSnapshot: () => ViewerControllerSnapshot;
  setFlags: (flags: RegressionViewerFlags) => void;
  setToolMode: (toolMode: string) => { changed: boolean; activeMode: string | null };
  setJointAngles: (jointAngles: Record<string, number>) => { changed: boolean };
}

export interface RegressionProjectedInteractionTarget {
  type: 'link' | 'joint';
  id: string;
  subType?: 'visual' | 'collision';
  objectIndex?: number;
  helperKind?: InteractionHelperKind;
  targetKind: 'geometry' | 'helper';
  sourceName: string | null;
  clientX: number;
  clientY: number;
  projectedWidth: number;
  projectedHeight: number;
  projectedArea: number;
  averageDepth: number;
}

export interface RegressionViewerResourceScopeState {
  sourceFileName: string | null;
  sourceFilePath: string | null;
  assetKeys: string[];
  availableFileNames: string[];
  signature: string | null;
}

export interface RegressionTransformGizmoSummary {
  active?: boolean;
  axis: string | null;
  clientX: number;
  clientY: number;
  kind: string;
  name: string;
  owner: string | null;
  screenRadius: number;
  visible: boolean;
  worldPosition: { x: number; y: number; z: number };
  worldRadius: number;
}

export interface RegressionJointPickOverlaySummary {
  connectorVisible: boolean | null;
  liveLinkPosition: [number, number, number] | null;
  position: [number, number, number];
  quaternion: [number, number, number, number];
  side: 'parent' | 'child';
  tracksLiveLink: boolean;
}

export interface RegressionJointPickHoverSummary {
  boundaryLoopCount: number;
  candidateCount: number;
  candidateKinds: string[];
  chosenKind: string;
  componentId: string;
  confidence: number;
  featureKind: 'surface' | 'planar' | 'cylindrical';
  linkId: string;
  recommendedKind: string;
  side: 'parent' | 'child' | null;
  triangleCount: number;
  truncated: boolean;
  valid: boolean;
}

export interface RegressionEditableSourceApplyResult {
  mode: 'incremental-patch' | 'full-parse';
  dirtyRangeCount: number;
  dirtySpanBytes: number;
  dirtySpanLimitBytes: number;
  patchKind: string | null;
  skipReason: string | null;
}

export const regressionDebugState: {
  appHandlers: AppRegressionHandlers | null;
  viewerHandlers: ViewerRegressionHandlers | null;
  viewerResourceScopeState: RegressionViewerResourceScopeState | null;
  lastEditableSourceApplyResult: RegressionEditableSourceApplyResult | null;
  runtimeRobot: RuntimeRobotObject | null;
  runtimeRevision: number;
  primaryRuntimeRobot: RuntimeRobotObject | null;
  primaryRuntimeRevision: number;
  projectedInteractionTargetsProvider: (() => RegressionProjectedInteractionTarget[]) | null;
  jointPickOverlaySummaryProviders: Set<() => RegressionJointPickOverlaySummary[]>;
  jointPickHoverSummaryProviders: Set<() => RegressionJointPickHoverSummary[]>;
  transformGizmoSummaryProviders: Set<() => RegressionTransformGizmoSummary[]>;
} = {
  appHandlers: null,
  viewerHandlers: null,
  viewerResourceScopeState: null,
  lastEditableSourceApplyResult: null,
  runtimeRobot: null,
  runtimeRevision: 0,
  primaryRuntimeRobot: null,
  primaryRuntimeRevision: 0,
  projectedInteractionTargetsProvider: null,
  jointPickOverlaySummaryProviders: new Set(),
  jointPickHoverSummaryProviders: new Set(),
  transformGizmoSummaryProviders: new Set(),
};

export function setRegressionAppHandlers(handlers: AppRegressionHandlers | null): void {
  regressionDebugState.appHandlers = handlers;
}

export function setRegressionViewerHandlers(handlers: ViewerRegressionHandlers | null): void {
  regressionDebugState.viewerHandlers = handlers;
}

export function setRegressionViewerResourceScope(
  scope: RegressionViewerResourceScopeState | null,
): void {
  regressionDebugState.viewerResourceScopeState = scope;
}

export function setRegressionEditableSourceApplyResult(
  result: RegressionEditableSourceApplyResult | null,
): void {
  regressionDebugState.lastEditableSourceApplyResult = result;
}

export function setRegressionRuntimeRobot(robot: RuntimeRobotObject | null): void {
  regressionDebugState.runtimeRobot = robot;
  regressionDebugState.runtimeRevision += 1;
}

export function setRegressionPrimaryRuntimeRobot(robot: RuntimeRobotObject | null): void {
  if (regressionDebugState.primaryRuntimeRobot === robot) {
    return;
  }

  regressionDebugState.primaryRuntimeRobot = robot;
  regressionDebugState.primaryRuntimeRevision += 1;
}

export function bumpRegressionRuntimeRevision(): void {
  regressionDebugState.runtimeRevision += 1;
}

export function setRegressionProjectedInteractionTargetsProvider(
  provider: (() => RegressionProjectedInteractionTarget[]) | null,
): void {
  regressionDebugState.projectedInteractionTargetsProvider = provider;
}

export function registerRegressionJointPickOverlaySummaryProvider(
  provider: () => RegressionJointPickOverlaySummary[],
): () => void {
  regressionDebugState.jointPickOverlaySummaryProviders.add(provider);
  return () => {
    regressionDebugState.jointPickOverlaySummaryProviders.delete(provider);
  };
}

export function getRegressionJointPickOverlaySummaries(): RegressionJointPickOverlaySummary[] {
  return Array.from(regressionDebugState.jointPickOverlaySummaryProviders).flatMap((provider) =>
    provider(),
  );
}

export function registerRegressionJointPickHoverSummaryProvider(
  provider: () => RegressionJointPickHoverSummary[],
): () => void {
  regressionDebugState.jointPickHoverSummaryProviders.add(provider);
  return () => {
    regressionDebugState.jointPickHoverSummaryProviders.delete(provider);
  };
}

export function getRegressionJointPickHoverSummaries(): RegressionJointPickHoverSummary[] {
  return Array.from(regressionDebugState.jointPickHoverSummaryProviders).flatMap((provider) =>
    provider(),
  );
}

export function registerRegressionTransformGizmoSummaryProvider(
  provider: () => RegressionTransformGizmoSummary[],
): () => void {
  regressionDebugState.transformGizmoSummaryProviders.add(provider);
  return () => {
    regressionDebugState.transformGizmoSummaryProviders.delete(provider);
  };
}

export function getRegressionTransformGizmoSummaries(): RegressionTransformGizmoSummary[] {
  return Array.from(regressionDebugState.transformGizmoSummaryProviders).flatMap((provider) =>
    provider(),
  );
}
