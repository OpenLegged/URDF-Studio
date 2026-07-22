/**
 * Unified Renderer Backend Hook
 *
 * Manages the lifecycle of a RobotRendererBackend instance and provides
 * a consistent interface for loading and rendering robots across all formats.
 */

import { startTransition, useCallback, useMemo, useState, useRef, useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import type * as THREE from 'three';
import {
  createRendererBackend,
  type RobotRendererBackend,
  type RendererSceneProps,
} from '@/features/urdf-viewer/renderers';
import type { RuntimeRobotObject } from '@/shared/components/3d/runtimeRobotTypes';
import { copyRobotRootTransform } from '@/shared/components/3d/robotPositioning';
import { buildColladaRootNormalizationHints } from '@/core/loaders';
import { getSourceFileDirectory } from '@/core/parsers/meshPathUtils';
import type { UrdfJoint, UrdfLink } from '@/types';
import type { ViewerDocumentLoadEvent, ViewerRuntimeStageBridge } from '../types';
import {
  createMemoizedRendererBackendLoadScopeKey,
  type RendererBackendLoadScopeKeyMemo,
} from '../utils/rendererBackendLoadScope';
import {
  detectGeometryPatches,
  detectJointPatches,
} from '../utils/robotLoaderDiff';
import { applyGeometryPatchesInPlace } from '../utils/robotLoaderGeometryPatch';
import { patchJointsInPlace } from '../utils/robotLoaderJointPatch';
import {
  isSceneCompileWarmupBlocked,
  warmupSceneCompile,
} from '@/shared/components/3d/scene/SceneCompileWarmup';

export interface UseRendererBackendOptions extends RendererSceneProps {
  /** Reload token to force re-loading */
  reloadToken?: number;
  /** Initial robot object (for hot reloading) */
  initialRobot?: RuntimeRobotObject | null;
  /** Callback when robot is loaded */
  onRobotLoaded?: (robot: RuntimeRobotObject) => void;
}

export interface UseRendererBackendResult {
  /** The robot scene object */
  robot: RuntimeRobotObject | null;
  /** Map of link ID to meshes */
  linkMeshMapRef: React.RefObject<Map<string, THREE.Mesh[]>>;
  /** Robot links data */
  robotLinks: Record<string, UrdfLink>;
  /** Robot joints data */
  robotJoints: Record<string, UrdfJoint>;
  /** Root link ID */
  rootLinkId: string | null;
  /** Backend instance */
  backend: RobotRendererBackend | null;
  /** Whether currently loading */
  isLoading: boolean;
  /** Loading progress */
  loadingProgress: ViewerDocumentLoadEvent | null;
  /** Runtime version for change tracking */
  robotVersion: number;
  /** Robot reference */
  robotRef: React.RefObject<RuntimeRobotObject | null>;
  /** Error message if loading failed */
  error: string | null;
}

type RuntimeCollisionHost = RuntimeRobotObject & {
  colliders?: Record<string, unknown>;
};

function waitForAnimationFrame(): Promise<void> {
  if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
}

function hasRuntimeCollisionGroups(robotObject: RuntimeRobotObject | null): boolean {
  if (!robotObject) {
    return false;
  }

  const colliders = (robotObject as RuntimeCollisionHost).colliders;
  if (colliders && Object.keys(colliders).length > 0) {
    return true;
  }

  let hasCollisionGroup = false;
  robotObject.traverse((child) => {
    if ((child as { isURDFCollider?: boolean }).isURDFCollider === true) {
      hasCollisionGroup = true;
    }
  });
  return hasCollisionGroup;
}

export function useRendererBackend(
  options: UseRendererBackendOptions,
): UseRendererBackendResult {
  const threeState = useThree();
  const { gl, invalidate, camera, scene } = threeState;
  const controls = (threeState as typeof threeState & { controls?: unknown }).controls;
  const {
    sourceFile,
    availableFiles,
    assets,
    groundPlaneOffset,
    showVisual,
    showCollision,
    showCollisionAlwaysOnTop,
    allowUrdfXmlFallback = false,
    robotLinks: providedRobotLinks,
    robotJoints: providedRobotJoints,
    robotData,
    initialJointAngles,
    onRuntimeRobotLoaded,
    runtimeBridge,
    reloadToken = 0,
    initialRobot = null,
    onRobotLoaded,
    onDocumentLoadEvent,
  } = options;

  // State
  const [robot, setRobot] = useState<RuntimeRobotObject | null>(() => initialRobot);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState<ViewerDocumentLoadEvent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [robotVersion, setRobotVersion] = useState(0);
  const [resolvedRobotLinks, setResolvedRobotLinks] = useState<Record<string, UrdfLink>>(
    () => robotData?.links ?? providedRobotLinks ?? {},
  );
  const [resolvedRobotJoints, setResolvedRobotJoints] = useState<Record<string, UrdfJoint>>(
    () => robotData?.joints ?? providedRobotJoints ?? {},
  );
  const [resolvedRootLinkId, setResolvedRootLinkId] = useState<string | null>(
    () => robotData?.rootLinkId ?? null,
  );
  const [patchReloadRevision, setPatchReloadRevision] = useState(0);

  // Refs
  const robotRef = useRef<RuntimeRobotObject | null>(initialRobot);
  const backendRef = useRef<RobotRendererBackend | null>(null);
  const inFlightBackendRef = useRef<RobotRendererBackend | null>(null);
  const pendingCommitDisposeBackendsRef = useRef<Set<RobotRendererBackend>>(new Set());
  const linkMeshMapRef = useRef<Map<string, THREE.Mesh[]>>(new Map());
  const isMountedRef = useRef(true);
  const loadIdRef = useRef(0);
  const onRobotLoadedRef = useRef(onRobotLoaded);
  const onDocumentLoadEventRef = useRef(onDocumentLoadEvent);
  const onRuntimeRobotLoadedRef = useRef(onRuntimeRobotLoaded);
  const runtimeBridgeRef = useRef(runtimeBridge);
  const activeLoadScopeKeyRef = useRef<string | null>(null);
  const activeBaseLoadScopeKeyRef = useRef<string | null>(null);
  const mountedRobotHasCollisionGroupsRef = useRef(false);
  const loadScopeKeyMemoRef = useRef<RendererBackendLoadScopeKeyMemo>({});
  const previousPatchRobotLinksRef = useRef<Record<string, UrdfLink> | null>(
    robotData?.links ?? providedRobotLinks ?? null,
  );
  const previousPatchRobotJointsRef = useRef<Record<string, UrdfJoint> | null>(
    robotData?.joints ?? providedRobotJoints ?? null,
  );
  const runtimeBridgeProxyRef = useRef<ViewerRuntimeStageBridge>({
    onRobotResolved: (robot) => runtimeBridgeRef.current?.onRobotResolved?.(robot),
    onSelectionChange: (type, id, subType, helperKind) =>
      runtimeBridgeRef.current?.onSelectionChange?.(type, id, subType, helperKind),
    onActiveJointChange: (jointName) =>
      runtimeBridgeRef.current?.onActiveJointChange?.(jointName),
    onJointAnglesChange: (jointAngles) =>
      runtimeBridgeRef.current?.onJointAnglesChange?.(jointAngles),
  });

  const baseLoadScopeKey = useMemo(
    () =>
      createMemoizedRendererBackendLoadScopeKey(
        {
          sourceFile,
          availableFiles,
          assets,
          reloadToken,
          allowUrdfXmlFallback,
          robotLinks: providedRobotLinks,
          robotJoints: providedRobotJoints,
          robotData,
        },
        loadScopeKeyMemoRef.current,
      ),
    [
      assets,
      allowUrdfXmlFallback,
      availableFiles,
      providedRobotJoints,
      providedRobotLinks,
      reloadToken,
      robotData,
      sourceFile,
    ],
  );
  const shouldParseCollisionMeshes =
    showCollision === true ||
    (activeBaseLoadScopeKeyRef.current === baseLoadScopeKey &&
      mountedRobotHasCollisionGroupsRef.current);
  const loadScopeKey = useMemo(
    () =>
      [
        baseLoadScopeKey,
        `patch-reload:${patchReloadRevision}`,
        `parse-collision:${shouldParseCollisionMeshes ? '1' : '0'}`,
      ].join('|'),
    [baseLoadScopeKey, patchReloadRevision, shouldParseCollisionMeshes],
  );

  const emitDocumentLoadEvent = useCallback(
    (event: ViewerDocumentLoadEvent) => {
      if (!isMountedRef.current) return;
      // Filter out planned abort errors from backends that aren't the current one
      if (event.status === 'error' && event.error === 'Load aborted') {
        return;
      }
      setLoadingProgress(event);
      onDocumentLoadEventRef.current?.(event);
    },
    [setLoadingProgress],
  );

  const latestScenePropsRef = useRef<RendererSceneProps | null>(null);
  latestScenePropsRef.current = {
    sourceFile,
    availableFiles,
    assets,
    groundPlaneOffset,
    showVisual,
    showCollision,
    parseCollisionMeshes: shouldParseCollisionMeshes,
    showCollisionAlwaysOnTop,
    allowUrdfXmlFallback,
    robotLinks: providedRobotLinks,
    robotJoints: providedRobotJoints,
    robotData,
    initialJointAngles,
    onRuntimeRobotLoaded: (runtimeRobot) => onRuntimeRobotLoadedRef.current?.(runtimeRobot),
    runtimeBridge: runtimeBridge ? runtimeBridgeProxyRef.current : undefined,
    runtimeHost: { camera, scene, controls },
    invalidate,
    onDocumentLoadEvent: emitDocumentLoadEvent,
  };

  const prepareRobotHandoff = useCallback(
    async (nextRobot: RuntimeRobotObject) => {
      nextRobot.updateMatrixWorld(true);

      if (sourceFile.format !== 'mjcf' && !isSceneCompileWarmupBlocked(gl)) {
        try {
          await warmupSceneCompile(gl, nextRobot, camera);
        } catch (compileError) {
          if (import.meta.env.DEV) {
            console.warn(
              '[useRendererBackend] Failed to precompile robot before handoff:',
              compileError,
            );
          }
        }
      }

      await waitForAnimationFrame();
    },
    [camera, gl, sourceFile.format],
  );

  // Keep refs in sync
  useEffect(() => {
    onRobotLoadedRef.current = onRobotLoaded;
  }, [onRobotLoaded]);

  useEffect(() => {
    onDocumentLoadEventRef.current = onDocumentLoadEvent;
  }, [onDocumentLoadEvent]);

  useEffect(() => {
    onRuntimeRobotLoadedRef.current = onRuntimeRobotLoaded;
  }, [onRuntimeRobotLoaded]);

  useEffect(() => {
    runtimeBridgeRef.current = runtimeBridge;
  }, [runtimeBridge]);

  // Sync robot state with ref
  useEffect(() => {
    robotRef.current = robot;
  }, [robot]);

  useEffect(() => {
    if (!robot || pendingCommitDisposeBackendsRef.current.size === 0) {
      return;
    }

    // This effect is the handoff acknowledgement: R3F has committed the new
    // <primitive> before passive effects run, so older scene resources are no
    // longer reachable from the visible graph. A fixed RAF delay cannot provide
    // that guarantee because a transition may be postponed by urgent updates.
    pendingCommitDisposeBackendsRef.current.forEach((backend) => {
      if (
        backend === backendRef.current
        || backend === inFlightBackendRef.current
        || backend.getRobotObject() === robot
      ) {
        return;
      }

      pendingCommitDisposeBackendsRef.current.delete(backend);
      backend.dispose();
    });
  }, [robot]);

  useEffect(() => {
    const nextLinks = robotData?.links ?? providedRobotLinks ?? null;
    const previousLinks = previousPatchRobotLinksRef.current;
    previousPatchRobotLinksRef.current = nextLinks;

    if (!previousLinks || !nextLinks || !robotRef.current) {
      return;
    }

    const patches = detectGeometryPatches(previousLinks, nextLinks);
    if (!patches || patches.length === 0) {
      return;
    }

    // A scope-changing edit may start a full reload while the previous runtime
    // intentionally remains visible. Apply validated geometry patches to that
    // visible runtime as an interim update, but do not promote its active scope;
    // activeLoadScopeKeyRef is committed only after a backend handoff succeeds.
    const currentRobot = robotRef.current;
    const applied = applyGeometryPatchesInPlace({
      robotModel: currentRobot,
      patches,
      assets,
      sourceFileDir: getSourceFileDirectory(sourceFile.name),
      colladaRootNormalizationHints: buildColladaRootNormalizationHints(nextLinks),
      showVisual: showVisual ?? true,
      showCollision: showCollision ?? false,
      linkMeshMapRef,
      invalidate,
      isPatchTargetValid: () => isMountedRef.current && robotRef.current === currentRobot,
    });

    if (!applied) {
      const message = 'Failed to apply a runtime geometry patch in place';
      console.error('[useRendererBackend]', message, patches);
      setError(message);
      setPatchReloadRevision((revision) => revision + 1);
      return;
    }

    setResolvedRobotLinks(nextLinks);
    if (robotData?.rootLinkId) {
      setResolvedRootLinkId(robotData.rootLinkId);
    }
    setRobotVersion((version) => version + 1);
    setError(null);
  }, [
    assets,
    invalidate,
    linkMeshMapRef,
    loadScopeKey,
    providedRobotLinks,
    robotData,
    showCollision,
    showVisual,
    sourceFile,
  ]);

  useEffect(() => {
    const nextJoints = robotData?.joints ?? providedRobotJoints ?? null;
    const previousJoints = previousPatchRobotJointsRef.current;
    previousPatchRobotJointsRef.current = nextJoints;

    if (!previousJoints || !nextJoints || !robotRef.current) {
      return;
    }

    if (activeLoadScopeKeyRef.current !== loadScopeKey) {
      return;
    }

    const patches = detectJointPatches(previousJoints, nextJoints);
    if (!patches || patches.length === 0) {
      return;
    }

    const currentRobot = robotRef.current;
    const applied = patchJointsInPlace(currentRobot, patches, invalidate);
    if (!applied) {
      const message = 'Failed to apply a runtime joint patch in place';
      console.error('[useRendererBackend]', message, patches);
      setError(message);
      setPatchReloadRevision((revision) => revision + 1);
      return;
    }

    setResolvedRobotJoints(nextJoints);
    if (robotData?.rootLinkId) {
      setResolvedRootLinkId(robotData.rootLinkId);
    }
    setRobotVersion((version) => version + 1);
    setError(null);
  }, [invalidate, loadScopeKey, providedRobotJoints, robotData]);

  // Track component mount state
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    const pendingCommitDisposeBackends = pendingCommitDisposeBackendsRef.current;
    return () => {
      pendingCommitDisposeBackends.forEach((backend) => {
        if (backend !== inFlightBackendRef.current && backend !== backendRef.current) {
          backend.dispose();
        }
      });
      pendingCommitDisposeBackends.clear();
      if (inFlightBackendRef.current && inFlightBackendRef.current !== backendRef.current) {
        inFlightBackendRef.current.dispose();
        inFlightBackendRef.current = null;
      }
      if (backendRef.current) {
        backendRef.current.dispose();
        backendRef.current = null;
      }
      activeLoadScopeKeyRef.current = null;
      activeBaseLoadScopeKeyRef.current = null;
      mountedRobotHasCollisionGroupsRef.current = false;
    };
  }, []);

  // Load robot
  useEffect(() => {
    const sceneProps = latestScenePropsRef.current;
    if (!sceneProps?.sourceFile) return;

    const loadId = loadIdRef.current + 1;
    loadIdRef.current = loadId;

    if (inFlightBackendRef.current && inFlightBackendRef.current !== backendRef.current) {
      inFlightBackendRef.current.dispose();
      inFlightBackendRef.current = null;
    }

    const backend = createRendererBackend(sceneProps);
    inFlightBackendRef.current = backend;

    const loadRobot = async () => {
      try {
        setIsLoading(true);
        setError(null);

        // Load robot
        const sceneGraph = await backend.load(sceneProps);
        const nextRobot = sceneGraph.root;

        if (!nextRobot) {
          throw new Error('Renderer backend returned no robot root');
        }

        const previousRobot = robotRef.current;
        if (previousRobot && activeBaseLoadScopeKeyRef.current === baseLoadScopeKey) {
          copyRobotRootTransform(previousRobot, nextRobot);
        }

        if (!isMountedRef.current || loadIdRef.current !== loadId) {
          if (inFlightBackendRef.current === backend) {
            inFlightBackendRef.current = null;
          }
          backend.dispose();
          return;
        }

        await prepareRobotHandoff(nextRobot);

        if (!isMountedRef.current || loadIdRef.current !== loadId) {
          if (inFlightBackendRef.current === backend) {
            inFlightBackendRef.current = null;
          }
          backend.dispose();
          return;
        }

        const previousBackend = backendRef.current;
        backendRef.current = backend;
        activeLoadScopeKeyRef.current = loadScopeKey;
        activeBaseLoadScopeKeyRef.current = baseLoadScopeKey;
        if (inFlightBackendRef.current === backend) {
          inFlightBackendRef.current = null;
        }

        robotRef.current = nextRobot;
        mountedRobotHasCollisionGroupsRef.current = hasRuntimeCollisionGroups(nextRobot);
        const commitLoadedRobot = () => {
          setRobot(nextRobot);
          linkMeshMapRef.current = sceneGraph.linkMeshMap;
          setResolvedRobotLinks(sceneGraph.robotLinks);
          setResolvedRobotJoints(sceneGraph.robotJoints);
          setResolvedRootLinkId(sceneGraph.rootLinkId);
          previousPatchRobotLinksRef.current = sceneGraph.robotLinks;
          previousPatchRobotJointsRef.current = sceneGraph.robotJoints;
          setRobotVersion((v) => v + 1);
          setIsLoading(false);
          setLoadingProgress(null);
        };

        if (previousRobot) {
          // Update replacements in one transition so the old runtime scene remains mounted
          // until the prepared scene graph is ready to replace it.
          if (previousBackend && previousBackend !== backend) {
            pendingCommitDisposeBackendsRef.current.add(previousBackend);
          }
          startTransition(commitLoadedRobot);
        } else {
          commitLoadedRobot();
        }

        // Notify callbacks
        onRobotLoadedRef.current?.(nextRobot);
        onRuntimeRobotLoadedRef.current?.(nextRobot);
        invalidate?.();
      } catch (err) {
        if (!isMountedRef.current || loadIdRef.current !== loadId) {
          return;
        }

        // Handle planned aborts silently - these happen during rapid file switching
        // or React StrictMode double-mounting in dev.
        if (err instanceof Error && err.message === 'Load aborted') {
          setIsLoading(false);
          setLoadingProgress(null);
          return;
        }

        if (inFlightBackendRef.current === backend) {
          inFlightBackendRef.current = null;
        }
        backend.dispose();

        console.error('[useRendererBackend] Failed to load robot:', err);
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        setError(errorMessage);
        setIsLoading(false);
        setLoadingProgress({
          status: 'error',
          phase: null,
          progressMode: null,
          progressPercent: null,
          loadedCount: null,
          totalCount: null,
          message: null,
          error: errorMessage,
        });
        onDocumentLoadEventRef.current?.({
          status: 'error',
          phase: null,
          progressMode: null,
          progressPercent: null,
          loadedCount: null,
          totalCount: null,
          message: null,
          error: errorMessage,
        });
      }
    };

    loadRobot();

    return () => {
      if (loadIdRef.current === loadId) {
        loadIdRef.current += 1;
      }
      if (inFlightBackendRef.current === backend) {
        inFlightBackendRef.current = null;
        backend.dispose();
      }
    };
  }, [baseLoadScopeKey, invalidate, loadScopeKey, prepareRobotHandoff]);

  return {
    robot,
    linkMeshMapRef,
    robotLinks: resolvedRobotLinks,
    robotJoints: resolvedRobotJoints,
    rootLinkId: resolvedRootLinkId,
    backend: backendRef.current,
    isLoading,
    loadingProgress,
    robotVersion,
    robotRef,
    error,
  };
}
