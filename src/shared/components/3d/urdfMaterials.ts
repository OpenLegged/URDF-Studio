import * as THREE from 'three';
import { createThreeColorFromSRGB, parseThreeColorWithOpacity } from '@/core/utils/color.ts';
import { getVisualGeometryEntries } from '@/core/robot';
import type { UrdfLink, UrdfVisual, UrdfVisualMaterial } from '@/types';
import { isProtectedMaterial } from '@/core/utils/three/materialProtection';
import { disposeMaterial } from '@/shared/utils/three/dispose';

// ============================================================
// URDF Material Parser - Extract rgba colors from URDF XML
// Supports multiple materials per visual (for DAE files with named materials)
// ============================================================
export interface URDFMaterialInfo {
  name?: string;
  rgba?: [number, number, number, number];
  // Named palettes are the only way a multi-material mesh can express per-slot
  // appearance, so they must carry textures too — otherwise a USD/OBJ palette whose
  // entries are textured renders as flat color.
  texture?: string;
  textureRotation?: number;
}

function toMaterialRgba(
  colorValue?: string,
  textureValue?: string,
  colorRgbaValue?: [number, number, number, number],
): [number, number, number, number] | null {
  const raw = String(colorValue || '').trim();
  if (raw) {
    const parsedColor = parseThreeColorWithOpacity(raw);
    if (parsedColor) {
      const color = parsedColor.color.convertLinearToSRGB();
      const alpha =
        parsedColor.opacity ??
        (Array.isArray(colorRgbaValue) &&
        colorRgbaValue.length === 4 &&
        Number.isFinite(colorRgbaValue[3])
          ? colorRgbaValue[3]
          : 1);
      return [color.r, color.g, color.b, Math.min(1, Math.max(0, alpha))];
    }
  }

  if (
    Array.isArray(colorRgbaValue) &&
    colorRgbaValue.length === 4 &&
    colorRgbaValue.every((v) => Number.isFinite(v))
  ) {
    return colorRgbaValue;
  }

  if (!raw) {
    return textureValue ? [1, 1, 1, 1] : null;
  }

  const color = new THREE.Color(raw).convertLinearToSRGB();
  return [color.r, color.g, color.b, 1];
}

function collectAuthoredMaterials(
  geometry: Pick<UrdfVisual, 'authoredMaterials'> | null | undefined,
): UrdfVisualMaterial[] {
  return geometry?.authoredMaterials ?? [];
}

export function collectURDFMaterialsFromVisualGeometry(
  geometry: Pick<UrdfVisual, 'authoredMaterials'> | null | undefined,
): Map<string, URDFMaterialInfo> {
  const namedMaterials = new Map<string, URDFMaterialInfo>();

  for (const material of collectAuthoredMaterials(geometry)) {
    const name = material.name?.trim();
    const rgba = toMaterialRgba(material.color, material.texture, material.colorRgba);
    if (!name || !rgba) {
      continue;
    }

    const texture = material.texture?.trim() || undefined;
    namedMaterials.set(name, {
      name,
      rgba,
      ...(texture ? { texture } : {}),
      ...(material.textureRotation !== undefined
        ? { textureRotation: material.textureRotation }
        : {}),
    });
  }

  return namedMaterials;
}

export function collectURDFMaterialsFromLinks(
  links?: Record<string, UrdfLink> | null,
): Map<string, URDFMaterialInfo> {
  const namedMaterials = new Map<string, URDFMaterialInfo>();

  if (!links) {
    return namedMaterials;
  }

  for (const link of Object.values(links)) {
    for (const entry of getVisualGeometryEntries(link)) {
      for (const [name, material] of collectURDFMaterialsFromVisualGeometry(entry.geometry)) {
        namedMaterials.set(name, material);
      }
    }
  }

  return namedMaterials;
}

export function normalizeURDFMaterialName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/-effect$/i, '')
    .replace(/[._\-\s]+/g, '');
}

function findURDFMaterialByName(
  materials: Map<string, URDFMaterialInfo>,
  materialName: string,
): URDFMaterialInfo | undefined {
  const exactMatch = materials.get(materialName);
  if (exactMatch) {
    return exactMatch;
  }

  const normalizedMaterialName = normalizeURDFMaterialName(materialName);
  if (!normalizedMaterialName) {
    return undefined;
  }

  for (const [candidateName, candidateMaterial] of materials) {
    if (normalizeURDFMaterialName(candidateName) === normalizedMaterialName) {
      return candidateMaterial;
    }
  }

  return undefined;
}

function disposeTransientViewerMaterial(material: THREE.Material): void {
  if (isProtectedMaterial(material)) {
    return;
  }

  disposeMaterial(material, false);
}

