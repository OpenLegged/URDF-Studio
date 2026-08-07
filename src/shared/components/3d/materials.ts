import * as THREE from 'three';
import { disposeMaterial } from '@/shared/utils/three/dispose';
export { disposeMaterial } from '@/shared/utils/three/dispose';
import { applyVisualMeshShadowPolicy } from '@/core/utils/visualMeshShadowPolicy';
import { parseThreeColorWithOpacity } from '@/core/utils/color.ts';
import { isProtectedMaterial, markMaterialAsShared } from '@/core/utils/three/materialProtection';

// Re-export core material factory so existing consumers keep working
export { MATERIAL_CONFIG, createMatteMaterial } from '@/core/utils/materialFactory';
export type { CreateMaterialOptions } from '@/core/utils/materialFactory';
import { MATERIAL_CONFIG, createMatteMaterial } from '@/core/utils/materialFactory';
import {
  COLLISION_STANDARD_RENDER_ORDER,
  COLLISION_OVERLAY_RENDER_ORDER,
  collisionBaseMaterial,
  configureCollisionOverlayMaterial,
  createCollisionOverlayMaterial,
} from '@/core/utils/three/collisionOverlayMaterial';
export {
  COLLISION_STANDARD_RENDER_ORDER,
  COLLISION_OVERLAY_RENDER_ORDER,
  collisionBaseMaterial,
  configureCollisionOverlayMaterial,
  createCollisionOverlayMaterial,
} from '@/core/utils/three/collisionOverlayMaterial';
const COLLISION_WITH_VISUAL_OPACITY = 0.35;
const COLLISION_ONLY_OPACITY = 0.72;

export function resolveCollisionRenderOrder(alwaysOnTop: boolean): number {
  return alwaysOnTop ? COLLISION_OVERLAY_RENDER_ORDER : COLLISION_STANDARD_RENDER_ORDER;
}

export function syncCollisionBaseMaterialPriority(
  alwaysOnTop: boolean,
  showVisual: boolean = true,
): boolean {
  const nextDepthTest = !alwaysOnTop;
  const nextDepthWrite = false;
  const nextOpacity = showVisual ? COLLISION_WITH_VISUAL_OPACITY : COLLISION_ONLY_OPACITY;
  let changed = false;

  if (
    collisionBaseMaterial.depthTest !== nextDepthTest ||
    collisionBaseMaterial.depthWrite !== nextDepthWrite
  ) {
    collisionBaseMaterial.depthTest = nextDepthTest;
    collisionBaseMaterial.depthWrite = nextDepthWrite;
    collisionBaseMaterial.needsUpdate = true;
    changed = true;
  }

  if (Math.abs(collisionBaseMaterial.opacity - nextOpacity) > 1e-6) {
    collisionBaseMaterial.opacity = nextOpacity;
    collisionBaseMaterial.transparent = nextOpacity < 1;
    collisionBaseMaterial.needsUpdate = true;
    changed = true;
  }

  return changed;
}

/**
 * Applies unified material properties to an existing mesh's materials.
 * Converts any material type to MeshStandardMaterial for PBR rendering.
 *
 * @param mesh - The mesh to apply materials to
 * @param color - Optional color override (uses existing color if not provided)
 * @param opacity - Optional opacity (1.0 = fully opaque)
 */
export function applyMatteMaterialToMesh(
  mesh: THREE.Mesh,
  color?: THREE.ColorRepresentation,
  opacity: number = 1.0,
): void {
  const processMaterial = (oldMat: THREE.Material): THREE.MeshStandardMaterial => {
    const usesVertexColors = Boolean((oldMat as any).vertexColors);
    // Extract existing color if not overridden
    let matColor: THREE.Color;
    if (color !== undefined) {
      matColor = new THREE.Color(color);
    } else if (usesVertexColors) {
      matColor = new THREE.Color(0xffffff);
    } else if ((oldMat as any).color) {
      matColor = (oldMat as any).color.clone();
    } else {
      matColor = new THREE.Color(0x888888);
    }

    // Extract existing texture if any
    const existingMap = (oldMat as any).map || null;

    const newMat = createMatteMaterial({
      color: matColor,
      opacity,
      transparent: opacity < 1.0 || oldMat.transparent,
      side: oldMat.side,
      map: existingMap,
      name: oldMat.name,
      preserveExactColor: usesVertexColors,
    });
    if (usesVertexColors) {
      newMat.vertexColors = true;
      newMat.color.set(0xffffff);
      newMat.toneMapped = false;
      newMat.userData.usesVertexColors = true;
      newMat.userData.originalColor = newMat.color.clone();
    }
    return newMat;
  };

  const originalMaterial = mesh.material as THREE.Material | THREE.Material[] | undefined;
  if (Array.isArray(mesh.material)) {
    mesh.material = mesh.material.map(processMaterial);
  } else if (mesh.material) {
    mesh.material = processMaterial(mesh.material);
  }

  if (originalMaterial) {
    // New materials reuse texture references; dispose only material programs/state.
    // Skip shared singleton materials for safety.
    const mats = Array.isArray(originalMaterial) ? originalMaterial : [originalMaterial];
    mats.forEach((mat) => {
      if (!mat) return;
      if (isProtectedMaterial(mat)) return;
      disposeMaterial(mat, false);
    });
  }
}

