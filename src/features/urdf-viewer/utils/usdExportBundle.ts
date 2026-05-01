import { Color, Matrix3, Matrix4, Vector3 } from 'three';

import {
  DEFAULT_JOINT,
  DEFAULT_LINK,
  GeometryType,
  JointType,
  type RobotData,
  type RobotState,
  type UrdfJoint,
  type UrdfLink,
  type UrdfVisual,
  type UsdMeshDescriptorRanges,
  type UsdPreparedExportCache,
  type UsdMeshRange,
  type UsdSceneBuffers,
  type UsdSceneMaterialRecord,
  type UsdSceneMeshDescriptor,
  type UsdSceneSnapshot,
} from '../../../types/index.ts';
import { getVisualGeometryEntries } from '@/core/robot';
import {
  adaptUsdViewerSnapshotToRobotData,
  resolveUsdMeshApproximationGeometry,
} from './usdViewerRobotAdapter.ts';
import { resolveUsdPrimitiveGeometryFromDescriptor as resolvePrimitiveGeometryFromDescriptor } from './usdPrimitiveGeometry.ts';
import { toVirtualUsdPath } from './usdPreloadSources.ts';
import { hydrateUsdViewerRobotResolutionFromRuntime } from './usdRuntimeRobotHydration.ts';
import type { ViewerRobotDataResolution } from './viewerRobotData.ts';

type MeshRange = UsdMeshRange;
type MeshDescriptorRanges = UsdMeshDescriptorRanges;
type SnapshotMaterialRecord = UsdSceneMaterialRecord;
type SnapshotMeshDescriptor = UsdSceneMeshDescriptor;
type SnapshotBuffers = UsdSceneBuffers;
type UsdExportSnapshot = UsdSceneSnapshot;

type DescriptorRole = 'visual' | 'collision';

type SnapshotGeomSubsetSection = {
  start: number;
  length: number;
  materialId?: string | null;
};

type ExportDescriptor = {
  descriptor: SnapshotMeshDescriptor;
  meshId: string;
  linkPath: string;
  linkId: string;
  role: DescriptorRole;
  exportPath: string;
  ordinal: number;
  subsetIndex?: number;
  subsetSection?: SnapshotGeomSubsetSection | null;
  materialIdOverride?: string | null;
  displayColor?: [number, number, number] | null;
  subsetDisplayColors?: Array<{
    start: number;
    length: number;
    color: [number, number, number];
  }> | null;
  bakeTransformIntoMesh?: boolean;
};

type RobotLike = RobotData | RobotState;
const ORIGIN_EPSILON = 1e-9;
const NORMAL_EPSILON = 1e-10;
const NORMAL_REPAIR_DOT_THRESHOLD = -0.05;
const EXPORT_COLOR_PLACEHOLDERS = new Set([
  DEFAULT_LINK.visual.color.toLowerCase(),
  DEFAULT_LINK.collision.color.toLowerCase(),
  '#808080',
  '#3b82f6',
]);

export interface UsdExportBundle {
  robot: RobotState;
  meshFiles: Map<string, Blob>;
  resolution: ViewerRobotDataResolution;
}

export type PreparedUsdExportCacheResult = UsdPreparedExportCache & {
  resolution: ViewerRobotDataResolution;
};

type PreparedUsdExportCacheTransferBytesCarrier = {
  __meshFileBytes?: Record<string, Uint8Array>;
};

type SnapshotHost =
  | {
      renderInterface?: {
        getCachedRobotSceneSnapshot?: (stageSourcePath?: string | null) => unknown;
        getPreferredVisualMaterialForLink?: (
          linkPath: string,
          requestingMeshId?: string | null,
        ) => unknown;
        getPreferredLinkWorldTransform?: (linkPath: string) => unknown;
        getWorldTransformForPrimPath?: (primPath: string) => unknown;
      } | null;
    }
  | null
  | undefined;

function normalizeUsdPath(path: string | null | undefined): string {
  const normalized = String(path || '')
    .trim()
    .replace(/[<>]/g, '')
    .replace(/\\/g, '/');
  if (!normalized) return '';
  return normalized.startsWith('/') ? normalized : `/${normalized}`;
}

function getPathBasename(path: string | null | undefined): string {
  const normalized = normalizeUsdPath(path);
  if (!normalized) return '';
  const segments = normalized.split('/').filter(Boolean);
  return segments[segments.length - 1] || '';
}

function sanitizeFileToken(value: string): string {
  const normalized = String(value || '')
    .trim()
    .replace(/[^\w.-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return normalized || 'mesh';
}

function buildUsdSnapshotLookupPaths(stageSourcePath?: string | null): Array<string | null> {
  const rawStagePath = String(stageSourcePath || '')
    .trim()
    .split('?')[0];
  if (!rawStagePath) {
    return [null];
  }

  const normalizedStagePath = rawStagePath.startsWith('/')
    ? rawStagePath
    : toVirtualUsdPath(rawStagePath);

  return normalizedStagePath === rawStagePath
    ? [normalizedStagePath]
    : [normalizedStagePath, rawStagePath];
}

function normalizeSemanticToken(value: string | null | undefined): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .split('_')
    .filter(
      (token) =>
        token.length > 0 &&
        ![
          'link',
          'joint',
          'visual',
          'visuals',
          'collision',
          'collisions',
          'mesh',
          'geom',
          'geometry',
          'proto',
          'id',
          'usd',
          'xform',
          'body',
        ].includes(token),
    )
    .join('_');
}

function isGenericDescriptorName(value: string | null | undefined): boolean {
  const raw = String(value || '')
    .trim()
    .toLowerCase();
  if (!raw) return true;
  return (
    /^mesh(?:[_-]?\d+)?$/.test(raw) ||
    /^geom(?:[_-]?\d+)?$/.test(raw) ||
    /^proto(?:[_-].*)?$/.test(raw)
  );
}

function getDescriptorSemanticName(descriptor: SnapshotMeshDescriptor): string {
  const candidates = [
    getPathBasename(descriptor.resolvedPrimPath),
    getPathBasename(descriptor.meshId),
  ];

  for (const candidate of candidates) {
    if (!candidate || isGenericDescriptorName(candidate)) {
      continue;
    }
    return candidate;
  }

  return '';
}

function getDescriptorGeomSubsetSections(
  descriptor: SnapshotMeshDescriptor,
): SnapshotGeomSubsetSection[] {
  const geometry =
    descriptor.geometry && typeof descriptor.geometry === 'object'
      ? (descriptor.geometry as {
          geomSubsetSections?: Array<{
            start?: unknown;
            length?: unknown;
            materialId?: unknown;
          }> | null;
        })
      : null;
  const rawSections = Array.isArray(geometry?.geomSubsetSections)
    ? geometry.geomSubsetSections
    : [];

  return rawSections
    .map((section) => {
      const start = Number(section?.start);
      const length = Number(section?.length);
      if (!Number.isFinite(start) || !Number.isFinite(length) || length <= 0) {
        return null;
      }

      return {
        start: Math.max(0, Math.floor(start)),
        length: Math.max(0, Math.floor(length)),
        materialId: normalizeUsdPath(String(section?.materialId || '')) || null,
      } satisfies SnapshotGeomSubsetSection;
    })
    .filter(Boolean) as SnapshotGeomSubsetSection[];
}

function getDescriptorMaterialId(
  descriptor: SnapshotMeshDescriptor,
  materialIdOverride?: string | null,
): string {
  return normalizeUsdPath(
    materialIdOverride || descriptor.materialId || descriptor.geometry?.materialId || '',
  );
}

function toHexChannel(value: number): string {
  const clamped = Math.max(0, Math.min(255, Math.round(value)));
  return clamped.toString(16).padStart(2, '0');
}

function colorArrayToHex(
  value: ArrayLike<number> | null | undefined,
  opacityOverride?: number | null,
): string | null {
  const source = Array.isArray(value)
    ? value
    : value && typeof value.length === 'number'
      ? Array.from(value)
      : null;
  if (!source || source.length < 3) {
    return null;
  }

  const r = Number(source[0]);
  const g = Number(source[1]);
  const b = Number(source[2]);
  if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) {
    return null;
  }

  const to255 = (channel: number) => (Math.abs(channel) <= 1 ? channel * 255 : channel);

  const useNormalizedLinearChannels = Math.abs(r) <= 1 && Math.abs(g) <= 1 && Math.abs(b) <= 1;
  const linearColor = useNormalizedLinearChannels
    ? new Color(
        Math.max(0, Math.min(1, r)),
        Math.max(0, Math.min(1, g)),
        Math.max(0, Math.min(1, b)),
      )
    : null;

  const a = opacityOverride ?? (source.length >= 4 ? Number(source[3]) : null);
  if (a !== null && Number.isFinite(a) && a < 0.999) {
    return `#${linearColor?.getHexString() ?? `${toHexChannel(to255(r))}${toHexChannel(to255(g))}${toHexChannel(to255(b))}`}${toHexChannel(to255(a))}`;
  }

  return `#${linearColor?.getHexString() ?? `${toHexChannel(to255(r))}${toHexChannel(to255(g))}${toHexChannel(to255(b))}`}`;
}

function normalizeScalarMaterialValue(
  value: unknown,
  options: { clamp01?: boolean; min?: number } = {},
): number | null {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }

  let nextValue = numeric;
  if (typeof options.min === 'number') {
    nextValue = Math.max(options.min, nextValue);
  }
  if (options.clamp01) {
    nextValue = Math.max(0, Math.min(1, nextValue));
  }

  return nextValue;
}

function normalizeBooleanMaterialValue(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function normalizeColorMaterialValue(value: unknown): [number, number, number] | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as {
    isColor?: unknown;
    r?: unknown;
    g?: unknown;
    b?: unknown;
    length?: unknown;
  };

  if (candidate.isColor === true) {
    const r = Number(candidate.r);
    const g = Number(candidate.g);
    const b = Number(candidate.b);
    if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) {
      return [r, g, b];
    }
  }

  if (typeof candidate.length === 'number') {
    const source = Array.from(value as ArrayLike<number>);
    if (source.length >= 3) {
      const normalized = source.slice(0, 3).map((channel) => Number(channel));
      if (normalized.every((channel) => Number.isFinite(channel))) {
        return normalized as [number, number, number];
      }
    }
  }

  return null;
}

function normalizeVector2MaterialValue(value: unknown): [number, number] | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as {
    x?: unknown;
    y?: unknown;
    length?: unknown;
  };

  const x = Number(candidate.x);
  const y = Number(candidate.y);
  if (Number.isFinite(x) && Number.isFinite(y)) {
    return [x, y];
  }

  if (typeof candidate.length === 'number') {
    const source = Array.from(value as ArrayLike<number>);
    if (source.length >= 2) {
      const normalized = source.slice(0, 2).map((channel) => Number(channel));
      if (normalized.every((channel) => Number.isFinite(channel))) {
        return normalized as [number, number];
      }
    }
  }

  return null;
}

function normalizeTextureMaterialPath(value: unknown): string | null {
  if (!value) {
    return null;
  }

  if (typeof value === 'string') {
    const normalized = value.trim();
    return normalized || null;
  }

  if (typeof value !== 'object') {
    return null;
  }

  const candidate = value as {
    name?: unknown;
    userData?: {
      usdSourcePath?: unknown;
    } | null;
  };
  const normalized = String(candidate.userData?.usdSourcePath || candidate.name || '').trim();
  return normalized || null;
}

function hasSnapshotMaterialRecordContent(
  material: SnapshotMaterialRecord | null | undefined,
): boolean {
  if (!material || typeof material !== 'object') {
    return false;
  }

  return Object.values(material).some((value) => {
    if (value == null) {
      return false;
    }
    if (Array.isArray(value)) {
      return value.length > 0;
    }
    if (ArrayBuffer.isView(value)) {
      return value.byteLength > 0;
    }
    if (typeof value === 'string') {
      return value.trim().length > 0;
    }
    return true;
  });
}

