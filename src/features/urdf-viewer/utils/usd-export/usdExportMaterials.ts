import { parseThreeColorWithOpacity } from '@/core/utils/color';

import {
  DEFAULT_LINK,
  type RobotState,
  type UrdfLink,
  type UrdfVisual,
  type UrdfVisualMaterial,
} from '../../../../types/index.ts';

import { getDescriptorGeomSubsetSections } from './objBufferReaders.ts';
import {
  getDescriptorLinkPath,
  getDescriptorRole,
  normalizeUsdPath,
} from './usdExportPaths.ts';
import {
  resolveSnapshotAuthoredMaterial,
  resolveSnapshotMaterialColorHex,
} from '@/lib/robot-parser/usd/usdViewerRobotAdapter/usdAdapterConversions';
import {
  normalizeBooleanMaterialValue,
  normalizeColorMaterialValue,
  normalizeScalarMaterialValue,
  normalizeTextureMaterialPath,
  normalizeVector2MaterialValue,
} from './usdMaterialValueNormalization.ts';

import type {
  ExportDescriptor,
  RobotLike,
  SnapshotHost,
  SnapshotMaterialRecord,
  SnapshotMeshDescriptor,
  UsdExportSnapshot,
} from './internalTypes.ts';

const EXPORT_COLOR_PLACEHOLDERS = new Set([
  DEFAULT_LINK.visual.color.toLowerCase(),
  DEFAULT_LINK.collision.color.toLowerCase(),
  '#808080',
  '#3b82f6',
]);

export function getDescriptorMaterialId(
  descriptor: SnapshotMeshDescriptor,
  materialIdOverride?: string | null,
): string {
  return normalizeUsdPath(
    materialIdOverride || descriptor.materialId || descriptor.geometry?.materialId || '',
  );
}

export function hasNonEmptyTexturePath(value: unknown): boolean {
  return Boolean(normalizeTextureMaterialPath(value));
}

const SNAPSHOT_TEXTURE_PATH_KEYS = [
  'mapPath',
  'emissiveMapPath',
  'roughnessMapPath',
  'metalnessMapPath',
  'normalMapPath',
  'aoMapPath',
  'alphaMapPath',
  'clearcoatMapPath',
  'clearcoatRoughnessMapPath',
  'clearcoatNormalMapPath',
  'specularColorMapPath',
  'specularIntensityMapPath',
  'transmissionMapPath',
  'thicknessMapPath',
  'sheenColorMapPath',
  'sheenRoughnessMapPath',
  'anisotropyMapPath',
  'iridescenceMapPath',
  'iridescenceThicknessMapPath',
] as const satisfies readonly (keyof SnapshotMaterialRecord)[];

export function snapshotMaterialUsesTextureCoordinates(
  material: SnapshotMaterialRecord | null | undefined,
): boolean {
  if (!material || typeof material !== 'object') {
    return false;
  }

  return SNAPSHOT_TEXTURE_PATH_KEYS.some((key) => hasNonEmptyTexturePath(material[key]));
}

function authoredMaterialUsesTextureCoordinates(
  material: UrdfVisualMaterial | null | undefined,
): boolean {
  if (!material) {
    return false;
  }

  if (hasNonEmptyTexturePath(material.texture)) {
    return true;
  }

  return Array.isArray(material.passes)
    ? material.passes.some((pass) => hasNonEmptyTexturePath(pass.texture))
    : false;
}

export function visualUsesTextureCoordinates(visual: UrdfVisual | null | undefined): boolean {
  return Array.isArray(visual?.authoredMaterials)
    ? visual.authoredMaterials.some(authoredMaterialUsesTextureCoordinates)
    : false;
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

  // OBJ vertex colors contain RGB only; alpha remains in authored materials.
  const parsed = parseThreeColorWithOpacity(normalized);
  return parsed ? [parsed.color.r, parsed.color.g, parsed.color.b] : null;
}

export function shouldAdoptSnapshotColor(color: string | null | undefined): boolean {
  const normalized = String(color || '')
    .trim()
    .toLowerCase();
  if (!normalized) {
    return true;
  }

  return EXPORT_COLOR_PLACEHOLDERS.has(normalized);
}

