import { Matrix4, Quaternion, Vector3 } from 'three';
import type {
  InteractionHelperKind,
  InteractionSelection,
  RobotFile,
  RobotState,
  UrdfJoint,
  UrdfLink,
  UsdSceneMeshDescriptor,
  UsdSceneMaterialRecord,
  UsdSceneSnapshot,
} from '@/types';
import { getLatestUsdStageLoadDebugEntry } from './usdStageLoadDebug';

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

interface AppRegressionHandlers {
  getAvailableFiles: () => RobotFile[];
  getSelectedFile: () => RobotFile | null;
  getUsdSceneSnapshot: (fileName: string) => UsdSceneSnapshot | null;
  getDocumentLoadState: () => {
    status: string;
    fileName: string | null;
    format?: string | null;
    error?: string | null;
  };
  getRobotState: () => RobotState;
  getAssetDebugState: () => {
    appAssetKeys: string[];
    preparedUsdCacheKeysByFile: Record<string, string[]>;
  };
  getInteractionState: () => {
    selection: InteractionSelection;
    hoveredSelection: InteractionSelection;
  };
  loadRobotByName: (fileName: string) => Promise<{ loaded: boolean; selectedFile: string | null }>;
}

interface ViewerControllerSnapshot {
  jointAngles: Record<string, number>;
  activeJoint: string | null;
  toolMode: string | null;
  highlightMode: HighlightMode;
  flags: Required<RegressionViewerFlags>;
}

