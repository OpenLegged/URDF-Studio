import { useCallback, useEffect, useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import type * as THREE from 'three';
import { computeVisibleMeshBounds } from '@/shared/utils/threeBounds';

/**
 * Shared scene-bounds cache for workspace consumers (orbit clip planes,
 * adaptive ground plane). Previously each consumer re-traversed the scene
 * graph on a useFrame loop — that traversal is O(scene) per demanded frame
 * and the dominant cost once several MJCF / multi-link robots are loaded.
 *
 * Strategy:
 * - One cache instance per Three.js scene (stored on `scene.userData` so
 *   multiple consumers in the same R3F tree share the same lazy compute).
 * - Compute on first access after invalidation; reuse otherwise.
 * - Invalidation triggers:
 *     * initial mount (effect-driven first compute)
 *     * scene 'childadded' / 'childremoved' events (robot load/unload)
 *     * explicit caller-driven `invalidate()` for in-place workspace
 *       transforms that do not add or remove scene children
 */

interface BoundsCache {
  clipBounds: THREE.Box3 | null;
  panBounds: THREE.Box3 | null;
  layoutBounds: THREE.Box3 | null;
  clipDirty: boolean;
  panDirty: boolean;
  layoutDirty: boolean;
}

interface SceneBoundsCacheHandle {
  cache: BoundsCache;
  refCount: number;
  invalidate: () => void;
}

const SCENE_CACHE_KEY = '__workspaceSceneBoundsCache' as const;

interface SceneWithCache extends THREE.Scene {
  userData: THREE.Scene['userData'] & {
    [SCENE_CACHE_KEY]?: SceneBoundsCacheHandle;
  };
}

function createBoundsCache(): BoundsCache {
  return {
    clipBounds: null,
    panBounds: null,
    layoutBounds: null,
    clipDirty: true,
    panDirty: true,
    layoutDirty: true,
  };
}

function ensureHandle(scene: THREE.Scene): SceneBoundsCacheHandle {
  const sceneWithCache = scene as SceneWithCache;
  let handle = sceneWithCache.userData[SCENE_CACHE_KEY];
  if (handle) {
    return handle;
  }

  const cache = createBoundsCache();
  const invalidate = () => {
    cache.clipDirty = true;
    cache.panDirty = true;
    cache.layoutDirty = true;
  };

  handle = {
    cache,
    refCount: 0,
    invalidate,
  };
  sceneWithCache.userData[SCENE_CACHE_KEY] = handle;
  return handle;
}

function releaseHandle(scene: THREE.Scene): void {
  const sceneWithCache = scene as SceneWithCache;
  const handle = sceneWithCache.userData[SCENE_CACHE_KEY];
  if (!handle) {
    return;
  }
  if (handle.refCount <= 0) {
    delete sceneWithCache.userData[SCENE_CACHE_KEY];
  }
}

export interface SceneBoundsCacheApi {
  /**
   * Bounds used to clamp the perspective far plane. Includes ground plane
   * helpers so the depth budget covers the visible reference grid as well as
   * the robot. Returns `null` when the visible scene has no bounded meshes.
   */
  getClipBounds: () => THREE.Box3 | null;
  /**
   * Bounds used to scale orbit pan / zoom speed. Excludes ground plane
   * helpers because pan tuning should respond to the robot footprint, not
   * the grid (which is far larger).
   */
  getPanBounds: () => THREE.Box3 | null;
  /**
   * Bounds used by the adaptive ground plane to choose its size and center.
   * Same scope as `panBounds` today; kept as a separate accessor in case
   * future work needs to diverge (e.g. exclude assembly-bridge helpers).
   */
  getLayoutBounds: () => THREE.Box3 | null;
  /**
   * Mark all cached bounds dirty so the next accessor call recomputes.
   * Cheap; safe to call from event handlers.
   */
  invalidate: () => void;
}

/**
 * React hook exposing a shared scene-bounds cache. Subscribes to scene
 * mutation events (`childadded` / `childremoved`) so robot load/unload
 * auto-invalidates the cache. Consumers compute on demand via the returned
 * accessors.
 */
export function useSceneBoundsCache(): SceneBoundsCacheApi {
  const scene = useThree((state) => state.scene);

  // Resolve the per-scene cache once per scene reference. Multiple
  // consumers in the same R3F canvas share the same compute results.
  const handle = useMemo(() => ensureHandle(scene), [scene]);

  useEffect(() => {
    handle.refCount += 1;

    // First mount (or scene swap) needs a fresh compute on next access.
    handle.invalidate();

    const onChildAdded = () => {
      handle.invalidate();
    };
    const onChildRemoved = () => {
      handle.invalidate();
    };

    // Scene mutations bubble through `childadded` / `childremoved` events on
    // the parent that mutated. Robots and helpers are added directly under
    // the scene root via R3F primitives, so listening on the scene root
    // captures the common case (robot load, snapshot helpers, etc.).
    scene.addEventListener('childadded' as never, onChildAdded as never);
    scene.addEventListener('childremoved' as never, onChildRemoved as never);

    return () => {
      scene.removeEventListener('childadded' as never, onChildAdded as never);
      scene.removeEventListener('childremoved' as never, onChildRemoved as never);
      handle.refCount -= 1;
      releaseHandle(scene);
    };
  }, [handle, scene]);

  const getClipBounds = useCallback(() => {
    const cache = handle.cache;
    if (cache.clipDirty) {
      cache.clipBounds = computeVisibleMeshBounds(scene, {
        includeGroundPlaneHelpers: true,
      });
      cache.clipDirty = false;
    }
    return cache.clipBounds;
  }, [handle, scene]);

  const getPanBounds = useCallback(() => {
    const cache = handle.cache;
    if (cache.panDirty) {
      cache.panBounds = computeVisibleMeshBounds(scene);
      cache.panDirty = false;
    }
    return cache.panBounds;
  }, [handle, scene]);

  const getLayoutBounds = useCallback(() => {
    const cache = handle.cache;
    if (cache.layoutDirty) {
      cache.layoutBounds = computeVisibleMeshBounds(scene);
      cache.layoutDirty = false;
    }
    return cache.layoutBounds;
  }, [handle, scene]);

  const invalidate = useCallback(() => {
    handle.invalidate();
  }, [handle]);

  return useMemo(
    () => ({ getClipBounds, getPanBounds, getLayoutBounds, invalidate }),
    [getClipBounds, getPanBounds, getLayoutBounds, invalidate],
  );
}