// ============================================================
// HIGHLIGHT MATERIALS (for selection/hover)
// ============================================================
export const highlightMaterial = new THREE.MeshStandardMaterial({
  color: 0x60a5fa, // Blue-400
  roughness: 0.5,
  metalness: 0.0,
  emissive: 0x60a5fa,
  emissiveIntensity: 0.3,
  side: THREE.DoubleSide,
});

export const highlightFaceMaterial = new THREE.MeshBasicMaterial({
  color: 0xff0000,
  transparent: true,
  opacity: 0.5,
  side: THREE.DoubleSide,
  depthTest: false,
  depthWrite: false,
});

export const collisionHighlightMaterial = new THREE.MeshStandardMaterial({
  color: 0xfacc15, // Yellow-400
  roughness: 0.5,
  metalness: 0.0,
  emissive: 0xfacc15,
  emissiveIntensity: 0.4,
  side: THREE.DoubleSide,
  transparent: true,
  depthTest: false,
  depthWrite: false,
});
export const measureFirstHighlightMaterial = new THREE.MeshStandardMaterial({
  color: 0x60a5fa, // Blue-400
  roughness: 0.45,
  metalness: 0.0,
  emissive: 0x60a5fa,
  emissiveIntensity: 0.35,
  side: THREE.DoubleSide,
  transparent: true,
  opacity: 0.42,
  depthTest: false,
  depthWrite: false,
});

export const measureSecondHighlightMaterial = new THREE.MeshStandardMaterial({
  color: 0xfbbf24, // Amber-400
  roughness: 0.45,
  metalness: 0.0,
  emissive: 0xf59e0b,
  emissiveIntensity: 0.38,
  side: THREE.DoubleSide,
  transparent: true,
  opacity: 0.42,
  depthTest: false,
  depthWrite: false,
});

export const measureHoverHighlightMaterial = new THREE.MeshStandardMaterial({
  color: 0xe2e8f0, // Slate-200
  roughness: 0.5,
  metalness: 0.0,
  emissive: 0x93c5fd,
  emissiveIntensity: 0.22,
  side: THREE.DoubleSide,
  transparent: true,
  opacity: 0.18,
  depthTest: false,
  depthWrite: false,
});

export type HighlightMaterialRole = 'visual' | 'collision';

const VISUAL_HIGHLIGHT_TINT_COLOR = new THREE.Color(0x93c5fd); // Blue-300
const VISUAL_HIGHLIGHT_EMISSIVE_COLOR = new THREE.Color(0x60a5fa); // Blue-400
const COLLISION_HIGHLIGHT_TINT_COLOR = new THREE.Color(0xfde047); // Yellow-300
const COLLISION_HIGHLIGHT_EMISSIVE_COLOR = new THREE.Color(0xfacc15); // Yellow-400
const MJCF_TENDON_HIGHLIGHT_TINT_COLOR = new THREE.Color(0xffffff);
const MJCF_TENDON_HIGHLIGHT_EMISSIVE_COLOR = new THREE.Color(0xfef08a); // Amber-200

