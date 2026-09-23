import * as THREE from 'three';

type UsdSurfaceMaterial = THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial;

export interface UsdOpacityState {
  opacity?: number | null;
  alphaTest?: number | null;
  opacityEnabled?: boolean | null;
  opacityTextureEnabled?: boolean | null;
  hasAlphaTexture?: boolean;
  forceTransparent?: boolean;
}

/** Keep USD image orientation identical for Hydra and scene projections. */
export function orientUsdTexture(texture: THREE.Texture): void {
  if (!texture.flipY) {
    texture.flipY = true;
    texture.needsUpdate = true;
  }
}

/** Three multiplies maps by these scalar inputs; a USD map replaces its scalar. */
export function applyUsdTextureSlotDefaults(
  material: UsdSurfaceMaterial,
  slot: 'map' | 'emissiveMap' | 'roughnessMap' | 'metalnessMap',
): void {
  switch (slot) {
    case 'map':
      material.color.set(0xffffff);
      material.vertexColors = false;
      break;
    case 'emissiveMap':
      material.emissive.set(0xffffff);
      break;
    case 'roughnessMap':
      material.roughness = 1;
      break;
    case 'metalnessMap':
      material.metalness = 1;
      break;
  }
}

export function usdOpacityTextureEnabled(state: UsdOpacityState): boolean {
  return state.opacityEnabled !== false && state.opacityTextureEnabled !== false;
}

/** Apply one opacity/alpha policy to both USD material render paths. */
export function applyUsdOpacityState(
  material: UsdSurfaceMaterial,
  state: UsdOpacityState,
): void {
  const enabled = state.opacityEnabled !== false;
  const opacity = typeof state.opacity === 'number' && Number.isFinite(state.opacity)
    ? Math.max(0, Math.min(1, state.opacity))
    : 1;
  const alphaTest = typeof state.alphaTest === 'number' && Number.isFinite(state.alphaTest)
    ? Math.max(0, Math.min(1, state.alphaTest))
    : 0;
  material.opacity = enabled ? opacity : 1;
  material.alphaTest = enabled ? alphaTest : 0;
  const blendAlphaTexture = enabled
    && usdOpacityTextureEnabled(state)
    && state.hasAlphaTexture === true
    && material.alphaTest <= 0;
  material.transparent = enabled && (state.forceTransparent === true
    || (material.alphaTest <= 0 && (material.opacity < 1 || blendAlphaTexture)));
  material.depthWrite = !material.transparent;
}