interface ViewerRegressionHandlers {
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

interface RuntimeJointSummary {
  name: string;
  type: string | null;
  angle: number | null;
  axis: [number, number, number] | null;
  limit: {
    lower: number | null;
    upper: number | null;
  } | null;
}

interface RuntimeLinkSummary {
  name: string;
  visualGroupCount: number;
  collisionGroupCount: number;
  visualMeshCount: number;
  collisionMeshCount: number;
  placeholderMeshCount: number;
  visiblePlaceholderMeshCount: number;
  hiddenPlaceholderMeshCount: number;
  visualPlaceholderMeshCount: number;
  visibleVisualPlaceholderMeshCount: number;
  collisionPlaceholderMeshCount: number;
  texturedVisualMeshCount: number;
}

interface RuntimeMaterialSummary {
  type: string;
  name: string | null;
  hasTexture: boolean;
  color: string | null;
  transparent: boolean;
  opacity: number | null;
}

interface RuntimeVisualMeshSummary {
  link: string;
  name: string;
  visible: boolean;
  effectiveVisible: boolean;
  isPlaceholder: boolean;
  missingMeshPath: string | null;
  materials: RuntimeMaterialSummary[];
}

interface RegressionDocumentLoadState {
  status: string;
  fileName: string | null;
  format?: string | null;
  error?: string | null;
}

interface RegressionSnapshot {
  timestamp: number;
  runtimeRevision: number;
  availableFiles: Array<{ name: string; format: string }>;
  selectedFile: { name: string; format: string } | null;
  store: ReturnType<typeof summarizeRobotState> | null;
  interaction: {
    selection: ReturnType<typeof summarizeInteractionSelection>;
    hoveredSelection: ReturnType<typeof summarizeInteractionSelection>;
  } | null;
  viewer: ViewerControllerSnapshot | null;
  runtime: ReturnType<typeof summarizeRuntimeRobot> | null;
}

interface RegressionViewerResourceScopeState {
  sourceFileName: string | null;
  sourceFilePath: string | null;
  assetKeys: string[];
  availableFileNames: string[];
  signature: string | null;
}

interface RegressionAssetDebugState {
  appAssetKeys: string[];
  preparedUsdCacheKeysByFile: Record<string, string[]>;
  viewerScopedAssetKeys: string[];
  viewerScopedAvailableFileNames: string[];
  viewerScopedSourceFileName: string | null;
  viewerScopedSourceFilePath: string | null;
  viewerScopedSignature: string | null;
}

interface RegressionUsdBindingSummary {
  descriptorCount: number;
  withDescriptorMaterialId: number;
  withGeometryMaterialId: number;
  withGeomSubsetSections: number;
  withoutAnyMaterialBinding: number;
}

interface RegressionUsdBoundsSummary {
  min: [number, number, number] | null;
  max: [number, number, number] | null;
  size: [number, number, number] | null;
  center: [number, number, number] | null;
}

interface RegressionUsdTransformSummary {
  position: [number, number, number] | null;
  quaternion: [number, number, number, number] | null;
  scale: [number, number, number] | null;
}

interface RegressionUsdBaseLinkDescriptorSummary {
  meshId: string | null;
  resolvedPrimPath: string | null;
  sectionName: string | null;
  materialId: string | null;
  geometryMaterialId: string | null;
  geomSubsetSectionCount: number;
  geomSubsetMaterialIds: string[];
}

export interface RegressionSelectedUsdSceneSummary {
  available: boolean;
  fileName: string | null;
  stageSourcePath: string | null;
  defaultPrimPath: string | null;
  rootLinkId: string | null;
  meshDescriptorCount: number;
  materialCount: number;
  bindingSummary: RegressionUsdBindingSummary;
  baseLink: {
    found: boolean;
    linkPath: string | null;
    visualDescriptorCount: number;
    collisionDescriptorCount: number;
    primPaths: string[];
    materialIds: string[];
    geometryMaterialIds: string[];
    geomSubsetMaterialIds: string[];
    geomSubsetSectionCount: number;
    bindingSummary: RegressionUsdBindingSummary;
    bounds: RegressionUsdBoundsSummary;
    transform: RegressionUsdTransformSummary | null;
    runtimeLinkTransform: RegressionUsdTransformSummary | null;
    runtimeVisualMeshTransforms: Array<{
      name: string;
      position: [number, number, number] | null;
      quaternion: [number, number, number, number] | null;
      scale: [number, number, number] | null;
    }>;
    descriptors: RegressionUsdBaseLinkDescriptorSummary[];
  };
}

interface RegressionSelectedUsdVisualMaterialSummary {
  meshes: Array<{
    meshId: string | null;
    linkPath: string | null;
    overrideColor: string | null;
    hasOverrideMaterial: boolean;
    materials: Array<{
      name: string | null;
      type: string | null;
      color: string | null;
      emissive: string | null;
    }>;
  }>;
}

export interface RegressionDebugApi {
  getAvailableFiles: () => Array<{ name: string; format: string }>;
  getRegressionSnapshot: () => RegressionSnapshot;
  getDocumentLoadState: () => RegressionDocumentLoadState | null;
  getProjectedInteractionTargets: () => RegressionProjectedInteractionTarget[];
  getAssetDebugState: () => RegressionAssetDebugState;
  getSelectedUsdSceneSummary: () => RegressionSelectedUsdSceneSummary | null;
  getSelectedUsdVisualMaterialSummary: () => RegressionSelectedUsdVisualMaterialSummary | null;
  getRuntimeSceneTransforms: () => ReturnType<typeof summarizeRuntimeSceneTransforms> | null;
  setBeforeUnloadPromptEnabled: (enabled: boolean) => { ok: boolean; enabled: boolean };
  loadRobotByName: (fileName: string) => Promise<{ loaded: boolean; snapshot: RegressionSnapshot }>;
  setViewerFlags: (flags: RegressionViewerFlags) => { ok: boolean };
  setViewerToolMode: (toolMode: string) => {
    ok: boolean;
    changed: boolean;
    activeMode: string | null;
  };
  setViewerJointAngles: (jointAngles: Record<string, number>) => { ok: boolean; changed: boolean };
}

declare global {
  interface Window {
    __URDF_STUDIO_DEBUG__?: RegressionDebugApi;
  }
}

const DEFAULT_FLAGS: Required<RegressionViewerFlags> = {
  showCollision: false,
  showCollisionAlwaysOnTop: true,
  showVisual: true,
  showCenterOfMass: false,
  showCoMOverlay: true,
  centerOfMassSize: 0.01,
  showInertia: false,
  showInertiaOverlay: true,
  showOrigins: false,
  showOriginsOverlay: true,
  originSize: 1,
  showJointAxes: false,
  showJointAxesOverlay: true,
  jointAxisSize: 1,
  highlightMode: 'link',
  modelOpacity: 1,
};

let appHandlers: AppRegressionHandlers | null = null;
let viewerHandlers: ViewerRegressionHandlers | null = null;
let viewerResourceScopeState: RegressionViewerResourceScopeState | null = null;
let runtimeRobot: any | null = null;
let runtimeRevision = 0;
let projectedInteractionTargetsProvider: (() => RegressionProjectedInteractionTarget[]) | null =
  null;
let regressionBeforeUnloadPromptSuppressed = false;
const regressionBeforeUnloadPromptListeners = new Set<(suppressed: boolean) => void>();

export function isRegressionBeforeUnloadPromptSuppressed(): boolean {
  return regressionBeforeUnloadPromptSuppressed;
}

export function subscribeRegressionBeforeUnloadPromptSuppression(
  listener: (suppressed: boolean) => void,
): () => void {
  regressionBeforeUnloadPromptListeners.add(listener);
  return () => {
    regressionBeforeUnloadPromptListeners.delete(listener);
  };
}

export function setRegressionBeforeUnloadPromptSuppressed(suppressed: boolean): void {
  if (regressionBeforeUnloadPromptSuppressed === suppressed) {
    return;
  }

  regressionBeforeUnloadPromptSuppressed = suppressed;
  regressionBeforeUnloadPromptListeners.forEach((listener) => {
    listener(suppressed);
  });
}

function toFixedArray(
  value: { x?: number; y?: number; z?: number } | [number, number, number] | undefined | null,
): [number, number, number] | null {
  if (!value) {
    return null;
  }

  if (Array.isArray(value)) {
    return [Number(value[0] ?? 0), Number(value[1] ?? 0), Number(value[2] ?? 0)];
  }

  return [Number(value.x ?? 0), Number(value.y ?? 0), Number(value.z ?? 0)];
}

function normalizeUsdDebugPath(value: string | null | undefined): string {
  const normalized = String(value || '')
    .trim()
    .replace(/[<>]/g, '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '');
  return normalized;
}

function normalizeUsdDebugPathWithLeadingSlash(value: string | null | undefined): string {
  const normalized = normalizeUsdDebugPath(value);
  return normalized ? `/${normalized}` : '';
}

function getUsdPathBasename(value: string | null | undefined): string {
  const normalized = normalizeUsdDebugPath(value);
  if (!normalized) {
    return '';
  }

  const segments = normalized.split('/').filter(Boolean);
  return segments[segments.length - 1] || '';
}

function getUsdDescriptorSectionName(descriptor: UsdSceneMeshDescriptor): string {
  return String(descriptor.sectionName || '')
    .trim()
    .toLowerCase();
}

function isUsdVisualDescriptor(descriptor: UsdSceneMeshDescriptor): boolean {
  const sectionName = getUsdDescriptorSectionName(descriptor);
  if (sectionName === 'visual' || sectionName === 'visuals') {
    return true;
  }

  const resolvedPrimPath = normalizeUsdDebugPathWithLeadingSlash(descriptor.resolvedPrimPath);
  return resolvedPrimPath.includes('/visuals/');
}

function isUsdCollisionDescriptor(descriptor: UsdSceneMeshDescriptor): boolean {
  const sectionName = getUsdDescriptorSectionName(descriptor);
  if (sectionName === 'collision' || sectionName === 'collisions') {
    return true;
  }

  const resolvedPrimPath = normalizeUsdDebugPathWithLeadingSlash(descriptor.resolvedPrimPath);
  return (
    resolvedPrimPath.includes('/collision/') ||
    resolvedPrimPath.includes('/collisions/') ||
    resolvedPrimPath.includes('/collider/') ||
    resolvedPrimPath.includes('/colliders/')
  );
}

function getUsdDescriptorMaterialIds(descriptor: UsdSceneMeshDescriptor): {
  descriptorMaterialId: string | null;
  geometryMaterialId: string | null;
  geomSubsetMaterialIds: string[];
} {
  const descriptorMaterialId = normalizeUsdDebugPathWithLeadingSlash(descriptor.materialId) || null;
  const geometryMaterialId =
    normalizeUsdDebugPathWithLeadingSlash(descriptor.geometry?.materialId) || null;
  const geomSubsetMaterialIds = Array.from(
    new Set(
      Array.isArray(descriptor.geometry?.geomSubsetSections)
        ? descriptor.geometry.geomSubsetSections
            .map((section) => normalizeUsdDebugPathWithLeadingSlash(section?.materialId))
            .filter(Boolean)
        : [],
    ),
  ).sort((left, right) => left.localeCompare(right));

  return {
    descriptorMaterialId,
    geometryMaterialId,
    geomSubsetMaterialIds,
  };
}

function getUsdDescriptorCandidatePaths(descriptor: UsdSceneMeshDescriptor): string[] {
  return [
    normalizeUsdDebugPathWithLeadingSlash(descriptor.resolvedPrimPath),
    normalizeUsdDebugPathWithLeadingSlash(descriptor.meshId),
  ].filter(Boolean);
}

function getUsdVisualDescriptorLinkPath(descriptor: UsdSceneMeshDescriptor): string | null {
  const visualPathMarkers = ['/visuals/', '/visual/', '/visuals.', '/visual.'];
  for (const candidatePath of getUsdDescriptorCandidatePaths(descriptor)) {
    for (const marker of visualPathMarkers) {
      const markerIndex = candidatePath.indexOf(marker);
      if (markerIndex > 0) {
        return candidatePath.slice(0, markerIndex);
      }
    }
  }

  return null;
}

function colorArrayToRegressionHex(
  source: ArrayLike<number> | null | undefined,
  opacityOverride?: number | null,
): string | null {
  if (!source || typeof source.length !== 'number' || source.length < 3) {
    return null;
  }

  const r = Number(source[0]);
  const g = Number(source[1]);
  const b = Number(source[2]);
  if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) {
    return null;
  }

  const to255 = (channel: number) => (Math.abs(channel) <= 1 ? channel * 255 : channel);
  const toHex = (channel: number) =>
    Math.max(0, Math.min(255, Math.round(channel)))
      .toString(16)
      .padStart(2, '0');
  const a = opacityOverride ?? (source.length >= 4 ? Number(source[3]) : null);
  const rgb = [toHex(to255(r)), toHex(to255(g)), toHex(to255(b))];

  if (a !== null && Number.isFinite(a) && a < 0.999) {
    rgb.push(toHex(to255(Number(a))));
  }

  return `#${rgb.join('')}`;
}

function summarizeRegressionUsdMaterial(
  material: UsdSceneMaterialRecord | null | undefined,
  materialId?: string | null,
): {
  name: string | null;
  type: string | null;
  color: string | null;
  emissive: string | null;
} | null {
  if (!material) {
    return null;
  }

  const name =
    String(material.name || '').trim() ||
    getUsdPathBasename(material.materialId || materialId || '') ||
    null;
  const type =
    String(material.shaderName || '').trim() ||
    String(material.shaderInfoId || '').trim() ||
    String(material.shaderPath || '').trim() ||
    null;
  const emissiveEnabled =
    material.emissiveEnabled === true
      ? true
      : material.emissiveEnabled === false
        ? false
        : material.isOmniPbr === true
          ? false
          : true;
  const color = colorArrayToRegressionHex(material.color, material.opacity);
  const emissive = emissiveEnabled ? colorArrayToRegressionHex(material.emissive) : null;

  if (!name && !type && !color && !emissive) {
    return null;
  }

  return {
    name,
    type,
    color,
    emissive,
  };
}

function summarizeUsdDescriptorBindings(
  descriptors: UsdSceneMeshDescriptor[],
): RegressionUsdBindingSummary {
  let withDescriptorMaterialId = 0;
  let withGeometryMaterialId = 0;
  let withGeomSubsetSections = 0;
  let withoutAnyMaterialBinding = 0;

  descriptors.forEach((descriptor) => {
    const { descriptorMaterialId, geometryMaterialId, geomSubsetMaterialIds } =
      getUsdDescriptorMaterialIds(descriptor);
    const hasDescriptorMaterialId = Boolean(descriptorMaterialId);
    const hasGeometryMaterialId = Boolean(geometryMaterialId);
    const hasGeomSubsetSections = geomSubsetMaterialIds.length > 0;

    if (hasDescriptorMaterialId) {
      withDescriptorMaterialId += 1;
    }
    if (hasGeometryMaterialId) {
      withGeometryMaterialId += 1;
    }
    if (hasGeomSubsetSections) {
      withGeomSubsetSections += 1;
    }
    if (!hasDescriptorMaterialId && !hasGeometryMaterialId && !hasGeomSubsetSections) {
      withoutAnyMaterialBinding += 1;
    }
  });

  return {
    descriptorCount: descriptors.length,
    withDescriptorMaterialId,
    withGeometryMaterialId,
    withGeomSubsetSections,
    withoutAnyMaterialBinding,
  };
}

function readUsdPositionBounds(
  descriptor: UsdSceneMeshDescriptor,
  snapshot: UsdSceneSnapshot,
): RegressionUsdBoundsSummary | null {
  const positionsRange = descriptor.ranges?.positions;
  const positionsBuffer = snapshot.buffers?.positions;
  if (
    !positionsRange ||
    !positionsBuffer ||
    typeof positionsRange.offset !== 'number' ||
    typeof positionsRange.count !== 'number'
  ) {
    return null;
  }

  const stride = Math.max(3, Number(positionsRange.stride) || 3);
  const offset = Math.max(0, Math.floor(Number(positionsRange.offset) || 0));
  const count = Math.max(0, Math.floor(Number(positionsRange.count) || 0));
  if (count < 3) {
    return null;
  }

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;

  for (let index = 0; index + 2 < count; index += stride) {
    const x = Number(positionsBuffer[offset + index]);
    const y = Number(positionsBuffer[offset + index + 1]);
    const z = Number(positionsBuffer[offset + index + 2]);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      continue;
    }

    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    maxZ = Math.max(maxZ, z);
  }

