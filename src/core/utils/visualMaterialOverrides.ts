import * as THREE from 'three';
import { createMatteMaterial } from './materialFactory';
import { isProtectedMaterial } from './three/materialProtection';
import {
  colorRgbaTupleToHex,
  colorRgbaTupleToOpacity,
  parseThreeColorWithOpacity,
} from './color.ts';
import type { UrdfVisual } from '@/types';

export interface VisualMaterialOverride {
  color?: string;
  texture?: string;
  textureRotation?: number;
  opacity?: number;
  roughness?: number;
  metalness?: number;
  emissive?: string;
  emissiveIntensity?: number;
  alphaTest?: number;
}

function normalizeMaterialValue(value: string | null | undefined): string | undefined {
  const trimmed = String(value || '').trim();
  return trimmed ? trimmed : undefined;
}

function normalizeUnitIntervalValue(value: number | undefined): number | undefined {
  if (!Number.isFinite(value)) {
    return undefined;
  }

  return Math.min(1, Math.max(0, Number(value)));
}

function normalizeNonNegativeValue(value: number | undefined): number | undefined {
  if (!Number.isFinite(value)) {
    return undefined;
  }

  return Math.max(0, Number(value));
}

function isImplicitDefaultVisualColor(value: string | undefined): boolean {
  return (
    String(value || '')
      .trim()
      .toLowerCase() === '#808080'
  );
}

function isNearWhiteTextureBaseColor(color: THREE.Color | null): boolean {
  return Boolean(color && color.r > 0.95 && color.g > 0.95 && color.b > 0.95);
}

function disposeTransientMaterial(material: THREE.Material | undefined): void {
  if (!material) {
    return;
  }

  if (isProtectedMaterial(material)) {
    return;
  }

  material.dispose();
}

export function hasExplicitGeometryMaterialOverride(
  geometry: Pick<UrdfVisual, 'authoredMaterials'> | null | undefined,
): boolean {
  const authoredMaterials =
    geometry?.authoredMaterials?.filter(
      (material) =>
        Boolean(normalizeMaterialValue(material?.color)) ||
        colorRgbaTupleToHex(material?.colorRgba) !== null ||
        Boolean(normalizeMaterialValue(material?.texture)) ||
        normalizeUnitIntervalValue(material?.opacity) !== undefined ||
        normalizeUnitIntervalValue(material?.roughness) !== undefined ||
        normalizeUnitIntervalValue(material?.metalness) !== undefined ||
        Boolean(normalizeMaterialValue(material?.emissive)) ||
        normalizeNonNegativeValue(material?.emissiveIntensity) !== undefined ||
        normalizeUnitIntervalValue(material?.alphaTest) !== undefined,
    ) ?? [];

  if (authoredMaterials.length > 1) {
    return false;
  }

  return authoredMaterials.length === 1;
}

export function resolveVisualMaterialOverrideFromGeometry(
  geometry: Pick<UrdfVisual, 'color' | 'authoredMaterials'> | null | undefined,
): VisualMaterialOverride | null {
  const authoredMaterials =
    geometry?.authoredMaterials?.filter(
      (material) =>
        Boolean(normalizeMaterialValue(material?.color)) ||
        colorRgbaTupleToHex(material?.colorRgba) !== null ||
        Boolean(normalizeMaterialValue(material?.texture)) ||
        normalizeUnitIntervalValue(material?.opacity) !== undefined ||
        normalizeUnitIntervalValue(material?.roughness) !== undefined ||
        normalizeUnitIntervalValue(material?.metalness) !== undefined ||
        Boolean(normalizeMaterialValue(material?.emissive)) ||
        normalizeNonNegativeValue(material?.emissiveIntensity) !== undefined ||
        normalizeUnitIntervalValue(material?.alphaTest) !== undefined,
    ) ?? [];

  // A single VisualMaterialOverride can only represent one uniform override.
  // Multi-material mesh palettes must stay slot-based and be applied by name.
  if (authoredMaterials.length > 1) {
    return null;
  }

  const authoredMaterial = authoredMaterials[0];
  const texture = normalizeMaterialValue(authoredMaterial?.texture);
  const geometryColor = normalizeMaterialValue(geometry?.color);
  const colorRgba = authoredMaterial
    ? colorRgbaTupleToHex(authoredMaterial.colorRgba)
    : null;
  const color =
    normalizeMaterialValue(authoredMaterial?.color) ??
    colorRgba ??
    (texture && isImplicitDefaultVisualColor(geometryColor) ? undefined : geometryColor);
  const textureRotation = authoredMaterial?.textureRotation;
  const opacity =
    normalizeUnitIntervalValue(authoredMaterial?.opacity) ??
    colorRgbaTupleToOpacity(authoredMaterial?.colorRgba);
  const roughness = normalizeUnitIntervalValue(authoredMaterial?.roughness);
  const metalness = normalizeUnitIntervalValue(authoredMaterial?.metalness);
  const emissive = normalizeMaterialValue(authoredMaterial?.emissive);
  const emissiveIntensity = normalizeNonNegativeValue(authoredMaterial?.emissiveIntensity);
  const alphaTest = normalizeUnitIntervalValue(authoredMaterial?.alphaTest);

  if (
    !color &&
    !texture &&
    opacity === undefined &&
    roughness === undefined &&
    metalness === undefined &&
    !emissive &&
    emissiveIntensity === undefined &&
    alphaTest === undefined
  ) {
    return null;
  }

  return {
    ...(color ? { color } : {}),
    ...(texture ? { texture } : {}),
    ...(textureRotation !== undefined ? { textureRotation } : {}),
    ...(opacity !== undefined ? { opacity } : {}),
    ...(roughness !== undefined ? { roughness } : {}),
    ...(metalness !== undefined ? { metalness } : {}),
    ...(emissive ? { emissive } : {}),
    ...(emissiveIntensity !== undefined ? { emissiveIntensity } : {}),
    ...(alphaTest !== undefined ? { alphaTest } : {}),
  };
}

