import type * as THREE from 'three';

type ShadowMapRenderer = Pick<THREE.WebGLRenderer, 'shadowMap'>;

interface ShadowMapRefreshPause {
  owners: Map<symbol, number>;
  previousAutoUpdate: boolean;
  pendingRefresh: boolean;
}

const shadowMapRefreshPauses = new WeakMap<ShadowMapRenderer, ShadowMapRefreshPause>();

export function isShadowMapRefreshPaused(renderer: ShadowMapRenderer): boolean {
  return shadowMapRefreshPauses.has(renderer);
}

export function requestShadowMapRefresh(
  renderer: ShadowMapRenderer | null | undefined,
  { force = false }: { force?: boolean } = {},
): boolean {
  const shadowMap = renderer?.shadowMap;
  if (!renderer || !shadowMap?.enabled) {
    return false;
  }

  const pause = shadowMapRefreshPauses.get(renderer);
  if (pause) {
    pause.pendingRefresh = true;
    if (!force) {
      return false;
    }
  }

  shadowMap.needsUpdate = true;
  return true;
}

/** Defers interactive refresh requests until every renderer-scoped owner releases its pause. */
export function pauseShadowMapRefresh(renderer: ShadowMapRenderer, owner: symbol): () => void {
  const { shadowMap } = renderer;
  let pause = shadowMapRefreshPauses.get(renderer);
  if (!pause) {
    pause = {
      owners: new Map(),
      previousAutoUpdate: shadowMap.autoUpdate,
      pendingRefresh: shadowMap.needsUpdate,
    };
    shadowMapRefreshPauses.set(renderer, pause);
  }
  pause.owners.set(owner, (pause.owners.get(owner) ?? 0) + 1);
  pause.pendingRefresh ||= shadowMap.needsUpdate;
  shadowMap.autoUpdate = false;
  shadowMap.needsUpdate = false;

  const activePause = pause;
  let released = false;
  return () => {
    if (released) {
      return;
    }
    released = true;
    const ownerCount = activePause.owners.get(owner) ?? 0;
    if (ownerCount > 1) {
      activePause.owners.set(owner, ownerCount - 1);
    } else {
      activePause.owners.delete(owner);
    }
    if (activePause.owners.size > 0) {
      return;
    }

    shadowMapRefreshPauses.delete(renderer);
    shadowMap.autoUpdate = activePause.previousAutoUpdate;
    if (shadowMap.enabled && activePause.pendingRefresh) {
      shadowMap.needsUpdate = true;
    }
  };
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
