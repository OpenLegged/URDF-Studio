import { BOX_FACE_MATERIAL_ORDER } from '@/core/robot';
import type {
  MjcfBuiltinCubeFace,
  MjcfBuiltinTexture,
  MjcfBuiltinTextureKind,
  UrdfVisualMaterial,
} from '@/types';

import { buildMjcfCubeAuthoredMaterials, getMjcfCubeTextureFaceRecord } from './mjcfCubeTextures';
import type { MJCFMaterial, MJCFTexture } from './mjcfUtils';

const SUPPORTED_BUILTIN_TEXTURES = new Set<MjcfBuiltinTextureKind>(['checker', 'flat', 'gradient']);

function normalizeBuiltinKind(value: string | undefined): MjcfBuiltinTextureKind | null {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  return SUPPORTED_BUILTIN_TEXTURES.has(normalized as MjcfBuiltinTextureKind)
    ? (normalized as MjcfBuiltinTextureKind)
    : null;
}

function normalizeRgbTuple(value: number[] | undefined): [number, number, number] | undefined {
  if (
    !value ||
    value.length < 3 ||
    value.slice(0, 3).some((channel) => !Number.isFinite(channel))
  ) {
    return undefined;
  }

  return [Number(value[0]), Number(value[1]), Number(value[2])];
}

function normalizeTextureRepeat(value: number[] | undefined): [number, number] | undefined {
  if (!value || value.length < 2 || !Number.isFinite(value[0]) || !Number.isFinite(value[1])) {
    return undefined;
  }

  return [Number(value[0]), Number(value[1])];
}

export function createCanonicalMjcfBuiltinTexture(
  texture: MJCFTexture | null | undefined,
  cubeFace?: MjcfBuiltinCubeFace,
): MjcfBuiltinTexture | null {
  const builtin = normalizeBuiltinKind(texture?.builtin);
  if (!texture || !builtin || texture.file) {
    return null;
  }

  const type = texture.type?.trim();
  const rgb1 = normalizeRgbTuple(texture.rgb1);
  const rgb2 = normalizeRgbTuple(texture.rgb2);
  const mark = texture.mark?.trim();
  const markrgb = normalizeRgbTuple(texture.markrgb);

  return {
    builtin,
    ...(type ? { type } : {}),
    ...(rgb1 ? { rgb1 } : {}),
    ...(rgb2 ? { rgb2 } : {}),
    ...(mark ? { mark } : {}),
    ...(markrgb ? { markrgb } : {}),
    ...(Number.isFinite(texture.width) ? { width: Number(texture.width) } : {}),
    ...(Number.isFinite(texture.height) ? { height: Number(texture.height) } : {}),
    ...(cubeFace ? { cubeFace } : {}),
  };
}

/**
 * Carries MuJoCo-generated textures through RobotState without embedding Three.js objects.
 * Cube textures on box geoms become the canonical six-entry box-face palette.
 */
function buildCanonicalMjcfBuiltinAuthoredMaterials({
  baseMaterial,
  geomType,
  material,
  texture,
}: {
  baseMaterial: UrdfVisualMaterial;
  geomType: string | undefined;
  material: MJCFMaterial | null | undefined;
  texture: MJCFTexture | null | undefined;
}): UrdfVisualMaterial[] | null {
  const textureRepeat = normalizeTextureRepeat(material?.texrepeat);
  const isCubeBox =
    String(texture?.type || '')
      .trim()
      .toLowerCase() === 'cube' &&
    String(geomType || '')
      .trim()
      .toLowerCase() === 'box';
  const faces = isCubeBox ? BOX_FACE_MATERIAL_ORDER : ([undefined] as const);
  const baseTexture = createCanonicalMjcfBuiltinTexture(texture);
  if (!baseTexture) {
    return null;
  }

  return faces.map(
    (cubeFace) =>
      ({
        ...baseMaterial,
        ...(textureRepeat ? { textureRepeat } : {}),
        mjcfBuiltinTexture: {
          ...baseTexture,
          ...(cubeFace ? { cubeFace } : {}),
        },
      }) satisfies UrdfVisualMaterial,
  );
}

export function buildCanonicalMjcfAuthoredMaterials({
  geomType,
  materialName,
  material,
  sharedColor,
  sharedColorRgba,
  texture,
}: {
  geomType: string | undefined;
  materialName: string | undefined;
  material: MJCFMaterial | null | undefined;
  sharedColor: string | undefined;
  sharedColorRgba: [number, number, number, number] | undefined;
  texture: MJCFTexture | null | undefined;
}): UrdfVisualMaterial[] | undefined {
  const textureRepeat = normalizeTextureRepeat(material?.texrepeat);
  const cubeFaceRecord =
    String(geomType || '').toLowerCase() === 'box' ? getMjcfCubeTextureFaceRecord(texture) : null;
  if (cubeFaceRecord) {
    return buildMjcfCubeAuthoredMaterials(cubeFaceRecord, sharedColor, sharedColorRgba).map(
      (entry) => ({
        ...entry,
        ...(textureRepeat ? { textureRepeat } : {}),
      }),
    );
  }

  const baseMaterial: UrdfVisualMaterial = {
    ...(materialName ? { name: materialName } : {}),
    ...(sharedColor ? { color: sharedColor } : {}),
    ...(sharedColorRgba ? { colorRgba: sharedColorRgba } : {}),
    ...(Number.isFinite(material?.shininess)
      ? { roughness: Math.max(0, Math.min(1, 1 - Number(material!.shininess))) }
      : {}),
    ...(Number.isFinite(material?.reflectance)
      ? { metalness: Math.max(0, Math.min(1, Number(material!.reflectance))) }
      : {}),
    ...(Number.isFinite(material?.emission) && sharedColor
      ? {
          emissive: sharedColor,
          emissiveIntensity: Math.max(0, Number(material!.emission)),
        }
      : {}),
  };
  const builtinMaterials = buildCanonicalMjcfBuiltinAuthoredMaterials({
    baseMaterial,
    geomType,
    material,
    texture,
  });
  if (builtinMaterials) {
    return builtinMaterials;
  }

  const texturePath = texture?.file;
  if (!sharedColor && !texturePath) {
    return undefined;
  }

  return [
    {
      ...baseMaterial,
      ...(texturePath ? { texture: texturePath } : {}),
      ...(textureRepeat ? { textureRepeat } : {}),
    },
  ];
}