export type VisualMaterialOverrideCache = Map<string, THREE.MeshStandardMaterial>;

export function applyVisualMaterialOverrideToObject(
  object: THREE.Object3D,
  override: VisualMaterialOverride | null | undefined,
  manager?: THREE.LoadingManager,
  cache?: VisualMaterialOverrideCache,
): void {
  const colorOverride = normalizeMaterialValue(override?.color);
  const texturePath = normalizeMaterialValue(override?.texture);
  const opacityOverride = normalizeUnitIntervalValue(override?.opacity);
  const roughnessOverride = normalizeUnitIntervalValue(override?.roughness);
  const metalnessOverride = normalizeUnitIntervalValue(override?.metalness);
  const emissiveOverride = normalizeMaterialValue(override?.emissive);
  const emissiveIntensityOverride = normalizeNonNegativeValue(override?.emissiveIntensity);
  const alphaTestOverride = normalizeUnitIntervalValue(override?.alphaTest);
  const parsedColor = parseThreeColorWithOpacity(colorOverride);
  const parsedEmissive = parseThreeColorWithOpacity(emissiveOverride);
  const hasExplicitColor = Boolean(parsedColor);
  const hasExplicitEmissive = Boolean(parsedEmissive);
  const nextColor = parsedColor?.color ?? (texturePath ? new THREE.Color('#ffffff') : null);
  const nextOpacity = opacityOverride ?? parsedColor?.opacity;
  const nextEmissive = parsedEmissive?.color;
  const replacementMaterials: THREE.MeshStandardMaterial[] = [];

  if (
    !nextColor &&
    !texturePath &&
    nextOpacity === undefined &&
    roughnessOverride === undefined &&
    metalnessOverride === undefined &&
    !nextEmissive &&
    emissiveIntensityOverride === undefined &&
    alphaTestOverride === undefined
  ) {
    return;
  }

  // Cache shares materials across multiple calls within the same robot load
  // when both the override and the relevant source-material properties match.
  // MJCF documents like menagerie's anymal_b dispatch one override per <geom>;
  // before sharing, anymal_b allocated 138 MeshStandardMaterials for the 10
  // distinct named materials, and the cost compounded on every assembly add.
  const hasExplicitOverrideColor = Boolean(parsedColor);
  const cacheKeyBase =
    cache && (hasExplicitOverrideColor || texturePath)
      ? `${nextColor ? nextColor.getHexString() : ''}|tx=${texturePath || ''}|op=${
          nextOpacity ?? 'src'
        }|rg=${roughnessOverride ?? 'src'}|mt=${metalnessOverride ?? 'src'}|em=${
          nextEmissive ? nextEmissive.getHexString() : ''
        }|ei=${emissiveIntensityOverride ?? 'src'}|at=${alphaTestOverride ?? 'src'}`
      : null;

  object.traverse((child) => {
    if (!(child as THREE.Mesh).isMesh) {
      return;
    }

    const mesh = child as THREE.Mesh;
    const currentMaterials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const nextMaterials = currentMaterials.map((material) => {
      const sourceSide = material.side;
      const sourceTransparent = material.transparent || (nextOpacity ?? 1) < 1;
      const sourceMapKey = texturePath ? 'override' : (material as any).map?.uuid || 'none';
      const fullCacheKey =
        cacheKeyBase && cache
          ? `${cacheKeyBase}|side=${sourceSide}|tr=${sourceTransparent ? 1 : 0}|src=${sourceMapKey}|nm=${material.name || ''}`
          : null;

      if (fullCacheKey) {
        const cached = cache!.get(fullCacheKey);
        if (cached) {
          return cached;
        }
      }

      const nextMaterial = createMatteMaterial({
        color: nextColor ?? ((material as any).color?.clone?.() || '#ffffff'),
        // A canonical texture override without authored opacity is opaque by
        // default. Do not inherit a derived loader material's placeholder
        // opacity (MDL render networks can surface an unevaluated zero here).
        opacity: nextOpacity ?? (texturePath ? 1 : (material.opacity ?? 1)),
        transparent: sourceTransparent,
        side: sourceSide,
        map: texturePath ? null : (material as any).map || null,
        roughness: roughnessOverride,
        metalness: metalnessOverride,
        emissive: nextEmissive ?? undefined,
        emissiveIntensity: emissiveIntensityOverride,
        alphaTest: alphaTestOverride,
        name: material.name,
        preserveExactColor: hasExplicitColor || Boolean(texturePath) || hasExplicitEmissive,
      });

      if (texturePath && !hasExplicitColor) {
        nextMaterial.color.set('#ffffff');
        nextMaterial.userData.originalColor = new THREE.Color('#ffffff');
        nextMaterial.toneMapped = false;
      } else if (texturePath && isNearWhiteTextureBaseColor(nextColor)) {
        nextMaterial.color.copy(nextColor!);
        nextMaterial.userData.originalColor = nextMaterial.color.clone();
      }

      if (parsedColor) {
        nextMaterial.userData.urdfColorApplied = true;
        nextMaterial.userData.urdfColor = parsedColor.color.clone();
      }

      if (texturePath) {
        nextMaterial.userData.urdfTextureApplied = true;
        nextMaterial.userData.urdfTexturePath = texturePath;
      }
      if (opacityOverride !== undefined) {
        nextMaterial.userData.urdfOpacityApplied = true;
        nextMaterial.userData.urdfOpacity = opacityOverride;
      }
      if (roughnessOverride !== undefined) {
        nextMaterial.userData.urdfRoughnessApplied = true;
        nextMaterial.userData.urdfRoughness = roughnessOverride;
      }
      if (metalnessOverride !== undefined) {
        nextMaterial.userData.urdfMetalnessApplied = true;
        nextMaterial.userData.urdfMetalness = metalnessOverride;
      }
      if (hasExplicitEmissive) {
        nextMaterial.userData.urdfEmissiveApplied = true;
        nextMaterial.userData.urdfEmissive = parsedEmissive!.color.clone();
      }
      if (emissiveIntensityOverride !== undefined) {
        nextMaterial.userData.urdfEmissiveIntensityApplied = true;
        nextMaterial.userData.urdfEmissiveIntensity = emissiveIntensityOverride;
      }

      if (fullCacheKey && cache) {
        cache.set(fullCacheKey, nextMaterial);
      }

      return nextMaterial;
    });

    mesh.material = Array.isArray(mesh.material) ? nextMaterials : nextMaterials[0];
    currentMaterials.forEach((material) => disposeTransientMaterial(material));
    replacementMaterials.push(...nextMaterials);
  });

  if (!texturePath || replacementMaterials.length === 0) {
    if (texturePath && replacementMaterials.length === 0) {
      console.warn(
        '[EditorViewer] Visual texture override requested, but no mesh materials were available to receive it.',
        texturePath,
      );
    }
    return;
  }

  const loader = new THREE.TextureLoader(manager);
  loader.load(
    texturePath,
    (texture) => {
      texture.colorSpace = THREE.SRGBColorSpace;
      const rotation = override?.textureRotation;
      if (rotation !== undefined && rotation !== 0) {
        texture.rotation = rotation;
        texture.center.set(0.5, 0.5);
      }
      replacementMaterials.forEach((material) => {
        material.map = texture;
        if (!hasExplicitColor && material.color?.isColor) {
          material.color.set('#ffffff');
        }
        material.needsUpdate = true;
      });
    },
    undefined,
    (error) => {
      console.error('[EditorViewer] Failed to apply visual texture override:', texturePath, error);
    },
  );
}