function resolveSnapshotMaterialColorHex(
  material: SnapshotMaterialRecord | null | undefined,
): string | null {
  const authoredColor = colorArrayToHex(material?.color, material?.opacity);
  if (authoredColor) {
    return authoredColor;
  }

  const opacity = normalizeScalarMaterialValue(material?.opacity, { clamp01: true });
  const hasPrimaryTexture = Boolean(
    normalizeTextureMaterialPath(material?.mapPath) ||
    normalizeTextureMaterialPath(material?.alphaMapPath),
  );

  if (hasPrimaryTexture && opacity !== null && opacity < 0.999) {
    return colorArrayToHex([1, 1, 1], opacity);
  }

  return null;
}

function colorArrayToVertexColor(
  value: ArrayLike<number> | null | undefined,
): [number, number, number] | null {
  const source = Array.isArray(value)
    ? value
    : value && typeof value.length === 'number'
      ? Array.from(value)
      : null;
  if (!source || source.length < 3) {
    return null;
  }

  const channels = source.slice(0, 3).map((channel) => Number(channel));
  if (channels.some((channel) => !Number.isFinite(channel))) {
    return null;
  }

  const normalizeChannel = (channel: number) =>
    Math.abs(channel) <= 1
      ? Math.max(0, Math.min(1, channel))
      : Math.max(0, Math.min(1, channel / 255));

  return [
    normalizeChannel(channels[0]),
    normalizeChannel(channels[1]),
    normalizeChannel(channels[2]),
  ];
}

function colorHexToVertexColor(value: string | null | undefined): [number, number, number] | null {
  const normalized = String(value || '').trim();
  if (!/^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(normalized)) {
    return null;
  }

  const color = new Color(normalized);
  return [color.r, color.g, color.b];
}

function shouldAdoptSnapshotColor(color: string | null | undefined): boolean {
  const normalized = String(color || '')
    .trim()
    .toLowerCase();
  if (!normalized) {
    return true;
  }

  return EXPORT_COLOR_PLACEHOLDERS.has(normalized);
}

function getDescriptorLinkPath(descriptor: SnapshotMeshDescriptor): string {
  const meshId = normalizeUsdPath(descriptor.meshId || '');
  if (meshId) {
    const markerIndex = meshId.indexOf('.proto_');
    if (markerIndex > 0) {
      let linkPath = meshId.slice(0, markerIndex);
      if (
        linkPath.endsWith('/visuals') ||
        linkPath.endsWith('/collisions') ||
        linkPath.endsWith('/colliders')
      ) {
        const parentSlash = linkPath.lastIndexOf('/');
        if (parentSlash > 0) {
          linkPath = linkPath.slice(0, parentSlash);
        }
      }
      if (linkPath) {
        return linkPath;
      }
    }
  }

  const candidates = [descriptor.resolvedPrimPath, descriptor.meshId];
  for (const candidate of candidates) {
    const normalized = normalizeUsdPath(candidate || '');
    if (!normalized) continue;

    const authoredPathMatch = normalized.match(
      /^(.*?)(?:\/(?:visuals?|coll(?:isions?|iders?)))(?:$|[/.])/i,
    );
    if (authoredPathMatch?.[1]) {
      return normalizeUsdPath(authoredPathMatch[1]);
    }
  }

  return '';
}

function getDescriptorRole(descriptor: SnapshotMeshDescriptor): DescriptorRole {
  const sectionName = String(descriptor.sectionName || '')
    .trim()
    .toLowerCase();
  if (sectionName === 'collisions' || sectionName === 'collision') {
    return 'collision';
  }

  const candidateText =
    `${descriptor.meshId || ''} ${descriptor.resolvedPrimPath || ''}`.toLowerCase();
  return /\/coll(?:isions?|iders?)(?:$|[/.])/.test(candidateText) ? 'collision' : 'visual';
}

function parseDescriptorOrdinal(descriptor: SnapshotMeshDescriptor, fallbackIndex: number): number {
  const meshId = String(descriptor.meshId || '');
  const match = meshId.match(/(?:\.proto_(?:mesh|[a-z]+)_id)(\d+)$/i);
  if (match) {
    const numeric = Number(match[1]);
    if (Number.isInteger(numeric) && numeric >= 0) {
      return numeric;
    }
  }

  return fallbackIndex;
}

function getDescriptorRanges(
  descriptor: SnapshotMeshDescriptor,
  buffers: SnapshotBuffers | null | undefined,
): MeshDescriptorRanges | null {
  if (descriptor.ranges) {
    return descriptor.ranges;
  }

  const meshId = normalizeUsdPath(descriptor.meshId || '');
  if (!meshId) return null;
  return buffers?.rangesByMeshId?.[meshId] || null;
}

function readRangeValues(
  source: ArrayLike<number> | null | undefined,
  range: MeshRange | null | undefined,
): number[] {
  if (!source || !range) return [];
  const offset = Math.max(0, Number(range.offset || 0));
  const count = Math.max(0, Number(range.count || 0));
  if (count <= 0) return [];
  return Array.from({ length: count }, (_, index) => Number(source[offset + index] || 0));
}

function hasSnapshotBufferValues(value: ArrayLike<number> | null | undefined): boolean {
  if (!value) {
    return false;
  }

  if (ArrayBuffer.isView(value)) {
    return value.byteLength > 0;
  }

  if (Array.isArray(value)) {
    return value.length > 0;
  }

  return typeof value.length === 'number' && Number(value.length) > 0;
}

function formatObjNumber(value: number): string {
  const normalized = Math.abs(value) < 1e-9 ? 0 : value;
  const fixed = Number(normalized.toFixed(6));
  return Number.isInteger(fixed) ? String(fixed) : String(fixed);
}

function hasNonIdentityOrigin(
  origin: Pick<NonNullable<UrdfVisual['origin']>, 'xyz' | 'rpy'> | null | undefined,
): boolean {
  if (!origin) {
    return false;
  }

  return (
    Math.abs(origin.xyz?.x || 0) > 1e-9 ||
    Math.abs(origin.xyz?.y || 0) > 1e-9 ||
    Math.abs(origin.xyz?.z || 0) > 1e-9 ||
    Math.abs(origin.rpy?.r || 0) > 1e-9 ||
    Math.abs(origin.rpy?.p || 0) > 1e-9 ||
    Math.abs(origin.rpy?.y || 0) > 1e-9
  );
}

function cloneVisualOrigin(
  origin: NonNullable<UrdfVisual['origin']> | null | undefined,
): NonNullable<UrdfVisual['origin']> {
  return {
    xyz: {
      x: origin?.xyz?.x || 0,
      y: origin?.xyz?.y || 0,
      z: origin?.xyz?.z || 0,
    },
    rpy: {
      r: origin?.rpy?.r || 0,
      p: origin?.rpy?.p || 0,
      y: origin?.rpy?.y || 0,
    },
  };
}

function cloneAuthoredMaterials(
  authoredMaterials: UrdfVisual['authoredMaterials'],
): UrdfVisual['authoredMaterials'] {
  return Array.isArray(authoredMaterials)
    ? authoredMaterials.map((material) => ({ ...material }))
    : undefined;
}

function cloneMeshMaterialGroups(
  meshMaterialGroups: UrdfVisual['meshMaterialGroups'],
): UrdfVisual['meshMaterialGroups'] {
  return Array.isArray(meshMaterialGroups)
    ? meshMaterialGroups.map((group) => ({ ...group }))
    : undefined;
}

function resolveMergedVisualMaterialMetadata(
  current: UrdfVisual | undefined,
  fallback?: UrdfVisual,
): Pick<UrdfVisual, 'authoredMaterials' | 'meshMaterialGroups' | 'materialSource'> {
  const authoredMaterials =
    current?.authoredMaterials !== undefined
      ? current.authoredMaterials
      : cloneAuthoredMaterials(fallback?.authoredMaterials);
  const meshMaterialGroups =
    current?.meshMaterialGroups !== undefined
      ? current.meshMaterialGroups
      : cloneMeshMaterialGroups(fallback?.meshMaterialGroups);
  const materialSource = current?.materialSource ?? fallback?.materialSource;

  return {
    ...(authoredMaterials !== undefined ? { authoredMaterials } : {}),
    ...(meshMaterialGroups !== undefined ? { meshMaterialGroups } : {}),
    ...(materialSource !== undefined ? { materialSource } : {}),
  };
}

function resolveMergedVisualColor(
  current: UrdfVisual | undefined,
  fallback?: UrdfVisual,
): string | undefined {
  const currentColor = current?.color?.trim() || undefined;
  const fallbackColor = fallback?.color?.trim() || undefined;
  if (fallbackColor && shouldAdoptSnapshotColor(currentColor)) {
    return fallbackColor;
  }
  return currentColor;
}

function resolveMergedVisualMaterialFields(
  current: UrdfVisual | undefined,
  fallback?: UrdfVisual,
): Pick<UrdfVisual, 'authoredMaterials' | 'meshMaterialGroups' | 'materialSource'> &
  Partial<Pick<UrdfVisual, 'color'>> {
  const color = resolveMergedVisualColor(current, fallback);
  return {
    ...resolveMergedVisualMaterialMetadata(current, fallback),
    ...(color !== undefined ? { color } : {}),
  };
}

function mergeRobotMaterials(
  current: RobotLike['materials'],
  fallback: RobotLike['materials'],
): RobotLike['materials'] {
  if (!current && !fallback) {
    return undefined;
  }

  const merged: NonNullable<RobotLike['materials']> = {};
  const materialKeys = new Set([...Object.keys(fallback || {}), ...Object.keys(current || {})]);

  materialKeys.forEach((key) => {
    const currentMaterial = current?.[key];
    const fallbackMaterial = fallback?.[key];
    const color =
      fallbackMaterial?.color && shouldAdoptSnapshotMaterialColor(currentMaterial?.color)
        ? fallbackMaterial.color
        : currentMaterial?.color || fallbackMaterial?.color;
    const texture = currentMaterial?.texture || fallbackMaterial?.texture;
    const usdMaterial = currentMaterial?.usdMaterial || fallbackMaterial?.usdMaterial;
    const colorRgba = currentMaterial?.colorRgba || fallbackMaterial?.colorRgba;

    merged[key] = {
      ...(fallbackMaterial || {}),
      ...(currentMaterial || {}),
      ...(color ? { color } : {}),
      ...(colorRgba ? { colorRgba } : {}),
      ...(texture ? { texture } : {}),
      ...(usdMaterial ? { usdMaterial } : {}),
    };
  });

  return merged;
}

function originsApproximatelyEqual(
  left: NonNullable<UrdfVisual['origin']> | null | undefined,
  right: NonNullable<UrdfVisual['origin']> | null | undefined,
): boolean {
  if (!left || !right) {
    return false;
  }

  return (
    Math.abs((left.xyz?.x || 0) - (right.xyz?.x || 0)) <= ORIGIN_EPSILON &&
    Math.abs((left.xyz?.y || 0) - (right.xyz?.y || 0)) <= ORIGIN_EPSILON &&
    Math.abs((left.xyz?.z || 0) - (right.xyz?.z || 0)) <= ORIGIN_EPSILON &&
    Math.abs((left.rpy?.r || 0) - (right.rpy?.r || 0)) <= ORIGIN_EPSILON &&
    Math.abs((left.rpy?.p || 0) - (right.rpy?.p || 0)) <= ORIGIN_EPSILON &&
    Math.abs((left.rpy?.y || 0) - (right.rpy?.y || 0)) <= ORIGIN_EPSILON
  );
}

function stripSyntheticMeshApproximationOrigin(
  geometry: UrdfVisual | null | undefined,
  descriptor: SnapshotMeshDescriptor,
  snapshot: UsdExportSnapshot,
): UrdfVisual | null | undefined {
  if (!geometry?.origin || geometry.type === GeometryType.NONE) {
    return geometry;
  }

  if (resolvePrimitiveGeometryFromDescriptor(descriptor, geometry)) {
    return geometry;
  }

  const approximation = resolveUsdMeshApproximationGeometry(snapshot, descriptor);
  if (!approximation?.origin || !originsApproximatelyEqual(geometry.origin, approximation.origin)) {
    return geometry;
  }

  return {
    ...geometry,
    origin: {
      xyz: { x: 0, y: 0, z: 0 },
      rpy: { r: 0, p: 0, y: 0 },
    },
  };
}

