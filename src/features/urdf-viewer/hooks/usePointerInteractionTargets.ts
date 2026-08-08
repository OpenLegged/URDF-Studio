import { useCallback, useEffect, useRef, type RefObject } from 'react';
import type * as THREE from 'three';
import type { InteractionSelection } from '@/types';
import type { ToolMode, ViewerSceneMode } from '../types';
import { collectGizmoRaycastTargets } from '../utils/raycast';
import {
  collectPickTargets,
  collectSelectableHelperTargets,
  type PickTargetMode,
} from '../utils/pickTargets';

const POINTER_TARGET_PREWARM_IDLE_TIMEOUT_MS = 180;
const POINTER_TARGET_PREWARM_SETTLE_FRAMES = 1;

interface PickTargetCache {
  key: string;
  targets: THREE.Object3D[];
}

interface UsePointerInteractionTargetsOptions {
  robot: THREE.Object3D | null;
  robotVersion: number;
  scene: THREE.Scene;
  toolMode: ToolMode;
  mode: ViewerSceneMode | undefined;
  selection: InteractionSelection | undefined;
  showCollision: boolean;
  showVisual: boolean;
  showCollisionAlwaysOnTop: boolean;
  linkMeshMapRef: RefObject<Map<string, THREE.Mesh[]>>;
}

/** Owns raycast target caches and their idle prewarm lifecycle. */
export function usePointerInteractionTargets({
  robot,
  robotVersion,
  scene,
  toolMode,
  mode,
  selection,
  showCollision,
  showVisual,
  showCollisionAlwaysOnTop,
  linkMeshMapRef,
}: UsePointerInteractionTargetsOptions) {
  const gizmoTargetsRef = useRef<THREE.Object3D[]>([]);
  const gizmoTargetsCacheKeyRef = useRef('');
  const pickTargetCachesRef = useRef<Record<PickTargetMode, PickTargetCache>>({
    all: { key: '', targets: [] },
    visual: { key: '', targets: [] },
    collision: { key: '', targets: [] },
  });

  const resetTargetCaches = useCallback(() => {
    gizmoTargetsRef.current = [];
    gizmoTargetsCacheKeyRef.current = '';
    for (const cache of Object.values(pickTargetCachesRef.current)) {
      cache.key = '';
      cache.targets = [];
    }
  }, []);

  useEffect(() => resetTargetCaches, [resetTargetCaches, robot, robotVersion, scene]);

  const getGizmoTargets = useCallback(() => {
    const nextCacheKey = [
      scene.children.length,
      toolMode,
      mode ?? 'editor',
      selection?.type ?? 'none',
      selection?.id ?? '',
      selection?.helperKind ?? '',
      robot ? 'robot' : 'empty',
    ].join(':');

    if (gizmoTargetsCacheKeyRef.current !== nextCacheKey || gizmoTargetsRef.current.length === 0) {
      gizmoTargetsRef.current = collectGizmoRaycastTargets(scene);
      gizmoTargetsCacheKeyRef.current = nextCacheKey;
    }

    return gizmoTargetsRef.current;
  }, [mode, robot, scene, selection?.helperKind, selection?.id, selection?.type, toolMode]);

  const getPickTargets = useCallback(
    (targetMode: PickTargetMode) => {
      const cache = pickTargetCachesRef.current[targetMode];
      const nextCacheKey = [
        robotVersion,
        targetMode,
        showCollision ? 'col:1' : 'col:0',
        showVisual ? 'vis:1' : 'vis:0',
        showCollisionAlwaysOnTop ? 'col-top:1' : 'col-top:0',
        linkMeshMapRef.current.size,
      ].join(':');

      if (cache.key !== nextCacheKey || cache.targets.length === 0) {
        cache.targets = collectPickTargets(linkMeshMapRef.current, targetMode, robot);
        cache.key = nextCacheKey;
      }

      return cache.targets;
    },
    [linkMeshMapRef, robot, robotVersion, showCollision, showCollisionAlwaysOnTop, showVisual],
  );

  const getHelperTargets = useCallback(() => collectSelectableHelperTargets(robot), [robot]);

  const prewarmPointerInteractionTargets = useCallback(() => {
    if (!robot) {
      return;
    }

    scene.updateMatrixWorld(true);
    getGizmoTargets();
    getPickTargets('all');
    getHelperTargets();
  }, [getGizmoTargets, getHelperTargets, getPickTargets, robot, scene]);

  useEffect(() => {
    if (!robot || typeof window === 'undefined') {
      return;
    }

    const requestIdle =
      typeof window.requestIdleCallback === 'function'
        ? window.requestIdleCallback.bind(window)
        : undefined;
    const cancelIdle =
      typeof window.cancelIdleCallback === 'function'
        ? window.cancelIdleCallback.bind(window)
        : undefined;

    let cancelled = false;
    let frameHandle: number | null = null;
    let idleHandle: number | null = null;
    let timeoutHandle: number | null = null;

    const cancelScheduledWork = () => {
      if (frameHandle !== null) {
        window.cancelAnimationFrame(frameHandle);
        frameHandle = null;
      }
      if (idleHandle !== null && cancelIdle) {
        cancelIdle(idleHandle);
        idleHandle = null;
      }
      if (timeoutHandle !== null) {
        window.clearTimeout(timeoutHandle);
        timeoutHandle = null;
      }
    };
    const runPrewarm = () => {
      if (!cancelled) {
        prewarmPointerInteractionTargets();
      }
    };
    const schedulePrewarm = () => {
      if (cancelled) {
        return;
      }
      if (requestIdle) {
        idleHandle = requestIdle(
          () => {
            idleHandle = null;
            runPrewarm();
          },
          { timeout: POINTER_TARGET_PREWARM_IDLE_TIMEOUT_MS },
        );
        return;
      }
      timeoutHandle = window.setTimeout(() => {
        timeoutHandle = null;
        runPrewarm();
      }, POINTER_TARGET_PREWARM_IDLE_TIMEOUT_MS);
    };
    const waitForStableFrames = (remainingFrames: number) => {
      if (cancelled) {
        return;
      }
      if (remainingFrames <= 0) {
        schedulePrewarm();
        return;
      }
      frameHandle = window.requestAnimationFrame(() => {
        frameHandle = null;
        waitForStableFrames(remainingFrames - 1);
      });
    };

    waitForStableFrames(POINTER_TARGET_PREWARM_SETTLE_FRAMES);

    return () => {
      cancelled = true;
      cancelScheduledWork();
    };
  }, [prewarmPointerInteractionTargets, robot, robotVersion]);

  return { getGizmoTargets, getHelperTargets, getPickTargets };
}
