import * as THREE from 'three';

import { computeLinkWorldMatrices } from '@/core/robot/kinematics';
import {
  DEFAULT_JOINT,
  DEFAULT_LINK,
  GeometryType,
  JointType,
  type Euler,
  type RobotClosedLoopConstraint,
  type RobotData,
  type UrdfJointUsdPhysicsFrame,
  type UrdfJoint,
  type UrdfLink,
  type UrdfVisual,
  type UrdfVisualMaterial,
  type UsdClosedLoopConstraintEntry,
  type UsdJointCatalogEntry,
  type UsdLinkDynamicsEntry,
  type UsdMeshCountsEntry,
  type UsdSceneMaterialRecord,
  type UsdRobotMetadataSnapshot,
  type UsdSceneMeshDescriptor,
  type UsdSceneSnapshot,
  type Vector3,
} from '@/types';
import type { ViewerRobotDataResolution } from './viewerRobotData';
import {
  buildNormalizedUsdPathSet,
  getUsdDescriptorSectionChildToken,
  getUsdDescriptorSemanticChildLinkName,
  resolveUsdDescriptorTargetLinkPath,
} from './usdDescriptorLinkResolution';
import { shouldUseUsdCollisionVisualProxy } from './usdCollisionVisualProxy';
import { resolveUsdPrimitiveGeometryFromDescriptor } from './usdPrimitiveGeometry';

type MeshPrimitiveCounts = Record<string, number | undefined>;
type MeshCountsEntry = UsdMeshCountsEntry;
type JointCatalogEntry = UsdJointCatalogEntry;
type ClosedLoopConstraintEntry = UsdClosedLoopConstraintEntry;
type LinkDynamicsEntry = UsdLinkDynamicsEntry;
type MaterialRecord = UsdSceneMaterialRecord;
type RobotMetadataSnapshot = UsdRobotMetadataSnapshot;
type MeshDescriptor = UsdSceneMeshDescriptor;
type RobotSceneSnapshot = UsdSceneSnapshot;
type ResolvedUsdGeometry = Pick<UrdfVisual, 'type' | 'dimensions'> & {
  origin?: UrdfVisual['origin'];
};

interface DescriptorEntry {
  descriptor: MeshDescriptor;
  ordinal: number;
  groupKey: string;
}

interface DescriptorGroup {
  groupKey: string;
  entries: DescriptorEntry[];
}

interface DescriptorGeomSubsetSection {
  start: number;
  length: number;
  materialId: string | null;
}

interface ResolvedDescriptorMaterialRecord {
  materialId: string | null;
  material: MaterialRecord;
  authoredMaterial: UrdfVisualMaterial;
}

export type { ViewerRobotDataResolution } from './viewerRobotData';
export type UsdViewerRobotDataResolution = ViewerRobotDataResolution;

export type UsdViewerRobotSceneSnapshot = RobotSceneSnapshot;

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

function getPathParent(path: string | null | undefined): string {
  const normalized = normalizeUsdPath(path);
  if (!normalized) return '';

  const segments = normalized.split('/').filter(Boolean);
  if (segments.length <= 1) {
    return '';
  }

  return `/${segments.slice(0, -1).join('/')}`;
}

function isUsdInternalMeshLibraryPath(path: string | null | undefined): boolean {
  const segments = normalizeUsdPath(path).split('/').filter(Boolean);
  return segments.some((segment) => segment.toLowerCase() === '__meshlibrary');
}

function shouldOmitUsdInternalMeshLibraryPaths(
  paths: Iterable<string | null | undefined>,
): boolean {
  let hasInternalMeshLibraryPath = false;
  let hasRobotLinkPath = false;

  for (const path of paths) {
    const normalized = normalizeUsdPath(path);
    if (!normalized) {
      continue;
    }

    if (isUsdInternalMeshLibraryPath(normalized)) {
      hasInternalMeshLibraryPath = true;
    } else {
      hasRobotLinkPath = true;
    }

    if (hasInternalMeshLibraryPath && hasRobotLinkPath) {
      return true;
    }
  }

  return false;
}

function buildMeshOnlyHierarchyFallback({
  defaultPrimPath,
  linkPaths,
  linkParentPairs,
  jointCatalogEntries,
  rootLinkPaths,
}: {
  defaultPrimPath: string | null | undefined;
  linkPaths: Set<string>;
  linkParentPairs: Array<[string | null | undefined, string | null | undefined]>;
  jointCatalogEntries: JointCatalogEntry[];
  rootLinkPaths: string[];
}): {
  linkPaths: Set<string>;
  linkParentPairs: Array<[string | null, string | null]>;
  rootLinkPaths: string[];
} {
  const hasAuthoredHierarchy =
    jointCatalogEntries.length > 0 || linkParentPairs.length > 0 || rootLinkPaths.length > 0;
  if (hasAuthoredHierarchy || linkPaths.size === 0) {
    return {
      linkPaths,
      linkParentPairs: linkParentPairs.map(([childPath, parentPath]) => [
        normalizeUsdPath(childPath),
        normalizeUsdPath(parentPath) || null,
      ]),
      rootLinkPaths,
    };
  }

  const fallbackLinkPaths = new Set(linkPaths);
  const normalizedDefaultPrimPath = normalizeUsdPath(defaultPrimPath);
  const sharedRootSegments = Array.from(linkPaths)
    .map((path) => path.split('/').filter(Boolean))
    .reduce<string[]>((commonSegments, nextSegments, index) => {
      if (index === 0) {
        return nextSegments;
      }

      let sharedLength = 0;
      while (
        sharedLength < commonSegments.length &&
        sharedLength < nextSegments.length &&
        commonSegments[sharedLength] === nextSegments[sharedLength]
      ) {
        sharedLength += 1;
      }

      return commonSegments.slice(0, sharedLength);
    }, []);
  const normalizedRootPath =
    normalizedDefaultPrimPath ||
    (sharedRootSegments.length > 0 ? `/${sharedRootSegments.join('/')}` : '');

  if (normalizedRootPath) {
    fallbackLinkPaths.add(normalizedRootPath);
  }

  Array.from(linkPaths).forEach((path) => {
    let parentPath = getPathParent(path);
    while (parentPath && parentPath !== normalizedRootPath) {
      fallbackLinkPaths.add(parentPath);
      parentPath = getPathParent(parentPath);
    }
  });

  const fallbackRootLinkPaths = normalizedRootPath ? [normalizedRootPath] : [];
  const syntheticLinkParentPairs: Array<[string | null, string | null]> = [];
  Array.from(fallbackLinkPaths)
    .sort((left, right) => left.localeCompare(right))
    .forEach((path) => {
      if (!path) {
        return;
      }

      if (normalizedRootPath && path === normalizedRootPath) {
        syntheticLinkParentPairs.push([path, null]);
        return;
      }

      let parentPath = getPathParent(path);
      while (parentPath && !fallbackLinkPaths.has(parentPath)) {
        parentPath = getPathParent(parentPath);
      }

      syntheticLinkParentPairs.push([path, parentPath || normalizedRootPath || null]);
    });

  return {
    linkPaths: fallbackLinkPaths,
    linkParentPairs: syntheticLinkParentPairs,
    rootLinkPaths: fallbackRootLinkPaths,
  };
}

function normalizeDescriptorSectionName(sectionName: string | null | undefined): string {
  const normalized = String(sectionName || '')
    .trim()
    .toLowerCase();
  if (normalized === 'visual') return 'visuals';
  if (normalized === 'collision' || normalized === 'collider' || normalized === 'colliders') {
    return 'collisions';
  }
  return normalized;
}