function buildObjBlobFromDescriptor(
  descriptor: ExportDescriptor,
  buffers: SnapshotBuffers | null | undefined,
): { blob: Blob; bytes: Uint8Array } | null {
  const ranges = getDescriptorRanges(descriptor.descriptor, buffers);
  const positionValues = readRangeValues(buffers?.positions, ranges?.positions);
  if (positionValues.length < 9) {
    return null;
  }

  const indexValues = readRangeValues(buffers?.indices, ranges?.indices).map((value) =>
    Number(value),
  );
  const normalValues = readRangeValues(buffers?.normals, ranges?.normals);
  const uvValues = readRangeValues(buffers?.uvs, ranges?.uvs);
  const transformValues = readRangeValues(buffers?.transforms, ranges?.transform);

  const transform =
    transformValues.length >= 16 ? new Matrix4().fromArray(transformValues.slice(0, 16)) : null;
  const shouldBakeTransform = descriptor.bakeTransformIntoMesh !== false;
  const normalMatrix =
    transform && shouldBakeTransform ? new Matrix3().getNormalMatrix(transform) : null;
  const tempVector = new Vector3();

  const lines: string[] = [
    `o ${sanitizeFileToken(`${descriptor.linkId}_${descriptor.role}_${descriptor.ordinal}`)}`,
  ];

  const vertexCount = Math.floor(positionValues.length / 3);
  const fullTriangleIndices =
    indexValues.length >= 3
      ? indexValues
      : Array.from({ length: vertexCount }, (_, index) => index);
  const subsetStart = descriptor.subsetSection
    ? Math.max(0, Math.min(fullTriangleIndices.length, descriptor.subsetSection.start))
    : 0;
  const subsetEnd = descriptor.subsetSection
    ? Math.max(
        subsetStart,
        Math.min(fullTriangleIndices.length, subsetStart + descriptor.subsetSection.length),
      )
    : fullTriangleIndices.length;
  const triangleIndices = descriptor.subsetSection
    ? (() => {
        const sliced = fullTriangleIndices.slice(subsetStart, subsetEnd);
        return sliced.length >= 3 ? sliced : [];
      })()
    : fullTriangleIndices;
  const vertexColorByIndex = new Map<number, [number, number, number]>();
  (descriptor.subsetDisplayColors || []).forEach((section) => {
    const start = Math.max(0, Math.min(fullTriangleIndices.length, Math.floor(section.start)));
    const end = Math.max(
      start,
      Math.min(fullTriangleIndices.length, start + Math.floor(section.length)),
    );
    for (let faceVertexIndex = start; faceVertexIndex < end; faceVertexIndex += 1) {
      const vertexIndex = Number(fullTriangleIndices[faceVertexIndex]);
      if (!Number.isInteger(vertexIndex) || vertexIndex < 0) {
        continue;
      }
      if (!vertexColorByIndex.has(vertexIndex)) {
        vertexColorByIndex.set(vertexIndex, section.color);
      }
    }
  });
  const defaultVertexColor = descriptor.displayColor || null;

  for (let index = 0; index + 2 < positionValues.length; index += 3) {
    tempVector.set(positionValues[index], positionValues[index + 1], positionValues[index + 2]);
    if (transform && shouldBakeTransform) {
      tempVector.applyMatrix4(transform);
    }
    const vertexColor = vertexColorByIndex.get(index / 3) || defaultVertexColor;
    lines.push(
      vertexColor
        ? `v ${formatObjNumber(tempVector.x)} ${formatObjNumber(tempVector.y)} ${formatObjNumber(tempVector.z)} ${formatObjNumber(vertexColor[0])} ${formatObjNumber(vertexColor[1])} ${formatObjNumber(vertexColor[2])}`
        : `v ${formatObjNumber(tempVector.x)} ${formatObjNumber(tempVector.y)} ${formatObjNumber(tempVector.z)}`,
    );
  }
  const uvStride = Math.max(1, Number(ranges?.uvs?.stride || 2));
  const uvCount = Math.floor(uvValues.length / uvStride);
  const hasIndexedUvs = uvCount >= vertexCount;
  const hasFaceVaryingUvs = indexValues.length >= 3 && uvCount === fullTriangleIndices.length;
  const hasPerVertexUvs = hasIndexedUvs && !hasFaceVaryingUvs;
  const normalStride = Math.max(1, Number(ranges?.normals?.stride || 3));
  const normalCount = Math.floor(normalValues.length / normalStride);
  const hasIndexedNormals = normalCount >= vertexCount;
  const hasFaceVaryingNormals =
    indexValues.length >= 3 && normalCount === fullTriangleIndices.length;
  const hasPerVertexNormals = hasIndexedNormals && !hasFaceVaryingNormals;
  const positionA = new Vector3();
  const positionB = new Vector3();
  const positionC = new Vector3();
  const edgeA = new Vector3();
  const edgeB = new Vector3();
  const faceNormal = new Vector3();
  const authoredNormalA = new Vector3();
  const authoredNormalB = new Vector3();
  const authoredNormalC = new Vector3();
  const averagedAuthoredNormal = new Vector3();

  const readPositionVector = (vertexIndex: number, target: Vector3): boolean => {
    const offset = vertexIndex * 3;
    if (offset < 0 || offset + 2 >= positionValues.length) {
      return false;
    }
    target.set(positionValues[offset], positionValues[offset + 1], positionValues[offset + 2]);
    if (transform && shouldBakeTransform) {
      target.applyMatrix4(transform);
    }
    return Number.isFinite(target.x) && Number.isFinite(target.y) && Number.isFinite(target.z);
  };

  const computeFaceNormal = (
    vertexIndexA: number,
    vertexIndexB: number,
    vertexIndexC: number,
    target: Vector3,
  ): boolean => {
    if (
      !readPositionVector(vertexIndexA, positionA) ||
      !readPositionVector(vertexIndexB, positionB) ||
      !readPositionVector(vertexIndexC, positionC)
    ) {
      return false;
    }
    edgeA.subVectors(positionB, positionA);
    edgeB.subVectors(positionC, positionA);
    target.crossVectors(edgeA, edgeB);
    if (target.lengthSq() <= NORMAL_EPSILON) {
      return false;
    }
    target.normalize();
    return true;
  };

  const readAuthoredNormalVector = (
    faceVertexIndex: number,
    vertexIndex: number,
    target: Vector3,
  ): boolean => {
    let offset = -1;
    if (hasFaceVaryingNormals) {
      offset = faceVertexIndex * normalStride;
    } else if (hasPerVertexNormals) {
      offset = vertexIndex * normalStride;
    }
    if (offset < 0 || offset + 2 >= normalValues.length) {
      return false;
    }
    target.set(
      normalValues[offset] || 0,
      normalValues[offset + 1] || 0,
      normalValues[offset + 2] || 0,
    );
    if (normalMatrix) {
      target.applyMatrix3(normalMatrix);
    }
    if (
      !Number.isFinite(target.x) ||
      !Number.isFinite(target.y) ||
      !Number.isFinite(target.z) ||
      target.lengthSq() <= NORMAL_EPSILON
    ) {
      return false;
    }
    target.normalize();
    return true;
  };

  const doesAuthoredNormalOpposeFace = (
    faceVertexIndex: number,
    vertexIndexA: number,
    vertexIndexB: number,
    vertexIndexC: number,
  ): boolean => {
    if (!computeFaceNormal(vertexIndexA, vertexIndexB, vertexIndexC, faceNormal)) {
      return false;
    }
    const hasNormalA = readAuthoredNormalVector(faceVertexIndex, vertexIndexA, authoredNormalA);
    const hasNormalB = readAuthoredNormalVector(faceVertexIndex + 1, vertexIndexB, authoredNormalB);
    const hasNormalC = readAuthoredNormalVector(faceVertexIndex + 2, vertexIndexC, authoredNormalC);
    if (!hasNormalA || !hasNormalB || !hasNormalC) {
      return true;
    }
    averagedAuthoredNormal
      .copy(authoredNormalA)
      .add(authoredNormalB)
      .add(authoredNormalC);
    if (averagedAuthoredNormal.lengthSq() <= NORMAL_EPSILON) {
      return true;
    }
    averagedAuthoredNormal.normalize();
    return averagedAuthoredNormal.dot(faceNormal) < NORMAL_REPAIR_DOT_THRESHOLD;
  };

  const shouldWriteRepairedFaceVaryingNormals =
    (hasFaceVaryingNormals || hasPerVertexNormals) &&
    (() => {
      for (let index = 0; index + 2 < triangleIndices.length; index += 3) {
        const a = Number(triangleIndices[index]);
        const b = Number(triangleIndices[index + 1]);
        const c = Number(triangleIndices[index + 2]);
        if (!Number.isInteger(a) || !Number.isInteger(b) || !Number.isInteger(c)) {
          continue;
        }
        if (doesAuthoredNormalOpposeFace(subsetStart + index, a, b, c)) {
          return true;
        }
      }
      return false;
    })();
  const writesFaceVaryingNormals = shouldWriteRepairedFaceVaryingNormals || hasFaceVaryingNormals;
  const pushObjNormalLine = (normal: Vector3): void => {
    lines.push(
      `vn ${formatObjNumber(normal.x)} ${formatObjNumber(normal.y)} ${formatObjNumber(normal.z)}`,
    );
  };

  if (hasFaceVaryingUvs) {
    for (let uvIndex = subsetStart; uvIndex < subsetEnd; uvIndex += 1) {
      const offset = uvIndex * uvStride;
      lines.push(
        `vt ${formatObjNumber(uvValues[offset] || 0)} ${formatObjNumber(uvValues[offset + 1] || 0)}`,
      );
    }
  } else if (hasPerVertexUvs) {
    for (let vertexIndex = 0; vertexIndex < vertexCount; vertexIndex += 1) {
      const offset = vertexIndex * uvStride;
      lines.push(
        `vt ${formatObjNumber(uvValues[offset] || 0)} ${formatObjNumber(uvValues[offset + 1] || 0)}`,
      );
    }
  }

  if (shouldWriteRepairedFaceVaryingNormals) {
    for (let index = 0; index + 2 < triangleIndices.length; index += 3) {
      const a = Number(triangleIndices[index]);
      const b = Number(triangleIndices[index + 1]);
      const c = Number(triangleIndices[index + 2]);
      const globalFaceVertexIndex = subsetStart + index;
      const hasComputedFaceNormal = computeFaceNormal(a, b, c, faceNormal);
      const hasNormalA = readAuthoredNormalVector(globalFaceVertexIndex, a, authoredNormalA);
      const hasNormalB = readAuthoredNormalVector(globalFaceVertexIndex + 1, b, authoredNormalB);
      const hasNormalC = readAuthoredNormalVector(globalFaceVertexIndex + 2, c, authoredNormalC);
      let useComputedFaceNormal =
        hasComputedFaceNormal && (!hasNormalA || !hasNormalB || !hasNormalC);

      if (!useComputedFaceNormal && hasComputedFaceNormal) {
        averagedAuthoredNormal
          .copy(authoredNormalA)
          .add(authoredNormalB)
          .add(authoredNormalC);
        useComputedFaceNormal =
          averagedAuthoredNormal.lengthSq() <= NORMAL_EPSILON ||
          averagedAuthoredNormal.normalize().dot(faceNormal) < NORMAL_REPAIR_DOT_THRESHOLD;
      }

      if (useComputedFaceNormal) {
        pushObjNormalLine(faceNormal);
        pushObjNormalLine(faceNormal);
        pushObjNormalLine(faceNormal);
        continue;
      }

      const fallbackNormal = hasComputedFaceNormal ? faceNormal : tempVector.set(0, 0, 1);
      pushObjNormalLine(hasNormalA ? authoredNormalA : fallbackNormal);
      pushObjNormalLine(hasNormalB ? authoredNormalB : fallbackNormal);
      pushObjNormalLine(hasNormalC ? authoredNormalC : fallbackNormal);
    }
  } else if (hasFaceVaryingNormals) {
    for (let normalIndex = subsetStart; normalIndex < subsetEnd; normalIndex += 1) {
      const offset = normalIndex * normalStride;
      tempVector.set(
        normalValues[offset] || 0,
        normalValues[offset + 1] || 0,
        normalValues[offset + 2] || 0,
      );
      if (normalMatrix) {
        tempVector.applyMatrix3(normalMatrix).normalize();
      }
      pushObjNormalLine(tempVector);
    }
  } else if (hasPerVertexNormals) {
    for (let vertexIndex = 0; vertexIndex < vertexCount; vertexIndex += 1) {
      const offset = vertexIndex * normalStride;
      tempVector.set(
        normalValues[offset] || 0,
        normalValues[offset + 1] || 0,
        normalValues[offset + 2] || 0,
      );
      if (normalMatrix) {
        tempVector.applyMatrix3(normalMatrix).normalize();
      }
      pushObjNormalLine(tempVector);
    }
  }

  const formatObjFaceVertex = (
    vertexIndex: number,
    uvIndex: number | null,
    normalIndex: number | null,
  ): string => {
    if (uvIndex !== null && normalIndex !== null) {
      return `${vertexIndex}/${uvIndex}/${normalIndex}`;
    }
    if (uvIndex !== null) {
      return `${vertexIndex}/${uvIndex}`;
    }
    if (normalIndex !== null) {
      return `${vertexIndex}//${normalIndex}`;
    }
    return String(vertexIndex);
  };

  for (let index = 0; index + 2 < triangleIndices.length; index += 3) {
    const a = Number(triangleIndices[index]) + 1;
    const b = Number(triangleIndices[index + 1]) + 1;
    const c = Number(triangleIndices[index + 2]) + 1;
    if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(c)) {
      continue;
    }
    const uvIndexes = hasFaceVaryingUvs
      ? [index + 1, index + 2, index + 3]
      : hasPerVertexUvs
        ? [a, b, c]
        : [null, null, null];
    const normalIndexes = writesFaceVaryingNormals
      ? [index + 1, index + 2, index + 3]
      : hasPerVertexNormals
        ? [a, b, c]
        : [null, null, null];
    lines.push(
      `f ${formatObjFaceVertex(a, uvIndexes[0], normalIndexes[0])} ${formatObjFaceVertex(
        b,
        uvIndexes[1],
        normalIndexes[1],
      )} ${formatObjFaceVertex(c, uvIndexes[2], normalIndexes[2])}`,
    );
  }

  if (!lines.some((line) => line.startsWith('f '))) {
    return null;
  }

  const objText = `${lines.join('\n')}\n`;
  const bytes = new TextEncoder().encode(objText);

  return {
    blob: new Blob([objText], { type: 'text/plain;charset=utf-8' }),
    bytes,
  };
}