  if (![minX, minY, minZ, maxX, maxY, maxZ].every(Number.isFinite)) {
    return null;
  }

  const min: [number, number, number] = [minX, minY, minZ];
  const max: [number, number, number] = [maxX, maxY, maxZ];
  return {
    min,
    max,
    size: [
      Number((maxX - minX).toFixed(6)),
      Number((maxY - minY).toFixed(6)),
      Number((maxZ - minZ).toFixed(6)),
    ],
    center: [
      Number(((minX + maxX) / 2).toFixed(6)),
      Number(((minY + maxY) / 2).toFixed(6)),
      Number(((minZ + maxZ) / 2).toFixed(6)),
    ],
  };
}

function readUsdExtentBounds(
  descriptor: UsdSceneMeshDescriptor,
): RegressionUsdBoundsSummary | null {
  const extent = descriptor.extentSize;
  const values =
    Array.isArray(extent) || ArrayBuffer.isView(extent)
      ? Array.from(extent as ArrayLike<number>).slice(0, 3)
      : [];
  if (values.length < 3 || !values.every((value) => Number.isFinite(Number(value)))) {
    return null;
  }

  const half = values.map((value) => Number(value) / 2);
  return {
    min: [
      Number((-half[0]).toFixed(6)),
      Number((-half[1]).toFixed(6)),
      Number((-half[2]).toFixed(6)),
    ],
    max: [Number(half[0].toFixed(6)), Number(half[1].toFixed(6)), Number(half[2].toFixed(6))],
    size: values.map((value) => Number(Number(value).toFixed(6))) as [number, number, number],
    center: [0, 0, 0],
  };
}

function mergeUsdBoundsSummaries(
  summaries: Array<RegressionUsdBoundsSummary | null | undefined>,
): RegressionUsdBoundsSummary {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;

  summaries.forEach((summary) => {
    if (!summary?.min || !summary?.max) {
      return;
    }

    minX = Math.min(minX, Number(summary.min[0]));
    minY = Math.min(minY, Number(summary.min[1]));
    minZ = Math.min(minZ, Number(summary.min[2]));
    maxX = Math.max(maxX, Number(summary.max[0]));
    maxY = Math.max(maxY, Number(summary.max[1]));
    maxZ = Math.max(maxZ, Number(summary.max[2]));
  });

  if (![minX, minY, minZ, maxX, maxY, maxZ].every(Number.isFinite)) {
    return {
      min: null,
      max: null,
      size: null,
      center: null,
    };
  }

  return {
    min: [minX, minY, minZ],
    max: [maxX, maxY, maxZ],
    size: [
      Number((maxX - minX).toFixed(6)),
      Number((maxY - minY).toFixed(6)),
      Number((maxZ - minZ).toFixed(6)),
    ],
    center: [
      Number(((minX + maxX) / 2).toFixed(6)),
      Number(((minY + maxY) / 2).toFixed(6)),
      Number(((minZ + maxZ) / 2).toFixed(6)),
    ],
  };
}

function summarizeUsdDescriptorBounds(
  descriptor: UsdSceneMeshDescriptor,
  snapshot: UsdSceneSnapshot,
): RegressionUsdBoundsSummary | null {
  return readUsdPositionBounds(descriptor, snapshot) || readUsdExtentBounds(descriptor);
}

function summarizeUsdDescriptorTransform(
  descriptor: UsdSceneMeshDescriptor,
  snapshot: UsdSceneSnapshot,
): RegressionUsdTransformSummary | null {
  const transformRange = descriptor.ranges?.transform;
  const transformsBuffer = snapshot.buffers?.transforms;
  if (
    !transformRange ||
    !transformsBuffer ||
    typeof transformRange.offset !== 'number' ||
    typeof transformRange.count !== 'number'
  ) {
    return null;
  }

  const offset = Math.max(0, Math.floor(Number(transformRange.offset) || 0));
  const count = Math.max(0, Math.floor(Number(transformRange.count) || 0));
  if (count < 16) {
    return null;
  }

  const matrixElements = Array.from({ length: 16 }, (_, index) =>
    Number(transformsBuffer[offset + index]),
  );
  if (!matrixElements.every(Number.isFinite)) {
    return null;
  }

  const matrix = new Matrix4().fromArray(matrixElements);
  const position = new Vector3();
  const quaternion = new Quaternion();
  const scale = new Vector3();
  matrix.decompose(position, quaternion, scale);

  return {
    position: [
      Number(position.x.toFixed(6)),
      Number(position.y.toFixed(6)),
      Number(position.z.toFixed(6)),
    ],
    quaternion: [
      Number(quaternion.x.toFixed(6)),
      Number(quaternion.y.toFixed(6)),
      Number(quaternion.z.toFixed(6)),
      Number(quaternion.w.toFixed(6)),
    ],
    scale: [Number(scale.x.toFixed(6)), Number(scale.y.toFixed(6)), Number(scale.z.toFixed(6))],
  };
}