function getDescriptorMaterialId(descriptor: MeshDescriptor): string {
  return normalizeUsdPath(descriptor.materialId || descriptor.geometry?.materialId || '');
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
  const toHex = (channel: number) =>
    Math.max(0, Math.min(255, Math.round(channel)))
      .toString(16)
      .padStart(2, '0');
  const linearColor =
    Math.abs(r) <= 1 && Math.abs(g) <= 1 && Math.abs(b) <= 1
      ? new THREE.Color(
          Math.max(0, Math.min(1, r)),
          Math.max(0, Math.min(1, g)),
          Math.max(0, Math.min(1, b)),
        )
      : null;

  const a = opacityOverride ?? (source.length >= 4 ? Number(source[3]) : null);
  const rgb = linearColor
    ? [linearColor.getHexString()]
    : [toHex(to255(r)), toHex(to255(g)), toHex(to255(b))];

  if (a !== null && Number.isFinite(a) && a < 0.999) {
    rgb.push(toHex(to255(Number(a))));
  }

  return `#${rgb.join('')}`;
}

function hasMaterialRecordContent(material: MaterialRecord | null | undefined): boolean {
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
  material: MaterialRecord | null | undefined,
): string | null {
  const authoredColor = colorArrayToHex(material?.color, material?.opacity);
  if (authoredColor) {
    return authoredColor;
  }

  const opacity = Number(material?.opacity);
  const hasPrimaryTexture = Boolean(
    String(material?.mapPath || material?.alphaMapPath || '').trim(),
  );
  if (hasPrimaryTexture && Number.isFinite(opacity) && opacity < 0.999) {
    return colorArrayToHex([1, 1, 1], opacity);
  }

  return null;
}

function getDescriptorGeomSubsetSections(
  descriptor: MeshDescriptor,
): DescriptorGeomSubsetSection[] {
  const rawSections = Array.isArray(descriptor.geometry?.geomSubsetSections)
    ? descriptor.geometry.geomSubsetSections
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
        materialId: normalizeUsdPath(section?.materialId || '') || null,
      } satisfies DescriptorGeomSubsetSection;
    })
    .filter((section): section is DescriptorGeomSubsetSection => Boolean(section));
}

function resolveSnapshotMaterialTexturePath(
  material: MaterialRecord | null | undefined,
): string | undefined {
  const texturePath = String(material?.mapPath || '').trim();
  return texturePath || undefined;
}

function resolveSnapshotMaterialEmissionEnabled(
  material: MaterialRecord | null | undefined,
): boolean {
  if (!material || typeof material !== 'object') {
    return true;
  }
  if (material.emissiveEnabled === true) {
    return true;
  }
  if (material.emissiveEnabled === false) {
    return false;
  }
  return material.isOmniPbr === true ? false : true;
}

function resolveSnapshotAuthoredMaterial(
  material: MaterialRecord | null | undefined,
  materialId?: string | null,
): UrdfVisualMaterial | null {
  if (!material) {
    return null;
  }

  const name =
    String(material.name || '').trim() ||
    getPathBasename(material.materialId || materialId || '') ||
    undefined;
  const color = resolveSnapshotMaterialColorHex(material) || undefined;
  const texture = resolveSnapshotMaterialTexturePath(material);
  const opacity = Number(material.opacity);
  const roughness = Number(material.roughness);
  const metalness = Number(material.metalness);
  const emissiveEnabled = resolveSnapshotMaterialEmissionEnabled(material);
  const emissive = emissiveEnabled ? colorArrayToHex(material.emissive) || undefined : undefined;
  const emissiveIntensity = emissiveEnabled ? Number(material.emissiveIntensity) : Number.NaN;

  if (
    !name &&
    !color &&
    !texture &&
    !Number.isFinite(opacity) &&
    !Number.isFinite(roughness) &&
    !Number.isFinite(metalness) &&
    !emissive &&
    !Number.isFinite(emissiveIntensity)
  ) {
    return null;
  }

  return {
    ...(name ? { name } : {}),
    ...(color ? { color } : {}),
    ...(texture ? { texture } : {}),
    ...(Number.isFinite(opacity) ? { opacity } : {}),
    ...(Number.isFinite(roughness) ? { roughness } : {}),
    ...(Number.isFinite(metalness) ? { metalness } : {}),
    ...(emissive ? { emissive } : {}),
    ...(Number.isFinite(emissiveIntensity) ? { emissiveIntensity } : {}),
  };
}

function getResolvedDescriptorMaterialRecords(
  descriptor: MeshDescriptor,
  materialLookup: Map<string, MaterialRecord>,
): ResolvedDescriptorMaterialRecord[] {
  const resolvedMaterials: ResolvedDescriptorMaterialRecord[] = [];
  const seenKeys = new Set<string>();

  const pushResolvedMaterial = (materialId: string | null, material: MaterialRecord | null) => {
    if (!material) {
      return;
    }

    const authoredMaterial = resolveSnapshotAuthoredMaterial(material, materialId);
    if (!authoredMaterial) {
      return;
    }

    const dedupeKey =
      materialId ||
      JSON.stringify({
        name: authoredMaterial.name || '',
        color: authoredMaterial.color || '',
        texture: authoredMaterial.texture || '',
        opacity: authoredMaterial.opacity ?? null,
        roughness: authoredMaterial.roughness ?? null,
        metalness: authoredMaterial.metalness ?? null,
        emissive: authoredMaterial.emissive || '',
        emissiveIntensity: authoredMaterial.emissiveIntensity ?? null,
      });
    if (seenKeys.has(dedupeKey)) {
      return;
    }

    seenKeys.add(dedupeKey);
    resolvedMaterials.push({
      materialId,
      material,
      authoredMaterial,
    });
  };

  getDescriptorGeomSubsetSections(descriptor).forEach((section) => {
    if (!section.materialId) {
      return;
    }

    pushResolvedMaterial(section.materialId, materialLookup.get(section.materialId) || null);
  });

  const directMaterialId = getDescriptorMaterialId(descriptor);
  if (directMaterialId) {
    pushResolvedMaterial(directMaterialId, materialLookup.get(directMaterialId) || null);
  }

  return resolvedMaterials;
}