function cloneRobotState(input: RobotLike): RobotState {
  const cloned = structuredClone(input) as RobotLike;
  return {
    ...cloned,
    selection:
      'selection' in cloned
        ? { ...(cloned.selection || { type: null, id: null }) }
        : { type: null, id: null },
  };
}

function dimensionsApproximatelyEqual(
  left: UrdfVisual['dimensions'] | null | undefined,
  right: UrdfVisual['dimensions'] | null | undefined,
): boolean {
  if (!left || !right) {
    return false;
  }

  return (
    Math.abs((left.x || 0) - (right.x || 0)) <= ORIGIN_EPSILON &&
    Math.abs((left.y || 0) - (right.y || 0)) <= ORIGIN_EPSILON &&
    Math.abs((left.z || 0) - (right.z || 0)) <= ORIGIN_EPSILON
  );
}

function canReuseFallbackMeshPath(current: UrdfVisual, fallback?: UrdfVisual): boolean {
  if (!fallback || current.type !== GeometryType.MESH || fallback.type !== GeometryType.MESH) {
    return false;
  }

  return (
    dimensionsApproximatelyEqual(current.dimensions, fallback.dimensions) &&
    originsApproximatelyEqual(current.origin, fallback.origin)
  );
}

function fillMeshPath(current: UrdfVisual, fallback?: UrdfVisual): UrdfVisual {
  const preservedMaterialMetadata = resolveMergedVisualMaterialFields(current, fallback);
  if (current.type !== GeometryType.MESH) {
    return {
      ...current,
      ...preservedMaterialMetadata,
    };
  }

  if (current.meshPath || !fallback?.meshPath || !canReuseFallbackMeshPath(current, fallback)) {
    return {
      ...current,
      ...preservedMaterialMetadata,
    };
  }

  return {
    ...current,
    ...preservedMaterialMetadata,
    meshPath: fallback.meshPath,
  };
}

function mergeGeometryWithSnapshot(
  current: UrdfVisual | undefined,
  fallback?: UrdfVisual,
): UrdfVisual | undefined {
  if (!current) {
    return fallback;
  }

  if (!fallback) {
    return current;
  }

  return fillMeshPath(current, fallback);
}

function mergeLinkWithSnapshotMeshPaths(current: UrdfLink, fallback?: UrdfLink): UrdfLink {
  if (!fallback) {
    return current;
  }

  const fallbackBodies = fallback.collisionBodies || [];
  const currentBodies = current.collisionBodies || [];
  const usedFallbackBodyIndexes = new Set<number>();
  const resolveFallbackBody = (
    currentBody: UrdfVisual,
    bodyIndex: number,
  ): UrdfVisual | undefined => {
    const indexedFallbackBody = fallbackBodies[bodyIndex];
    if (
      indexedFallbackBody &&
      !usedFallbackBodyIndexes.has(bodyIndex) &&
      canReuseFallbackMeshPath(currentBody, indexedFallbackBody)
    ) {
      usedFallbackBodyIndexes.add(bodyIndex);
      return indexedFallbackBody;
    }

    for (let index = 0; index < fallbackBodies.length; index += 1) {
      if (usedFallbackBodyIndexes.has(index)) {
        continue;
      }

      const candidate = fallbackBodies[index];
      if (!canReuseFallbackMeshPath(currentBody, candidate)) {
        continue;
      }

      usedFallbackBodyIndexes.add(index);
      return candidate;
    }

    return undefined;
  };

  // Keep the live robot as source of truth for geometry existence. Snapshot fallback
  // may only supplement missing meshPath on already-existing geometry records.
  const mergedBodies =
    currentBodies.length > 0
      ? currentBodies
          .map((currentBody, index) =>
            mergeGeometryWithSnapshot(currentBody, resolveFallbackBody(currentBody, index)),
          )
          .filter((body): body is UrdfVisual => Boolean(body))
      : current.collisionBodies;

  return {
    ...fallback,
    ...current,
    visual: mergeGeometryWithSnapshot(current.visual, fallback.visual) || current.visual,
    collision:
      mergeGeometryWithSnapshot(current.collision, fallback.collision) || current.collision,
    collisionBodies: mergedBodies,
  };
}

function mergeGeometryWithPreparedCache(
  current: UrdfVisual | undefined,
  fallback?: UrdfVisual,
): UrdfVisual | undefined {
  if (!current) {
    return fallback;
  }

  if (!fallback) {
    return current;
  }

  if (current.type === GeometryType.NONE && fallback.type !== GeometryType.NONE) {
    return fallback;
  }

  if (current.type !== GeometryType.MESH || fallback.type !== GeometryType.MESH) {
    return current;
  }

  return {
    ...fallback,
    ...current,
    ...resolveMergedVisualMaterialFields(current, fallback),
    meshPath: current.meshPath || fallback.meshPath,
  };
}

function mergeLinkWithPreparedCacheGeometry(current: UrdfLink, fallback?: UrdfLink): UrdfLink {
  if (!fallback) {
    return current;
  }

  const fallbackBodies = fallback.collisionBodies || [];
  const currentBodies = current.collisionBodies || [];
  const mergedBodies =
    currentBodies.length > 0
      ? currentBodies
          .map((currentBody, index) =>
            mergeGeometryWithPreparedCache(currentBody, fallbackBodies[index]),
          )
          .filter((body): body is UrdfVisual => Boolean(body))
      : fallback.collisionBodies;

  return {
    ...fallback,
    ...current,
    visual:
      mergeGeometryWithPreparedCache(current.visual, fallback.visual) ||
      current.visual ||
      fallback.visual,
    collision:
      mergeGeometryWithPreparedCache(current.collision, fallback.collision) ||
      current.collision ||
      fallback.collision,
    collisionBodies: mergedBodies,
  };
}

function mergeCurrentRobotWithPreparedCacheGeometry(
  currentRobot: RobotLike,
  preparedRobot: RobotState,
): RobotState {
  const baseRobot = cloneRobotState(currentRobot);
  const mergedLinks: Record<string, UrdfLink> = {};
  const linkIds = new Set([...Object.keys(preparedRobot.links), ...Object.keys(baseRobot.links)]);

  linkIds.forEach((linkId) => {
    const currentLink = baseRobot.links[linkId];
    const preparedLink = preparedRobot.links[linkId];
    if (currentLink && preparedLink) {
      mergedLinks[linkId] = mergeLinkWithPreparedCacheGeometry(currentLink, preparedLink);
      return;
    }
    mergedLinks[linkId] = currentLink || preparedLink;
  });

  return {
    ...preparedRobot,
    ...baseRobot,
    rootLinkId:
      preparedRobot.rootLinkId && mergedLinks[preparedRobot.rootLinkId]
        ? preparedRobot.rootLinkId
        : baseRobot.rootLinkId,
    links: mergedLinks,
    joints: {
      ...preparedRobot.joints,
      ...baseRobot.joints,
    },
    materials: mergeRobotMaterials(baseRobot.materials, preparedRobot.materials),
    closedLoopConstraints: baseRobot.closedLoopConstraints || preparedRobot.closedLoopConstraints,
    selection:
      'selection' in currentRobot
        ? { ...((currentRobot as RobotState).selection || { type: null, id: null }) }
        : { type: null, id: null },
  };
}

function mergeCurrentRobotWithSnapshotMeshPaths(
  currentRobot: RobotLike,
  snapshotRobot: RobotState,
): RobotState {
  const baseRobot = cloneRobotState(currentRobot);
  const mergedLinks: Record<string, UrdfLink> = {};
  const linkIds = new Set([...Object.keys(snapshotRobot.links), ...Object.keys(baseRobot.links)]);

  linkIds.forEach((linkId) => {
    const currentLink = baseRobot.links[linkId];
    const snapshotLink = snapshotRobot.links[linkId];
    if (currentLink && snapshotLink) {
      mergedLinks[linkId] = mergeLinkWithSnapshotMeshPaths(currentLink, snapshotLink);
      return;
    }
    mergedLinks[linkId] = currentLink || snapshotLink;
  });

  return {
    ...snapshotRobot,
    ...baseRobot,
    rootLinkId:
      snapshotRobot.rootLinkId && mergedLinks[snapshotRobot.rootLinkId]
        ? snapshotRobot.rootLinkId
        : baseRobot.rootLinkId,
    links: mergedLinks,
    joints: {
      ...snapshotRobot.joints,
      ...baseRobot.joints,
    },
    materials: mergeRobotMaterials(baseRobot.materials, snapshotRobot.materials),
    closedLoopConstraints: baseRobot.closedLoopConstraints || snapshotRobot.closedLoopConstraints,
    selection:
      'selection' in currentRobot
        ? { ...((currentRobot as RobotState).selection || { type: null, id: null }) }
        : { type: null, id: null },
  };
}

function isSyntheticWorldLink(link: UrdfLink | undefined): boolean {
  if (!link) {
    return false;
  }

  return (
    getVisualGeometryEntries(link).length === 0 &&
    link.collision.type === GeometryType.NONE &&
    (link.inertial?.mass || 0) <= 1e-9
  );
}

function stripSyntheticWorldRootForExport(robot: RobotState): RobotState {
  if (robot.rootLinkId !== 'world' || !isSyntheticWorldLink(robot.links.world)) {
    return robot;
  }

  const worldChildJoints = Object.values(robot.joints).filter(
    (joint) => joint.parentLinkId === 'world',
  );
  if (worldChildJoints.length !== 1) {
    return robot;
  }

  const rootAnchorJoint = worldChildJoints[0];
  if (rootAnchorJoint.type !== JointType.FIXED || !robot.links[rootAnchorJoint.childLinkId]) {
    return robot;
  }

  if (hasNonIdentityOrigin(rootAnchorJoint.origin)) {
    return robot;
  }

  const nextLinks = { ...robot.links };
  delete nextLinks.world;

  const nextJoints = { ...robot.joints };
  delete nextJoints[rootAnchorJoint.id];

  return {
    ...robot,
    rootLinkId: rootAnchorJoint.childLinkId,
    links: nextLinks,
    joints: nextJoints,
  };
}