function buildRuntimeTransformSummary(
  transform:
    | {
        position: [number, number, number] | null;
        quaternion: [number, number, number, number] | null;
        scale?: [number, number, number] | null;
      }
    | null
    | undefined,
): RegressionUsdTransformSummary | null {
  if (!transform) {
    return null;
  }

  return {
    position: transform.position ?? null,
    quaternion: transform.quaternion ?? null,
    scale: transform.scale ?? null,
  };
}

function summarizeSelectedUsdScene(): RegressionSelectedUsdSceneSummary | null {
  const selectedFile = appHandlers?.getSelectedFile() ?? null;
  if (!selectedFile || selectedFile.format !== 'usd') {
    return null;
  }

  const snapshot = appHandlers?.getUsdSceneSnapshot(selectedFile.name) ?? null;
  if (!snapshot) {
    return {
      available: false,
      fileName: selectedFile.name,
      stageSourcePath: null,
      defaultPrimPath: null,
      rootLinkId: appHandlers?.getRobotState()?.rootLinkId ?? null,
      meshDescriptorCount: 0,
      materialCount: 0,
      bindingSummary: summarizeUsdDescriptorBindings([]),
      baseLink: {
        found: false,
        linkPath: null,
        visualDescriptorCount: 0,
        collisionDescriptorCount: 0,
        primPaths: [],
        materialIds: [],
        geometryMaterialIds: [],
        geomSubsetMaterialIds: [],
        geomSubsetSectionCount: 0,
        bindingSummary: summarizeUsdDescriptorBindings([]),
        bounds: { min: null, max: null, size: null, center: null },
        transform: null,
        runtimeLinkTransform: null,
        runtimeVisualMeshTransforms: [],
        descriptors: [],
      },
    };
  }

  const rootLinkId = appHandlers?.getRobotState()?.rootLinkId ?? null;
  const descriptors = Array.from(snapshot.render?.meshDescriptors || []);
  const allBindingSummary = summarizeUsdDescriptorBindings(descriptors);
  const normalizedDefaultPrimPath =
    normalizeUsdDebugPathWithLeadingSlash(snapshot.stage?.defaultPrimPath) || null;
  const rootLinkCandidates = new Set<string>();

  Array.from(snapshot.robotTree?.rootLinkPaths || []).forEach((linkPath) => {
    const normalized = normalizeUsdDebugPathWithLeadingSlash(String(linkPath || ''));
    if (!normalized) {
      return;
    }
    if (!rootLinkId || getUsdPathBasename(normalized) === rootLinkId) {
      rootLinkCandidates.add(normalized);
    }
  });

  Array.from(snapshot.robotMetadataSnapshot?.linkParentPairs || []).forEach((entry) => {
    const linkPath = Array.isArray(entry) ? entry[0] : null;
    const normalized = normalizeUsdDebugPathWithLeadingSlash(String(linkPath || ''));
    if (!normalized) {
      return;
    }
    if (!rootLinkId || getUsdPathBasename(normalized) === rootLinkId) {
      rootLinkCandidates.add(normalized);
    }
  });

  if (rootLinkId && normalizedDefaultPrimPath) {
    rootLinkCandidates.add(`${normalizedDefaultPrimPath}/${rootLinkId}`);
  }

  const baseLinkDescriptors = descriptors.filter((descriptor) => {
    const candidates = getUsdDescriptorCandidatePaths(descriptor);
    if (candidates.length === 0) {
      return false;
    }

    if (rootLinkCandidates.size > 0) {
      return candidates.some((candidate) =>
        Array.from(rootLinkCandidates).some(
          (linkPath) => candidate === linkPath || candidate.startsWith(`${linkPath}/`),
        ),
      );
    }

    if (!rootLinkId) {
      return false;
    }

    return candidates.some((candidate) => candidate.includes(`/${rootLinkId}/`));
  });

  const visualBaseLinkDescriptors = baseLinkDescriptors.filter(isUsdVisualDescriptor);
  const collisionBaseLinkDescriptors = baseLinkDescriptors.filter(isUsdCollisionDescriptor);
  const baseLinkBindingSummary = summarizeUsdDescriptorBindings(visualBaseLinkDescriptors);
  const baseLinkDescriptorSummaries = visualBaseLinkDescriptors.map((descriptor) => {
    const { descriptorMaterialId, geometryMaterialId, geomSubsetMaterialIds } =
      getUsdDescriptorMaterialIds(descriptor);
    return {
      meshId: normalizeUsdDebugPathWithLeadingSlash(descriptor.meshId) || null,
      resolvedPrimPath: normalizeUsdDebugPathWithLeadingSlash(descriptor.resolvedPrimPath) || null,
      sectionName: getUsdDescriptorSectionName(descriptor) || null,
      materialId: descriptorMaterialId,
      geometryMaterialId,
      geomSubsetSectionCount: Array.isArray(descriptor.geometry?.geomSubsetSections)
        ? descriptor.geometry.geomSubsetSections.length
        : 0,
      geomSubsetMaterialIds,
    } satisfies RegressionUsdBaseLinkDescriptorSummary;
  });
  const runtimeSceneTransforms = summarizeRuntimeSceneTransforms(runtimeRobot);
  const runtimeLinkTransform = runtimeSceneTransforms?.links.find(
    (entry) => rootLinkId && entry.name === rootLinkId,
  );
  const runtimeVisualMeshTransforms = (runtimeSceneTransforms?.visualMeshes || [])
    .filter((entry) => rootLinkId && entry.link === rootLinkId)
    .map((entry) => ({
      name: entry.name,
      position: entry.position,
      quaternion: entry.quaternion,
      scale: entry.scale ?? null,
    }));

  return {
    available: true,
    fileName: selectedFile.name,
    stageSourcePath: normalizeUsdDebugPath(snapshot.stageSourcePath) || null,
    defaultPrimPath: normalizedDefaultPrimPath,
    rootLinkId,
    meshDescriptorCount: descriptors.length,
    materialCount: Array.from(snapshot.render?.materials || []).length,
    bindingSummary: allBindingSummary,
    baseLink: {
      found:
        visualBaseLinkDescriptors.length > 0 ||
        collisionBaseLinkDescriptors.length > 0 ||
        Boolean(runtimeLinkTransform),
      linkPath:
        Array.from(rootLinkCandidates)[0] ||
        (rootLinkId && normalizedDefaultPrimPath
          ? `${normalizedDefaultPrimPath}/${rootLinkId}`
          : null),
      visualDescriptorCount: visualBaseLinkDescriptors.length,
      collisionDescriptorCount: collisionBaseLinkDescriptors.length,
      primPaths: Array.from(
        new Set(
          baseLinkDescriptorSummaries
            .map((descriptor) => descriptor.resolvedPrimPath)
            .filter((value): value is string => Boolean(value)),
        ),
      ).sort((left, right) => left.localeCompare(right)),
      materialIds: Array.from(
        new Set(
          baseLinkDescriptorSummaries
            .map((descriptor) => descriptor.materialId)
            .filter((value): value is string => Boolean(value)),
        ),
      ).sort((left, right) => left.localeCompare(right)),
      geometryMaterialIds: Array.from(
        new Set(
          baseLinkDescriptorSummaries
            .map((descriptor) => descriptor.geometryMaterialId)
            .filter((value): value is string => Boolean(value)),
        ),
      ).sort((left, right) => left.localeCompare(right)),
      geomSubsetMaterialIds: Array.from(
        new Set(
          baseLinkDescriptorSummaries.flatMap((descriptor) => descriptor.geomSubsetMaterialIds),
        ),
      ).sort((left, right) => left.localeCompare(right)),
      geomSubsetSectionCount: baseLinkDescriptorSummaries.reduce(
        (sum, descriptor) => sum + descriptor.geomSubsetSectionCount,
        0,
      ),
      bindingSummary: baseLinkBindingSummary,
      bounds: mergeUsdBoundsSummaries(
        visualBaseLinkDescriptors.map((descriptor) =>
          summarizeUsdDescriptorBounds(descriptor, snapshot),
        ),
      ),
      transform:
        visualBaseLinkDescriptors
          .map((descriptor) => summarizeUsdDescriptorTransform(descriptor, snapshot))
          .find(Boolean) ?? null,
      runtimeLinkTransform: buildRuntimeTransformSummary(runtimeLinkTransform),
      runtimeVisualMeshTransforms,
      descriptors: baseLinkDescriptorSummaries,
    },
  };
}