function getHighlightTintConfig(role: HighlightMaterialRole, sourceMaterial?: THREE.Material) {
  if (role === 'visual' && sourceMaterial?.userData?.isMjcfTendonMaterial === true) {
    return {
      tintColor: MJCF_TENDON_HIGHLIGHT_TINT_COLOR,
      tintStrength: 0.72,
      emissiveColor: MJCF_TENDON_HIGHLIGHT_EMISSIVE_COLOR,
      emissiveStrength: 0.82,
      emissiveIntensityFloor: 0.9,
      forceOverlay: true,
      minOpacity: 0.98,
    };
  }

  if (role === 'collision') {
    return {
      tintColor: COLLISION_HIGHLIGHT_TINT_COLOR,
      tintStrength: 0.42,
      emissiveColor: COLLISION_HIGHLIGHT_EMISSIVE_COLOR,
      emissiveStrength: 0.58,
      emissiveIntensityFloor: 0.45,
      forceOverlay: true,
      minOpacity: 0.94,
    };
  }

  return {
    tintColor: VISUAL_HIGHLIGHT_TINT_COLOR,
    tintStrength: 0.38,
    emissiveColor: VISUAL_HIGHLIGHT_EMISSIVE_COLOR,
    emissiveStrength: 0.55,
    emissiveIntensityFloor: 0.38,
    forceOverlay: false,
    minOpacity: 0,
  };
}

export function createHighlightOverrideMaterial(
  sourceMaterial: THREE.Material,
  role: HighlightMaterialRole,
): THREE.Material {
  const highlightMaterialOverride = sourceMaterial.clone();
  const tintConfig = getHighlightTintConfig(role, sourceMaterial);
  const materialWithLighting = highlightMaterialOverride as THREE.Material & {
    color?: THREE.Color;
    emissive?: THREE.Color;
    emissiveIntensity?: number;
  };

  if (materialWithLighting.color?.isColor) {
    materialWithLighting.color = materialWithLighting.color.clone();
    materialWithLighting.color.lerp(tintConfig.tintColor, tintConfig.tintStrength);
  }

  if (materialWithLighting.emissive?.isColor) {
    materialWithLighting.emissive = materialWithLighting.emissive.clone();
    materialWithLighting.emissive.lerp(tintConfig.emissiveColor, tintConfig.emissiveStrength);
    const currentEmissiveIntensity = Number(materialWithLighting.emissiveIntensity ?? 0);
    materialWithLighting.emissiveIntensity = Number.isFinite(currentEmissiveIntensity)
      ? Math.max(currentEmissiveIntensity, tintConfig.emissiveIntensityFloor)
      : tintConfig.emissiveIntensityFloor;
  }

  if (tintConfig.forceOverlay) {
    highlightMaterialOverride.transparent = true;
    highlightMaterialOverride.opacity = Math.max(
      Math.min(highlightMaterialOverride.opacity ?? 1, 1),
      tintConfig.minOpacity,
    );
    highlightMaterialOverride.depthTest = false;
    highlightMaterialOverride.depthWrite = false;
  }

  highlightMaterialOverride.userData = {
    ...highlightMaterialOverride.userData,
    isHighlightOverrideMaterial: true,
    highlightRole: role,
  };
  highlightMaterialOverride.needsUpdate = true;
  return highlightMaterialOverride;
}
markMaterialAsShared(highlightMaterial);
highlightMaterial.userData.isHighlightMaterial = true;
markMaterialAsShared(highlightFaceMaterial);
highlightFaceMaterial.userData.isHighlightMaterial = true;
markMaterialAsShared(collisionHighlightMaterial);
collisionHighlightMaterial.userData.isHighlightMaterial = true;
markMaterialAsShared(measureFirstHighlightMaterial);
measureFirstHighlightMaterial.userData.isHighlightMaterial = true;
markMaterialAsShared(measureSecondHighlightMaterial);
measureSecondHighlightMaterial.userData.isHighlightMaterial = true;
markMaterialAsShared(measureHoverHighlightMaterial);
measureHoverHighlightMaterial.userData.isHighlightMaterial = true;

// Empty raycast function to disable raycast on collision meshes
export const emptyRaycast = () => {};

// ============================================================
// MATERIAL ENHANCEMENT
// Converts all materials to unified MeshStandardMaterial for PBR
// ============================================================

/**
 * Enhances all materials in a robot model with unified PBR finish.
 * Converts all material types to MeshStandardMaterial for IBL support.
 * Preserves original colors while applying consistent PBR properties.
 *
 * @param robotObject - The robot Object3D to enhance
 * @param envMap - Optional environment map (used for realistic reflections)
 */
