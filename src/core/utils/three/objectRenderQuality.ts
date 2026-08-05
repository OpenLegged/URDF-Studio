import * as THREE from 'three';
import { isProtectedMaterial } from './materialProtection';

export interface ObjectRenderQuality {
  readonly textureAnisotropy: number;
  readonly materialDithering: boolean;
}

function getObjectMaterials(object: THREE.Object3D): THREE.Material[] {
  const material = (object as THREE.Mesh).material;
  const highlightedBaseMaterial = object.userData?.__urdfHighlightSnapshot?.material as
    | THREE.Material
    | THREE.Material[]
    | undefined;
  const materials = [
    ...(Array.isArray(material) ? material : material ? [material] : []),
    ...(Array.isArray(highlightedBaseMaterial)
      ? highlightedBaseMaterial
      : highlightedBaseMaterial
        ? [highlightedBaseMaterial]
        : []),
  ];
  return Array.from(new Set(materials.filter(Boolean)));
}

export function collectMaterialTextures(material: THREE.Material): THREE.Texture[] {
  const textures = new Set<THREE.Texture>();
  Object.values(material).forEach((value) => {
    if (value instanceof THREE.Texture) {
      textures.add(value);
    }
  });
  const textureUniforms = material.userData?.__urdfStudioTextureUniforms as
    | Record<string, { value?: unknown }>
    | undefined;
  Object.values(textureUniforms ?? {}).forEach((uniform) => {
    if (uniform.value instanceof THREE.Texture) {
      textures.add(uniform.value);
    }
  });
  return Array.from(textures);
}

/**
 * Applies renderer-dependent sampling and banding controls to an owned scene graph.
 * Geometry, materials, and textures keep their existing ownership and disposal lifecycle.
 */
export function applyObjectRenderQuality(
  object: THREE.Object3D,
  quality: ObjectRenderQuality,
): boolean {
  const textureAnisotropy = Math.max(1, Math.round(quality.textureAnisotropy));
  let changed = false;

  object.traverse((child) => {
    getObjectMaterials(child).forEach((material) => {
      if (isProtectedMaterial(material)) {
        return;
      }
      if (material.dithering !== quality.materialDithering) {
        material.dithering = quality.materialDithering;
        material.needsUpdate = true;
        changed = true;
      }

      collectMaterialTextures(material).forEach((texture) => {
        if (texture.anisotropy === textureAnisotropy) {
          return;
        }
        texture.anisotropy = textureAnisotropy;
        texture.needsUpdate = true;
        changed = true;
      });
    });
  });

  return changed;
}