function summarizeSelectedUsdVisualMaterials(): RegressionSelectedUsdVisualMaterialSummary | null {
  const selectedFile = appHandlers?.getSelectedFile() ?? null;
  if (!selectedFile || selectedFile.format !== 'usd') {
    return null;
  }

  const snapshot = appHandlers?.getUsdSceneSnapshot(selectedFile.name) ?? null;
  if (!snapshot) {
    return null;
  }

  const materialLookup = new Map<string, UsdSceneMaterialRecord>();
  Array.from(snapshot.render?.materials || []).forEach((material, index) => {
    const materialId = normalizeUsdDebugPathWithLeadingSlash(material?.materialId);
    materialLookup.set(materialId || `__material-index:${index}`, material);
  });

  const meshes = Array.from(snapshot.render?.meshDescriptors || [])
    .filter(isUsdVisualDescriptor)
    .map((descriptor) => {
      const linkPath = getUsdVisualDescriptorLinkPath(descriptor);
      const { descriptorMaterialId, geometryMaterialId, geomSubsetMaterialIds } =
        getUsdDescriptorMaterialIds(descriptor);
      const materialIds = Array.from(
        new Set(
          [descriptorMaterialId, geometryMaterialId, ...geomSubsetMaterialIds].filter(
            (value): value is string => Boolean(value),
          ),
        ),
      );
      const preferredVisualMaterial = linkPath
        ? snapshot.render?.preferredVisualMaterialsByLinkPath?.[linkPath] ?? null
        : null;
      const materials = materialIds
        .map((materialId) =>
          summarizeRegressionUsdMaterial(materialLookup.get(materialId) || null, materialId),
        )
        .filter((material): material is NonNullable<typeof material> => Boolean(material));

      if (materials.length === 0 && preferredVisualMaterial) {
        const summarizedPreferredMaterial = summarizeRegressionUsdMaterial(
          preferredVisualMaterial,
          preferredVisualMaterial.materialId || null,
        );
        if (summarizedPreferredMaterial) {
          materials.push(summarizedPreferredMaterial);
        }
      }

      return {
        meshId: normalizeUsdDebugPathWithLeadingSlash(descriptor.meshId) || null,
        linkPath,
        overrideColor: null,
        hasOverrideMaterial: false,
        materials,
      };
    })
    .filter((entry) => entry.materials.length > 0);

  return meshes.length > 0 ? { meshes } : null;
}

function summarizeGeometry(geometry: UrdfLink['visual'] | UrdfLink['collision']) {
  return {
    type: geometry.type,
    meshPath: geometry.meshPath || null,
    dimensions: geometry.dimensions
      ? {
          x: Number(geometry.dimensions.x ?? 0),
          y: Number(geometry.dimensions.y ?? 0),
          z: Number(geometry.dimensions.z ?? 0),
        }
      : null,
    origin: geometry.origin
      ? {
          xyz: {
            x: Number(geometry.origin.xyz.x ?? 0),
            y: Number(geometry.origin.xyz.y ?? 0),
            z: Number(geometry.origin.xyz.z ?? 0),
          },
          rpy: {
            r: Number(geometry.origin.rpy.r ?? 0),
            p: Number(geometry.origin.rpy.p ?? 0),
            y: Number(geometry.origin.rpy.y ?? 0),
          },
        }
      : null,
    visible: geometry.visible ?? true,
  };
}

function summarizeLink(link: UrdfLink) {
  return {
    id: link.id,
    name: link.name,
    mass: Number(link.inertial?.mass ?? 0),
    centerOfMass: link.inertial?.origin
      ? {
          xyz: {
            x: Number(link.inertial.origin.xyz.x ?? 0),
            y: Number(link.inertial.origin.xyz.y ?? 0),
            z: Number(link.inertial.origin.xyz.z ?? 0),
          },
          rpy: {
            r: Number(link.inertial.origin.rpy.r ?? 0),
            p: Number(link.inertial.origin.rpy.p ?? 0),
            y: Number(link.inertial.origin.rpy.y ?? 0),
          },
        }
      : null,
    inertia: link.inertial?.inertia
      ? {
          ixx: Number(link.inertial.inertia.ixx ?? 0),
          ixy: Number(link.inertial.inertia.ixy ?? 0),
          ixz: Number(link.inertial.inertia.ixz ?? 0),
          iyy: Number(link.inertial.inertia.iyy ?? 0),
          iyz: Number(link.inertial.inertia.iyz ?? 0),
          izz: Number(link.inertial.inertia.izz ?? 0),
        }
      : null,
    visual: summarizeGeometry(link.visual),
    collision: summarizeGeometry(link.collision),
    collisionBodies: (link.collisionBodies || []).map((body, index) => ({
      index,
      geometry: summarizeGeometry(body),
    })),
  };
}

function summarizeJoint(joint: UrdfJoint) {
  return {
    id: joint.id,
    name: joint.name,
    type: joint.type,
    parentLinkId: joint.parentLinkId,
    childLinkId: joint.childLinkId,
    axis: joint.axis
      ? {
          x: Number(joint.axis.x ?? 0),
          y: Number(joint.axis.y ?? 0),
          z: Number(joint.axis.z ?? 0),
        }
      : null,
    origin: {
      xyz: {
        x: Number(joint.origin.xyz.x ?? 0),
        y: Number(joint.origin.xyz.y ?? 0),
        z: Number(joint.origin.xyz.z ?? 0),
      },
      rpy: {
        r: Number(joint.origin.rpy.r ?? 0),
        p: Number(joint.origin.rpy.p ?? 0),
        y: Number(joint.origin.rpy.y ?? 0),
      },
    },
    limit: joint.limit
      ? {
          lower: Number(joint.limit.lower ?? 0),
          upper: Number(joint.limit.upper ?? 0),
          effort: Number(joint.limit.effort ?? 0),
          velocity: Number(joint.limit.velocity ?? 0),
        }
      : null,
  };
}

function summarizeRobotState(robotState: RobotState) {
  const links = Object.values(robotState.links || {});
  const joints = Object.values(robotState.joints || {});
  return {
    name: robotState.name,
    rootLinkId: robotState.rootLinkId,
    linkCount: links.length,
    jointCount: joints.length,
    totalMass: links.reduce((sum, link) => sum + Number(link.inertial?.mass ?? 0), 0),
    links: links.map(summarizeLink),
    joints: joints.map(summarizeJoint),
  };
}