export const enhanceMaterials = (
  robotObject: THREE.Object3D,
  envMap?: THREE.Texture | null,
  sharedEnhancedMaterialMemo?: Map<THREE.Material, THREE.Material>,
) => {
  let enhancedCount = 0;
  let totalMeshes = 0;
  const disposedMaterials = new Set<THREE.Material>();
  // Within one traverse, many meshes often point at the same source material
  // (e.g. all "metallic_grey" meshes from a URDF/MJCF/MTL). Without memo we
  // would create a fresh MeshStandardMaterial per mesh, multiplying GPU
  // program compiles and VRAM. Memo collapses that to one enhanced material
  // per unique source. Callers that invoke enhanceMaterials once per mesh
  // (notably the MJCF path that flattens each <geom> into a separate visual
  // group) can pass a sharedEnhancedMaterialMemo so cross-mesh reuse still
  // happens; when omitted, the map stays call-local for the legacy behavior.
  const enhancedBySource =
    sharedEnhancedMaterialMemo ?? new Map<THREE.Material, THREE.Material>();
  const enhanceMaterialMemo = (mat: THREE.Material): THREE.Material => {
    const cached = enhancedBySource.get(mat);
    if (cached) return cached;
    const enhanced = enhanceSingleMaterial(mat, envMap);
    enhancedBySource.set(mat, enhanced);
    return enhanced;
  };

  robotObject.traverse((child: any) => {
    if (child.isMesh && child.material) {
      totalMeshes++;

      const originalMaterial = child.material as THREE.Material | THREE.Material[] | undefined;
      const shouldSkipEnhance = (mat: THREE.Material): boolean => isProtectedMaterial(mat);

      if (Array.isArray(child.material)) {
        child.material = child.material.map((mat: THREE.Material) => {
          if (shouldSkipEnhance(mat)) return mat;
          const enhanced = enhanceMaterialMemo(mat);
          if (enhanced !== mat) enhancedCount++;
          return enhanced;
        });
      } else {
        if (!shouldSkipEnhance(child.material)) {
          const enhanced = enhanceMaterialMemo(child.material);
          if (enhanced !== child.material) enhancedCount++;
          child.material = enhanced;
        }
      }

      if (originalMaterial) {
        const mats = Array.isArray(originalMaterial) ? originalMaterial : [originalMaterial];
        for (const mat of mats) {
          if (!mat || disposedMaterials.has(mat)) continue;
          if (shouldSkipEnhance(mat)) continue;
          // Preserve textures because enhanced materials may share same maps.
          disposeMaterial(mat, false);
          disposedMaterials.add(mat);
        }
      }
      applyVisualMeshShadowPolicy(child as THREE.Mesh);
    }
  });
};

/**
 * Enhances a single material with unified PBR properties.
 * Converts any material type to MeshStandardMaterial for IBL support.
 *
 * @param material - The material to enhance
 * @param envMap - Optional environment map (for realistic reflections)
 * @returns Enhanced MeshStandardMaterial
 */