function applyVisualGroupMaterialsToLink(
  link: UrdfLink,
  linkId: string,
  group: DescriptorGroup | null | undefined,
  materialLookup: Map<string, MaterialRecord>,
  materials: NonNullable<RobotData['materials']>,
): void {
  if (!group) {
    return;
  }

  const resolvedMaterials: ResolvedDescriptorMaterialRecord[] = [];
  const seenKeys = new Set<string>();
  group.entries.forEach(({ descriptor }) => {
    getResolvedDescriptorMaterialRecords(descriptor, materialLookup).forEach((resolvedMaterial) => {
      const dedupeKey =
        resolvedMaterial.materialId ||
        JSON.stringify({
          name: resolvedMaterial.authoredMaterial.name || '',
          color: resolvedMaterial.authoredMaterial.color || '',
          texture: resolvedMaterial.authoredMaterial.texture || '',
          opacity: resolvedMaterial.authoredMaterial.opacity ?? null,
          roughness: resolvedMaterial.authoredMaterial.roughness ?? null,
          metalness: resolvedMaterial.authoredMaterial.metalness ?? null,
          emissive: resolvedMaterial.authoredMaterial.emissive || '',
          emissiveIntensity: resolvedMaterial.authoredMaterial.emissiveIntensity ?? null,
        });
      if (seenKeys.has(dedupeKey)) {
        return;
      }

      seenKeys.add(dedupeKey);
      resolvedMaterials.push(resolvedMaterial);
    });
  });
  if (resolvedMaterials.length === 0) {
    return;
  }

  if (resolvedMaterials.length > 1) {
    link.visual = {
      ...link.visual,
      color: undefined,
      authoredMaterials: resolvedMaterials.map(({ authoredMaterial }) => ({ ...authoredMaterial })),
      materialSource: 'named',
    };
    delete materials[linkId];
    return;
  }

  const [resolvedMaterial] = resolvedMaterials;
  const color = resolvedMaterial?.authoredMaterial.color;
  const texture = resolvedMaterial?.authoredMaterial.texture;
  const hasUsdMaterial = hasMaterialRecordContent(resolvedMaterial?.material);

  link.visual = {
    ...link.visual,
    ...(color && (link.visual.color === DEFAULT_LINK.visual.color || !link.visual.color)
      ? { color }
      : {}),
    materialSource: 'named',
  };
  delete link.visual.authoredMaterials;

  if (!color && !texture && !hasUsdMaterial) {
    delete materials[linkId];
    return;
  }

  materials[linkId] = {
    ...(color ? { color } : {}),
    ...(texture ? { texture } : {}),
    ...(hasUsdMaterial ? { usdMaterial: structuredClone(resolvedMaterial.material) } : {}),
  };
}

