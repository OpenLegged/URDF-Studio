import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { buildRuntimeRobotFromState, URDFLoader } from '@/core/parsers/urdf/loader';
import { getJointMotionAngleFromActualAngle, hasFiniteJointLimitBounds } from '@/core/robot';
import { normalizeLoadingProgress } from '@/shared/components/3d/loadingHudState';
import { disposeObject3D } from '../utils/dispose';
import {
  alignRobotToGroundBeforeFirstMount,
  beginInitialGroundAlignment,
  copyRobotRootTransform,
  offsetRobotToGround,
  setInitialGroundAlignment,
  setPreserveAuthoredRootTransform,
} from '@/shared/components/3d/robotPositioning';
import { SHARED_MATERIALS } from '@/shared/components/3d/sharedMaterials';
import {
  buildColladaRootNormalizationHints,
  createLoadingManager,
  createMeshLoader,
} from '@/core/loaders';
import { createMainThreadYieldController } from '@/core/utils/yieldToMainThread';
import { getSourceFileDirectory } from '@/core/parsers/meshPathUtils';
import type { UrdfJoint, UrdfLink } from '@/types';
import { setRegressionRuntimeRobot } from '@/shared/debug/regressionState';
import { isRegressionDebugEnabled } from '@/shared/debug/regressionDebugEnabled';
import { isSingleDofJoint } from '@/shared/utils/jointTypes';
import {
  detectGeometryPatches,
  detectJointPatches,
} from '../utils/robotLoaderDiff';
import { applyGeometryPatchesInPlace } from '../utils/robotLoaderGeometryPatch';
import { patchJointsInPlace } from '../utils/robotLoaderJointPatch';
import { resolveURDFMaterialsForScene } from '@/shared/components/3d/urdfMaterials';
import { syncLoadedRobotScene } from '@/features/urdf-viewer/renderers/loadedRobotSceneSync';
import { shouldMountRobotBeforeAssetsComplete } from '../utils/loadStrategy';
import { resolveRobotLoaderSourceMetadata } from '@/features/urdf-viewer/renderers/robotLoaderSourceMetadata';
import { createViewerRobotLoadInputSignature } from '../utils/robotLoadScope';
import { resolveViewerRobotSourceFormat } from '@/features/urdf-viewer/renderers/sourceFormat';
import { shouldWaitForStructuredUrdfRobotState } from '@/features/urdf-viewer/renderers/urdfXmlFallbackPolicy';
import type { ViewerDocumentLoadEvent } from '../types';
import {
  createAssetScopeKey,
  createLoadingDispatchKey,
  normalizeExternalDocumentLoadEvent,
  preprocessURDFForLoader,
  resolveRobotJoint,
  VIEWER_LOAD_YIELD_BUDGET_MS,
  waitForLoadingHudPaint,
  type PendingLoadingDispatch,
  type RobotLoadingProgress,
  type UseRobotLoaderOptions,
  type UseRobotLoaderResult,
} from './robotLoaderSupport';

export type {
  RobotLoadingProgress,
  UseRobotLoaderOptions,
  UseRobotLoaderResult,
} from './robotLoaderSupport';

type RuntimeCollisionHost = THREE.Object3D & {
  colliders?: Record<string, unknown>;
};

