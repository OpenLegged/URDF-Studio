import {
  GeometryType,
  type RobotData,
  type UrdfLink,
  type UrdfVisual,
  type UrdfVisualMaterial,
} from '@/types';
import { getVisualGeometryByObjectIndex, updateVisualGeometryByObjectIndex } from './visualBodies';

type RobotMaterials = RobotData['materials'];

export const BOX_FACE_MATERIAL_ORDER = ['right', 'left', 'up', 'down', 'front', 'back'] as const;

export type BoxFaceMaterialName = (typeof BOX_FACE_MATERIAL_ORDER)[number];

export interface BoxFaceMaterialEntry {
  face: BoxFaceMaterialName;
  index: number;
  material: UrdfVisualMaterial;
}

const BOX_FACE_SINGLE_MATERIAL_EXPORT_ORDER = [
  'front',
  'right',
  'left',
  'up',
  'down',
  'back',
] as const satisfies readonly BoxFaceMaterialName[];

export interface ResolvedVisualMaterialOverride {
  authoredMaterials?: UrdfVisualMaterial[];
  color?: string;
  colorRgba?: [number, number, number, number];
  texture?: string;
  textureRotation?: number;
  opacity?: number;
  roughness?: number;
  metalness?: number;
  emissive?: string;
  emissiveIntensity?: number;
  alphaTest?: number;
  passes?: UrdfVisualMaterial['passes'];
  source: 'authored' | 'legacy-link' | 'none';
  isMultiMaterial: boolean;
}

function normalizeMaterialValue(value?: string | null): string | undefined {
  const trimmed = String(value || '').trim();
  return trimmed ? trimmed : undefined;
}

function normalizeUnitIntervalValue(value?: number | null): number | undefined {
  if (!Number.isFinite(value)) {
    return undefined;
  }

  return Math.min(1, Math.max(0, Number(value)));
}

function normalizeNonNegativeValue(value?: number | null): number | undefined {
  if (!Number.isFinite(value)) {
    return undefined;
  }

  return Math.max(0, Number(value));
}

export function normalizeAuthoredMaterialEntry(
  material: UrdfVisualMaterial | null | undefined,
): UrdfVisualMaterial | null {
  if (!material) {
    return null;
  }

  const name = normalizeMaterialValue(material.name);
  const color = normalizeMaterialValue(material.color);
  const colorRgba =
    Array.isArray(material.colorRgba) &&
    material.colorRgba.length === 4 &&
    material.colorRgba.every((value) => Number.isFinite(value))
      ? ([
          Number(material.colorRgba[0]),
          Number(material.colorRgba[1]),
          Number(material.colorRgba[2]),
          Number(material.colorRgba[3]),
        ] as [number, number, number, number])
      : undefined;
  const texture = normalizeMaterialValue(material.texture);
  const textureRotation = Number.isFinite(material.textureRotation)
    ? Number(material.textureRotation)
    : undefined;
  const opacity = normalizeUnitIntervalValue(material.opacity);
  const roughness = normalizeUnitIntervalValue(material.roughness);
  const metalness = normalizeUnitIntervalValue(material.metalness);
  const emissive = normalizeMaterialValue(material.emissive);
  const emissiveIntensity = normalizeNonNegativeValue(material.emissiveIntensity);
  const alphaTest = normalizeUnitIntervalValue(material.alphaTest);
  const passes = Array.isArray(material.passes)
    ? material.passes.map((pass) => ({
        ...(normalizeMaterialValue(pass.texture)
          ? { texture: normalizeMaterialValue(pass.texture) }
          : {}),
        ...(pass.sceneBlend === 'alpha_blend' ||
        pass.sceneBlend === 'add' ||
        pass.sceneBlend === 'modulate'
          ? { sceneBlend: pass.sceneBlend }
          : {}),
        ...(typeof pass.depthWrite === 'boolean' ? { depthWrite: pass.depthWrite } : {}),
        ...(typeof pass.lighting === 'boolean' ? { lighting: pass.lighting } : {}),
      }))
    : undefined;

  if (
    !name &&
    !color &&
    !colorRgba &&
    !texture &&
    textureRotation === undefined &&
    opacity === undefined &&
    roughness === undefined &&
    metalness === undefined &&
    !emissive &&
    emissiveIntensity === undefined &&
    alphaTest === undefined &&
    passes === undefined
  ) {
    return null;
  }

  return {
    ...(name ? { name } : {}),
    ...(color ? { color } : {}),
    ...(colorRgba ? { colorRgba } : {}),
    ...(texture ? { texture } : {}),
    ...(textureRotation !== undefined ? { textureRotation } : {}),
    ...(opacity !== undefined ? { opacity } : {}),
    ...(roughness !== undefined ? { roughness } : {}),
    ...(metalness !== undefined ? { metalness } : {}),
    ...(emissive ? { emissive } : {}),
    ...(emissiveIntensity !== undefined ? { emissiveIntensity } : {}),
    ...(alphaTest !== undefined ? { alphaTest } : {}),
    ...(passes !== undefined ? { passes } : {}),
  };
}