function getSnapshotMaterialLookup(snapshot: RobotSceneSnapshot): Map<string, MaterialRecord> {
  const lookup = new Map<string, MaterialRecord>();
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

function getDescriptorSemanticName(descriptor: MeshDescriptor): string {
  const semanticChildLinkName = getUsdDescriptorSemanticChildLinkName(descriptor);
  if (semanticChildLinkName) {
    return semanticChildLinkName;
  }

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

function parseDescriptorOrdinal(descriptor: MeshDescriptor, fallbackIndex: number): number {
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

function getUsdDescriptorAttachmentGroupKey(descriptor: MeshDescriptor): string {
  return getUsdDescriptorSectionChildToken(descriptor) || '__default__';
}

function groupDescriptorEntries(entries: DescriptorEntry[]): DescriptorGroup[] {
  const groups = new Map<string, DescriptorEntry[]>();

  entries.forEach((entry) => {
    const bucket = groups.get(entry.groupKey) || [];
    bucket.push(entry);
    groups.set(entry.groupKey, bucket);
  });

  return Array.from(groups.entries())
    .map(([groupKey, groupedEntries]) => ({
      groupKey,
      entries: groupedEntries.slice().sort((left, right) => left.ordinal - right.ordinal),
    }))
    .sort((left, right) => {
      const leftOrdinal = left.entries[0]?.ordinal ?? 0;
      const rightOrdinal = right.entries[0]?.ordinal ?? 0;
      return leftOrdinal - rightOrdinal;
    });
}

function createUniqueId(base: string, used: Set<string>, fallbackPath: string): string {
  const normalizedBase = String(base || 'link').replace(/[^\w]+/g, '_') || 'link';
  if (!used.has(normalizedBase)) {
    used.add(normalizedBase);
    return normalizedBase;
  }

  const sanitizedPath =
    String(fallbackPath || '')
      .replace(/[^\w]+/g, '_')
      .replace(/^_+|_+$/g, '') || normalizedBase;
  if (!used.has(sanitizedPath)) {
    used.add(sanitizedPath);
    return sanitizedPath;
  }

  let suffix = 2;
  while (used.has(`${sanitizedPath}_${suffix}`)) {
    suffix += 1;
  }
  const candidate = `${sanitizedPath}_${suffix}`;
  used.add(candidate);
  return candidate;
}

function toVector3(
  value: ArrayLike<number> | null | undefined,
  fallback: Vector3 = { x: 0, y: 0, z: 0 },
): Vector3 {
  return {
    x: Number.isFinite(Number(value?.[0])) ? Number(value?.[0]) : fallback.x,
    y: Number.isFinite(Number(value?.[1])) ? Number(value?.[1]) : fallback.y,
    z: Number.isFinite(Number(value?.[2])) ? Number(value?.[2]) : fallback.z,
  };
}

function toOptionalVector3(value: ArrayLike<number> | null | undefined): Vector3 | undefined {
  if (!value || typeof value.length !== 'number' || value.length < 3) {
    return undefined;
  }

  const x = Number(value[0]);
  const y = Number(value[1]);
  const z = Number(value[2]);
  if (![x, y, z].every((entry) => Number.isFinite(entry))) {
    return undefined;
  }

  return { x, y, z };
}

function toQuaternionWxyz(
  value: ArrayLike<number> | null | undefined,
): [number, number, number, number] | undefined {
  if (!value || typeof value.length !== 'number' || value.length < 4) {
    return undefined;
  }

  const w = Number(value[0]);
  const x = Number(value[1]);
  const y = Number(value[2]);
  const z = Number(value[3]);
  if (![w, x, y, z].every((entry) => Number.isFinite(entry))) {
    return undefined;
  }

  return [w, x, y, z];
}

function resolveUsdPhysicsFrameFromViewerEntry(
  entry: JointCatalogEntry,
): UrdfJointUsdPhysicsFrame | undefined {
  const localPos0 = toOptionalVector3(entry.localPos0);
  const localRot0Wxyz = toQuaternionWxyz(entry.localRot0Wxyz);
  const localPos1 = toOptionalVector3(entry.localPos1);
  const localRot1Wxyz = toQuaternionWxyz(entry.localRot1Wxyz);
  const axisToken = String(entry.axisToken || '').trim();

  if (!localPos0 && !localRot0Wxyz && !localPos1 && !localRot1Wxyz && !axisToken) {
    return undefined;
  }

  return {
    ...(axisToken ? { axisToken } : {}),
    ...(localPos0 ? { localPos0 } : {}),
    ...(localRot0Wxyz ? { localRot0Wxyz } : {}),
    ...(localPos1 ? { localPos1 } : {}),
    ...(localRot1Wxyz ? { localRot1Wxyz } : {}),
  };
}

function getDescriptorExtentDimensions(
  descriptor: MeshDescriptor,
): [number, number, number] | null {
  const source = descriptor.extentSize;
  if (!source || typeof source.length !== 'number' || source.length < 3) {
    return null;
  }

  const dimensions = [
    Math.abs(Number(source[0] ?? 0)),
    Math.abs(Number(source[1] ?? 0)),
    Math.abs(Number(source[2] ?? 0)),
  ];

  if (dimensions.some((value) => !Number.isFinite(value) || value <= 1e-9)) {
    return null;
  }

  return [
    Math.max(dimensions[0], 1e-6),
    Math.max(dimensions[1], 1e-6),
    Math.max(dimensions[2], 1e-6),
  ];
}

function resolveUsdMeshApproximationFromBuffers(
  snapshot: RobotSceneSnapshot,
  descriptor: MeshDescriptor,
): ResolvedUsdGeometry | null {
  const positions = snapshot.buffers?.positions;
  const range = descriptor.ranges?.positions;
  if (!positions || !range || typeof positions.length !== 'number') {
    return null;
  }

  const offset = Math.max(0, Number(range.offset ?? 0));
  const count = Math.max(0, Number(range.count ?? 0));
  const stride = Math.max(3, Number(range.stride ?? 3));
  if (
    !Number.isFinite(offset) ||
    !Number.isFinite(count) ||
    !Number.isFinite(stride) ||
    count < 3
  ) {
    return null;
  }

  const end = Math.min(positions.length, offset + count);
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;

  for (let index = offset; index + 2 < end; index += stride) {
    const x = Number(positions[index]);
    const y = Number(positions[index + 1]);
    const z = Number(positions[index + 2]);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      continue;
    }

    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }

  if (
    !Number.isFinite(minX) ||
    !Number.isFinite(minY) ||
    !Number.isFinite(minZ) ||
    !Number.isFinite(maxX) ||
    !Number.isFinite(maxY) ||
    !Number.isFinite(maxZ)
  ) {
    return null;
  }

  return {
    type: GeometryType.BOX,
    dimensions: {
      x: Math.max(maxX - minX, 1e-6),
      y: Math.max(maxY - minY, 1e-6),
      z: Math.max(maxZ - minZ, 1e-6),
    },
    origin: {
      xyz: {
        x: (minX + maxX) * 0.5,
        y: (minY + maxY) * 0.5,
        z: (minZ + maxZ) * 0.5,
      },
      rpy: { r: 0, p: 0, y: 0 },
    },
  };
}

export function resolveUsdMeshApproximationGeometry(
  snapshot: RobotSceneSnapshot,
  descriptor: MeshDescriptor,
): ResolvedUsdGeometry | null {
  const extentDimensions = getDescriptorExtentDimensions(descriptor);
  if (extentDimensions) {
    return {
      type: GeometryType.BOX,
      dimensions: {
        x: extentDimensions[0],
        y: extentDimensions[1],
        z: extentDimensions[2],
      },
      origin: {
        xyz: { x: 0, y: 0, z: 0 },
        rpy: { r: 0, p: 0, y: 0 },
      },
    };
  }

  return resolveUsdMeshApproximationFromBuffers(snapshot, descriptor);
}

function quaternionComponentsToEuler(
  x: unknown,
  y: unknown,
  z: unknown,
  w: unknown,
  fallback: Euler = { r: 0, p: 0, y: 0 },
): Euler {
  const quaternion = new THREE.Quaternion(
    Number(x) || 0,
    Number(y) || 0,
    Number(z) || 0,
    Number(w) || 0,
  );
  if (quaternion.lengthSq() <= 1e-12) {
    return fallback;
  }

  quaternion.normalize();
  const euler = new THREE.Euler(0, 0, 0, 'ZYX').setFromQuaternion(quaternion, 'ZYX');
  return {
    r: euler.x,
    p: euler.y,
    y: euler.z,
  };
}

function getDynamicsOriginRotation(dynamicsEntry?: LinkDynamicsEntry | null): Euler {
  const principalAxesLocal = dynamicsEntry?.principalAxesLocal;
  if (
    principalAxesLocal &&
    typeof principalAxesLocal.length === 'number' &&
    principalAxesLocal.length >= 4
  ) {
    return quaternionComponentsToEuler(
      principalAxesLocal[0],
      principalAxesLocal[1],
      principalAxesLocal[2],
      principalAxesLocal[3],
    );
  }

  const principalAxesLocalWxyz = dynamicsEntry?.principalAxesLocalWxyz;
  if (
    principalAxesLocalWxyz &&
    typeof principalAxesLocalWxyz.length === 'number' &&
    principalAxesLocalWxyz.length >= 4
  ) {
    return quaternionComponentsToEuler(
      principalAxesLocalWxyz[1],
      principalAxesLocalWxyz[2],
      principalAxesLocalWxyz[3],
      principalAxesLocalWxyz[0],
    );
  }

  return { r: 0, p: 0, y: 0 };
}

function degreesToRadians(value: number | null | undefined): number | undefined {
  return Number.isFinite(Number(value)) ? (Number(value) * Math.PI) / 180 : undefined;
}

function jointTypeFromViewerValue(value: string | null | undefined): JointType {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  if (!normalized) {
    return JointType.REVOLUTE;
  }

  if (normalized === 'fixed' || normalized.includes('fixed')) {
    return JointType.FIXED;
  }
  if (normalized === 'continuous' || normalized.includes('continuous')) {
    return JointType.CONTINUOUS;
  }
  if (normalized === 'prismatic' || normalized.includes('prismatic')) {
    return JointType.PRISMATIC;
  }
  if (normalized === 'ball' || normalized.includes('ball') || normalized.includes('spherical')) {
    return JointType.BALL;
  }
  if (normalized === 'planar' || normalized.includes('planar')) {
    return JointType.PLANAR;
  }
  if (normalized === 'floating' || normalized.includes('floating')) {
    return JointType.FLOATING;
  }

  return JointType.REVOLUTE;
}

function axisFromToken(token: string | null | undefined): Vector3 {
  const normalized = String(token || '')
    .trim()
    .toUpperCase();
  switch (normalized) {
    case 'Y':
      return { x: 0, y: 1, z: 0 };
    case 'Z':
      return { x: 0, y: 0, z: 1 };
    case 'X':
    default:
      return { x: 1, y: 0, z: 0 };
  }
}

function axisFromViewerEntry(entry: JointCatalogEntry): Vector3 {
  const axisLocal = entry.axisLocal;
  if (axisLocal && typeof axisLocal.length === 'number' && axisLocal.length >= 3) {
    const vector = toVector3(axisLocal, axisFromToken(entry.axisToken));
    if (vector.x !== 0 || vector.y !== 0 || vector.z !== 0) {
      return vector;
    }
  }
  return axisFromToken(entry.axisToken);
}

function geometryTypeFromCollisionPrimitive(
  counts: MeshPrimitiveCounts | null | undefined,
): GeometryType {
  if (!counts || typeof counts !== 'object') {
    return GeometryType.MESH;
  }

  const preferredOrder: Array<[string, GeometryType]> = [
    ['box', GeometryType.BOX],
    ['cube', GeometryType.BOX],
    ['sphere', GeometryType.SPHERE],
    ['cylinder', GeometryType.CYLINDER],
    ['capsule', GeometryType.CAPSULE],
    ['mesh', GeometryType.MESH],
  ];

  for (const [key, geometryType] of preferredOrder) {
    if (Number(counts[key] || 0) > 0) {
      return geometryType;
    }
  }

  return GeometryType.MESH;
}

function createPlaceholderVisual(type: GeometryType, color: string, meshPath?: string): UrdfVisual {
  return {
    ...DEFAULT_LINK.visual,
    type,
    color,
    meshPath,
    dimensions: type === GeometryType.NONE ? { x: 0, y: 0, z: 0 } : { x: 1, y: 1, z: 1 },
    origin: {
      xyz: { x: 0, y: 0, z: 0 },
      rpy: { r: 0, p: 0, y: 0 },
    },
  };
}

function getCollisionGeometryVisualProxy(link: UrdfLink): UrdfVisual | null {
  const candidates = [link.collision, ...(link.collisionBodies || [])];

  for (const candidate of candidates) {
    if (candidate && candidate.type !== GeometryType.NONE) {
      return candidate;
    }
  }

  return null;
}

function cloneMeshCountsEntry(entry: MeshCountsEntry | null | undefined): MeshCountsEntry {
  return {
    visualMeshCount: Number(entry?.visualMeshCount || 0),
    collisionMeshCount: Number(entry?.collisionMeshCount || 0),
    collisionPrimitiveCounts: {
      ...(entry?.collisionPrimitiveCounts || {}),
    },
  };
}

function deriveMeshCountsByLinkPath(
  snapshot: RobotSceneSnapshot,
  knownLinkPaths: Iterable<string | null | undefined>,
): Record<string, MeshCountsEntry> {
  const existing = snapshot.robotMetadataSnapshot?.meshCountsByLinkPath;
  const descriptors = Array.from(snapshot.render?.meshDescriptors || []);
  if (descriptors.length === 0) {
    return existing || {};
  }

  const derivedGroupsByLinkPath = new Map<
    string,
    {
      visualGroups: Set<string>;
      collisionGroupPrimitiveTypes: Map<string, string>;
    }
  >();
  const normalizedKnownLinkPaths = buildNormalizedUsdPathSet(knownLinkPaths);

  const ensureEntry = (linkPath: string) => {
    let entry = derivedGroupsByLinkPath.get(linkPath);
    if (!entry) {
      entry = {
        visualGroups: new Set<string>(),
        collisionGroupPrimitiveTypes: new Map<string, string>(),
      };
      derivedGroupsByLinkPath.set(linkPath, entry);
    }
    return entry;
  };

  for (const descriptor of descriptors) {
    const linkPath = resolveUsdDescriptorTargetLinkPath({
      descriptor,
      knownLinkPaths: normalizedKnownLinkPaths,
    });
    if (!linkPath) continue;

    const entry = ensureEntry(linkPath);
    const sectionName = normalizeDescriptorSectionName(descriptor.sectionName);
    const groupKey = getUsdDescriptorAttachmentGroupKey(descriptor);
    if (sectionName === 'collisions') {
      if (!entry.collisionGroupPrimitiveTypes.has(groupKey)) {
        const primitiveType =
          String(descriptor.primType || '')
            .trim()
            .toLowerCase() || 'mesh';
        entry.collisionGroupPrimitiveTypes.set(groupKey, primitiveType);
      }
      continue;
    }

    entry.visualGroups.add(groupKey);
  }

  const derived = Object.fromEntries(
    Array.from(derivedGroupsByLinkPath.entries()).map(([linkPath, entry]) => {
      const collisionPrimitiveCounts: Record<string, number> = {};
      entry.collisionGroupPrimitiveTypes.forEach((primitiveType) => {
        collisionPrimitiveCounts[primitiveType] =
          Number(collisionPrimitiveCounts[primitiveType] || 0) + 1;
      });

      return [
        linkPath,
        {
          visualMeshCount: entry.visualGroups.size,
          collisionMeshCount: entry.collisionGroupPrimitiveTypes.size,
          collisionPrimitiveCounts,
        } satisfies MeshCountsEntry,
      ];
    }),
  ) as Record<string, MeshCountsEntry>;

  if (!existing || Object.keys(existing).length === 0) {
    return derived;
  }

  const result: Record<string, MeshCountsEntry> = {};
  const allLinkPaths = new Set([...Object.keys(existing), ...Object.keys(derived)]);

  allLinkPaths.forEach((linkPath) => {
    const existingEntry = cloneMeshCountsEntry(existing[linkPath]);
    const derivedEntry = cloneMeshCountsEntry(derived[linkPath]);
    const mergedEntry: MeshCountsEntry = {
      visualMeshCount:
        derivedEntry.visualMeshCount > 0
          ? derivedEntry.visualMeshCount
          : existingEntry.visualMeshCount,
      collisionMeshCount:
        derivedEntry.collisionMeshCount > 0
          ? derivedEntry.collisionMeshCount
          : existingEntry.collisionMeshCount,
      collisionPrimitiveCounts:
        Object.keys(derivedEntry.collisionPrimitiveCounts || {}).length > 0
          ? derivedEntry.collisionPrimitiveCounts
          : existingEntry.collisionPrimitiveCounts,
    };

    if (mergedEntry.visualMeshCount > 0 || mergedEntry.collisionMeshCount > 0) {
      result[linkPath] = mergedEntry;
    }
  });

  return result;
}

function createLinkFromViewerMetadata(
  linkPath: string,
  meshCounts: MeshCountsEntry,
  dynamicsEntry?: LinkDynamicsEntry | null,
): UrdfLink {
  const visualCount = Number(meshCounts.visualMeshCount || 0);
  const collisionCount = Number(meshCounts.collisionMeshCount || 0);
  const collisionType =
    collisionCount > 0
      ? geometryTypeFromCollisionPrimitive(meshCounts.collisionPrimitiveCounts)
      : GeometryType.NONE;

  return {
    ...DEFAULT_LINK,
    id: '',
    name: getPathBasename(linkPath) || 'link',
    visual:
      visualCount > 0
        ? // USD scene snapshots only tell us that a link has authored visual geometry.
          // The link path itself is not a loadable mesh asset, so keep meshPath empty to
          // avoid invalid mesh-analysis lookups such as "/go2_description/base".
          createPlaceholderVisual(GeometryType.MESH, DEFAULT_LINK.visual.color)
        : createPlaceholderVisual(GeometryType.NONE, DEFAULT_LINK.visual.color),
    collision:
      collisionCount > 0
        ? createPlaceholderVisual(collisionType, DEFAULT_LINK.collision.color)
        : createPlaceholderVisual(GeometryType.NONE, DEFAULT_LINK.collision.color),
    collisionBodies:
      collisionCount > 1
        ? Array.from({ length: collisionCount - 1 }, () =>
            createPlaceholderVisual(collisionType, DEFAULT_LINK.collision.color),
          )
        : [],
    inertial: {
      ...DEFAULT_LINK.inertial,
      mass: Number.isFinite(Number(dynamicsEntry?.mass))
        ? Number(dynamicsEntry?.mass)
        : DEFAULT_LINK.inertial.mass,
      origin: {
        xyz: toVector3(dynamicsEntry?.centerOfMassLocal, DEFAULT_LINK.inertial.origin?.xyz),
        rpy: getDynamicsOriginRotation(dynamicsEntry),
      },
      inertia:
        Array.isArray(dynamicsEntry?.diagonalInertia) ||
        (dynamicsEntry?.diagonalInertia && typeof dynamicsEntry.diagonalInertia.length === 'number')
          ? {
              ixx: Number(dynamicsEntry?.diagonalInertia?.[0]) || 0,
              ixy: 0,
              ixz: 0,
              iyy: Number(dynamicsEntry?.diagonalInertia?.[1]) || 0,
              iyz: 0,
              izz: Number(dynamicsEntry?.diagonalInertia?.[2]) || 0,
            }
          : { ...DEFAULT_LINK.inertial.inertia },
    },
  };
}

function createJointFromViewerEntry(
  entry: JointCatalogEntry,
  linkIdByPath: Map<string, string>,
  usedJointIds: Set<string>,
): UrdfJoint | null {
  const childPath = normalizeUsdPath(entry.linkPath || entry.childLinkPath);
  const parentPath = normalizeUsdPath(entry.parentLinkPath);
  if (!childPath || !parentPath) return null;

  const childLinkId = linkIdByPath.get(childPath);
  const parentLinkId = linkIdByPath.get(parentPath);
  if (!childLinkId || !parentLinkId) return null;

  const jointName = String(
    entry.jointName || getPathBasename(entry.jointPath) || `${getPathBasename(childPath)}_joint`,
  ).trim();
  const jointId = createUniqueId(jointName || 'joint', usedJointIds, `${parentPath}_${childPath}`);
  const jointType = jointTypeFromViewerValue(entry.jointTypeName || entry.jointType);
  const lower = degreesToRadians(entry.lowerLimitDeg);
  const upper = degreesToRadians(entry.upperLimitDeg);
  const angle = degreesToRadians(entry.angleDeg);
  const driveDamping =
    typeof entry.driveDamping === 'number' && Number.isFinite(entry.driveDamping)
      ? entry.driveDamping
      : undefined;
  const driveMaxForce =
    typeof entry.driveMaxForce === 'number' && Number.isFinite(entry.driveMaxForce)
      ? entry.driveMaxForce
      : undefined;
  const originXyz =
    entry.originXyz && typeof entry.originXyz.length === 'number'
      ? toVector3(entry.originXyz)
      : toVector3(entry.localPivotInLink);
  const originQuatWxyz =
    entry.originQuatWxyz && typeof entry.originQuatWxyz.length === 'number'
      ? Array.from(entry.originQuatWxyz).slice(0, 4)
      : null;
  const usdPhysics = resolveUsdPhysicsFrameFromViewerEntry(entry);

  return {
    ...DEFAULT_JOINT,
    id: jointId,
    name: jointName || jointId,
    type: jointType,
    parentLinkId,
    childLinkId,
    ...(typeof angle === 'number' && Number.isFinite(angle) ? { angle } : {}),
    origin: {
      xyz: originXyz,
      rpy: originQuatWxyz
        ? quaternionComponentsToEuler(
            originQuatWxyz[1],
            originQuatWxyz[2],
            originQuatWxyz[3],
            originQuatWxyz[0],
          )
        : { r: 0, p: 0, y: 0 },
    },
    axis: axisFromViewerEntry(entry),
    dynamics: {
      ...DEFAULT_JOINT.dynamics,
      ...(driveDamping !== undefined ? { damping: driveDamping } : {}),
    },
    limit: {
      ...DEFAULT_JOINT.limit,
      ...(lower !== undefined ? { lower } : {}),
      ...(upper !== undefined ? { upper } : {}),
      ...(driveMaxForce !== undefined ? { effort: driveMaxForce } : {}),
    },
    ...(usdPhysics ? { usdPhysics } : {}),
  };
}

function createClosedLoopConstraintFromUsdEntry(
  entry: ClosedLoopConstraintEntry,
  linkIdByPath: Map<string, string>,
): RobotClosedLoopConstraint | null {
  const linkAPath = normalizeUsdPath(entry.linkAPath);
  const linkBPath = normalizeUsdPath(entry.linkBPath);
  if (!linkAPath || !linkBPath) {
    return null;
  }

  const linkAId = linkIdByPath.get(linkAPath);
  const linkBId = linkIdByPath.get(linkBPath);
  if (!linkAId || !linkBId) {
    return null;
  }

  const constraintType = String(entry.constraintType || '')
    .trim()
    .toLowerCase();
  if (constraintType && constraintType !== 'connect') {
    return null;
  }

  return {
    id:
      String(entry.id || `${linkAId}_${linkBId}_closed_loop`).trim() ||
      `${linkAId}_${linkBId}_closed_loop`,
    type: 'connect',
    linkAId,
    linkBId,
    anchorLocalA: toVector3(entry.anchorLocalA),
    anchorLocalB: toVector3(entry.anchorLocalB),
    anchorWorld: { x: 0, y: 0, z: 0 },
  };
}

function populateClosedLoopConstraintWorldAnchors(
  constraints: RobotClosedLoopConstraint[],
  links: Record<string, UrdfLink>,
  joints: Record<string, UrdfJoint>,
  rootLinkId: string,
): RobotClosedLoopConstraint[] {
  if (constraints.length === 0) {
    return constraints;
  }

  const linkWorldMatrices = computeLinkWorldMatrices({ links, joints, rootLinkId });
  return constraints.map((constraint) => {
    const linkAMatrix = linkWorldMatrices[constraint.linkAId];
    if (!linkAMatrix) {
      return constraint;
    }

    const anchorWorld = new THREE.Vector3(
      constraint.anchorLocalA.x,
      constraint.anchorLocalA.y,
      constraint.anchorLocalA.z,
    ).applyMatrix4(linkAMatrix);

    return {
      ...constraint,
      anchorWorld: {
        x: anchorWorld.x,
        y: anchorWorld.y,
        z: anchorWorld.z,
      },
    };
  });
}

export function adaptUsdViewerSnapshotToRobotData(
  snapshot: RobotSceneSnapshot | null | undefined,
  options: { fileName?: string } = {},
): ViewerRobotDataResolution | null {
  if (!snapshot || typeof snapshot !== 'object') {
    return null;
  }

  const metadata = snapshot.robotMetadataSnapshot || {};
  const linkParentPairs = Array.from(
    metadata.linkParentPairs || snapshot.robotTree?.linkParentPairs || [],
  );
  const jointCatalogEntries = Array.from(
    metadata.jointCatalogEntries || snapshot.robotTree?.jointCatalogEntries || [],
  );
  const closedLoopConstraintEntries = Array.from(metadata.closedLoopConstraintEntries || []);
  const linkDynamicsEntries = Array.from(
    metadata.linkDynamicsEntries || snapshot.physics?.linkDynamicsEntries || [],
  );
  const rootLinkPaths = Array.from(snapshot.robotTree?.rootLinkPaths || []);

  const linkPaths = new Set<string>();
  const addLinkPath = (value: string | null | undefined) => {
    const normalized = normalizeUsdPath(value);
    if (normalized) linkPaths.add(normalized);
  };

  linkParentPairs.forEach((pair) => {
    addLinkPath(pair?.[0]);
    addLinkPath(pair?.[1]);
  });
  jointCatalogEntries.forEach((entry) => {
    addLinkPath(entry.linkPath);
    addLinkPath(entry.childLinkPath);
    addLinkPath(entry.parentLinkPath);
  });
  linkDynamicsEntries.forEach((entry) => addLinkPath(entry.linkPath));
  rootLinkPaths.forEach((entry) => addLinkPath(entry));
  Object.keys(metadata.meshCountsByLinkPath || {}).forEach((path) => addLinkPath(path));

  let meshCountsByLinkPath = deriveMeshCountsByLinkPath(snapshot, linkPaths);
  Object.keys(meshCountsByLinkPath).forEach((path) => addLinkPath(path));
  const normalizedDefaultPrimPath = normalizeUsdPath(snapshot.stage?.defaultPrimPath);
  const hasInternalMeshLibraryPath = Array.from(linkPaths).some((path) =>
    isUsdInternalMeshLibraryPath(path),
  );
  const shouldOmitInternalMeshLibraryPaths =
    shouldOmitUsdInternalMeshLibraryPaths(linkPaths) ||
    (hasInternalMeshLibraryPath &&
      Boolean(normalizedDefaultPrimPath) &&
      !isUsdInternalMeshLibraryPath(normalizedDefaultPrimPath));
  const effectiveSourceLinkPaths = shouldOmitInternalMeshLibraryPaths
    ? new Set(Array.from(linkPaths).filter((path) => !isUsdInternalMeshLibraryPath(path)))
    : new Set(linkPaths);
  if (
    shouldOmitInternalMeshLibraryPaths &&
    effectiveSourceLinkPaths.size === 0 &&
    normalizedDefaultPrimPath
  ) {
    effectiveSourceLinkPaths.add(normalizedDefaultPrimPath);
  }
  const effectiveSourceLinkParentPairs = shouldOmitInternalMeshLibraryPaths
    ? linkParentPairs.filter(
        ([childPath, parentPath]) =>
          !isUsdInternalMeshLibraryPath(childPath) && !isUsdInternalMeshLibraryPath(parentPath),
      )
    : linkParentPairs;
  const effectiveJointCatalogEntries = shouldOmitInternalMeshLibraryPaths
    ? jointCatalogEntries.filter(
        (entry) =>
          !isUsdInternalMeshLibraryPath(entry.linkPath) &&
          !isUsdInternalMeshLibraryPath(entry.childLinkPath) &&
          !isUsdInternalMeshLibraryPath(entry.parentLinkPath),
      )
    : jointCatalogEntries;
  const effectiveSourceRootLinkPaths = shouldOmitInternalMeshLibraryPaths
    ? rootLinkPaths.filter((path) => !isUsdInternalMeshLibraryPath(path))
    : rootLinkPaths;
  if (
    shouldOmitInternalMeshLibraryPaths &&
    effectiveSourceRootLinkPaths.length === 0 &&
    normalizedDefaultPrimPath
  ) {
    effectiveSourceRootLinkPaths.push(normalizedDefaultPrimPath);
  }

  if (shouldOmitInternalMeshLibraryPaths) {
    meshCountsByLinkPath = Object.fromEntries(
      Object.entries(meshCountsByLinkPath).filter(
        ([linkPath]) => !isUsdInternalMeshLibraryPath(linkPath),
      ),
    );
  }

  const hierarchyFallback = buildMeshOnlyHierarchyFallback({
    defaultPrimPath: snapshot.stage?.defaultPrimPath,
    linkPaths: effectiveSourceLinkPaths,
    linkParentPairs: effectiveSourceLinkParentPairs,
    jointCatalogEntries: effectiveJointCatalogEntries,
    rootLinkPaths: effectiveSourceRootLinkPaths,
  });
  const effectiveLinkPaths = hierarchyFallback.linkPaths;
  const effectiveLinkParentPairs = hierarchyFallback.linkParentPairs;
  const effectiveRootLinkPaths = hierarchyFallback.rootLinkPaths;

  const normalizedStageSourcePath = normalizeUsdPath(
    snapshot.stageSourcePath || metadata.stageSourcePath,
  );
  if (effectiveLinkPaths.size === 0) {
    return null;
  }

  const sortedLinkPaths = Array.from(effectiveLinkPaths).sort((left, right) =>
    left.localeCompare(right),
  );
  const dynamicsByLinkPath = new Map<string, LinkDynamicsEntry>();
  linkDynamicsEntries.forEach((entry) => {
    const normalizedPath = normalizeUsdPath(entry.linkPath);
    if (normalizedPath && !dynamicsByLinkPath.has(normalizedPath)) {
      dynamicsByLinkPath.set(normalizedPath, entry);
    }
  });

  const links: Record<string, UrdfLink> = {};
  const linkIdByPath = new Map<string, string>();
  const linkPathById = new Map<string, string>();
  const usedLinkIds = new Set<string>();

  for (const linkPath of sortedLinkPaths) {
    const linkName = getPathBasename(linkPath) || 'link';
    const linkId = createUniqueId(linkName, usedLinkIds, linkPath);
    linkIdByPath.set(linkPath, linkId);

    const link = createLinkFromViewerMetadata(
      linkPath,
      meshCountsByLinkPath[linkPath] || {},
      dynamicsByLinkPath.get(linkPath) || null,
    );
    link.id = linkId;
    link.name = linkName;
    links[linkId] = link;
    linkPathById.set(linkId, linkPath);
  }

  const joints: Record<string, UrdfJoint> = {};
  const usedJointIds = new Set<string>();
  const explicitChildPaths = new Set<string>();
  const jointPathById = new Map<string, string>();
  const childLinkPathByJointId = new Map<string, string>();
  const parentLinkPathByJointId = new Map<string, string>();

  for (const entry of effectiveJointCatalogEntries) {
    const joint = createJointFromViewerEntry(entry, linkIdByPath, usedJointIds);
    if (!joint) continue;
    joints[joint.id] = joint;

    const childPath = normalizeUsdPath(entry.linkPath || entry.childLinkPath);
    const parentPath = normalizeUsdPath(entry.parentLinkPath);
    const jointPath = normalizeUsdPath(entry.jointPath);
    if (childPath) {
      explicitChildPaths.add(childPath);
      childLinkPathByJointId.set(joint.id, childPath);
    }
    if (parentPath) {
      parentLinkPathByJointId.set(joint.id, parentPath);
    }
    if (jointPath) {
      jointPathById.set(joint.id, jointPath);
    }
  }

  for (const pair of effectiveLinkParentPairs) {
    const childPath = normalizeUsdPath(pair?.[0]);
    const parentPath = normalizeUsdPath(pair?.[1]);
    if (!childPath || !parentPath || explicitChildPaths.has(childPath)) continue;

    const childLinkId = linkIdByPath.get(childPath);
    const parentLinkId = linkIdByPath.get(parentPath);
    if (!childLinkId || !parentLinkId) continue;

    const jointId = createUniqueId(
      `${getPathBasename(childPath) || childLinkId}_fixed`,
      usedJointIds,
      `${parentPath}_${childPath}_fixed`,
    );
    joints[jointId] = {
      ...DEFAULT_JOINT,
      id: jointId,
      name: jointId,
      type: JointType.FIXED,
      parentLinkId,
      childLinkId,
      origin: {
        xyz: { x: 0, y: 0, z: 0 },
        rpy: { r: 0, p: 0, y: 0 },
      },
      axis: { x: 0, y: 0, z: 1 },
    };
    childLinkPathByJointId.set(jointId, childPath);
    parentLinkPathByJointId.set(jointId, parentPath);
  }

  const childLinkIds = new Set(Object.values(joints).map((joint) => joint.childLinkId));
  const preferredRootPath = normalizeUsdPath(effectiveRootLinkPaths[0]);
  const rootLinkId =
    (preferredRootPath ? linkIdByPath.get(preferredRootPath) : null) ||
    Object.keys(links).find((linkId) => !childLinkIds.has(linkId)) ||
    Object.keys(links)[0];

  if (!rootLinkId) {
    return null;
  }

  const robotName =
    getPathBasename(snapshot.stage?.defaultPrimPath) ||
    (options.fileName
      ? options.fileName
          .split('/')
          .pop()
          ?.replace(/\.[^/.]+$/, '')
      : '') ||
    getPathBasename(normalizedStageSourcePath) ||
    'usd_scene';

  const materials: NonNullable<RobotData['materials']> = {};
  const materialLookup = getSnapshotMaterialLookup(snapshot);
  const descriptors = Array.from(snapshot.render?.meshDescriptors || []);
  const visualDescriptorsByLinkPath = new Map<string, DescriptorEntry[]>();
  const collisionDescriptorsByLinkPath = new Map<string, DescriptorEntry[]>();
  const visualDescriptorTargetLinkIds = new Map<string, string>();

  const getDescriptorEntryKey = (descriptor: MeshDescriptor, ordinal: number) =>
    `${normalizeDescriptorSectionName(descriptor.sectionName)}|${normalizeUsdPath(descriptor.meshId)}|${normalizeUsdPath(descriptor.resolvedPrimPath)}|${ordinal}`;

  descriptors.forEach((descriptor) => {
    const linkPath = resolveUsdDescriptorTargetLinkPath({
      descriptor,
      knownLinkPaths: effectiveLinkPaths,
    });
    if (!linkPath) {
      return;
    }

    const sectionName = normalizeDescriptorSectionName(descriptor.sectionName);
    const targetMap =
      sectionName === 'collisions' ? collisionDescriptorsByLinkPath : visualDescriptorsByLinkPath;
    const entries = targetMap.get(linkPath) || [];
    entries.push({
      descriptor,
      ordinal: parseDescriptorOrdinal(descriptor, entries.length),
      groupKey: getUsdDescriptorAttachmentGroupKey(descriptor),
    });
    targetMap.set(linkPath, entries);
  });

  visualDescriptorsByLinkPath.forEach((entries) => {
    entries.sort((left, right) => left.ordinal - right.ordinal);
  });
  collisionDescriptorsByLinkPath.forEach((entries) => {
    entries.sort((left, right) => left.ordinal - right.ordinal);
  });

  visualDescriptorsByLinkPath.forEach((entries, linkPath) => {
    const parentLinkId = linkIdByPath.get(linkPath);
    if (!parentLinkId) {
      return;
    }

    const groupedEntries = groupDescriptorEntries(entries);
    const primaryGroup = groupedEntries[0];
    primaryGroup?.entries.forEach(({ descriptor, ordinal }) => {
      visualDescriptorTargetLinkIds.set(getDescriptorEntryKey(descriptor, ordinal), parentLinkId);
    });
    applyVisualGroupMaterialsToLink(
      links[parentLinkId],
      parentLinkId,
      primaryGroup,
      materialLookup,
      materials,
    );

    groupedEntries.slice(1).forEach((group, index) => {
      const descriptor = group.entries[0]?.descriptor;
      if (!descriptor) {
        return;
      }

      const semanticName = getDescriptorSemanticName(descriptor);
      const childLinkId = createUniqueId(
        semanticName || `${parentLinkId}_geom_${index + 1}`,
        usedLinkIds,
        `${parentLinkId}_${descriptor.resolvedPrimPath || descriptor.meshId || index}`,
      );
      const childJointId = createUniqueId(
        `fixed_${childLinkId}`,
        usedJointIds,
        `${parentLinkId}_${childLinkId}_fixed`,
      );

      links[childLinkId] = {
        ...DEFAULT_LINK,
        id: childLinkId,
        name: childLinkId,
        visual: createPlaceholderVisual(GeometryType.MESH, DEFAULT_LINK.visual.color),
        collision: createPlaceholderVisual(GeometryType.NONE, DEFAULT_LINK.collision.color),
        inertial: {
          ...DEFAULT_LINK.inertial,
          mass: 0,
        },
      };
      joints[childJointId] = {
        ...DEFAULT_JOINT,
        id: childJointId,
        name: childJointId,
        type: JointType.FIXED,
        parentLinkId,
        childLinkId,
        origin: {
          xyz: { x: 0, y: 0, z: 0 },
          rpy: { r: 0, p: 0, y: 0 },
        },
        axis: { x: 0, y: 0, z: 1 },
      };
      applyVisualGroupMaterialsToLink(
        links[childLinkId],
        childLinkId,
        group,
        materialLookup,
        materials,
      );

      group.entries.forEach(({ descriptor: groupDescriptor, ordinal }) => {
        visualDescriptorTargetLinkIds.set(
          getDescriptorEntryKey(groupDescriptor, ordinal),
          childLinkId,
        );
      });
    });
  });

  const visualGeometryAssignedLinkIds = new Set<string>();
  visualDescriptorsByLinkPath.forEach((entries) => {
    entries.forEach(({ descriptor, ordinal }) => {
      const targetLinkId = visualDescriptorTargetLinkIds.get(
        getDescriptorEntryKey(descriptor, ordinal),
      );
      if (
        !targetLinkId ||
        !links[targetLinkId] ||
        visualGeometryAssignedLinkIds.has(targetLinkId)
      ) {
        return;
      }

      const nextGeometry: ResolvedUsdGeometry | null = resolveUsdPrimitiveGeometryFromDescriptor(
        descriptor,
        links[targetLinkId].visual,
      );
      if (!nextGeometry) {
        return;
      }

      links[targetLinkId].visual = {
        ...links[targetLinkId].visual,
        ...nextGeometry,
        meshPath: undefined,
      };
      visualGeometryAssignedLinkIds.add(targetLinkId);
    });
  });

  collisionDescriptorsByLinkPath.forEach((entries, linkPath) => {
    const linkId = linkIdByPath.get(linkPath);
    const link = linkId ? links[linkId] : null;
    if (!link) {
      return;
    }

    groupDescriptorEntries(entries).forEach((group, index) => {
      const descriptor = group.entries[0]?.descriptor;
      if (!descriptor) {
        return;
      }

      const currentCollision = index === 0 ? link.collision : link.collisionBodies?.[index - 1];
      const nextGeometry: ResolvedUsdGeometry | null =
        resolveUsdPrimitiveGeometryFromDescriptor(descriptor, currentCollision) ??
        resolveUsdMeshApproximationGeometry(snapshot, descriptor);
      if (!nextGeometry) {
        return;
      }

      const nextCollision = {
        ...DEFAULT_LINK.collision,
        ...(currentCollision || {}),
        ...nextGeometry,
        meshPath: undefined,
        origin: nextGeometry.origin ??
          currentCollision?.origin ?? { ...DEFAULT_LINK.collision.origin },
      };

      if (index === 0) {
        link.collision = nextCollision;
        return;
      }

      const collisionBodies = [...(link.collisionBodies || [])];
      collisionBodies[index - 1] = nextCollision;
      link.collisionBodies = collisionBodies;
    });
  });

  if (shouldUseUsdCollisionVisualProxy(snapshot)) {
    Object.values(links).forEach((link) => {
      if (link.visual.type !== GeometryType.NONE) {
        return;
      }

      const proxyGeometry = getCollisionGeometryVisualProxy(link);
      if (!proxyGeometry) {
        return;
      }

      link.visual = {
        ...link.visual,
        type: proxyGeometry.type,
        dimensions: proxyGeometry.dimensions
          ? { ...proxyGeometry.dimensions }
          : link.visual.dimensions,
        origin: proxyGeometry.origin
          ? {
              xyz: { ...proxyGeometry.origin.xyz },
              rpy: { ...proxyGeometry.origin.rpy },
            }
          : link.visual.origin,
        meshPath: undefined,
      };
    });
  }

  const closedLoopConstraints = populateClosedLoopConstraintWorldAnchors(
    closedLoopConstraintEntries
      .map((entry) => createClosedLoopConstraintFromUsdEntry(entry, linkIdByPath))
      .filter((entry): entry is RobotClosedLoopConstraint => Boolean(entry)),
    links,
    joints,
    rootLinkId,
  );

  return {
    stageSourcePath: normalizedStageSourcePath || null,
    linkIdByPath: Object.fromEntries(linkIdByPath.entries()),
    linkPathById: Object.fromEntries(linkPathById.entries()),
    jointPathById: Object.fromEntries(jointPathById.entries()),
    childLinkPathByJointId: Object.fromEntries(childLinkPathByJointId.entries()),
    parentLinkPathByJointId: Object.fromEntries(parentLinkPathByJointId.entries()),
    runtimeLinkMappingMode: 'robot-data',
    robotData: {
      name: robotName,
      links,
      joints,
      rootLinkId,
      ...(Object.keys(materials).length > 0 ? { materials } : {}),
      ...(closedLoopConstraints.length > 0 ? { closedLoopConstraints } : {}),
    },
  };
}