function summarizeInteractionSelection(selection: InteractionSelection | null | undefined) {
  return {
    type: selection?.type ?? null,
    id: selection?.id ?? null,
    subType: selection?.subType ?? null,
    objectIndex: selection?.objectIndex ?? null,
    helperKind: selection?.helperKind ?? null,
  };
}

function resolveRuntimeLinkName(object: any): string | null {
  if (!object) {
    return null;
  }

  if (typeof object.userData?.parentLinkName === 'string' && object.userData.parentLinkName) {
    return object.userData.parentLinkName;
  }

  let current = object;
  while (current) {
    if (current.isURDFLink && typeof current.name === 'string' && current.name) {
      return current.name;
    }
    current = current.parent;
  }

  return null;
}

function isEffectivelyVisible(object: any): boolean {
  let current = object;
  while (current) {
    if (current.visible === false) {
      return false;
    }
    current = current.parent;
  }

  return true;
}

function summarizeRuntimeRobot(robot: any) {
  if (!robot) {
    return null;
  }

  const joints = robot.joints ? Object.values(robot.joints as Record<string, any>) : [];
  const runtimeJoints: RuntimeJointSummary[] = [];
  joints.forEach((joint: any) => {
    runtimeJoints.push({
      name: typeof joint?.name === 'string' ? joint.name : '',
      type:
        typeof joint?.jointType === 'string'
          ? joint.jointType
          : typeof joint?.type === 'string'
            ? joint.type
            : null,
      angle:
        typeof joint?.angle === 'number'
          ? joint.angle
          : typeof joint?.jointValue === 'number'
            ? joint.jointValue
            : null,
      axis: toFixedArray(joint?.axis),
      limit: joint?.limit
        ? {
            lower: typeof joint.limit.lower === 'number' ? joint.limit.lower : null,
            upper: typeof joint.limit.upper === 'number' ? joint.limit.upper : null,
          }
        : null,
    });
  });

  if (typeof robot?.traverse !== 'function') {
    return {
      name: typeof robot?.name === 'string' ? robot.name : null,
      linkCount: 0,
      jointCount: runtimeJoints.length,
      visualGroupCount: 0,
      collisionGroupCount: 0,
      visualMeshCount: 0,
      collisionMeshCount: 0,
      placeholderMeshCount: 0,
      visiblePlaceholderMeshCount: 0,
      hiddenPlaceholderMeshCount: 0,
      visualPlaceholderMeshCount: 0,
      visibleVisualPlaceholderMeshCount: 0,
      collisionPlaceholderMeshCount: 0,
      texturedVisualMeshCount: 0,
      helpers: {
        centerOfMass: 0,
        inertiaBox: 0,
        originAxes: 0,
        jointAxis: 0,
      },
      links: [],
      placeholderMeshes: [],
      visualMeshes: [],
      joints: runtimeJoints.sort((a, b) => a.name.localeCompare(b.name)),
    };
  }

  const linkMap = new Map<string, RuntimeLinkSummary>();
  const placeholderMeshes: Array<{
    link: string;
    name: string;
    missingMeshPath: string | null;
    visible: boolean;
    effectiveVisible: boolean;
  }> = [];
  const visualMeshes: RuntimeVisualMeshSummary[] = [];
  const helperCounts = {
    centerOfMass: 0,
    inertiaBox: 0,
    originAxes: 0,
    jointAxis: 0,
  };

  const getOrCreateLinkSummary = (linkName: string): RuntimeLinkSummary => {
    const existing = linkMap.get(linkName);
    if (existing) {
      return existing;
    }

    const created: RuntimeLinkSummary = {
      name: linkName,
      visualGroupCount: 0,
      collisionGroupCount: 0,
      visualMeshCount: 0,
      collisionMeshCount: 0,
      placeholderMeshCount: 0,
      visiblePlaceholderMeshCount: 0,
      hiddenPlaceholderMeshCount: 0,
      visualPlaceholderMeshCount: 0,
      visibleVisualPlaceholderMeshCount: 0,
      collisionPlaceholderMeshCount: 0,
      texturedVisualMeshCount: 0,
    };
    linkMap.set(linkName, created);
    return created;
  };

  const summarizeRuntimeMaterial = (material: any): RuntimeMaterialSummary => {
    const hasTexture = Boolean(material?.map);
    const color = material?.color?.isColor ? `#${material.color.getHexString()}` : null;

    return {
      type: typeof material?.type === 'string' ? material.type : 'UnknownMaterial',
      name: typeof material?.name === 'string' && material.name.trim() ? material.name : null,
      hasTexture,
      color,
      transparent: material?.transparent === true,
      opacity: typeof material?.opacity === 'number' ? material.opacity : null,
    };
  };

  if (typeof robot.traverse === 'function') {
    robot.traverse((child: any) => {
      if (child.name === '__com_visual__') helperCounts.centerOfMass += 1;
      if (child.name === '__inertia_box__') helperCounts.inertiaBox += 1;
      if (child.name === '__origin_axes__') helperCounts.originAxes += 1;
      if (child.name === '__joint_axis__' || child.name === '__joint_axis_helper__')
        helperCounts.jointAxis += 1;

      const linkName = resolveRuntimeLinkName(child);
      if (linkName) {
        const entry = getOrCreateLinkSummary(linkName);
        const isMesh = child.isMesh === true;
        const isVisualMesh = isMesh && child.userData?.isVisualMesh === true;
        const isCollisionMesh = isMesh && child.userData?.isCollisionMesh === true;
        const isPlaceholder = isMesh && child.userData?.isPlaceholder === true;
        const effectiveVisible = isMesh ? isEffectivelyVisible(child) : false;

        if (child.userData?.isVisualGroup) entry.visualGroupCount += 1;
        if (child.userData?.isCollisionGroup || child.isURDFCollider)
          entry.collisionGroupCount += 1;
        if (isVisualMesh) entry.visualMeshCount += 1;
        if (isCollisionMesh) entry.collisionMeshCount += 1;

        if (isPlaceholder) {
          entry.placeholderMeshCount += 1;
          if (effectiveVisible) {
            entry.visiblePlaceholderMeshCount += 1;
          } else {
            entry.hiddenPlaceholderMeshCount += 1;
          }
          if (isVisualMesh) {
            entry.visualPlaceholderMeshCount += 1;
            if (effectiveVisible) {
              entry.visibleVisualPlaceholderMeshCount += 1;
            }
          }
          if (isCollisionMesh) {
            entry.collisionPlaceholderMeshCount += 1;
          }
        }

        if (isVisualMesh) {
          const materials = Array.isArray(child.material) ? child.material : [child.material];
          const summarizedMaterials = materials.map(summarizeRuntimeMaterial);
          if (summarizedMaterials.some((material) => material.hasTexture)) {
            entry.texturedVisualMeshCount += 1;
          }

          const visualMeshSummary: RuntimeVisualMeshSummary = {
            link: linkName,
            name: typeof child.name === 'string' ? child.name : '',
            visible: child.visible !== false,
            effectiveVisible,
            isPlaceholder,
            missingMeshPath:
              typeof child.userData?.missingMeshPath === 'string'
                ? child.userData.missingMeshPath
                : null,
            materials: summarizedMaterials,
          };
          visualMeshes.push(visualMeshSummary);

          if (visualMeshSummary.isPlaceholder) {
            placeholderMeshes.push({
              link: linkName,
              name: visualMeshSummary.name,
              missingMeshPath: visualMeshSummary.missingMeshPath,
              visible: visualMeshSummary.visible,
              effectiveVisible: visualMeshSummary.effectiveVisible,
            });
          }
        }
      }
    });
  }

  return {
    name: typeof robot?.name === 'string' ? robot.name : null,
    linkCount: Array.from(linkMap.values()).length,
    jointCount: runtimeJoints.length,
    visualGroupCount: Array.from(linkMap.values()).reduce(
      (sum, entry) => sum + entry.visualGroupCount,
      0,
    ),
    collisionGroupCount: Array.from(linkMap.values()).reduce(
      (sum, entry) => sum + entry.collisionGroupCount,
      0,
    ),
    visualMeshCount: Array.from(linkMap.values()).reduce(
      (sum, entry) => sum + entry.visualMeshCount,
      0,
    ),
    collisionMeshCount: Array.from(linkMap.values()).reduce(
      (sum, entry) => sum + entry.collisionMeshCount,
      0,
    ),
    placeholderMeshCount: Array.from(linkMap.values()).reduce(
      (sum, entry) => sum + entry.placeholderMeshCount,
      0,
    ),
    visiblePlaceholderMeshCount: Array.from(linkMap.values()).reduce(
      (sum, entry) => sum + entry.visiblePlaceholderMeshCount,
      0,
    ),
    hiddenPlaceholderMeshCount: Array.from(linkMap.values()).reduce(
      (sum, entry) => sum + entry.hiddenPlaceholderMeshCount,
      0,
    ),
    visualPlaceholderMeshCount: Array.from(linkMap.values()).reduce(
      (sum, entry) => sum + entry.visualPlaceholderMeshCount,
      0,
    ),
    visibleVisualPlaceholderMeshCount: Array.from(linkMap.values()).reduce(
      (sum, entry) => sum + entry.visibleVisualPlaceholderMeshCount,
      0,
    ),
    collisionPlaceholderMeshCount: Array.from(linkMap.values()).reduce(
      (sum, entry) => sum + entry.collisionPlaceholderMeshCount,
      0,
    ),
    texturedVisualMeshCount: Array.from(linkMap.values()).reduce(
      (sum, entry) => sum + entry.texturedVisualMeshCount,
      0,
    ),
    helpers: helperCounts,
    links: Array.from(linkMap.values()).sort((a, b) => a.name.localeCompare(b.name)),
    placeholderMeshes: placeholderMeshes.sort((a, b) =>
      `${a.link}:${a.name}`.localeCompare(`${b.link}:${b.name}`),
    ),
    visualMeshes: visualMeshes.sort((a, b) =>
      `${a.link}:${a.name}`.localeCompare(`${b.link}:${b.name}`),
    ),
    joints: runtimeJoints.sort((a, b) => a.name.localeCompare(b.name)),
  };
}