function resolveLegacyLinkMaterial(
  materials: RobotMaterials | undefined,
  link: Pick<UrdfLink, 'id' | 'name'>,
): UrdfVisualMaterial | null {
  const material = materials?.[link.id] || materials?.[link.name];
  if (!material) {
    return null;
  }

  return normalizeAuthoredMaterialEntry({
    color: material.color,
    colorRgba: material.colorRgba,
    texture: material.texture,
  });
}

export function getGeometryAuthoredMaterials(
  geometry: Pick<UrdfVisual, 'authoredMaterials'> | null | undefined,
): UrdfVisualMaterial[] {
  if (!Array.isArray(geometry?.authoredMaterials)) {
    return [];
  }

  return geometry.authoredMaterials
    .map((material) => normalizeAuthoredMaterialEntry(material))
    .filter((material): material is UrdfVisualMaterial => Boolean(material));
}

export function getEffectiveGeometryAuthoredMaterials(
  geometry: Pick<UrdfVisual, 'authoredMaterials' | 'color'> | null | undefined,
): UrdfVisualMaterial[] {
  const authoredMaterials = getGeometryAuthoredMaterials(geometry);
  if (authoredMaterials.length !== 1) {
    return authoredMaterials;
  }

  const inlineColor = normalizeMaterialValue(geometry?.color);
  if (!inlineColor || authoredMaterials[0]?.color || authoredMaterials[0]?.colorRgba) {
    return authoredMaterials;
  }

  return [
    {
      ...authoredMaterials[0],
      color: inlineColor,
    },
  ];
}

export function hasMultipleAuthoredMaterials(
  geometry: Pick<UrdfVisual, 'authoredMaterials'> | null | undefined,
): boolean {
  return getGeometryAuthoredMaterials(geometry).length > 1;
}

export function getBoxFaceMaterialPalette(
  geometry: Pick<UrdfVisual, 'type' | 'authoredMaterials'> | null | undefined,
): BoxFaceMaterialEntry[] {
  if (geometry?.type !== GeometryType.BOX) {
    return [];
  }

  const authoredMaterials = getGeometryAuthoredMaterials(geometry);
  if (authoredMaterials.length !== BOX_FACE_MATERIAL_ORDER.length) {
    return [];
  }

  return BOX_FACE_MATERIAL_ORDER.map((face, index) => ({
    face,
    index,
    material: authoredMaterials[index]!,
  }));
}

export function hasBoxFaceMaterialPalette(
  geometry: Pick<UrdfVisual, 'type' | 'authoredMaterials'> | null | undefined,
): boolean {
  return getBoxFaceMaterialPalette(geometry).length === BOX_FACE_MATERIAL_ORDER.length;
}

export function getPreferredSingleMaterialFromBoxFacePalette(
  geometry: Pick<UrdfVisual, 'type' | 'authoredMaterials'> | null | undefined,
): BoxFaceMaterialEntry | null {
  const palette = getBoxFaceMaterialPalette(geometry);
  if (palette.length !== BOX_FACE_MATERIAL_ORDER.length) {
    return null;
  }

  const paletteByFace = new Map(palette.map((entry) => [entry.face, entry]));
  for (const face of BOX_FACE_SINGLE_MATERIAL_EXPORT_ORDER) {
    const entry = paletteByFace.get(face);
    if (entry) {
      return entry;
    }
  }

  return palette[0] || null;
}