function materialUsesAuthoredVertexColors(material: THREE.Material): boolean {
  return (
    (material as { vertexColors?: boolean }).vertexColors === true ||
    material.userData?.usesVertexColors === true
  );
}

function applyNeutralVertexColorMaterialState(material: THREE.Material): void {
  (material as { vertexColors?: boolean }).vertexColors = true;
  const materialColor = (material as { color?: THREE.Color }).color;
  if (materialColor?.isColor) {
    materialColor.set(0xffffff);
  }

  const preservedUserData = { ...(material.userData ?? {}) };
  delete preservedUserData.urdfColorApplied;
  delete preservedUserData.urdfColor;
  material.userData = {
    ...preservedUserData,
    usesVertexColors: true,
  };
  material.toneMapped = false;
}

export function applyURDFMaterialInfoToMaterial(
  material: THREE.Material,
  materials: Map<string, URDFMaterialInfo>,
): THREE.Material {
  const materialName = material.name;
  const urdfMaterial = findURDFMaterialByName(materials, materialName);

  if (!urdfMaterial?.rgba) {
    return material;
  }

  const [r, g, b, a] = urdfMaterial.rgba;
  const color = createThreeColorFromSRGB(r, g, b);
  const cloned = material.clone();

  cloned.name = materialName || urdfMaterial.name || cloned.name;
  if (materialUsesAuthoredVertexColors(material)) {
    applyNeutralVertexColorMaterialState(cloned);
  } else {
    if ((cloned as any).color?.copy) {
      (cloned as any).color.copy(color);
    } else {
      (cloned as any).color = color;
    }
    cloned.userData.urdfColorApplied = true;
    cloned.userData.urdfColor = color.clone();
  }
  if (urdfMaterial.name) {
    cloned.userData.urdfMaterialName = urdfMaterial.name;
  }
  if (a < 1) {
    cloned.transparent = true;
    cloned.opacity = a;
  }
  cloned.needsUpdate = true;

  return cloned;
}

/**
 * Parse URDF materials - returns a Map keyed by material NAME (not link name)
 * This allows matching materials in DAE files by their name
 */
export function parseURDFMaterials(urdfContent: string): Map<string, URDFMaterialInfo> {
  const namedMaterials = new Map<string, URDFMaterialInfo>();

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(urdfContent, 'text/xml');
    const parserError = doc.querySelector('parsererror');
    if (parserError) {
      throw new Error(parserError.textContent?.trim() || 'Invalid URDF XML (parsererror)');
    }

    // First pass: collect global materials (defined at robot level)
    const robotMaterials = doc.querySelectorAll('robot > material');
    robotMaterials.forEach((matEl) => {
      const name = matEl.getAttribute('name');
      if (name) {
        const colorEl = matEl.querySelector('color');
        if (colorEl) {
          const rgbaStr = colorEl.getAttribute('rgba');
          if (rgbaStr) {
            const parts = rgbaStr.trim().split(/\s+/).map(Number);
            if (parts.length >= 3) {
              namedMaterials.set(name, {
                name,
                rgba: [parts[0], parts[1], parts[2], parts[3] ?? 1],
              });
            }
          }
        }
      }
    });

    // Second pass: get ALL materials from each link's visual elements
    // This handles DAE files where each visual can have multiple named materials
    const links = doc.querySelectorAll('link');
    links.forEach((linkEl) => {
      const linkName = linkEl.getAttribute('name');
      if (!linkName) return;

      // Get ALL visual elements (not just first)
      const visualEls = linkEl.querySelectorAll('visual');
      visualEls.forEach((visualEl) => {
        // Get ALL material elements in this visual (not just first)
        const matEls = visualEl.querySelectorAll('material');
        matEls.forEach((matEl) => {
          const matName = matEl.getAttribute('name');
          if (!matName) return;

          const colorEl = matEl.querySelector('color');
          if (colorEl) {
            const rgbaStr = colorEl.getAttribute('rgba');
            if (rgbaStr) {
              const parts = rgbaStr.trim().split(/\s+/).map(Number);
              if (parts.length >= 3) {
                const rgba: [number, number, number, number] = [
                  parts[0],
                  parts[1],
                  parts[2],
                  parts[3] ?? 1,
                ];
                namedMaterials.set(matName, {
                  name: matName,
                  rgba,
                });
              }
            }
          }
        });
      });
    });
  } catch (error) {
    const context = {
      contentLength: urdfContent.length,
      hasRobotTag: urdfContent.includes('<robot'),
    };
    console.error('[URDFMaterials] Failed to parse URDF material definitions.', context, error);
    throw new Error(
      `[URDFMaterials] Failed to parse URDF material definitions (length=${context.contentLength}, hasRobotTag=${context.hasRobotTag}).`,
      { cause: error },
    );
  }

  return namedMaterials;
}