function summarizeRuntimeSceneTransforms(robot: any) {
  if (!robot) {
    return null;
  }

  if (typeof robot?.traverse !== 'function') {
    const joints = Object.values(robot?.joints ?? {}).map((joint: any) => ({
      name: typeof joint?.name === 'string' ? joint.name : '',
      type:
        typeof joint?.jointType === 'string'
          ? joint.jointType
          : typeof joint?.type === 'string'
            ? joint.type
            : null,
      position: null,
      quaternion: null,
      scale: null,
      axis: toFixedArray(joint?.axis),
    }));

    return {
      links: [],
      joints: joints.sort((a, b) => a.name.localeCompare(b.name)),
      visualMeshes: [],
    };
  }

  const links: Array<{
    name: string;
    position: [number, number, number] | null;
    quaternion: [number, number, number, number] | null;
    scale: [number, number, number] | null;
  }> = [];
  const joints: Array<{
    name: string;
    type: string | null;
    position: [number, number, number] | null;
    quaternion: [number, number, number, number] | null;
    scale: [number, number, number] | null;
    axis: [number, number, number] | null;
  }> = [];
  const visualMeshes: Array<{
    link: string;
    name: string;
    position: [number, number, number] | null;
    quaternion: [number, number, number, number] | null;
    scale: [number, number, number] | null;
  }> = [];

  if (typeof robot.traverse === 'function') {
    robot.updateMatrixWorld?.(true);

    robot.traverse((child: any) => {
      if (child?.isURDFLink) {
        links.push({
          name: typeof child.name === 'string' ? child.name : '',
          position: toFixedArray(child.getWorldPosition?.(new Vector3())),
          quaternion: child.getWorldQuaternion
            ? (child
                .getWorldQuaternion(new Quaternion())
                .toArray()
                .map((value: number) => Number(value.toFixed(6))) as [
                number,
                number,
                number,
                number,
              ])
            : null,
          scale: toFixedArray(child.getWorldScale?.(new Vector3())),
        });
        return;
      }

      if (child?.isURDFJoint) {
        joints.push({
          name: typeof child.name === 'string' ? child.name : '',
          type: typeof child?.jointType === 'string' ? child.jointType : null,
          position: toFixedArray(child.getWorldPosition?.(new Vector3())),
          quaternion: child.getWorldQuaternion
            ? (child
                .getWorldQuaternion(new Quaternion())
                .toArray()
                .map((value: number) => Number(value.toFixed(6))) as [
                number,
                number,
                number,
                number,
              ])
            : null,
          scale: toFixedArray(child.getWorldScale?.(new Vector3())),
          axis: toFixedArray(child.axis),
        });
        return;
      }

      if (child?.isMesh && child?.userData?.isVisualMesh) {
        const linkName = resolveRuntimeLinkName(child);
        if (!linkName) {
          return;
        }

        visualMeshes.push({
          link: linkName,
          name: typeof child.name === 'string' ? child.name : '',
          position: toFixedArray(child.getWorldPosition?.(new Vector3())),
          quaternion: child.getWorldQuaternion
            ? (child
                .getWorldQuaternion(new Quaternion())
                .toArray()
                .map((value: number) => Number(value.toFixed(6))) as [
                number,
                number,
                number,
                number,
              ])
            : null,
          scale: toFixedArray(child.getWorldScale?.(new Vector3())),
        });
      }
    });
  }

  if (joints.length === 0 && robot.joints) {
    Object.values(robot.joints as Record<string, any>).forEach((joint: any) => {
      joints.push({
        name: typeof joint?.name === 'string' ? joint.name : '',
        type:
          typeof joint?.jointType === 'string'
            ? joint.jointType
            : typeof joint?.type === 'string'
              ? joint.type
              : null,
        position: null,
        quaternion: null,
        scale: null,
        axis: toFixedArray(joint?.axis),
      });
    });
  }

  return {
    links: links.sort((a, b) => a.name.localeCompare(b.name)),
    joints: joints.sort((a, b) => a.name.localeCompare(b.name)),
    visualMeshes: visualMeshes.sort((a, b) =>
      `${a.link}:${a.name}`.localeCompare(`${b.link}:${b.name}`),
    ),
  };
}

function getAvailableFilesSummary() {
  if (!appHandlers) {
    return [];
  }

  return appHandlers.getAvailableFiles().map((file) => ({
    name: file.name,
    format: file.format,
  }));
}

export function setRegressionAppHandlers(handlers: AppRegressionHandlers | null): void {
  appHandlers = handlers;
}

export function setRegressionViewerHandlers(handlers: ViewerRegressionHandlers | null): void {
  viewerHandlers = handlers;
}

export function setRegressionViewerResourceScope(
  scope: RegressionViewerResourceScopeState | null,
): void {
  viewerResourceScopeState = scope;
}

export function setRegressionRuntimeRobot(robot: any | null): void {
  runtimeRobot = robot;
  runtimeRevision += 1;
}