export function canEditGeometryBaseTexture(
  geometry: Pick<UrdfVisual, 'authoredMaterials'> | null | undefined,
): boolean {
  return !hasMultipleAuthoredMaterials(geometry);
}

export function resolveVisualMaterialOverride(
  robot: Pick<RobotData, 'materials'>,
  link: Pick<UrdfLink, 'id' | 'name'>,
  geometry: Pick<UrdfVisual, 'authoredMaterials' | 'color'>,
  options: {
    isPrimaryVisual?: boolean;
  } = {},
): ResolvedVisualMaterialOverride {
  const authoredMaterials = getEffectiveGeometryAuthoredMaterials(geometry);
  if (authoredMaterials.length > 0) {
    const [primaryMaterial] = authoredMaterials;
    return {
      authoredMaterials,
      color: primaryMaterial?.color,
      colorRgba: primaryMaterial?.colorRgba,
      texture: primaryMaterial?.texture,
      textureRotation: primaryMaterial?.textureRotation,
      opacity: primaryMaterial?.opacity ?? primaryMaterial?.colorRgba?.[3],
      roughness: primaryMaterial?.roughness,
      metalness: primaryMaterial?.metalness,
      emissive: primaryMaterial?.emissive,
      emissiveIntensity: primaryMaterial?.emissiveIntensity,
      alphaTest: primaryMaterial?.alphaTest,
      passes: primaryMaterial?.passes?.map((pass) => ({ ...pass })),
      source: 'authored',
      isMultiMaterial: authoredMaterials.length > 1,
    };
  }

  if (options.isPrimaryVisual !== false) {
    const legacyLinkMaterial = resolveLegacyLinkMaterial(robot.materials, link);
    if (legacyLinkMaterial) {
      return {
        color: legacyLinkMaterial.color,
        colorRgba: legacyLinkMaterial.colorRgba,
        texture: legacyLinkMaterial.texture,
        source: 'legacy-link',
        isMultiMaterial: false,
      };
    }
  }

  return {
    source: 'none',
    isMultiMaterial: false,
  };
}

export function updateVisualBaseTextureByObjectIndex(
  link: UrdfLink,
  objectIndex: number,
  texture: string | null | undefined,
): UrdfLink {
  const targetGeometry = getVisualGeometryByObjectIndex(link, objectIndex)?.geometry;
  if (!targetGeometry) {
    return link;
  }

  const authoredMaterials = getGeometryAuthoredMaterials(targetGeometry);
  if (authoredMaterials.length > 1) {
    return link;
  }

  const nextTexture = normalizeMaterialValue(texture);
  const nextMaterial = normalizeAuthoredMaterialEntry({
    ...(authoredMaterials[0] || {}),
    ...(nextTexture ? { texture: nextTexture } : { texture: undefined }),
  });

  return updateVisualGeometryByObjectIndex(link, objectIndex, {
    authoredMaterials: nextMaterial ? [nextMaterial] : undefined,
  });
}

export function updateVisualAuthoredMaterialByObjectIndex(
  link: UrdfLink,
  objectIndex: number,
  materialIndex: number,
  updates: Partial<UrdfVisualMaterial>,
): UrdfLink {
  const targetGeometry = getVisualGeometryByObjectIndex(link, objectIndex)?.geometry;
  if (!targetGeometry) {
    return link;
  }

  const authoredMaterials = getGeometryAuthoredMaterials(targetGeometry);
  if (materialIndex < 0 || materialIndex >= authoredMaterials.length) {
    return link;
  }

  const nextAuthoredMaterials = [...authoredMaterials];
  const nextMaterial = normalizeAuthoredMaterialEntry({
    ...nextAuthoredMaterials[materialIndex],
    ...updates,
  });

  if (!nextMaterial) {
    return link;
  }

  nextAuthoredMaterials[materialIndex] = nextMaterial;

  return updateVisualGeometryByObjectIndex(link, objectIndex, {
    authoredMaterials: nextAuthoredMaterials,
  });
}

export function collectGeometryTexturePaths(
  geometry: Pick<UrdfVisual, 'authoredMaterials'> | null | undefined,
): string[] {
  return getGeometryAuthoredMaterials(geometry)
    .map((material) => material.texture)
    .filter((texture): texture is string => Boolean(texture));
}