export function resolveUsdExportResolution(
  snapshot: UsdExportSnapshot,
  options: {
    fileName?: string;
    resolution?: ViewerRobotDataResolution | null;
    targetWindow?: SnapshotHost;
  } = {},
): ViewerRobotDataResolution | null {
  if (options.resolution) {
    return options.resolution;
  }

  const initialResolution = adaptUsdViewerSnapshotToRobotData(snapshot, {
    fileName: options.fileName,
  });
  if (!initialResolution) {
    return null;
  }

  const host =
    options.targetWindow ?? (typeof window !== 'undefined' ? (window as SnapshotHost) : null);
  const hydratedResolution = hydrateUsdViewerRobotResolutionFromRuntime(
    initialResolution,
    snapshot,
    host?.renderInterface,
  );

  return hydratedResolution || initialResolution;
}

export function canPrepareUsdExportCacheFromSnapshot(
  snapshot: UsdExportSnapshot | null | undefined,
): boolean {
  if (!snapshot || typeof snapshot !== 'object') {
    return false;
  }

  const descriptors = Array.from(snapshot.render?.meshDescriptors || []);
  if (descriptors.length === 0) {
    return true;
  }

  const bufferBackedDescriptors = descriptors.filter(
    (descriptor) => !resolvePrimitiveGeometryFromDescriptor(descriptor, null),
  );
  if (bufferBackedDescriptors.length === 0) {
    return true;
  }

  if (!hasSnapshotBufferValues(snapshot.buffers?.positions)) {
    return false;
  }

  return bufferBackedDescriptors.some((descriptor) =>
    Boolean(getDescriptorRanges(descriptor, snapshot.buffers || null)?.positions),
  );
}

function ensureMeshDimensions(
  dimensions: UrdfVisual['dimensions'] | null | undefined,
): UrdfVisual['dimensions'] {
  if (!dimensions) {
    return { x: 1, y: 1, z: 1 };
  }

  const values = [dimensions.x, dimensions.y, dimensions.z];
  const hasMeaningfulDimension = values.some(
    (value) => Number.isFinite(value) && Math.abs(value) > 1e-9,
  );
  return hasMeaningfulDimension ? dimensions : { x: 1, y: 1, z: 1 };
}

function getSnapshotMaterialLookup(
  snapshot: UsdExportSnapshot,
): Map<string, SnapshotMaterialRecord> {
  const lookup = new Map<string, SnapshotMaterialRecord>();
  const materials = Array.from(snapshot.render?.materials || []);

  materials.forEach((material) => {
    const keys = [
      normalizeUsdPath(material.materialId || ''),
      normalizeUsdPath(material.name || ''),
    ].filter(Boolean);

    keys.forEach((key) => {
      if (!lookup.has(key)) {
        lookup.set(key, material);
      }
    });
  });

  return lookup;
}

function getSnapshotPreferredVisualMaterialLookup(
  snapshot: UsdExportSnapshot,
): Map<string, SnapshotMaterialRecord> {
  const lookup = new Map<string, SnapshotMaterialRecord>();
  const rawLookup = snapshot.render?.preferredVisualMaterialsByLinkPath;
  if (!rawLookup || typeof rawLookup !== 'object') {
    return lookup;
  }

  Object.entries(rawLookup).forEach(([linkPath, record]) => {
    const normalizedLinkPath = normalizeUsdPath(linkPath);
    if (!normalizedLinkPath || !record || typeof record !== 'object') {
      return;
    }
    lookup.set(normalizedLinkPath, record);
  });

  return lookup;
}

function serializeLivePreferredMaterialRecord(material: unknown): SnapshotMaterialRecord | null {
  if (!material || typeof material !== 'object') {
    return null;
  }

  const candidate = material as Record<string, unknown>;
  const name = String(candidate.name || '').trim();
  const record: SnapshotMaterialRecord = {
    ...(name ? { name } : {}),
    ...(normalizeBooleanMaterialValue(candidate.opacityEnabled) !== null
      ? { opacityEnabled: normalizeBooleanMaterialValue(candidate.opacityEnabled) }
      : {}),
    ...(normalizeBooleanMaterialValue(candidate.opacityTextureEnabled) !== null
      ? { opacityTextureEnabled: normalizeBooleanMaterialValue(candidate.opacityTextureEnabled) }
      : {}),
    ...(normalizeBooleanMaterialValue(candidate.emissiveEnabled) !== null
      ? { emissiveEnabled: normalizeBooleanMaterialValue(candidate.emissiveEnabled) }
      : {}),
    ...(normalizeColorMaterialValue(candidate.color)
      ? { color: normalizeColorMaterialValue(candidate.color) }
      : {}),
    ...(normalizeColorMaterialValue(candidate.emissive)
      ? { emissive: normalizeColorMaterialValue(candidate.emissive) }
      : {}),
    ...(normalizeColorMaterialValue(candidate.specularColor)
      ? { specularColor: normalizeColorMaterialValue(candidate.specularColor) }
      : {}),
    ...(normalizeColorMaterialValue(candidate.attenuationColor)
      ? { attenuationColor: normalizeColorMaterialValue(candidate.attenuationColor) }
      : {}),
    ...(normalizeColorMaterialValue(candidate.sheenColor)
      ? { sheenColor: normalizeColorMaterialValue(candidate.sheenColor) }
      : {}),
    ...(normalizeVector2MaterialValue(candidate.normalScale)
      ? { normalScale: normalizeVector2MaterialValue(candidate.normalScale) }
      : {}),
    ...(normalizeVector2MaterialValue(candidate.clearcoatNormalScale)
      ? { clearcoatNormalScale: normalizeVector2MaterialValue(candidate.clearcoatNormalScale) }
      : {}),
    ...(normalizeScalarMaterialValue(candidate.roughness, { clamp01: true }) !== null
      ? { roughness: normalizeScalarMaterialValue(candidate.roughness, { clamp01: true }) }
      : {}),
    ...(normalizeScalarMaterialValue(candidate.metalness, { clamp01: true }) !== null
      ? { metalness: normalizeScalarMaterialValue(candidate.metalness, { clamp01: true }) }
      : {}),
    ...(normalizeScalarMaterialValue(candidate.opacity, { clamp01: true }) !== null
      ? { opacity: normalizeScalarMaterialValue(candidate.opacity, { clamp01: true }) }
      : {}),
    ...(normalizeScalarMaterialValue(candidate.alphaTest, { clamp01: true }) !== null
      ? { alphaTest: normalizeScalarMaterialValue(candidate.alphaTest, { clamp01: true }) }
      : {}),
    ...(normalizeScalarMaterialValue(candidate.clearcoat, { clamp01: true }) !== null
      ? { clearcoat: normalizeScalarMaterialValue(candidate.clearcoat, { clamp01: true }) }
      : {}),
    ...(normalizeScalarMaterialValue(candidate.clearcoatRoughness, { clamp01: true }) !== null
      ? {
          clearcoatRoughness: normalizeScalarMaterialValue(candidate.clearcoatRoughness, {
            clamp01: true,
          }),
        }
      : {}),
    ...(normalizeScalarMaterialValue(candidate.specularIntensity, { clamp01: true }) !== null
      ? {
          specularIntensity: normalizeScalarMaterialValue(candidate.specularIntensity, {
            clamp01: true,
          }),
        }
      : {}),
    ...(normalizeScalarMaterialValue(candidate.transmission, { clamp01: true }) !== null
      ? { transmission: normalizeScalarMaterialValue(candidate.transmission, { clamp01: true }) }
      : {}),
    ...(normalizeScalarMaterialValue(candidate.thickness, { min: 0 }) !== null
      ? { thickness: normalizeScalarMaterialValue(candidate.thickness, { min: 0 }) }
      : {}),
    ...(normalizeScalarMaterialValue(candidate.attenuationDistance, { min: 0 }) !== null
      ? {
          attenuationDistance: normalizeScalarMaterialValue(candidate.attenuationDistance, {
            min: 0,
          }),
        }
      : {}),
    ...(normalizeScalarMaterialValue(candidate.aoMapIntensity, { clamp01: true }) !== null
      ? {
          aoMapIntensity: normalizeScalarMaterialValue(candidate.aoMapIntensity, { clamp01: true }),
        }
      : {}),
    ...(normalizeScalarMaterialValue(candidate.sheen, { clamp01: true }) !== null
      ? { sheen: normalizeScalarMaterialValue(candidate.sheen, { clamp01: true }) }
      : {}),
    ...(normalizeScalarMaterialValue(candidate.sheenRoughness, { clamp01: true }) !== null
      ? {
          sheenRoughness: normalizeScalarMaterialValue(candidate.sheenRoughness, { clamp01: true }),
        }
      : {}),
    ...(normalizeScalarMaterialValue(candidate.iridescence, { clamp01: true }) !== null
      ? { iridescence: normalizeScalarMaterialValue(candidate.iridescence, { clamp01: true }) }
      : {}),
    ...(normalizeScalarMaterialValue(candidate.iridescenceIOR, { min: 1 }) !== null
      ? { iridescenceIOR: normalizeScalarMaterialValue(candidate.iridescenceIOR, { min: 1 }) }
      : {}),
    ...(normalizeScalarMaterialValue(candidate.anisotropy, { clamp01: true }) !== null
      ? { anisotropy: normalizeScalarMaterialValue(candidate.anisotropy, { clamp01: true }) }
      : {}),
    ...(normalizeScalarMaterialValue(candidate.anisotropyRotation) !== null
      ? { anisotropyRotation: normalizeScalarMaterialValue(candidate.anisotropyRotation) }
      : {}),
    ...(normalizeScalarMaterialValue(candidate.emissiveIntensity, { min: 0 }) !== null
      ? { emissiveIntensity: normalizeScalarMaterialValue(candidate.emissiveIntensity, { min: 0 }) }
      : {}),
    ...(normalizeScalarMaterialValue(candidate.ior, { min: 1 }) !== null
      ? { ior: normalizeScalarMaterialValue(candidate.ior, { min: 1 }) }
      : {}),
    ...(normalizeTextureMaterialPath(candidate.map)
      ? { mapPath: normalizeTextureMaterialPath(candidate.map) }
      : {}),
    ...(normalizeTextureMaterialPath(candidate.emissiveMap)
      ? { emissiveMapPath: normalizeTextureMaterialPath(candidate.emissiveMap) }
      : {}),
    ...(normalizeTextureMaterialPath(candidate.roughnessMap)
      ? { roughnessMapPath: normalizeTextureMaterialPath(candidate.roughnessMap) }
      : {}),
    ...(normalizeTextureMaterialPath(candidate.metalnessMap)
      ? { metalnessMapPath: normalizeTextureMaterialPath(candidate.metalnessMap) }
      : {}),
    ...(normalizeTextureMaterialPath(candidate.normalMap)
      ? { normalMapPath: normalizeTextureMaterialPath(candidate.normalMap) }
      : {}),
    ...(normalizeTextureMaterialPath(candidate.aoMap)
      ? { aoMapPath: normalizeTextureMaterialPath(candidate.aoMap) }
      : {}),
    ...(normalizeTextureMaterialPath(candidate.alphaMap)
      ? { alphaMapPath: normalizeTextureMaterialPath(candidate.alphaMap) }
      : {}),
    ...(normalizeTextureMaterialPath(candidate.clearcoatMap)
      ? { clearcoatMapPath: normalizeTextureMaterialPath(candidate.clearcoatMap) }
      : {}),
    ...(normalizeTextureMaterialPath(candidate.clearcoatRoughnessMap)
      ? { clearcoatRoughnessMapPath: normalizeTextureMaterialPath(candidate.clearcoatRoughnessMap) }
      : {}),
    ...(normalizeTextureMaterialPath(candidate.clearcoatNormalMap)
      ? { clearcoatNormalMapPath: normalizeTextureMaterialPath(candidate.clearcoatNormalMap) }
      : {}),
    ...(normalizeTextureMaterialPath(candidate.specularColorMap)
      ? { specularColorMapPath: normalizeTextureMaterialPath(candidate.specularColorMap) }
      : {}),
    ...(normalizeTextureMaterialPath(candidate.specularIntensityMap)
      ? { specularIntensityMapPath: normalizeTextureMaterialPath(candidate.specularIntensityMap) }
      : {}),
    ...(normalizeTextureMaterialPath(candidate.transmissionMap)
      ? { transmissionMapPath: normalizeTextureMaterialPath(candidate.transmissionMap) }
      : {}),
    ...(normalizeTextureMaterialPath(candidate.thicknessMap)
      ? { thicknessMapPath: normalizeTextureMaterialPath(candidate.thicknessMap) }
      : {}),
    ...(normalizeTextureMaterialPath(candidate.sheenColorMap)
      ? { sheenColorMapPath: normalizeTextureMaterialPath(candidate.sheenColorMap) }
      : {}),
    ...(normalizeTextureMaterialPath(candidate.sheenRoughnessMap)
      ? { sheenRoughnessMapPath: normalizeTextureMaterialPath(candidate.sheenRoughnessMap) }
      : {}),
    ...(normalizeTextureMaterialPath(candidate.anisotropyMap)
      ? { anisotropyMapPath: normalizeTextureMaterialPath(candidate.anisotropyMap) }
      : {}),
    ...(normalizeTextureMaterialPath(candidate.iridescenceMap)
      ? { iridescenceMapPath: normalizeTextureMaterialPath(candidate.iridescenceMap) }
      : {}),
    ...(normalizeTextureMaterialPath(candidate.iridescenceThicknessMap)
      ? {
          iridescenceThicknessMapPath: normalizeTextureMaterialPath(
            candidate.iridescenceThicknessMap,
          ),
        }
      : {}),
  };

  if (!hasSnapshotMaterialRecordContent(record)) {
    return null;
  }

  return record;
}