export const enhanceSingleMaterial = (
  material: THREE.Material,
  envMap?: THREE.Texture | null,
): THREE.Material => {
  const usesVertexColors = Boolean((material as any).vertexColors);
  const parsedUrdfColor = material.userData.urdfColorApplied
    ? parseThreeColorWithOpacity(material.userData.urdfColor)
    : null;

  // Extract color from existing material.
  // Vertex-colored materials must stay on a neutral base so Three.js does not
  // multiply authored vertex colors by a named OBJ/URDF material swatch.
  let color: THREE.Color;
  if (parsedUrdfColor) {
    // Preserve URDF-defined color (from applyURDFMaterials)
    color = parsedUrdfColor.color.clone();
  } else if (usesVertexColors) {
    color = new THREE.Color(0xffffff);
  } else if ((material as any).color) {
    color = (material as any).color.clone();
  } else {
    color = new THREE.Color(0x888888);
  }

  const resolveUnitIntervalValue = (value: unknown): number | undefined => {
    if (!Number.isFinite(value)) {
      return undefined;
    }

    return Math.min(1, Math.max(0, Number(value)));
  };

  const resolveNonNegativeValue = (value: unknown): number | undefined => {
    if (!Number.isFinite(value)) {
      return undefined;
    }

    return Math.max(0, Number(value));
  };

  const parsedUrdfEmissive = material.userData?.urdfEmissiveApplied
    ? parseThreeColorWithOpacity(material.userData.urdfEmissive)
    : null;
  const existingEmissive =
    parsedUrdfEmissive?.color ??
    ((material.userData?.originalEmissive as THREE.Color | undefined)?.isColor
      ? (material.userData.originalEmissive as THREE.Color).clone()
      : material.userData?.materialPreset === undefined &&
          material.userData?.urdfColorApplied !== true &&
          material.userData?.urdfTextureApplied !== true &&
          (material as THREE.MeshStandardMaterial).emissive?.isColor
        ? (material as THREE.MeshStandardMaterial).emissive.clone()
        : undefined);
  const existingEmissiveIntensity =
    resolveNonNegativeValue(
      material.userData?.urdfEmissiveIntensityApplied
        ? material.userData.urdfEmissiveIntensity
        : undefined,
    ) ?? resolveNonNegativeValue(material.userData?.originalEmissiveIntensity);
  const existingRoughness =
    resolveUnitIntervalValue(
      material.userData?.urdfRoughnessApplied ? material.userData.urdfRoughness : undefined,
    ) ?? resolveUnitIntervalValue(material.userData?.originalRoughness);
  const existingMetalness =
    resolveUnitIntervalValue(
      material.userData?.urdfMetalnessApplied ? material.userData.urdfMetalness : undefined,
    ) ?? resolveUnitIntervalValue(material.userData?.originalMetalness);

  // Extract existing properties
  const existingMap = (material as any).map || null;
  const existingOpacity = material.opacity !== undefined ? material.opacity : 1.0;
  const existingTransparent = material.transparent || existingOpacity < 1.0;
  const existingSide = material.side !== undefined ? material.side : THREE.DoubleSide;
  const existingDepthTest = material.depthTest;
  const existingDepthWrite = material.depthWrite;
  const existingAlphaTest = material.alphaTest ?? 0;
  const existingPolygonOffset = material.polygonOffset === true;
  const existingPolygonOffsetFactor = material.polygonOffsetFactor ?? 0;
  const existingPolygonOffsetUnits = material.polygonOffsetUnits ?? 0;

  const preserveExactColor =
    Boolean(material.userData.urdfColorApplied) ||
    Boolean(material.userData.urdfTextureApplied) ||
    usesVertexColors ||
    Boolean(existingMap);

  // Route all final visual materials through the shared matte material factory so
  // USD and URDF/MJCF land on the same shading defaults and color normalization.
  const normalizedMatteMaterial = createMatteMaterial({
    color,
    opacity: existingOpacity,
    transparent: existingTransparent,
    side: existingSide,
    map: existingMap,
    roughness: existingRoughness,
    metalness: existingMetalness,
    emissive: existingEmissive,
    emissiveIntensity: existingEmissiveIntensity,
    name: material.name,
    preserveExactColor,
  });

  // Cloning an existing PBR material preserves authored micro-surface data
  // (normal/roughness/metalness/AO maps and MeshPhysical extensions). We then
  // apply the viewer's normalized scalar defaults without flattening those maps.
  const newMat = (material as THREE.MeshStandardMaterial).isMeshStandardMaterial
    ? (material as THREE.MeshStandardMaterial).clone()
    : normalizedMatteMaterial;

  if (newMat !== normalizedMatteMaterial) {
    newMat.color.copy(normalizedMatteMaterial.color);
    newMat.roughness = normalizedMatteMaterial.roughness;
    newMat.metalness = normalizedMatteMaterial.metalness;
    newMat.envMapIntensity = normalizedMatteMaterial.envMapIntensity;
    newMat.emissive.copy(normalizedMatteMaterial.emissive);
    newMat.emissiveIntensity = normalizedMatteMaterial.emissiveIntensity;
    newMat.side = normalizedMatteMaterial.side;
    newMat.transparent = normalizedMatteMaterial.transparent;
    newMat.opacity = normalizedMatteMaterial.opacity;
    newMat.depthWrite = normalizedMatteMaterial.depthWrite;
    newMat.map = normalizedMatteMaterial.map;
    newMat.toneMapped = normalizedMatteMaterial.toneMapped;
    normalizedMatteMaterial.dispose();
  }

  newMat.userData = {
    ...(material.userData ?? {}),
    ...(newMat.userData ?? {}),
  };
  newMat.depthTest = existingDepthTest;
  newMat.depthWrite = existingDepthWrite;
  newMat.alphaTest = existingAlphaTest;
  newMat.polygonOffset = existingPolygonOffset;
  newMat.polygonOffsetFactor = existingPolygonOffsetFactor;
  newMat.polygonOffsetUnits = existingPolygonOffsetUnits;

  if (material.userData.urdfTextureApplied && !material.userData.urdfColorApplied) {
    newMat.color.set('#ffffff');
    newMat.userData.originalColor = newMat.color.clone();
  }

  if (usesVertexColors) {
    newMat.vertexColors = true;
    newMat.color.set(0xffffff);
    newMat.toneMapped = false;
    newMat.userData.usesVertexColors = true;
    newMat.userData.originalColor = newMat.color.clone();
    delete newMat.userData.urdfColorApplied;
    delete newMat.userData.urdfColor;
  }

  // Apply environment map if provided
  if (envMap) {
    newMat.envMap = envMap;
  }

  // Ensure textures use sRGB color space for proper gamma
  if (newMat.map && newMat.map.colorSpace !== THREE.SRGBColorSpace) {
    newMat.map.colorSpace = THREE.SRGBColorSpace;
    newMat.map.needsUpdate = true;
  }
  if (newMat.emissiveMap && newMat.emissiveMap.colorSpace !== THREE.SRGBColorSpace) {
    newMat.emissiveMap.colorSpace = THREE.SRGBColorSpace;
    newMat.emissiveMap.needsUpdate = true;
  }

  // Preserve URDF color flag for future material operations
  if (material.userData.urdfColorApplied && !usesVertexColors) {
    newMat.userData.urdfColorApplied = true;
    newMat.userData.urdfColor = color.clone();
  }
  if (parsedUrdfEmissive?.color) {
    newMat.userData.urdfEmissiveApplied = true;
    newMat.userData.urdfEmissive = parsedUrdfEmissive.color.clone();
  }
  if (material.userData?.urdfRoughnessApplied) {
    newMat.userData.urdfRoughnessApplied = true;
    newMat.userData.urdfRoughness = material.userData.urdfRoughness;
  }
  if (material.userData?.urdfMetalnessApplied) {
    newMat.userData.urdfMetalnessApplied = true;
    newMat.userData.urdfMetalness = material.userData.urdfMetalness;
  }
  if (material.userData?.urdfOpacityApplied) {
    newMat.userData.urdfOpacityApplied = true;
    newMat.userData.urdfOpacity = material.userData.urdfOpacity;
  }
  if (material.userData?.urdfEmissiveIntensityApplied) {
    newMat.userData.urdfEmissiveIntensityApplied = true;
    newMat.userData.urdfEmissiveIntensity = material.userData.urdfEmissiveIntensity;
  }

  newMat.needsUpdate = true;
  return newMat;
};

