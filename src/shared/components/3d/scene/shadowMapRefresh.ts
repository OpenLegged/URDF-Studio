import type * as THREE from 'three';

type ShadowMapRenderer = Pick<THREE.WebGLRenderer, 'shadowMap'>;

export function requestShadowMapRefresh(
  renderer: ShadowMapRenderer | null | undefined,
): boolean {
  const shadowMap = renderer?.shadowMap;
  if (!shadowMap?.enabled) {
    return false;
  }

  shadowMap.needsUpdate = true;
  return true;
}

/**
 * Runs an auxiliary scene pass without letting it replace the primary scene's
 * shadow map. Some post-processing passes temporarily hide scene objects, so a
 * shadow update during those renders would leave an incomplete map behind.
 */
export function runWithShadowMapUpdatesPaused<T>(
  renderer: ShadowMapRenderer,
  operation: () => T,
): T {
  const { shadowMap } = renderer;
  const previousAutoUpdate = shadowMap.autoUpdate;
  const previousNeedsUpdate = shadowMap.needsUpdate;

  shadowMap.autoUpdate = false;
  shadowMap.needsUpdate = false;
  try {
    return operation();
  } finally {
    shadowMap.autoUpdate = previousAutoUpdate;
    shadowMap.needsUpdate = previousNeedsUpdate;
  }
}