function enrichSnapshotWithLivePreferredMaterials(
  snapshot: UsdExportSnapshot,
  host: SnapshotHost,
): UsdExportSnapshot {
  const renderInterface = host?.renderInterface;
  if (typeof renderInterface?.getPreferredVisualMaterialForLink !== 'function') {
    return snapshot;
  }

  const preferredByLinkPath: Record<string, SnapshotMaterialRecord> = {
    ...(snapshot.render?.preferredVisualMaterialsByLinkPath || {}),
  };
  let changed = false;

  Array.from(snapshot.render?.meshDescriptors || []).forEach((descriptor) => {
    if (getDescriptorRole(descriptor) !== 'visual') {
      return;
    }

    const linkPath = normalizeUsdPath(getDescriptorLinkPath(descriptor));
    if (!linkPath) {
      return;
    }

    const liveRecord = serializeLivePreferredMaterialRecord(
      renderInterface.getPreferredVisualMaterialForLink(linkPath, null),
    );
    if (!liveRecord) {
      return;
    }

    preferredByLinkPath[linkPath] = liveRecord;
    changed = true;
  });

  if (!changed) {
    return snapshot;
  }

  return {
    ...snapshot,
    render: {
      ...(snapshot.render || {}),
      preferredVisualMaterialsByLinkPath: preferredByLinkPath,
    },
  };
}

function shouldAdoptSnapshotMaterialColor(color: string | null | undefined): boolean {
  return shouldAdoptSnapshotColor(color) || String(color || '').trim().length === 0;
}

function mergeLinkMaterial(
  robot: RobotState,
  linkId: string,
  payload: {
    color?: string;
    texture?: string;
    usdMaterial?: SnapshotMaterialRecord | null;
  },
): void {
  if (
    !payload.color &&
    !payload.texture &&
    !hasSnapshotMaterialRecordContent(payload.usdMaterial)
  ) {
    return;
  }

  const current = robot.materials?.[linkId] || {};
  const nextColor =
    payload.color && shouldAdoptSnapshotMaterialColor(current.color)
      ? payload.color
      : current.color;
  const nextTexture = payload.texture || current.texture;
  const nextUsdMaterial = hasSnapshotMaterialRecordContent(payload.usdMaterial)
    ? structuredClone(payload.usdMaterial)
    : current.usdMaterial;

  if (!nextColor && !nextTexture && !hasSnapshotMaterialRecordContent(nextUsdMaterial)) {
    return;
  }

  robot.materials = {
    ...(robot.materials || {}),
    [linkId]: {
      ...(current || {}),
      ...(nextColor ? { color: nextColor } : {}),
      ...(nextTexture ? { texture: nextTexture } : {}),
      ...(hasSnapshotMaterialRecordContent(nextUsdMaterial)
        ? { usdMaterial: nextUsdMaterial }
        : {}),
    },
  };
}

function applySnapshotMaterialRecordToLink(
  robot: RobotState,
  linkId: string,
  material: SnapshotMaterialRecord | null | undefined,
): boolean {
  if (!hasSnapshotMaterialRecordContent(material)) {
    return false;
  }

  const color = resolveSnapshotMaterialColorHex(material);
  const texture = material?.mapPath ? String(material.mapPath).trim() || undefined : undefined;

  const link = robot.links[linkId];
  if (!link) {
    return false;
  }

  if (color && shouldAdoptSnapshotColor(link.visual.color)) {
    link.visual = {
      ...link.visual,
      color,
      materialSource: 'named',
    };
  }

  mergeLinkMaterial(robot, linkId, {
    ...(color ? { color } : {}),
    ...(texture ? { texture } : {}),
    usdMaterial: material,
  });

  return true;
}

function applyVisualMaterialFallbackToLink(
  robot: RobotState,
  linkId: string,
  material:
    | {
        color?: string;
        texture?: string;
      }
    | null
    | undefined,
): boolean {
  const color = material?.color?.trim() || undefined;
  const texture = material?.texture?.trim() || undefined;
  if (!color && !texture) {
    return false;
  }

  const link = robot.links[linkId];
  if (!link) {
    return false;
  }

  if (color && shouldAdoptSnapshotColor(link.visual.color)) {
    link.visual = {
      ...link.visual,
      color,
      materialSource: 'named',
    };
  }

  mergeLinkMaterial(robot, linkId, {
    ...(color ? { color } : {}),
    ...(texture ? { texture } : {}),
  });

  return true;
}

function resolveGeometryMaterialFallback(
  geometry: UrdfVisual | null | undefined,
  preferredIndex: number,
): {
  color?: string;
  texture?: string;
} | null {
  if (!geometry) {
    return null;
  }

  const authoredMaterials = Array.isArray(geometry.authoredMaterials)
    ? geometry.authoredMaterials
    : [];
  const authoredCandidate =
    authoredMaterials[preferredIndex] ||
    (authoredMaterials.length === 1 ? authoredMaterials[0] : null) ||
    authoredMaterials.find((material) => Boolean(material?.color || material?.texture)) ||
    null;
  const authoredColor = authoredCandidate?.color?.trim() || undefined;
  const authoredTexture = authoredCandidate?.texture?.trim() || undefined;
  const directColor = geometry.color?.trim() || undefined;
  const usableDirectColor =
    directColor && !shouldAdoptSnapshotColor(directColor) ? directColor : undefined;

  if (authoredColor || authoredTexture) {
    return {
      ...(authoredColor ? { color: authoredColor } : {}),
      ...(authoredTexture ? { texture: authoredTexture } : {}),
    };
  }

  if (usableDirectColor) {
    return { color: usableDirectColor };
  }

  return null;
}

function resolveVisualMaterialFallbackForDescriptor(
  sourceLink: UrdfLink | undefined,
  descriptor: ExportDescriptor,
  visualDescriptorIndex: number,
): {
  color?: string;
  texture?: string;
} | null {
  if (!sourceLink) {
    return null;
  }

  const authoredMaterialIndex = Number.isFinite(descriptor.subsetIndex)
    ? Math.max(0, Number(descriptor.subsetIndex))
    : visualDescriptorIndex;

  if (descriptor.subsetSection) {
    const primarySubsetMaterial = resolveGeometryMaterialFallback(
      sourceLink.visual,
      authoredMaterialIndex,
    );
    if (primarySubsetMaterial) {
      return primarySubsetMaterial;
    }
  }

  if (!descriptor.subsetSection && visualDescriptorIndex > 0) {
    const bodyMaterial = resolveGeometryMaterialFallback(
      sourceLink.visualBodies?.[visualDescriptorIndex - 1],
      authoredMaterialIndex,
    );
    if (bodyMaterial) {
      return bodyMaterial;
    }
  }

  return resolveGeometryMaterialFallback(sourceLink.visual, authoredMaterialIndex);
}

function getDescriptorMaterialRecord(
  descriptor: Pick<ExportDescriptor, 'descriptor' | 'materialIdOverride'> | SnapshotMeshDescriptor,
  materialLookup: Map<string, SnapshotMaterialRecord>,
): SnapshotMaterialRecord | null {
  const sourceDescriptor = 'descriptor' in descriptor ? descriptor.descriptor : descriptor;
  const materialIdOverride =
    'materialIdOverride' in descriptor ? descriptor.materialIdOverride : null;
  const materialId = getDescriptorMaterialId(sourceDescriptor, materialIdOverride);
  if (!materialId) {
    return null;
  }

  return materialLookup.get(materialId) || null;
}

function applyDescriptorMaterialToLink(
  robot: RobotState,
  linkId: string,
  descriptor: ExportDescriptor,
  materialLookup: Map<string, SnapshotMaterialRecord>,
): boolean {
  const material = getDescriptorMaterialRecord(descriptor, materialLookup);
  if (!material) {
    return false;
  }

  return applySnapshotMaterialRecordToLink(robot, linkId, material);
}

function buildGeomSubsetMaterialGroups(
  descriptor: SnapshotMeshDescriptor,
  visual: UrdfVisual | undefined,
): UrdfVisual['meshMaterialGroups'] {
  const authoredMaterials = Array.isArray(visual?.authoredMaterials)
    ? visual.authoredMaterials
    : [];
  if (authoredMaterials.length <= 1) {
    return undefined;
  }

  const geomSubsetSections = getDescriptorGeomSubsetSections(descriptor);
  if (geomSubsetSections.length === 0) {
    return undefined;
  }

  return geomSubsetSections.map((section, index) => ({
    meshKey: '0',
    start: section.start,
    count: section.length,
    materialIndex: Math.min(index, authoredMaterials.length - 1),
  }));
}

function buildGeomSubsetDisplayColors(
  descriptor: SnapshotMeshDescriptor,
  visual: UrdfVisual | undefined,
): ExportDescriptor['subsetDisplayColors'] {
  const authoredMaterials = Array.isArray(visual?.authoredMaterials)
    ? visual.authoredMaterials
    : [];
  if (authoredMaterials.length === 0) {
    return undefined;
  }

  const geomSubsetSections = getDescriptorGeomSubsetSections(descriptor);
  if (geomSubsetSections.length === 0) {
    return undefined;
  }

  const fallbackColor = colorHexToVertexColor(visual?.color);
  const subsetColors = geomSubsetSections
    .map((section, index) => {
      const material = authoredMaterials[Math.min(index, authoredMaterials.length - 1)];
      const color =
        colorHexToVertexColor(material?.color) ||
        colorArrayToVertexColor(material?.colorRgba) ||
        fallbackColor;
      if (!color) {
        return null;
      }

      return {
        start: section.start,
        length: section.length,
        color,
      };
    })
    .filter(Boolean) as NonNullable<ExportDescriptor['subsetDisplayColors']>;

  return subsetColors.length > 0 ? subsetColors : undefined;
}