export function resolveURDFMaterialsForScene(
  urdfContent: string | null | undefined,
  robotLinks?: Record<string, UrdfLink> | null,
): Map<string, URDFMaterialInfo> {
  const materialsFromLinks = collectURDFMaterialsFromLinks(robotLinks);
  if (materialsFromLinks.size > 0) {
    return materialsFromLinks;
  }

  const sourceContent = urdfContent ?? '';
  if (!sourceContent.trim()) {
    return new Map();
  }

  return parseURDFMaterials(sourceContent);
}

/**
 * Apply URDF materials to robot model by matching material NAMES
 * This works with DAE files where materials have specific names like "深色橡胶_005-effect"
 */
/**
 * Apply a named material palette onto an object, matching by material name.
 *
 * Returns whether any material was actually replaced. Callers use that to detect a
 * palette that matched nothing — e.g. a mesh whose loader generated its own unnamed
 * material — so they can fall back to a single-material override instead of leaving
 * the mesh on its untextured loader default.
 */
export function applyURDFMaterials(
  robot: THREE.Object3D,
  materials: Map<string, URDFMaterialInfo>,
): boolean {
  if (materials.size === 0) return false;

  let appliedAnyMaterial = false;

  robot.traverse((child: any) => {
    if (!child.isMesh) return;

    const previousMaterial = child.material as THREE.Material | THREE.Material[] | undefined;
    const previousMaterials = Array.isArray(previousMaterial)
      ? previousMaterial
      : previousMaterial
        ? [previousMaterial]
        : [];
    const nextMaterials = previousMaterials.map((material) =>
      applyURDFMaterialInfoToMaterial(material, materials),
    );
    const hasReplacement = nextMaterials.some(
      (material, index) => material !== previousMaterials[index],
    );
    if (!hasReplacement) {
      return;
    }

    appliedAnyMaterial = true;
    child.material = Array.isArray(previousMaterial) ? nextMaterials : nextMaterials[0];
    previousMaterials.forEach((material, index) => {
      if (nextMaterials[index] !== material) {
        disposeTransientViewerMaterial(material);
      }
    });
  });

  return appliedAnyMaterial;
}

/**
 * Load and assign the textures authored on a named material palette.
 *
 * `applyURDFMaterials` only resolves color, because it is synchronous. Textures need a
 * loader, so they are a separate pass — run it after any material normalization, since
 * that step clones materials and would otherwise drop a texture assigned before it.
 *
 * Materials are matched by the `urdfMaterialName` marker that `applyURDFMaterials`
 * writes, and re-resolved from the object when each load finishes so a material swapped
 * in mid-load still receives its texture.
 */
export function applyURDFMaterialTextures(
  robot: THREE.Object3D,
  materials: Map<string, URDFMaterialInfo>,
  manager?: THREE.LoadingManager,
): void {
  const texturedEntries = Array.from(materials.values()).filter((material) =>
    Boolean(material.texture),
  );
  if (texturedEntries.length === 0) {
    return;
  }

  texturedEntries.forEach((paletteMaterial) => {
    const texturePath = paletteMaterial.texture!;
    const loader = new THREE.TextureLoader(manager);
    loader.load(
      texturePath,
      (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        if (paletteMaterial.textureRotation) {
          texture.rotation = paletteMaterial.textureRotation;
          texture.center.set(0.5, 0.5);
        }

        robot.traverse((child) => {
          const mesh = child as THREE.Mesh;
          if (!mesh.isMesh) return;
          const meshMaterials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          meshMaterials.forEach((material: THREE.Material | undefined) => {
            const standardMaterial = material as THREE.MeshStandardMaterial | undefined;
            if (!standardMaterial) {
              return;
            }
            if (standardMaterial.userData?.urdfMaterialName !== paletteMaterial.name) {
              return;
            }
            standardMaterial.map = texture;
            // Photogrammetry meshes often carry both baked vertex colors and a texture.
            // The texture is the higher-fidelity source, so stop modulating by vertex
            // color once it lands, otherwise the two multiply into a darkened surface.
            standardMaterial.vertexColors = false;
            standardMaterial.color.set('#ffffff');
            standardMaterial.userData.urdfTextureApplied = true;
            standardMaterial.userData.urdfTexturePath = texturePath;
            standardMaterial.needsUpdate = true;
          });
        });
      },
      undefined,
      (error) => {
        console.error('[EditorViewer] Failed to apply URDF palette texture:', texturePath, error);
      },
    );
  });
}