/**
 * Toggle material enhancement on a robot model.
 * When enabled, applies PBR finish. When disabled, restores original values.
 *
 * @param robotObject - The robot Object3D
 * @param enabled - Whether to enable material enhancement
 * @param envMap - Optional environment map
 */
export const toggleEnhancedLighting = (
  robotObject: THREE.Object3D,
  enabled: boolean,
  envMap?: THREE.Texture | null,
) => {
  let toggledCount = 0;

  robotObject.traverse((child: any) => {
    if (child.isMesh && child.material) {
      const materials = Array.isArray(child.material) ? child.material : [child.material];

      materials.forEach((mat: THREE.Material) => {
        if ((mat as any).isMeshStandardMaterial) {
          const stdMat = mat as THREE.MeshStandardMaterial;

          if (enabled) {
            // Apply PBR finish
            stdMat.roughness = MATERIAL_CONFIG.roughness;
            stdMat.metalness = MATERIAL_CONFIG.metalness;
            stdMat.envMapIntensity = MATERIAL_CONFIG.envMapIntensity;

            if (envMap && !stdMat.envMap) {
              stdMat.envMap = envMap;
            }
          } else {
            // Restore original properties
            stdMat.roughness = stdMat.userData.originalRoughness ?? 0.7;
            stdMat.metalness = stdMat.userData.originalMetalness ?? 0.1;
            stdMat.envMapIntensity = stdMat.userData.originalEnvMapIntensity ?? 0.8;
            if ((stdMat.userData.originalEmissive as THREE.Color | undefined)?.isColor) {
              stdMat.emissive.copy(stdMat.userData.originalEmissive as THREE.Color);
            } else {
              stdMat.emissive.set(0x000000);
            }
            stdMat.emissiveIntensity = stdMat.userData.originalEmissiveIntensity ?? 0;
          }

          stdMat.needsUpdate = true;
          toggledCount++;
        }
      });
    }
  });
};