export function setRegressionProjectedInteractionTargetsProvider(
  provider: (() => RegressionProjectedInteractionTarget[]) | null,
): void {
  projectedInteractionTargetsProvider = provider;
}

export function getRegressionSnapshot(): RegressionSnapshot {
  const selectedFile = appHandlers?.getSelectedFile() ?? null;
  const robotState = appHandlers?.getRobotState();
  const interactionState = appHandlers?.getInteractionState() ?? null;
  return {
    timestamp: Date.now(),
    runtimeRevision,
    availableFiles: getAvailableFilesSummary(),
    selectedFile: selectedFile ? { name: selectedFile.name, format: selectedFile.format } : null,
    store: robotState ? summarizeRobotState(robotState) : null,
    interaction: interactionState
      ? {
          selection: summarizeInteractionSelection(interactionState.selection),
          hoveredSelection: summarizeInteractionSelection(interactionState.hoveredSelection),
        }
      : null,
    viewer: viewerHandlers?.getSnapshot() ?? null,
    runtime: summarizeRuntimeRobot(runtimeRobot),
  };
}

export function installRegressionDebugApi(targetWindow: Window): void {
  const resolveAvailableFile = (fileName: string): RobotFile | null =>
    appHandlers?.getAvailableFiles().find((entry) => entry.name === fileName) ?? null;

  const hasCommittedUsdSnapshot = (fileName: string, snapshot: RegressionSnapshot): boolean => {
    const committedEntry = getLatestUsdStageLoadDebugEntry(
      targetWindow,
      fileName,
      'commit-worker-robot-data',
      'resolved',
    );
    if (!committedEntry) {
      return false;
    }

    if (snapshot.selectedFile?.name !== fileName || !snapshot.store) {
      return false;
    }

    const expectedLinkCount = Number(committedEntry.detail?.linkCount ?? Number.NaN);
    const expectedJointCount = Number(committedEntry.detail?.jointCount ?? Number.NaN);
    if (!Number.isFinite(expectedLinkCount) || !Number.isFinite(expectedJointCount)) {
      return false;
    }

    return (
      snapshot.store.linkCount === expectedLinkCount &&
      snapshot.store.jointCount === expectedJointCount
    );
  };

  const waitForStableSnapshot = async (
    fileName: string,
    timeoutMs = 180_000,
  ): Promise<RegressionSnapshot> => {
    const startedAt = Date.now();
    const isUsd = resolveAvailableFile(fileName)?.format === 'usd';

    while (Date.now() - startedAt < timeoutMs) {
      const snapshot = getRegressionSnapshot();
      const documentLoadState = appHandlers?.getDocumentLoadState() ?? null;
      const isMatchingDocumentState = documentLoadState?.fileName === fileName;
      const runtimeResolveEntry = getLatestUsdStageLoadDebugEntry(
        targetWindow,
        fileName,
        'resolve-runtime-robot-data',
        'resolved',
      );
      const hasResolvedRuntimeRobot = Boolean(
        snapshot.selectedFile?.name === fileName && snapshot.runtime,
      );
      const hasCommittedWorkerSnapshot = hasCommittedUsdSnapshot(fileName, snapshot);
      if (
        isUsd
          ? isMatchingDocumentState &&
            documentLoadState?.status === 'ready' &&
            (runtimeResolveEntry ? hasResolvedRuntimeRobot : hasCommittedWorkerSnapshot)
          : snapshot.selectedFile?.name === fileName &&
            snapshot.runtime &&
            isMatchingDocumentState &&
            documentLoadState?.status === 'ready'
      ) {
        return snapshot;
      }

      if (isUsd) {
        const loadFailedEntry = getLatestUsdStageLoadDebugEntry(
          targetWindow,
          fileName,
          'load-failed',
        );
        const commitRejectedEntry = getLatestUsdStageLoadDebugEntry(
          targetWindow,
          fileName,
          'commit-worker-robot-data',
          'rejected',
        );
        if (loadFailedEntry || commitRejectedEntry) {
          return snapshot;
        }
      } else if (isMatchingDocumentState && documentLoadState?.status === 'error') {
        return snapshot;
      }

      await new Promise((resolve) => globalThis.setTimeout(resolve, 50));
    }

    return getRegressionSnapshot();
  };

  targetWindow.__URDF_STUDIO_DEBUG__ = {
    getAvailableFiles: () => getAvailableFilesSummary(),
    getRegressionSnapshot: () => getRegressionSnapshot(),
    getDocumentLoadState: () => {
      const documentLoadState = appHandlers?.getDocumentLoadState() ?? null;
      return documentLoadState
        ? {
            status: documentLoadState.status,
            fileName: documentLoadState.fileName,
            format: documentLoadState.format ?? null,
            error: documentLoadState.error ?? null,
          }
        : null;
    },
    getProjectedInteractionTargets: () => projectedInteractionTargetsProvider?.() ?? [],
    getAssetDebugState: () => {
      const appAssetDebugState = appHandlers?.getAssetDebugState() ?? {
        appAssetKeys: [],
        preparedUsdCacheKeysByFile: {},
      };

      return {
        appAssetKeys: appAssetDebugState.appAssetKeys,
        preparedUsdCacheKeysByFile: appAssetDebugState.preparedUsdCacheKeysByFile,
        viewerScopedAssetKeys: viewerResourceScopeState?.assetKeys ?? [],
        viewerScopedAvailableFileNames: viewerResourceScopeState?.availableFileNames ?? [],
        viewerScopedSourceFileName: viewerResourceScopeState?.sourceFileName ?? null,
        viewerScopedSourceFilePath: viewerResourceScopeState?.sourceFilePath ?? null,
        viewerScopedSignature: viewerResourceScopeState?.signature ?? null,
      };
    },
    getSelectedUsdSceneSummary: () => summarizeSelectedUsdScene(),
    getSelectedUsdVisualMaterialSummary: () => summarizeSelectedUsdVisualMaterials(),
    getRuntimeSceneTransforms: () => summarizeRuntimeSceneTransforms(runtimeRobot),
    setBeforeUnloadPromptEnabled: (enabled: boolean) => {
      setRegressionBeforeUnloadPromptSuppressed(!enabled);
      return { ok: true, enabled };
    },
    loadRobotByName: async (fileName: string) => {
      if (!appHandlers) {
        throw new Error('Regression app handlers are not registered.');
      }

      setRegressionRuntimeRobot(null);
      const result = await appHandlers.loadRobotByName(fileName);
      const snapshot = result.loaded
        ? await waitForStableSnapshot(fileName)
        : getRegressionSnapshot();
      return {
        loaded: result.loaded,
        snapshot,
      };
    },
    setViewerFlags: (flags: RegressionViewerFlags) => {
      if (!viewerHandlers) {
        return { ok: false };
      }

      viewerHandlers.setFlags(flags);
      return { ok: true };
    },
    setViewerToolMode: (toolMode: string) => {
      if (!viewerHandlers) {
        return { ok: false, changed: false, activeMode: null };
      }

      const result = viewerHandlers.setToolMode(toolMode);
      return {
        ok: true,
        changed: result.changed,
        activeMode: result.activeMode,
      };
    },
    setViewerJointAngles: (jointAngles: Record<string, number>) => {
      if (!viewerHandlers) {
        return { ok: false, changed: false };
      }

      const result = viewerHandlers.setJointAngles(jointAngles);
      runtimeRobot?.updateMatrixWorld?.(true);
      runtimeRevision += 1;
      return { ok: true, changed: result.changed };
    },
  };
}