export function mergeRobotMaterials(
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

export function getSnapshotMaterialLookup(
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

export function getSnapshotPreferredVisualMaterialLookup(
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

type LiveMaterialScalarOptions = { clamp01?: boolean; min?: number };

const LIVE_BOOLEAN_MATERIAL_FIELDS = [
  ['opacityEnabled', 'opacityEnabled'],
  ['opacityTextureEnabled', 'opacityTextureEnabled'],
  ['emissiveEnabled', 'emissiveEnabled'],
] as const satisfies readonly [keyof SnapshotMaterialRecord, string][];

const LIVE_COLOR_MATERIAL_FIELDS = [
  ['color', 'color'],
  ['emissive', 'emissive'],
  ['specularColor', 'specularColor'],
  ['attenuationColor', 'attenuationColor'],
  ['sheenColor', 'sheenColor'],
] as const satisfies readonly [keyof SnapshotMaterialRecord, string][];

const LIVE_VECTOR2_MATERIAL_FIELDS = [
  ['normalScale', 'normalScale'],
  ['clearcoatNormalScale', 'clearcoatNormalScale'],
] as const satisfies readonly [keyof SnapshotMaterialRecord, string][];

const LIVE_SCALAR_MATERIAL_FIELDS = [
  { target: 'roughness', source: 'roughness', options: { clamp01: true } },
  { target: 'metalness', source: 'metalness', options: { clamp01: true } },
  { target: 'opacity', source: 'opacity', options: { clamp01: true } },
  { target: 'alphaTest', source: 'alphaTest', options: { clamp01: true } },
  { target: 'clearcoat', source: 'clearcoat', options: { clamp01: true } },
  { target: 'clearcoatRoughness', source: 'clearcoatRoughness', options: { clamp01: true } },
  { target: 'specularIntensity', source: 'specularIntensity', options: { clamp01: true } },
  { target: 'transmission', source: 'transmission', options: { clamp01: true } },
  { target: 'thickness', source: 'thickness', options: { min: 0 } },
  { target: 'attenuationDistance', source: 'attenuationDistance', options: { min: 0 } },
  { target: 'aoMapIntensity', source: 'aoMapIntensity', options: { clamp01: true } },
  { target: 'sheen', source: 'sheen', options: { clamp01: true } },
  { target: 'sheenRoughness', source: 'sheenRoughness', options: { clamp01: true } },
  { target: 'iridescence', source: 'iridescence', options: { clamp01: true } },
  { target: 'iridescenceIOR', source: 'iridescenceIOR', options: { min: 1 } },
  { target: 'anisotropy', source: 'anisotropy', options: { clamp01: true } },
  { target: 'anisotropyRotation', source: 'anisotropyRotation' },
  { target: 'emissiveIntensity', source: 'emissiveIntensity', options: { min: 0 } },
  { target: 'ior', source: 'ior', options: { min: 1 } },
] as const satisfies readonly {
  target: keyof SnapshotMaterialRecord;
  source: string;
  options?: LiveMaterialScalarOptions;
}[];

const LIVE_TEXTURE_MATERIAL_FIELDS = [
  ['mapPath', 'map'],
  ['emissiveMapPath', 'emissiveMap'],
  ['roughnessMapPath', 'roughnessMap'],
  ['metalnessMapPath', 'metalnessMap'],
  ['normalMapPath', 'normalMap'],
  ['aoMapPath', 'aoMap'],
  ['alphaMapPath', 'alphaMap'],
  ['clearcoatMapPath', 'clearcoatMap'],
  ['clearcoatRoughnessMapPath', 'clearcoatRoughnessMap'],
  ['clearcoatNormalMapPath', 'clearcoatNormalMap'],
  ['specularColorMapPath', 'specularColorMap'],
  ['specularIntensityMapPath', 'specularIntensityMap'],
  ['transmissionMapPath', 'transmissionMap'],
  ['thicknessMapPath', 'thicknessMap'],
  ['sheenColorMapPath', 'sheenColorMap'],
  ['sheenRoughnessMapPath', 'sheenRoughnessMap'],
  ['anisotropyMapPath', 'anisotropyMap'],
  ['iridescenceMapPath', 'iridescenceMap'],
  ['iridescenceThicknessMapPath', 'iridescenceThicknessMap'],
] as const satisfies readonly [keyof SnapshotMaterialRecord, string][];

function setLiveMaterialRecordValue(
  record: SnapshotMaterialRecord,
  key: keyof SnapshotMaterialRecord,
  value: SnapshotMaterialRecord[keyof SnapshotMaterialRecord] | null | undefined,
): void {
  if (value !== null && value !== undefined) {
    (record as Record<string, unknown>)[key] = value;
  }
}

function copyLiveMaterialFields(
  record: SnapshotMaterialRecord,
  candidate: Record<string, unknown>,
): void {
  LIVE_BOOLEAN_MATERIAL_FIELDS.forEach(([target, source]) => {
    setLiveMaterialRecordValue(record, target, normalizeBooleanMaterialValue(candidate[source]));
  });
  LIVE_COLOR_MATERIAL_FIELDS.forEach(([target, source]) => {
    setLiveMaterialRecordValue(record, target, normalizeColorMaterialValue(candidate[source]));
  });
  LIVE_VECTOR2_MATERIAL_FIELDS.forEach(([target, source]) => {
    setLiveMaterialRecordValue(record, target, normalizeVector2MaterialValue(candidate[source]));
  });
  LIVE_SCALAR_MATERIAL_FIELDS.forEach((field) => {
    setLiveMaterialRecordValue(
      record,
      field.target,
      normalizeScalarMaterialValue(
        candidate[field.source],
        'options' in field ? field.options : undefined,
      ),
    );
  });
  LIVE_TEXTURE_MATERIAL_FIELDS.forEach(([target, source]) => {
    setLiveMaterialRecordValue(record, target, normalizeTextureMaterialPath(candidate[source]));
  });
}

function serializeLivePreferredMaterialRecord(material: unknown): SnapshotMaterialRecord | null {
  if (!material || typeof material !== 'object') {
    return null;
  }

  const candidate = material as Record<string, unknown>;
  const name = String(candidate.name || '').trim();
  const record: SnapshotMaterialRecord = {};
  if (name) {
    record.name = name;
  }
  copyLiveMaterialFields(record, candidate);

  if (!hasSnapshotMaterialRecordContent(record)) {
    return null;
  }

  return record;
}

export function enrichSnapshotWithLivePreferredMaterials(
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

    const preferredMaterial = renderInterface.getPreferredVisualMaterialForLink?.(linkPath, null);
    const liveRecord = serializeLivePreferredMaterialRecord(preferredMaterial);
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

export function shouldAdoptSnapshotMaterialColor(color: string | null | undefined): boolean {
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

export function resolveVisualMaterialFallbackForDescriptor(
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

export function getDescriptorMaterialRecord(
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

export function applyDescriptorMaterialToLink(
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

export function buildGeomSubsetMaterialGroups(
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

  const materialIndexById = new Map<string, number>();
  const lastMaterialIndex = authoredMaterials.length - 1;
  return geomSubsetSections.map((section, index) => {
    const materialId = normalizeUsdPath(section.materialId || '');
    let materialIndex = materialId ? materialIndexById.get(materialId) : undefined;
    if (materialIndex === undefined) {
      // Unbound subsets fall back to their own position, matching the order
      // `buildGeomSubsetDisplayColors` assigns. Keying them off the dedup map
      // size instead would leave the map empty and collapse every unbound
      // subset onto the first authored material.
      materialIndex = Math.min(materialId ? materialIndexById.size : index, lastMaterialIndex);
      if (materialId) {
        materialIndexById.set(materialId, materialIndex);
      }
    }
    return {
      meshKey: '0',
      start: section.start,
      count: section.length,
      materialIndex,
    };
  });
}

export function buildGeomSubsetAuthoredMaterials(
  descriptor: SnapshotMeshDescriptor,
  materialLookup: Map<string, SnapshotMaterialRecord>,
): UrdfVisualMaterial[] | undefined {
  const sections = getDescriptorGeomSubsetSections(descriptor);
  if (sections.length <= 1) {
    return undefined;
  }

  const seenMaterialIds = new Set<string>();
  const authoredMaterials = sections.flatMap((section) => {
    const materialId = normalizeUsdPath(section.materialId || '');
    if (seenMaterialIds.has(materialId)) {
      return [];
    }
    seenMaterialIds.add(materialId);
    return [resolveSnapshotAuthoredMaterial(materialLookup.get(materialId), materialId) || {}];
  });
  return authoredMaterials.some((material) => Object.keys(material).length > 0)
    ? authoredMaterials
    : undefined;
}

export function buildGeomSubsetDisplayColors(
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

export {
  applySnapshotMaterialRecordToLink,
  applyVisualMaterialFallbackToLink,
  colorArrayToVertexColor,
  colorHexToVertexColor,
};
