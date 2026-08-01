import { Color } from 'three';

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
import { resolveSnapshotAuthoredMaterial } from '../usdViewerRobotAdapter/usdAdapterConversions.ts';

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

export function hasNonEmptyTexturePath(value: unknown): boolean {
  return Boolean(normalizeTextureMaterialPath(value));
}

export function snapshotMaterialUsesTextureCoordinates(
  material: SnapshotMaterialRecord | null | undefined,
): boolean {
  if (!material || typeof material !== 'object') {
    return false;
  }

  return (
    hasNonEmptyTexturePath(material.mapPath) ||
    hasNonEmptyTexturePath(material.emissiveMapPath) ||
    hasNonEmptyTexturePath(material.roughnessMapPath) ||
    hasNonEmptyTexturePath(material.metalnessMapPath) ||
    hasNonEmptyTexturePath(material.normalMapPath) ||
    hasNonEmptyTexturePath(material.aoMapPath) ||
    hasNonEmptyTexturePath(material.alphaMapPath) ||
    hasNonEmptyTexturePath(material.clearcoatMapPath) ||
    hasNonEmptyTexturePath(material.clearcoatRoughnessMapPath) ||
    hasNonEmptyTexturePath(material.clearcoatNormalMapPath) ||
    hasNonEmptyTexturePath(material.specularColorMapPath) ||
    hasNonEmptyTexturePath(material.specularIntensityMapPath) ||
    hasNonEmptyTexturePath(material.transmissionMapPath) ||
    hasNonEmptyTexturePath(material.thicknessMapPath) ||
    hasNonEmptyTexturePath(material.sheenColorMapPath) ||
    hasNonEmptyTexturePath(material.sheenRoughnessMapPath) ||
    hasNonEmptyTexturePath(material.anisotropyMapPath) ||
    hasNonEmptyTexturePath(material.iridescenceMapPath) ||
    hasNonEmptyTexturePath(material.iridescenceThicknessMapPath)
  );
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
  return geomSubsetSections.map((section) => {
    const materialId = normalizeUsdPath(section.materialId || '');
    let materialIndex = materialId ? materialIndexById.get(materialId) : undefined;
    if (materialIndex === undefined) {
      materialIndex = Math.min(materialIndexById.size, authoredMaterials.length - 1);
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
