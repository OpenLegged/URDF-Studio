import * as THREE from 'three';
import { createCanonicalMjcfBuiltinTexture } from '@/core/parsers/mjcf/mjcfBuiltinTextures';
import { createMatteMaterial } from './materialFactory';
import { isProtectedMaterial } from './three/materialProtection';
import {
  colorRgbaTupleToHex,
  colorRgbaTupleToOpacity,
  parseThreeColorWithOpacity,
} from './color.ts';
import type { MjcfBuiltinTexture, UrdfVisual } from '@/types';

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
  textureRepeat?: [number, number];
  mjcfBuiltinTexture?: MjcfBuiltinTexture;
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

function normalizeTextureRepeat(
  value: readonly number[] | undefined,
): [number, number] | undefined {
  if (!value || value.length !== 2 || value.some((entry) => !Number.isFinite(entry))) {
    return undefined;
  }

  return [Number(value[0]), Number(value[1])];
}

function isSupportedMjcfBuiltinTexture(
  value: MjcfBuiltinTexture | undefined,
): value is MjcfBuiltinTexture {
  return Boolean(value && ['checker', 'flat', 'gradient'].includes(value.builtin));
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
        normalizeUnitIntervalValue(material?.alphaTest) !== undefined ||
        normalizeTextureRepeat(material?.textureRepeat) !== undefined ||
        isSupportedMjcfBuiltinTexture(material?.mjcfBuiltinTexture),
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
        normalizeUnitIntervalValue(material?.alphaTest) !== undefined ||
        normalizeTextureRepeat(material?.textureRepeat) !== undefined ||
        isSupportedMjcfBuiltinTexture(material?.mjcfBuiltinTexture),
    ) ?? [];

  // A single VisualMaterialOverride can only represent one uniform override.
  // Multi-material mesh palettes must stay slot-based and be applied by name.
  if (authoredMaterials.length > 1) {
    return null;
  }

  const authoredMaterial = authoredMaterials[0];
  const texture = normalizeMaterialValue(authoredMaterial?.texture);
  const mjcfBuiltinTexture = isSupportedMjcfBuiltinTexture(authoredMaterial?.mjcfBuiltinTexture)
    ? { ...authoredMaterial.mjcfBuiltinTexture }
    : undefined;
  const geometryColor = normalizeMaterialValue(geometry?.color);
  const colorRgba = authoredMaterial ? colorRgbaTupleToHex(authoredMaterial.colorRgba) : null;
  const color =
    normalizeMaterialValue(authoredMaterial?.color) ??
    colorRgba ??
    ((texture || mjcfBuiltinTexture) && isImplicitDefaultVisualColor(geometryColor)
      ? undefined
      : geometryColor);
  const textureRotation = authoredMaterial?.textureRotation;
  const opacity =
    normalizeUnitIntervalValue(authoredMaterial?.opacity) ??
    colorRgbaTupleToOpacity(authoredMaterial?.colorRgba);
  const roughness = normalizeUnitIntervalValue(authoredMaterial?.roughness);
  const metalness = normalizeUnitIntervalValue(authoredMaterial?.metalness);
  const emissive = normalizeMaterialValue(authoredMaterial?.emissive);
  const emissiveIntensity = normalizeNonNegativeValue(authoredMaterial?.emissiveIntensity);
  const alphaTest = normalizeUnitIntervalValue(authoredMaterial?.alphaTest);
  const textureRepeat = normalizeTextureRepeat(authoredMaterial?.textureRepeat);

  if (
    !color &&
    !texture &&
    opacity === undefined &&
    roughness === undefined &&
    metalness === undefined &&
    !emissive &&
    emissiveIntensity === undefined &&
    alphaTest === undefined &&
    textureRepeat === undefined &&
    !mjcfBuiltinTexture
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
    ...(textureRepeat ? { textureRepeat } : {}),
    ...(mjcfBuiltinTexture ? { mjcfBuiltinTexture } : {}),
  };
}

/**
 * Resolve an override from a geometry's *first* authored material.
 *
 * `resolveVisualMaterialOverrideFromGeometry` deliberately returns null for multi-material
 * palettes, because one override cannot describe several slots. But a link can end up
 * holding a whole group's material list while its own geometry is a single mesh — the USD
 * adapter attaches every descriptor in a visual group to the parent link, then hands the
 * sibling descriptors to generated child links. In that shape the palette is unusable and
 * the first entry is the one that belongs to this geometry, since both lists keep
 * descriptor order. Callers use this only after the name-keyed palette has failed to
 * apply; otherwise the mesh would silently keep its loader-default material.
 */
export function resolvePrimaryAuthoredVisualMaterialOverride(
  geometry: Pick<UrdfVisual, 'color' | 'authoredMaterials'> | null | undefined,
): VisualMaterialOverride | null {
  const primaryAuthoredMaterial = geometry?.authoredMaterials?.[0];
  if (!primaryAuthoredMaterial) {
    return null;
  }

  return resolveVisualMaterialOverrideFromGeometry({
    color: geometry?.color,
    authoredMaterials: [primaryAuthoredMaterial],
  });
}

export type VisualMaterialOverrideCache = Map<string, THREE.MeshStandardMaterial>;