function buildFixedChildLinksByParent(robot: RobotState): Map<string, string[]> {
  const result = new Map<string, string[]>();

  Object.values(robot.joints).forEach((joint) => {
    if (joint.type !== JointType.FIXED) {
      return;
    }

    const list = result.get(joint.parentLinkId) || [];
    list.push(joint.childLinkId);
    result.set(joint.parentLinkId, list);
  });

  return result;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getGeomSuffixOrder(candidate: string, parentLinkId: string, parentName: string): number {
  const patterns = [
    new RegExp(`^${escapeRegExp(parentLinkId)}_geom_(\\d+)$`),
    new RegExp(`^${escapeRegExp(parentName)}_geom_(\\d+)$`),
  ];

  for (const pattern of patterns) {
    const match = candidate.match(pattern);
    if (match) {
      const numeric = Number(match[1]);
      if (Number.isFinite(numeric)) {
        return numeric;
      }
    }
  }

  return Number.POSITIVE_INFINITY;
}

function getLinkSemanticCandidates(link: UrdfLink): string[] {
  const candidates = [normalizeSemanticToken(link.id), normalizeSemanticToken(link.name)].filter(
    Boolean,
  );

  return Array.from(new Set(candidates));
}

function scoreDescriptorAgainstLink(descriptor: SnapshotMeshDescriptor, link: UrdfLink): number {
  const descriptorToken = normalizeSemanticToken(getDescriptorSemanticName(descriptor));
  if (!descriptorToken) {
    return 0;
  }

  let bestScore = 0;
  getLinkSemanticCandidates(link).forEach((candidate) => {
    if (candidate === descriptorToken) {
      bestScore = Math.max(bestScore, 8);
      return;
    }

    if (candidate.endsWith(`_${descriptorToken}`) || candidate.startsWith(`${descriptorToken}_`)) {
      bestScore = Math.max(bestScore, 6);
      return;
    }

    if (candidate.includes(descriptorToken) || descriptorToken.includes(candidate)) {
      bestScore = Math.max(bestScore, 4);
    }
  });

  return bestScore;
}

function isVisualAttachmentLink(
  link: UrdfLink | undefined,
  parentLinkId: string,
  parentName: string,
): boolean {
  if (!link) {
    return false;
  }

  const zeroMass = (link.inertial?.mass || 0) <= 1e-9;
  const visualPresent = link.visual.type !== GeometryType.NONE;
  const collisionOnly =
    link.visual.type === GeometryType.NONE && link.collision.type !== GeometryType.NONE;
  const syntheticName =
    getGeomSuffixOrder(link.id, parentLinkId, parentName) !== Number.POSITIVE_INFINITY ||
    getGeomSuffixOrder(link.name, parentLinkId, parentName) !== Number.POSITIVE_INFINITY;

  return !collisionOnly && (syntheticName || (zeroMass && visualPresent));
}

function sortVisualAttachmentLinkIds(
  robot: RobotState,
  parentLinkId: string,
  candidateIds: string[],
): string[] {
  const parent = robot.links[parentLinkId];
  const parentName = parent?.name || parentLinkId;

  return [...candidateIds].sort((leftId, rightId) => {
    const leftLink = robot.links[leftId];
    const rightLink = robot.links[rightId];
    const leftOrder = getGeomSuffixOrder(leftId, parentLinkId, parentName);
    const rightOrder = getGeomSuffixOrder(rightId, parentLinkId, parentName);

    if (leftOrder !== rightOrder) {
      return leftOrder - rightOrder;
    }

    const leftName = leftLink?.name || leftId;
    const rightName = rightLink?.name || rightId;
    return leftName.localeCompare(rightName);
  });
}

function collectVisualAttachmentLinkIds(
  robot: RobotState,
  parentLinkId: string,
  fixedChildrenByParent: Map<string, string[]>,
): string[] {
  const parent = robot.links[parentLinkId];
  if (!parent) {
    return [];
  }

  const childIds = (fixedChildrenByParent.get(parentLinkId) || []).filter((childId) =>
    isVisualAttachmentLink(robot.links[childId], parentLinkId, parent.name),
  );

  return [parentLinkId, ...sortVisualAttachmentLinkIds(robot, parentLinkId, childIds)];
}

function createUniqueRobotRecordKey(
  existing: Record<string, unknown>,
  preferredKeys: string[],
  fallbackKey: string,
): string {
  const candidates = [...preferredKeys, fallbackKey]
    .map((value) => sanitizeFileToken(value))
    .filter(Boolean);

  for (const candidate of candidates) {
    if (!existing[candidate]) {
      return candidate;
    }
  }

  const base = sanitizeFileToken(fallbackKey);
  let suffix = 2;
  while (existing[`${base}_${suffix}`]) {
    suffix += 1;
  }
  return `${base}_${suffix}`;
}

function createSyntheticVisualAttachmentLink(
  robot: RobotState,
  parentLinkId: string,
  descriptor: SnapshotMeshDescriptor,
  ordinal: number,
): string {
  const descriptorToken = normalizeSemanticToken(getDescriptorSemanticName(descriptor));
  const linkId = createUniqueRobotRecordKey(
    robot.links,
    [
      descriptorToken ? `${descriptorToken}_link` : '',
      descriptorToken ? `${parentLinkId}_${descriptorToken}` : '',
    ],
    `${parentLinkId}_geom_${ordinal}`,
  );
  const jointId = createUniqueRobotRecordKey(
    robot.joints,
    [`fixed_${linkId}`],
    `${parentLinkId}_fixed_${linkId}`,
  );

  robot.links[linkId] = {
    ...DEFAULT_LINK,
    id: linkId,
    name: linkId,
    visual: {
      ...DEFAULT_LINK.visual,
      type: GeometryType.MESH,
      dimensions: { x: 1, y: 1, z: 1 },
      origin: { ...DEFAULT_LINK.visual.origin },
    },
    collision: {
      ...DEFAULT_LINK.collision,
      type: GeometryType.NONE,
      dimensions: { x: 0, y: 0, z: 0 },
      origin: { ...DEFAULT_LINK.collision.origin },
    },
    inertial: {
      ...DEFAULT_LINK.inertial,
      mass: 0,
    },
  };

  robot.joints[jointId] = {
    ...DEFAULT_JOINT,
    id: jointId,
    name: jointId,
    type: JointType.FIXED,
    parentLinkId,
    childLinkId: linkId,
    origin: {
      xyz: { x: 0, y: 0, z: 0 },
      rpy: { r: 0, p: 0, y: 0 },
    },
    axis: { x: 0, y: 0, z: 1 },
    limit: undefined as UrdfJoint['limit'],
  };

  return linkId;
}

function assignVisualDescriptorToLink(
  snapshot: UsdExportSnapshot,
  robot: RobotState,
  linkId: string,
  entry: ExportDescriptor,
  descriptorByPath: Map<string, ExportDescriptor>,
  materialLookup: Map<string, SnapshotMaterialRecord>,
  preferredMaterialRecord?: SnapshotMaterialRecord | null,
  explicitMaterialFallback?: {
    color?: string;
    texture?: string;
  } | null,
): void {
  const link = robot.links[linkId];
  if (!link) {
    return;
  }

  const descriptorMaterialRecord = getDescriptorMaterialRecord(entry, materialLookup);
  const explicitFallbackColor = colorHexToVertexColor(explicitMaterialFallback?.color);
  const preferredFallbackColor = colorArrayToVertexColor(preferredMaterialRecord?.color);
  entry.displayColor =
    colorArrayToVertexColor(descriptorMaterialRecord?.color) ||
    explicitFallbackColor ||
    preferredFallbackColor;

  const primitiveGeometry = resolvePrimitiveGeometryFromDescriptor(entry.descriptor, link.visual);
  if (primitiveGeometry) {
    link.visual = {
      ...DEFAULT_LINK.visual,
      ...(link.visual || {}),
      ...primitiveGeometry,
      meshPath: undefined,
      origin: link.visual?.origin || { ...DEFAULT_LINK.visual.origin },
    };
    const appliedMaterial = applyDescriptorMaterialToLink(robot, linkId, entry, materialLookup);
    if (
      !appliedMaterial &&
      !applyVisualMaterialFallbackToLink(robot, linkId, explicitMaterialFallback)
    ) {
      applySnapshotMaterialRecordToLink(robot, linkId, preferredMaterialRecord);
    }
    return;
  }

  const visual =
    stripSyntheticMeshApproximationOrigin(link.visual, entry.descriptor, snapshot) || link.visual;
  link.visual = {
    ...DEFAULT_LINK.visual,
    ...(visual || {}),
    type: GeometryType.MESH,
    meshPath: entry.exportPath,
    doubleSided: true,
    dimensions: ensureMeshDimensions(visual?.dimensions),
    origin: visual?.origin || { ...DEFAULT_LINK.visual.origin },
  };
  entry.bakeTransformIntoMesh = !hasNonIdentityOrigin(link.visual.origin);
  descriptorByPath.set(entry.exportPath, entry);
  const appliedMaterial = applyDescriptorMaterialToLink(robot, linkId, entry, materialLookup);
  if (
    !appliedMaterial &&
    !applyVisualMaterialFallbackToLink(robot, linkId, explicitMaterialFallback)
  ) {
    applySnapshotMaterialRecordToLink(robot, linkId, preferredMaterialRecord);
  }
  const meshMaterialGroups = buildGeomSubsetMaterialGroups(entry.descriptor, link.visual);
  const subsetDisplayColors = buildGeomSubsetDisplayColors(entry.descriptor, link.visual);
  if (meshMaterialGroups) {
    link.visual = {
      ...link.visual,
      meshMaterialGroups,
    };
  }
  if (subsetDisplayColors) {
    entry.subsetDisplayColors = subsetDisplayColors;
  }
}

function assignCollisionDescriptorToLink(
  snapshot: UsdExportSnapshot,
  robot: RobotState,
  linkId: string,
  entry: ExportDescriptor,
  descriptorByPath: Map<string, ExportDescriptor>,
  collisionIndex: number,
): void {
  const link = robot.links[linkId];
  if (!link) {
    return;
  }

  const currentCollision =
    collisionIndex === 0 ? link.collision : link.collisionBodies?.[collisionIndex - 1];
  const primitiveGeometry = resolvePrimitiveGeometryFromDescriptor(
    entry.descriptor,
    currentCollision,
  );
  if (primitiveGeometry) {
    const nextCollision = {
      ...DEFAULT_LINK.collision,
      ...(currentCollision || {}),
      ...primitiveGeometry,
      meshPath: undefined,
      origin: currentCollision?.origin || { ...DEFAULT_LINK.collision.origin },
    };

    if (collisionIndex === 0) {
      link.collision = nextCollision;
      return;
    }

    const bodies = [...(link.collisionBodies || [])];
    bodies[collisionIndex - 1] = nextCollision;
    link.collisionBodies = bodies;
    return;
  }

  const sanitizedCollision =
    stripSyntheticMeshApproximationOrigin(currentCollision, entry.descriptor, snapshot) ||
    currentCollision;
  if (collisionIndex === 0) {
    link.collision = {
      ...DEFAULT_LINK.collision,
      ...(sanitizedCollision || {}),
      type: GeometryType.MESH,
      meshPath: entry.exportPath,
      dimensions: ensureMeshDimensions(sanitizedCollision?.dimensions),
      origin: sanitizedCollision?.origin || { ...DEFAULT_LINK.collision.origin },
    };
    entry.bakeTransformIntoMesh = !hasNonIdentityOrigin(link.collision.origin);
    descriptorByPath.set(entry.exportPath, entry);
    return;
  }

  const bodies = [...(link.collisionBodies || [])];
  const currentBody = sanitizedCollision;
  bodies[collisionIndex - 1] = {
    ...DEFAULT_LINK.collision,
    ...(currentBody || {}),
    type: GeometryType.MESH,
    meshPath: entry.exportPath,
    dimensions: ensureMeshDimensions(currentBody?.dimensions),
    origin: currentBody?.origin || { ...DEFAULT_LINK.collision.origin },
  };
  link.collisionBodies = bodies;
  entry.bakeTransformIntoMesh = !hasNonIdentityOrigin(bodies[collisionIndex - 1]?.origin);
  descriptorByPath.set(entry.exportPath, entry);
}

function assignLinkDescriptors(
  snapshot: UsdExportSnapshot,
  robot: RobotState,
  linkId: string,
  linkPath: string,
  visualDescriptors: ExportDescriptor[],
  collisionDescriptors: ExportDescriptor[],
  descriptorByPath: Map<string, ExportDescriptor>,
  materialLookup: Map<string, SnapshotMaterialRecord>,
  preferredMaterialLookup: Map<string, SnapshotMaterialRecord>,
  fixedChildrenByParent: Map<string, string[]>,
): void {
  if (!robot.links[linkId]) {
    return;
  }

  const visualLinkIds = collectVisualAttachmentLinkIds(robot, linkId, fixedChildrenByParent);
  const usedVisualLinkIds = new Set<string>();
  const preferredMaterialRecord = preferredMaterialLookup.get(normalizeUsdPath(linkPath)) || null;
  const sourceLink = robot.links[linkId];

  visualDescriptors.forEach((entry, index) => {
    let targetLinkId: string | undefined;
    const explicitMaterialFallback = resolveVisualMaterialFallbackForDescriptor(
      sourceLink,
      entry,
      index,
    );

    if (index === 0) {
      targetLinkId = linkId;
    } else {
      const availableLinkIds = visualLinkIds.filter(
        (candidateId) => candidateId !== linkId && !usedVisualLinkIds.has(candidateId),
      );

      let bestMatchId: string | undefined;
      let bestScore = 0;
      availableLinkIds.forEach((candidateId) => {
        const candidateLink = robot.links[candidateId];
        const score = candidateLink
          ? scoreDescriptorAgainstLink(entry.descriptor, candidateLink)
          : 0;
        if (score > bestScore) {
          bestScore = score;
          bestMatchId = candidateId;
        }
      });

      targetLinkId = bestMatchId || availableLinkIds[0];
      if (!targetLinkId) {
        targetLinkId = createSyntheticVisualAttachmentLink(robot, linkId, entry.descriptor, index);
        visualLinkIds.push(targetLinkId);
        const children = fixedChildrenByParent.get(linkId) || [];
        children.push(targetLinkId);
        fixedChildrenByParent.set(linkId, children);
      }
    }

    if (entry.subsetSection && targetLinkId !== linkId) {
      const sourceOrigin = robot.links[linkId]?.visual?.origin;
      const targetLink = robot.links[targetLinkId];
      if (
        targetLink &&
        hasNonIdentityOrigin(sourceOrigin) &&
        !hasNonIdentityOrigin(targetLink.visual.origin)
      ) {
        targetLink.visual = {
          ...targetLink.visual,
          origin: cloneVisualOrigin(sourceOrigin),
        };
      }
    }

    usedVisualLinkIds.add(targetLinkId);
    assignVisualDescriptorToLink(
      snapshot,
      robot,
      targetLinkId,
      entry,
      descriptorByPath,
      materialLookup,
      preferredMaterialRecord,
      explicitMaterialFallback,
    );
  });

  collisionDescriptors.forEach((entry, index) => {
    assignCollisionDescriptorToLink(snapshot, robot, linkId, entry, descriptorByPath, index);
  });
}

function collectReferencedMeshPaths(robot: RobotState): Set<string> {
  const referenced = new Set<string>();

  Object.values(robot.links).forEach((link) => {
    getVisualGeometryEntries(link).forEach((entry) => {
      if (entry.geometry.type === GeometryType.MESH && entry.geometry.meshPath) {
        referenced.add(entry.geometry.meshPath);
      }
    });
    if (link.collision.type === GeometryType.MESH && link.collision.meshPath) {
      referenced.add(link.collision.meshPath);
    }
    (link.collisionBodies || []).forEach((body) => {
      if (body.type === GeometryType.MESH && body.meshPath) {
        referenced.add(body.meshPath);
      }
    });
  });

  return referenced;
}

function createDescriptorExportMap(
  snapshot: UsdExportSnapshot,
  resolution: ViewerRobotDataResolution,
  currentRobot?: RobotLike | null,
): {
  robot: RobotState;
  descriptorByPath: Map<string, ExportDescriptor>;
} {
  const snapshotRobot = cloneRobotState({
    ...resolution.robotData,
    selection: { type: null, id: null },
  });
  const baseRobot = currentRobot
    ? mergeCurrentRobotWithSnapshotMeshPaths(currentRobot, snapshotRobot)
    : snapshotRobot;
  const descriptors = Array.from(snapshot.render?.meshDescriptors || []);
  const descriptorsByLinkRole = new Map<string, ExportDescriptor[]>();
  const materialLookup = getSnapshotMaterialLookup(snapshot);
  const preferredMaterialLookup = getSnapshotPreferredVisualMaterialLookup(snapshot);

  descriptors.forEach((descriptor, index) => {
    const linkPath = getDescriptorLinkPath(descriptor);
    if (!linkPath) return;

    const linkId = resolution.linkIdByPath[linkPath];
    if (!linkId) return;

    const role = getDescriptorRole(descriptor);
    const ordinal = parseDescriptorOrdinal(descriptor, index);
    const key = `${linkId}:${role}`;
    const current = descriptorsByLinkRole.get(key) || [];
    current.push({
      descriptor,
      meshId: normalizeUsdPath(descriptor.meshId || ''),
      linkPath,
      linkId,
      role,
      exportPath: `${sanitizeFileToken(linkId)}_${role}_${ordinal}.obj`,
      ordinal,
      subsetIndex: 0,
      subsetSection: null,
      materialIdOverride: null,
    } satisfies ExportDescriptor);
    descriptorsByLinkRole.set(key, current);
  });

  descriptorsByLinkRole.forEach((entries) => {
    entries.sort((left, right) => {
      if (left.ordinal !== right.ordinal) {
        return left.ordinal - right.ordinal;
      }
      if ((left.subsetIndex || 0) !== (right.subsetIndex || 0)) {
        return (left.subsetIndex || 0) - (right.subsetIndex || 0);
      }
      return left.meshId.localeCompare(right.meshId);
    });
  });

  const descriptorByPath = new Map<string, ExportDescriptor>();
  const fixedChildrenByParent = buildFixedChildLinksByParent(baseRobot);

  Object.entries(resolution.linkIdByPath).forEach(([linkPath, linkId]) => {
    assignLinkDescriptors(
      snapshot,
      baseRobot,
      linkId,
      linkPath,
      descriptorsByLinkRole.get(`${linkId}:visual`) || [],
      descriptorsByLinkRole.get(`${linkId}:collision`) || [],
      descriptorByPath,
      materialLookup,
      preferredMaterialLookup,
      fixedChildrenByParent,
    );
  });

  return {
    robot: stripSyntheticWorldRootForExport(baseRobot),
    descriptorByPath,
  };
}

export function getCurrentUsdViewerSceneSnapshot(
  options: { stageSourcePath?: string | null; targetWindow?: SnapshotHost } = {},
): UsdExportSnapshot | null {
  const host =
    options.targetWindow ?? (typeof window !== 'undefined' ? (window as SnapshotHost) : null);
  for (const stageSourcePath of buildUsdSnapshotLookupPaths(options.stageSourcePath)) {
    const snapshot = host?.renderInterface?.getCachedRobotSceneSnapshot?.(stageSourcePath);
    if (snapshot && typeof snapshot === 'object') {
      return enrichSnapshotWithLivePreferredMaterials(snapshot as UsdExportSnapshot, host);
    }
  }

  return null;
}

export function resolveUsdExportSceneSnapshot(
  options: {
    stageSourcePath?: string | null;
    cachedSnapshot?: UsdExportSnapshot | null;
    targetWindow?: SnapshotHost;
  } = {},
): UsdExportSnapshot | null {
  const host =
    options.targetWindow ?? (typeof window !== 'undefined' ? (window as SnapshotHost) : null);
  if (options.cachedSnapshot && typeof options.cachedSnapshot === 'object') {
    return enrichSnapshotWithLivePreferredMaterials(options.cachedSnapshot, host);
  }

  return getCurrentUsdViewerSceneSnapshot({
    stageSourcePath: options.stageSourcePath,
    targetWindow: host,
  });
}

export function prepareUsdExportCacheFromResolvedSnapshot(
  snapshot: UsdExportSnapshot,
  resolution: ViewerRobotDataResolution,
  options: {
    includeTransferBytes?: boolean;
  } = {},
): PreparedUsdExportCacheResult {
  const { robot: snapshotRobot, descriptorByPath } = createDescriptorExportMap(
    snapshot,
    resolution,
  );
  const meshFiles: Record<string, Blob> = {};
  const meshFileBytes: Record<string, Uint8Array> = {};

  collectReferencedMeshPaths(snapshotRobot).forEach((meshPath) => {
    const descriptor = descriptorByPath.get(meshPath);
    if (!descriptor) return;

    // Prepared caches are rendered under the hydrated RobotState link hierarchy.
    // Snapshot descriptor matrices are scene transforms, so baking them into the
    // OBJ vertices would apply the same link pose a second time in the viewer.
    descriptor.bakeTransformIntoMesh = false;
    const asset = buildObjBlobFromDescriptor(descriptor, snapshot.buffers || null);
    if (!asset) return;

    meshFiles[meshPath] = asset.blob;
    if (options.includeTransferBytes) {
      meshFileBytes[meshPath] = asset.bytes;
    }
  });

  const result: PreparedUsdExportCacheResult & PreparedUsdExportCacheTransferBytesCarrier = {
    stageSourcePath: snapshot.stageSourcePath || resolution.stageSourcePath || null,
    robotData: {
      name: snapshotRobot.name,
      links: snapshotRobot.links,
      joints: snapshotRobot.joints,
      rootLinkId: snapshotRobot.rootLinkId,
      materials: snapshotRobot.materials,
      closedLoopConstraints: snapshotRobot.closedLoopConstraints,
    },
    meshFiles,
    resolution,
  };

  if (options.includeTransferBytes && Object.keys(meshFileBytes).length > 0) {
    Object.defineProperty(result, '__meshFileBytes', {
      value: meshFileBytes,
      enumerable: false,
      configurable: false,
      writable: false,
    });
  }

  return result;
}

export function prepareUsdExportCacheFromSnapshot(
  snapshot: UsdExportSnapshot,
  options: {
    fileName?: string;
    resolution?: ViewerRobotDataResolution | null;
    targetWindow?: SnapshotHost;
  } = {},
): PreparedUsdExportCacheResult | null {
  const resolution = resolveUsdExportResolution(snapshot, options);

  if (!resolution) {
    return null;
  }

  return prepareUsdExportCacheFromResolvedSnapshot(snapshot, resolution);
}

export function buildUsdExportBundleFromPreparedCache(
  preparedCache: UsdPreparedExportCache,
  options: {
    currentRobot?: RobotLike | null;
  } = {},
): UsdExportBundle | null {
  if (!preparedCache?.robotData || typeof preparedCache.robotData !== 'object') {
    return null;
  }

  const snapshotRobot = cloneRobotState({
    ...preparedCache.robotData,
    selection: { type: null, id: null },
  });
  const robot = stripSyntheticWorldRootForExport(
    options.currentRobot
      ? mergeCurrentRobotWithPreparedCacheGeometry(options.currentRobot, snapshotRobot)
      : snapshotRobot,
  );

  return {
    robot,
    meshFiles: new Map(Object.entries(preparedCache.meshFiles || {})),
    resolution: {
      robotData: preparedCache.robotData,
      stageSourcePath: preparedCache.stageSourcePath || null,
      linkIdByPath: {},
      linkPathById: {},
      jointPathById: {},
      childLinkPathByJointId: {},
      parentLinkPathByJointId: {},
    },
  };
}

export function buildUsdExportBundleFromSnapshot(
  snapshot: UsdExportSnapshot,
  options: {
    fileName?: string;
    currentRobot?: RobotLike | null;
    resolution?: ViewerRobotDataResolution | null;
    targetWindow?: SnapshotHost;
  } = {},
): UsdExportBundle | null {
  const resolution = resolveUsdExportResolution(snapshot, options);
  if (!resolution) {
    return null;
  }

  const { robot, descriptorByPath } = createDescriptorExportMap(
    snapshot,
    resolution,
    options.currentRobot,
  );
  const meshFiles = new Map<string, Blob>();

  collectReferencedMeshPaths(robot).forEach((meshPath) => {
    const descriptor = descriptorByPath.get(meshPath);
    if (!descriptor) return;

    const asset = buildObjBlobFromDescriptor(descriptor, snapshot.buffers || null);
    if (!asset) return;

    meshFiles.set(meshPath, asset.blob);
  });

  return {
    robot,
    meshFiles,
    resolution,
  };
}