function hasRuntimeCollisionGroups(robotObject: THREE.Object3D): boolean {
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

export function useRobotLoader({
  urdfContent,
  assets,
  sourceFormat = 'auto',
  allowUrdfXmlFallback = false,
  reloadToken = 0,
  initialRobot = null,
  showCollision,
  showVisual,
  showCollisionAlwaysOnTop = true,
  isMeshPreview = false,
  robotLinks,
  robotJoints,
  robotInspectionContext,
  initialJointAngles,
  sourceFilePath,
  onRobotLoaded,
  onDocumentLoadEvent,
  groundPlaneOffset = 0,
  showMjcfWorldLink = false,
}: UseRobotLoaderOptions): UseRobotLoaderResult {
  const sourceFileDir = getSourceFileDirectory(sourceFilePath);
  const resolvedSourceFormat = resolveViewerRobotSourceFormat(urdfContent, sourceFormat);
  const [robot, setRobot] = useState<THREE.Object3D | null>(() => initialRobot);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState<RobotLoadingProgress | null>(null);
  const [robotVersion, setRobotVersion] = useState(0);
  const { invalidate } = useThree();

  // Ref to track current robot for proper cleanup (avoids stale closure issues)
  const robotRef = useRef<THREE.Object3D | null>(initialRobot);
  // Track component mount state for preventing state updates after unmount
  const isMountedRef = useRef(true);
  // Track loading abort controller to cancel duplicate loads
  const loadAbortRef = useRef<{ aborted: boolean }>({ aborted: false });
  // Dispose the previously rendered robot only after the new one has had a chance to mount,
  // otherwise the canvas can flash a blank frame during file switching.
  const pendingDisposeRobotRef = useRef<THREE.Object3D | null>(null);
  const pendingDisposeFrameRef = useRef<number | null>(null);
  const groundAlignTimerRef = useRef<number[]>([]);
  const mountedRobotSourceScopeKeyRef = useRef<string | null>(null);
  const mountedRobotReloadTokenRef = useRef<number | null>(null);
  const mountedRobotHasCollisionGroupsRef = useRef(false);
  const progressDispatchFrameRef = useRef<number | null>(null);
  const pendingLoadingDispatchRef = useRef<PendingLoadingDispatch | null>(null);
  const lastPublishedLoadingDispatchKeyRef = useRef('');
  const lastPublishedProgressRef = useRef<RobotLoadingProgress | null>(null);
  const onRobotLoadedRef = useRef(onRobotLoaded);
  const onDocumentLoadEventRef = useRef(onDocumentLoadEvent);
  // Ground offset is a presentation-only adjustment; changing it must not
  // restart the robot load pipeline or re-emit loading HUD phases.
  const groundPlaneOffsetRef = useRef(groundPlaneOffset);
  const inFlightLoadScopeKeyRef = useRef<string | null>(null);
  const completedLoadScopeKeyRef = useRef<string | null>(null);

  // Refs for visibility state (used in loading callback)
  const showVisualRef = useRef(showVisual);
  const showCollisionRef = useRef(showCollision);
  const showMjcfWorldLinkRef = useRef(showMjcfWorldLink);
  const showCollisionAlwaysOnTopRef = useRef(showCollisionAlwaysOnTop);
  const initialJointAnglesRef = useRef(initialJointAngles);

  // PERFORMANCE: Pre-built map of linkName -> meshes for O(1) highlight lookup
  const linkMeshMapRef = useRef<Map<string, THREE.Mesh[]>>(new Map());
  // Track previous link snapshot to detect geometry patches
  const prevRobotLinksRef = useRef<Record<string, UrdfLink> | null>(robotLinks || null);
  // Track previous joint snapshot to detect joint metadata/origin patches
  const prevRobotJointsRef = useRef<Record<string, UrdfJoint> | null>(robotJoints || null);
  // Skip exactly one upcoming urdfContent-driven full reload per successful
  // incremental patch. A counter is more robust than strict content matching
  // when robotLinks/robotJoints and urdfContent updates are not perfectly in sync.
  const skipReloadCountRef = useRef(0);
  const currentSourceScopeKey = `${resolvedSourceFormat}:${sourceFilePath ?? '__inline__'}`;
  const shouldParseCollisionMeshes =
    showCollision ||
    (mountedRobotSourceScopeKeyRef.current === currentSourceScopeKey &&
      mountedRobotHasCollisionGroupsRef.current);
  const hasStructuredRobotState =
    Boolean(robotLinks && robotJoints) &&
    (Object.keys(robotLinks ?? {}).length > 0 || Object.keys(robotJoints ?? {}).length > 0);
  const shouldWaitForStructuredRobotState = shouldWaitForStructuredUrdfRobotState({
    resolvedSourceFormat,
    hasStructuredRobotState,
    allowUrdfXmlFallback,
  });
  const loadInputSignature = useMemo(
    () =>
      createViewerRobotLoadInputSignature({
        urdfContent,
        hasStructuredRobotState,
        robotLinks,
        robotJoints,
      }),
    [hasStructuredRobotState, robotJoints, robotLinks, urdfContent],
  );
  const assetScopeKey = useMemo(() => createAssetScopeKey(assets), [assets]);
  const loadScopeKey = useMemo(
    () =>
      [
        currentSourceScopeKey,
        `reload:${reloadToken}`,
        `dir:${sourceFileDir ?? '__root__'}`,
        `input:${loadInputSignature}`,
        `assets:${assetScopeKey}`,
        `structured:${hasStructuredRobotState ? '1' : '0'}`,
        `xml-fallback:${allowUrdfXmlFallback ? '1' : '0'}`,
        `parse-collision:${shouldParseCollisionMeshes ? '1' : '0'}`,
      ].join('|'),
    [
      allowUrdfXmlFallback,
      assetScopeKey,
      currentSourceScopeKey,
      hasStructuredRobotState,
      loadInputSignature,
      reloadToken,
      shouldParseCollisionMeshes,
      sourceFileDir,
    ],
  );

  // Keep refs in sync
  useEffect(() => {
    showVisualRef.current = showVisual;
  }, [showVisual]);
  useEffect(() => {
    showCollisionRef.current = showCollision;
  }, [showCollision]);
  useEffect(() => {
    showMjcfWorldLinkRef.current = showMjcfWorldLink;
  }, [showMjcfWorldLink]);
  useEffect(() => {
    showCollisionAlwaysOnTopRef.current = showCollisionAlwaysOnTop;
  }, [showCollisionAlwaysOnTop]);
  useEffect(() => {
    initialJointAnglesRef.current = initialJointAngles;
  }, [initialJointAngles]);
  useEffect(() => {
    onRobotLoadedRef.current = onRobotLoaded;
  }, [onRobotLoaded]);
  useEffect(() => {
    onDocumentLoadEventRef.current = onDocumentLoadEvent;
  }, [onDocumentLoadEvent]);
  useEffect(() => {
    groundPlaneOffsetRef.current = groundPlaneOffset;
  }, [groundPlaneOffset]);

  const disposeRobotObject = useCallback((robotObject: THREE.Object3D | null) => {
    if (!robotObject) return;
    if (robotObject.parent) {
      robotObject.parent.remove(robotObject);
    }
    disposeObject3D(robotObject, true, SHARED_MATERIALS);
  }, []);

  const flushPendingRobotDispose = useCallback(() => {
    if (pendingDisposeFrameRef.current !== null && typeof window !== 'undefined') {
      window.cancelAnimationFrame(pendingDisposeFrameRef.current);
      pendingDisposeFrameRef.current = null;
    }

    if (pendingDisposeRobotRef.current) {
      const robotToDispose = pendingDisposeRobotRef.current;
      pendingDisposeRobotRef.current = null;
      disposeRobotObject(robotToDispose);
    }
  }, [disposeRobotObject]);

  const clearGroundAlignTimers = useCallback(() => {
    groundAlignTimerRef.current.forEach((timer) => window.clearTimeout(timer));
    groundAlignTimerRef.current = [];
  }, []);

  const emitDocumentLoadEvent = useCallback((event: ViewerDocumentLoadEvent) => {
    const nextEvent = onDocumentLoadEventRef.current
      ? normalizeExternalDocumentLoadEvent(event)
      : event;
    onDocumentLoadEventRef.current?.(nextEvent);
  }, []);

  const applyLoadingDispatch = useCallback(
    (dispatch: PendingLoadingDispatch) => {
      const normalizedExternalEvent = onDocumentLoadEventRef.current
        ? normalizeExternalDocumentLoadEvent(dispatch.event)
        : dispatch.event;
      const dispatchKey = createLoadingDispatchKey(
        onDocumentLoadEventRef.current ? null : dispatch.progress,
        normalizedExternalEvent,
      );
      if (dispatchKey === lastPublishedLoadingDispatchKeyRef.current) {
        return;
      }

      lastPublishedLoadingDispatchKeyRef.current = dispatchKey;
      lastPublishedProgressRef.current = dispatch.progress;
      // AppLayout owns the global loading overlay state for the main viewer.
      // Updating both the local hook state and the external document-load
      // state on every MJCF progress tick can create a render feedback loop
      // during large scene imports such as flybody.
      if (!onDocumentLoadEventRef.current) {
        setLoadingProgress(dispatch.progress);
      }
      emitDocumentLoadEvent(dispatch.event);
    },
    [emitDocumentLoadEvent],
  );

  const flushPendingLoadingDispatch = useCallback(() => {
    if (progressDispatchFrameRef.current !== null && typeof window !== 'undefined') {
      window.cancelAnimationFrame(progressDispatchFrameRef.current);
      progressDispatchFrameRef.current = null;
    }

    const pendingDispatch = pendingLoadingDispatchRef.current;
    pendingLoadingDispatchRef.current = null;
    if (!pendingDispatch) {
      return;
    }

    applyLoadingDispatch(pendingDispatch);
  }, [applyLoadingDispatch]);

  const publishLoadingDispatch = useCallback(
    (
      progress: RobotLoadingProgress | null,
      event: ViewerDocumentLoadEvent,
      options: { defer?: boolean } = {},
    ) => {
      const nextDispatch: PendingLoadingDispatch = { progress, event };

      if (!options.defer) {
        pendingLoadingDispatchRef.current = null;
        flushPendingLoadingDispatch();
        applyLoadingDispatch(nextDispatch);
        return;
      }

      pendingLoadingDispatchRef.current = nextDispatch;

      if (progressDispatchFrameRef.current !== null) {
        return;
      }

      if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
        progressDispatchFrameRef.current = window.requestAnimationFrame(() => {
          progressDispatchFrameRef.current = null;
          flushPendingLoadingDispatch();
        });
        return;
      }

      queueMicrotask(flushPendingLoadingDispatch);
    },
    [applyLoadingDispatch, flushPendingLoadingDispatch],
  );

  const schedulePreviousRobotDispose = useCallback(
    (previousRobot: THREE.Object3D | null) => {
      if (!previousRobot) return;

      flushPendingRobotDispose();
      pendingDisposeRobotRef.current = previousRobot;

      const disposePreviousRobot = () => {
        pendingDisposeFrameRef.current = null;
        const robotToDispose = pendingDisposeRobotRef.current;
        pendingDisposeRobotRef.current = null;

        if (!robotToDispose || robotToDispose === robotRef.current) {
          return;
        }

        disposeRobotObject(robotToDispose);
      };

      if (typeof window !== 'undefined') {
        pendingDisposeFrameRef.current = window.requestAnimationFrame(() => {
          pendingDisposeFrameRef.current = window.requestAnimationFrame(disposePreviousRobot);
        });
        return;
      }

      queueMicrotask(disposePreviousRobot);
    },
    [disposeRobotObject, flushPendingRobotDispose],
  );

  const scheduleGroundAlignment = useCallback(
    (loadedRobot: THREE.Object3D) => {
      if (!beginInitialGroundAlignment(loadedRobot)) {
        return;
      }

      if (typeof window === 'undefined') {
        offsetRobotToGround(loadedRobot, groundPlaneOffsetRef.current);
        return;
      }

      clearGroundAlignTimers();

      groundAlignTimerRef.current = [0, 80, 220, 500].map((delay) =>
        window.setTimeout(() => {
          if (!isMountedRef.current) return;
          if (robotRef.current !== loadedRobot) return;

          offsetRobotToGround(loadedRobot, groundPlaneOffsetRef.current);
          invalidate();
        }, delay),
      );
    },
    [clearGroundAlignTimers, invalidate],
  );

  // Incremental path: update exactly one changed link geometry in-place and skip
  // the next full robot reload. MJCF runtime roots expose the same link/group
  // structure here, so link-local visual edits can stay incremental too.
  useEffect(() => {
    if (isMeshPreview) return;
    if (!robotLinks) return;

    const previousLinks = prevRobotLinksRef.current;
    const currentRobot = robotRef.current;
    prevRobotLinksRef.current = robotLinks;

    if (!previousLinks || !currentRobot) return;
    if (
      mountedRobotSourceScopeKeyRef.current !== currentSourceScopeKey ||
      mountedRobotReloadTokenRef.current !== reloadToken
    ) {
      return;
    }

    const patches = detectGeometryPatches(previousLinks, robotLinks);
    if (!patches || patches.length === 0) return;

    const colladaRootNormalizationHints = buildColladaRootNormalizationHints(robotLinks);

    const applied = applyGeometryPatchesInPlace({
      robotModel: currentRobot,
      patches,
      assets,
      sourceFileDir,
      colladaRootNormalizationHints,
      showVisual: showVisualRef.current,
      showCollision: showCollisionRef.current,
      linkMeshMapRef,
      invalidate,
      isPatchTargetValid: () => isMountedRef.current && robotRef.current === currentRobot,
    });

    if (!applied) {
      const message = 'Failed to apply a runtime geometry patch in place';
      console.error('[useRobotLoader]', message, patches);
      skipReloadCountRef.current = 0;
      completedLoadScopeKeyRef.current = null;
      setError(message);
      return;
    }
    skipReloadCountRef.current += 1;
    setRobotVersion((v) => v + 1);
    setError(null);
    // See the joint-patch effect below: the scope guard reads
    // currentSourceScopeKey / reloadToken, so they must be deps to retry the
    // in-place patch after the mounted-robot refs converge.
  }, [
    robotLinks,
    resolvedSourceFormat,
    urdfContent,
    assets,
    invalidate,
    isMeshPreview,
    sourceFileDir,
    currentSourceScopeKey,
    reloadToken,
  ]);

  // Incremental path: update changed joint metadata/origins in-place and skip
  // the next full robot reload. MJCF runtime joints expose the same mutators,
  // so joint-local edits can stay incremental there as well.
  useEffect(() => {
    if (isMeshPreview) return;
    if (!robotJoints) return;

    const previousJoints = prevRobotJointsRef.current;
    const currentRobot = robotRef.current;
    prevRobotJointsRef.current = robotJoints;

    if (!previousJoints || !currentRobot) return;
    if (
      mountedRobotSourceScopeKeyRef.current !== currentSourceScopeKey ||
      mountedRobotReloadTokenRef.current !== reloadToken
    ) {
      return;
    }

    const patches = detectJointPatches(previousJoints, robotJoints);
    if (!patches || patches.length === 0) return;

    const applied = patchJointsInPlace(currentRobot, patches, invalidate);
    if (!applied) {
      const message = 'Failed to apply a runtime joint patch in place';
      console.error('[useRobotLoader]', message, patches);
      skipReloadCountRef.current = 0;
      completedLoadScopeKeyRef.current = null;
      setError(message);
      return;
    }
    skipReloadCountRef.current += 1;
    setRobotVersion((v) => v + 1);
    setError(null);
    // currentSourceScopeKey / reloadToken are read by the scope guard above; they
    // must be deps so the effect re-runs (and retries the in-place patch) once the
    // mounted-robot refs converge, instead of permanently missing the patch and
    // falling back to a full async rebuild (the multi-model snap-back).
  }, [
    robotJoints,
    resolvedSourceFormat,
    urdfContent,
    invalidate,
    isMeshPreview,
    currentSourceScopeKey,
    reloadToken,
  ]);

  // Track component mount state for preventing state updates after unmount
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Cleanup on unmount ONLY
  useEffect(() => {
    return () => {
      clearGroundAlignTimers();
      flushPendingRobotDispose();
      flushPendingLoadingDispatch();

      // Deep cleanup of robot resources on unmount
      if (robotRef.current) {
        disposeRobotObject(robotRef.current);
        robotRef.current = null;
      }
      mountedRobotSourceScopeKeyRef.current = null;
      mountedRobotReloadTokenRef.current = null;
      mountedRobotHasCollisionGroupsRef.current = false;
      inFlightLoadScopeKeyRef.current = null;
      completedLoadScopeKeyRef.current = null;
    };
  }, [
    clearGroundAlignTimers,
    disposeRobotObject,
    flushPendingLoadingDispatch,
    flushPendingRobotDispose,
  ]);

  useEffect(() => {
    if (!isRegressionDebugEnabled() || isMeshPreview) {
      return;
    }

    setRegressionRuntimeRobot(robot);

    return () => {
      setRegressionRuntimeRobot(null);
    };
  }, [isMeshPreview, robot]);

  useEffect(() => {
    return () => {
      clearGroundAlignTimers();
    };
  }, [clearGroundAlignTimers]);

  // Load robot with proper cleanup and abort handling
  useEffect(() => {
    if (!urdfContent) return;
    const isMountedForCurrentLoadScope =
      Boolean(robotRef.current) &&
      mountedRobotSourceScopeKeyRef.current === currentSourceScopeKey &&
      mountedRobotReloadTokenRef.current === reloadToken;
    if (
      isMountedForCurrentLoadScope &&
      completedLoadScopeKeyRef.current === loadScopeKey &&
      !error
    ) {
      return;
    }
    if (inFlightLoadScopeKeyRef.current === loadScopeKey && !loadAbortRef.current.aborted) {
      return;
    }
    if (skipReloadCountRef.current > 0) {
      skipReloadCountRef.current -= 1;
      return;
    }

    // Create abort controller for this load
    const abortController = { aborted: false };
    loadAbortRef.current = abortController;
    inFlightLoadScopeKeyRef.current = loadScopeKey;

    const loadRobot = async () => {
      try {
        setIsLoading(true);
        publishLoadingDispatch(
          normalizeLoadingProgress<RobotLoadingProgress>({
            phase: 'preparing-scene',
            progressPercent: null,
          }),
          normalizeLoadingProgress<ViewerDocumentLoadEvent>({
            status: 'loading',
            phase: 'preparing-scene',
            progressPercent: null,
            loadedCount: null,
            totalCount: null,
            message: null,
          }),
        );
        setError(null);
        invalidate?.();

        if (abortController.aborted || !isMountedRef.current) {
          return;
        }

        // NOTE: We do NOT cleanup the previous robot here immediately.
        // We wait until the new robot is ready to avoid flickering/rendering disposed objects.

        let robotModel: THREE.Object3D | null = null;
        let hasMountedRobot = false;
        let preservedRootTransformFromPreviousRobot = false;
        const isMJCFAsset = resolvedSourceFormat === 'mjcf';
        const preserveAuthoredRootTransform = false;
        const urdfMaterials = isMJCFAsset
          ? null
          : resolveURDFMaterialsForScene(urdfContent, robotLinks);

        const syncLoadedRobot = (loadedRobot: THREE.Object3D) => {
          const { changed, linkMeshMap } = syncLoadedRobotScene({
            robot: loadedRobot,
            sourceFormat: resolvedSourceFormat,
            showCollision: showCollisionRef.current,
            showVisual: showVisualRef.current,
            showMjcfWorldLink: showMjcfWorldLinkRef.current,
            showCollisionAlwaysOnTop: showCollisionAlwaysOnTopRef.current,
            urdfMaterials,
            robotLinks,
          });

          linkMeshMapRef.current = linkMeshMap;
          return changed;
        };

        const mountLoadedRobot = (loadedRobot: THREE.Object3D) => {
          if (hasMountedRobot) {
            return;
          }

          if (abortController.aborted || !isMountedRef.current) {
            if (robotRef.current !== loadedRobot) {
              disposeObject3D(loadedRobot, true, SHARED_MATERIALS);
            }
            return;
          }

          hasMountedRobot = true;
          const previousRobot = robotRef.current;
          const shouldPreservePreviousRootTransform =
            Boolean(previousRobot) &&
            mountedRobotSourceScopeKeyRef.current === currentSourceScopeKey;

          setPreserveAuthoredRootTransform(loadedRobot, preserveAuthoredRootTransform);
          syncLoadedRobot(loadedRobot);

          const nextJointAngles = initialJointAnglesRef.current;
          if (nextJointAngles && (loadedRobot as any).joints) {
            Object.entries(nextJointAngles).forEach(([jointName, angle]) => {
              const joint = (loadedRobot as any).joints?.[jointName];
              if (!isSingleDofJoint(joint) || typeof angle !== 'number') {
                return;
              }

              const sourceJoint = resolveRobotJoint(robotJoints, jointName);
              joint.setJointValue?.(
                sourceJoint ? getJointMotionAngleFromActualAngle(sourceJoint, angle) : angle,
              );
            });
            loadedRobot.updateMatrixWorld(true);
          }

          if (shouldPreservePreviousRootTransform) {
            preservedRootTransformFromPreviousRobot = copyRobotRootTransform(
              previousRobot,
              loadedRobot,
            );
          }

          if (!preservedRootTransformFromPreviousRobot) {
            // Place the robot on the ground before the first visible mount so
            // the scene never shows it popping up from below the grid.
            alignRobotToGroundBeforeFirstMount(loadedRobot, groundPlaneOffsetRef.current);
          }

          robotRef.current = loadedRobot;
          mountedRobotSourceScopeKeyRef.current = currentSourceScopeKey;
          mountedRobotReloadTokenRef.current = reloadToken;
          mountedRobotHasCollisionGroupsRef.current = hasRuntimeCollisionGroups(loadedRobot);
          setRobot(loadedRobot);
          setRobotVersion((v) => v + 1);
          setError(null);
          invalidate();
          if (!preservedRootTransformFromPreviousRobot) {
            scheduleGroundAlignment(loadedRobot);
          }

          if (previousRobot && previousRobot !== loadedRobot) {
            schedulePreviousRobotDispose(previousRobot);
          }
        };

        const finalizeLoadedRobot = async (loadedRobot: THREE.Object3D) => {
          const wasMountedBeforeFinalize = hasMountedRobot;
          mountLoadedRobot(loadedRobot);
          if (abortController.aborted || !isMountedRef.current) {
            return;
          }

          if (wasMountedBeforeFinalize) {
            const changed = syncLoadedRobot(loadedRobot);
            if (changed) {
              setRobotVersion((value) => value + 1);
            }
          }

          setIsLoading(false);
          publishLoadingDispatch(
            null,
            normalizeLoadingProgress({
              status: 'ready',
              phase: 'ready',
              progressPercent: 100,
              loadedCount: null,
              totalCount: null,
              message: null,
            }),
          );
          setError(null);
          completedLoadScopeKeyRef.current = loadScopeKey;
          inFlightLoadScopeKeyRef.current = null;
          invalidate();
          if (wasMountedBeforeFinalize && !preservedRootTransformFromPreviousRobot) {
            setInitialGroundAlignment(loadedRobot, false);
          }
          if (!preservedRootTransformFromPreviousRobot) {
            scheduleGroundAlignment(loadedRobot);
          }
          onRobotLoadedRef.current?.(loadedRobot);
        };

        {
          // Standard URDF loading
          const urdfDir = sourceFileDir;
          const {
            robotJoints: sourceRobotJoints,
            explicitlyScaledMeshPaths,
            colladaRootNormalizationHints,
          } = resolveRobotLoaderSourceMetadata({
            urdfContent,
            robotLinks,
            robotJoints,
          });
          const manager = createLoadingManager(assets, urdfDir);
          manager.onProgress = (_url, itemsLoaded, itemsTotal) => {
            if (abortController.aborted || !isMountedRef.current) {
              return;
            }

            const adjustedTotalCount = Math.max(0, itemsTotal - 1);
            if (adjustedTotalCount <= 0) {
              return;
            }

            publishLoadingDispatch(
              normalizeLoadingProgress<RobotLoadingProgress>({
                phase: 'streaming-meshes',
                loadedCount: Math.min(itemsLoaded, adjustedTotalCount),
                totalCount: adjustedTotalCount,
                progressPercent: null,
              }),
              normalizeLoadingProgress<ViewerDocumentLoadEvent>({
                status: 'loading',
                phase: 'streaming-meshes',
                progressPercent: null,
                loadedCount: Math.min(itemsLoaded, adjustedTotalCount),
                totalCount: adjustedTotalCount,
                message: null,
              }),
              { defer: true },
            );
          };
          manager.onLoad = () => {
            const loadedRobot = robotModel;
            if (!loadedRobot) return;
            if (!abortController.aborted && isMountedRef.current) {
              const currentProgress =
                pendingLoadingDispatchRef.current?.progress ?? lastPublishedProgressRef.current;
              const nextProgress: RobotLoadingProgress =
                normalizeLoadingProgress<RobotLoadingProgress>({
                  phase: 'finalizing-scene',
                  loadedCount: currentProgress?.loadedCount ?? null,
                  totalCount: currentProgress?.totalCount ?? null,
                  progressPercent: currentProgress?.progressPercent ?? null,
                });
              publishLoadingDispatch(
                nextProgress,
                normalizeLoadingProgress<ViewerDocumentLoadEvent>({
                  status: 'loading',
                  phase: nextProgress.phase,
                  progressPercent: nextProgress.progressPercent ?? null,
                  loadedCount: nextProgress.loadedCount ?? null,
                  totalCount: nextProgress.totalCount ?? null,
                  message: null,
                }),
              );
            }
            void finalizeLoadedRobot(loadedRobot);
          };
          // Use new local URDFLoader
          const loader = new URDFLoader(manager);
          const yieldIfNeeded = createMainThreadYieldController(VIEWER_LOAD_YIELD_BUDGET_MS);
          loader.parseCollision = shouldParseCollisionMeshes;
          loader.parseVisual = true;
          loader.loadMeshCb = createMeshLoader(assets, manager, urdfDir, {
            allowPlaceholderMeshes: true,
            colladaRootNormalizationHints,
            explicitScaleMeshPaths: explicitlyScaledMeshPaths,
            yieldIfNeeded,
          });
          loader.packages = '';

          const loadCompletionKey = '__urdf_studio_robot_finalize__';
          manager.itemStart(loadCompletionKey);
          try {
            // The editor already has canonical link/joint state in the hot path.
            // Rebuilding the runtime scene from that state avoids a second URDF XML parse.
            // Initial imports can surface urdfContent one render before the
            // structured robot store is populated. When that happens, the first
            // load can be aborted during view orchestration and must re-run once
            // the canonical link/joint state is available.
            if (hasStructuredRobotState) {
              robotModel = await buildRuntimeRobotFromState({
                links: robotLinks!,
                joints: robotJoints!,
                inspectionContext: robotInspectionContext,
                manager,
                loadMeshCb: loader.loadMeshCb,
                parseVisual: true,
                parseCollision: shouldParseCollisionMeshes,
                yieldIfNeeded,
              });
            } else {
              if (resolvedSourceFormat === 'mjcf') {
                throw new Error('MJCF sources must be resolved to RobotState before rendering.');
              }
              if (shouldWaitForStructuredRobotState) {
                return;
              }

              const cleanContent = preprocessURDFForLoader(urdfContent);
              robotModel = await loader.parseAsync(cleanContent, loader.workingPath, {
                yieldIfNeeded,
              });
              if (sourceRobotJoints && (robotModel as any).joints) {
                Object.entries((robotModel as any).joints).forEach(
                  ([name, joint]: [string, any]) => {
                    const parsedJoint = sourceRobotJoints[name];
                    if (parsedJoint && parsedJoint.limit) {
                      if (!joint.limit) joint.limit = {};
                      if (
                        typeof parsedJoint.limit.effort === 'number' &&
                        Number.isFinite(parsedJoint.limit.effort)
                      ) {
                        joint.limit.effort = parsedJoint.limit.effort;
                      }
                      if (
                        typeof parsedJoint.limit.velocity === 'number' &&
                        Number.isFinite(parsedJoint.limit.velocity)
                      ) {
                        joint.limit.velocity = parsedJoint.limit.velocity;
                      }
                      if (hasFiniteJointLimitBounds(parsedJoint.limit)) {
                        if (joint.limit.lower === undefined) {
                          joint.limit.lower = parsedJoint.limit.lower;
                        }
                        if (joint.limit.upper === undefined) {
                          joint.limit.upper = parsedJoint.limit.upper;
                        }
                        joint.ignoreLimits = false;
                      } else if (
                        parsedJoint.type === 'revolute' ||
                        parsedJoint.type === 'prismatic'
                      ) {
                        joint.ignoreLimits = true;
                      }
                    } else if (
                      parsedJoint &&
                      (parsedJoint.type === 'revolute' || parsedJoint.type === 'prismatic')
                    ) {
                      joint.ignoreLimits = true;
                    }
                  },
                );
              }
            }

            if (abortController.aborted) {
              if (robotModel) {
                disposeObject3D(robotModel, true, SHARED_MATERIALS);
              }
              return;
            }

            if (shouldMountRobotBeforeAssetsComplete(resolvedSourceFormat)) {
              mountLoadedRobot(robotModel);
            }
          } finally {
            manager.itemEnd(loadCompletionKey);
          }

          return;
        }

        if (!robotModel) {
          return;
        }
        const loadedRobot = robotModel as THREE.Object3D;

        if (isMountedRef.current) {
          const currentProgress =
            pendingLoadingDispatchRef.current?.progress ?? lastPublishedProgressRef.current;
          const nextProgress =
            currentProgress ??
            normalizeLoadingProgress<RobotLoadingProgress>({
              phase: 'finalizing-scene',
              loadedCount: null,
              totalCount: null,
              progressPercent: null,
            });
          publishLoadingDispatch(
            nextProgress,
            normalizeLoadingProgress<ViewerDocumentLoadEvent>({
              status: 'loading',
              phase: 'finalizing-scene',
              progressPercent: nextProgress.progressPercent ?? null,
              loadedCount: nextProgress.loadedCount ?? null,
              totalCount: nextProgress.totalCount ?? null,
              message: null,
            }),
          );
          void finalizeLoadedRobot(loadedRobot);
        } else {
          // Aborted or unmounted after load but before we could use it
          disposeObject3D(loadedRobot, true, SHARED_MATERIALS);
        }
      } catch (err) {
        if (!abortController.aborted && isMountedRef.current) {
          console.error('[EditorViewer] Failed to load URDF:', err);
          const errorMessage = err instanceof Error ? err.message : 'Unknown error';
          setError(errorMessage);
          setIsLoading(false);
          completedLoadScopeKeyRef.current = null;
          inFlightLoadScopeKeyRef.current = null;
          publishLoadingDispatch(null, {
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
      }
    };

    loadRobot();

    // Cleanup function - runs when dependencies change
    return () => {
      // Mark this load as aborted to prevent state updates
      abortController.aborted = true;
      if (inFlightLoadScopeKeyRef.current === loadScopeKey) {
        inFlightLoadScopeKeyRef.current = null;
      }
      clearGroundAlignTimers();

      // NOTE: We do NOT dispose robotRef.current here.
      // We allow the old robot to persist until the new one is ready,
      // or until the component unmounts (handled by the separate useEffect).
    };
  }, [
    assets,
    clearGroundAlignTimers,
    currentSourceScopeKey,
    error,
    allowUrdfXmlFallback,
    hasStructuredRobotState,
    invalidate,
    loadScopeKey,
    publishLoadingDispatch,
    reloadToken,
    resolvedSourceFormat,
    scheduleGroundAlignment,
    shouldParseCollisionMeshes,
    sourceFileDir,
    robotInspectionContext,
    urdfContent,
  ]);

  return {
    robot,
    error,
    isLoading,
    loadingProgress,
    robotVersion,
    robotRef,
    linkMeshMapRef,
  };
}