/**
 * Resolve which materials a finished texture load should be written to.
 *
 * Returns the materials captured when the override was applied, plus any material
 * currently mounted under `object` that carries the same `urdfTexturePath` marker. The
 * second group covers materials that replaced the captured ones mid-load; without it the
 * texture lands on a detached material and the mesh renders untextured.
 */
function collectOverrideTargetMaterials(
  object: THREE.Object3D,
  texturePath: string,
  capturedMaterials: readonly THREE.MeshStandardMaterial[],
): THREE.MeshStandardMaterial[] {
  const targets = new Set<THREE.MeshStandardMaterial>(capturedMaterials);

  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) {
      return;
    }

    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    materials.forEach((material) => {
      const standardMaterial = material as THREE.MeshStandardMaterial | undefined;
      if (!standardMaterial) {
        return;
      }
      if (standardMaterial.userData?.urdfTexturePath === texturePath) {
        targets.add(standardMaterial);
      }
    });
  });

  return Array.from(targets);
}

function applyMjcfBuiltinTextureToMaterials(
  materials: readonly THREE.MeshStandardMaterial[],
  descriptor: MjcfBuiltinTexture | undefined,
  repeat: [number, number] | undefined,
): void {
  if (!descriptor) {
    return;
  }

  const targets = Array.from(new Set(materials)).filter((material) => !material.map);
  if (targets.length === 0) {
    return;
  }

  const texture = createCanonicalMjcfBuiltinTexture(descriptor, repeat);
  targets.forEach((material) => {
    material.map = texture;
    material.needsUpdate = true;
  });
}

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
  const textureRepeat = normalizeTextureRepeat(override?.textureRepeat);
  const mjcfBuiltinTexture = isSupportedMjcfBuiltinTexture(override?.mjcfBuiltinTexture)
    ? override.mjcfBuiltinTexture
    : undefined;
  const hasTextureOverride = Boolean(texturePath || mjcfBuiltinTexture);
  const parsedColor = parseThreeColorWithOpacity(colorOverride);
  const parsedEmissive = parseThreeColorWithOpacity(emissiveOverride);
  const hasExplicitColor = Boolean(parsedColor);
  const hasExplicitEmissive = Boolean(parsedEmissive);
  const nextColor = parsedColor?.color ?? (hasTextureOverride ? new THREE.Color('#ffffff') : null);
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
    alphaTestOverride === undefined &&
    !hasTextureOverride
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
    cache && (hasExplicitOverrideColor || hasTextureOverride)
      ? `${nextColor ? nextColor.getHexString() : ''}|tx=${texturePath || ''}|mj=${
          mjcfBuiltinTexture ? JSON.stringify(mjcfBuiltinTexture) : ''
        }|rp=${textureRepeat?.join(',') || ''}|op=${
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
      const sourceMapKey = hasTextureOverride ? 'override' : (material as any).map?.uuid || 'none';
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
        map: hasTextureOverride ? null : (material as any).map || null,
        roughness: roughnessOverride,
        metalness: metalnessOverride,
        emissive: nextEmissive ?? undefined,
        emissiveIntensity: emissiveIntensityOverride,
        alphaTest: alphaTestOverride,
        name: material.name,
        preserveExactColor: hasExplicitColor || hasTextureOverride || hasExplicitEmissive,
      });

      if (hasTextureOverride && !hasExplicitColor) {
        nextMaterial.color.set('#ffffff');
        nextMaterial.userData.originalColor = new THREE.Color('#ffffff');
        nextMaterial.toneMapped = false;
      } else if (hasTextureOverride && isNearWhiteTextureBaseColor(nextColor)) {
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
      if (mjcfBuiltinTexture) {
        nextMaterial.userData.mjcfBuiltinTextureApplied = true;
        nextMaterial.userData.mjcfBuiltinTexture = { ...mjcfBuiltinTexture };
        nextMaterial.userData.mjcfTextureRepeat = textureRepeat ? [...textureRepeat] : [1, 1];
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

  applyMjcfBuiltinTextureToMaterials(replacementMaterials, mjcfBuiltinTexture, textureRepeat);

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
      if (textureRepeat) {
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.repeat.set(textureRepeat[0], textureRepeat[1]);
      }
      const rotation = override?.textureRotation;
      if (rotation !== undefined && rotation !== 0) {
        texture.rotation = rotation;
        texture.center.set(0.5, 0.5);
      }
      // Later scene passes (material enhancement, matte normalization) clone and swap a
      // mesh's material while this load is still in flight. Those clones copy `map` from
      // the source, which is still null until we get here, so writing only to the
      // materials captured before the load would silently drop the texture — and it does
      // so size-dependently, since only the slowest textures lose that race. Re-resolve
      // the live materials from the object and match on the marker written above.
      collectOverrideTargetMaterials(object, texturePath, replacementMaterials).forEach(
        (material) => {
          material.map = texture;
          if (!hasExplicitColor && material.color?.isColor) {
            material.color.set('#ffffff');
          }
          material.needsUpdate = true;
        },
      );
    },
    undefined,
    (error) => {
      console.error('[EditorViewer] Failed to apply visual texture override:', texturePath, error);
    },
  );
}
