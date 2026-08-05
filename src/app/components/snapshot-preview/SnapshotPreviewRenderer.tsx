import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { useThree } from '@react-three/fiber';
import {
  SnapshotExportLook,
  STUDIO_ENVIRONMENT_INTENSITY,
  WORKSPACE_CANVAS_BACKGROUND,
  WorkspaceCanvas,
  type SnapshotCaptureAction,
  type SnapshotCaptureOptions,
  useWorkspaceCanvasTheme,
} from '@/shared/components/3d';
import { resolveSnapshotAspectRatio } from '@/shared/components/3d/scene/snapshotConfig';
import { VIEWER_RENDER_QUALITY_PROFILES } from '@/shared/utils/viewerRenderQuality';
import {
  applySnapshotLightingPreset,
  applySnapshotShadowQuality,
} from '@/shared/components/3d/scene/snapshotSceneQuality';
import { useSnapshotRenderActive } from '@/shared/components/3d/scene/SnapshotRenderContext';
import { translations, type Language } from '@/shared/i18n';
import { useViewerController } from '@/features/editor';
import { resolveDefaultViewerToolMode } from '@/features/editor';
import { computeCameraFrame } from '@/features/urdf-viewer';
import { buildUnifiedViewerResourceScopes } from '@/app/utils/unifiedViewerResourceScopes';
import { ViewerSceneConnector } from '../unified-viewer/ViewerSceneConnector';
import { subscribeWorkspaceGroundPlaneInvalidation } from '@/store/robotGroundPlaneInvalidation';
import { useUIStore } from '@/store';
import { computeVisibleMeshBounds } from '@/shared/utils/threeBounds';

import type { SnapshotDialogPreviewState, SnapshotPreviewSession } from './types';
import type { WorkspaceCameraSnapshot } from '@/shared/components/3d';
import type { RobotFile } from '@/types';
import type { Object3D, Vector3 } from 'three';

interface SnapshotPreviewRendererProps {
  isOpen: boolean;
  lang: Language;
  session: SnapshotPreviewSession | null;
  options: SnapshotCaptureOptions;
  onStateChange: (state: SnapshotDialogPreviewState) => void;
  onCaptureActionChange?: (action: SnapshotCaptureAction | null) => void;
  className?: string;
}

interface SnapshotPreviewRuntimeRobotSnapshot {
  robot: Object3D | null;
  revision: number;
}

interface SnapshotPreviewRuntimeRobotStore {
  getSnapshot: () => SnapshotPreviewRuntimeRobotSnapshot;
  reset: () => void;
  setRobot: (robot: Object3D) => number;
  subscribe: (listener: () => void) => () => void;
}

export function resolveSnapshotPreviewRuntimeReady({
  previewLoadRevision,
  previewWarmupRevision,
  hasCompletedWarmup,
}: {
  previewLoadRevision: number;
  previewWarmupRevision: number;
  hasCompletedWarmup: boolean;
}) {
  if (previewLoadRevision <= 0) {
    return false;
  }

  return hasCompletedWarmup || previewWarmupRevision >= previewLoadRevision;
}

function createSnapshotPreviewRuntimeRobotStore(): SnapshotPreviewRuntimeRobotStore {
  let snapshot: SnapshotPreviewRuntimeRobotSnapshot = {
    robot: null,
    revision: 0,
  };
  const listeners = new Set<() => void>();
  const emit = () => {
    listeners.forEach((listener) => listener());
  };

  return {
    getSnapshot: () => snapshot,
    reset: () => {
      if (!snapshot.robot && snapshot.revision === 0) {
        return;
      }

      snapshot = {
        robot: null,
        revision: snapshot.revision + 1,
      };
      emit();
    },
    setRobot: (robot) => {
      const revision = snapshot.revision + 1;
      snapshot = {
        robot,
        revision,
      };
      emit();
      return revision;
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

const SNAPSHOT_PREVIEW_BACKGROUND: Record<
  Exclude<SnapshotCaptureOptions['backgroundStyle'], 'viewport'>,
  { light: string; dark: string }
> = {
  studio: { light: '#f7f9fc', dark: '#dfe7f1' },
  sky: { light: '#dbeafe', dark: '#dbeafe' },
  dark: { light: '#111827', dark: '#111827' },
  transparent: { light: '#f8fafc', dark: '#111827' },
};
const SNAPSHOT_PREVIEW_READY_SETTLE_MS = 180;
const SNAPSHOT_PREVIEW_INCLUDE_READY_SETTLE_MS = 900;
const SNAPSHOT_PREVIEW_SHADOW_MAP_SIZE = 512;

function hasMjcfInclude(content: string | null | undefined) {
  return /<include\b/i.test(content ?? '');
}

function resolvePreviewBackground(backgroundStyle: SnapshotCaptureOptions['backgroundStyle']) {
  return backgroundStyle === 'viewport'
    ? WORKSPACE_CANVAS_BACKGROUND
    : SNAPSHOT_PREVIEW_BACKGROUND[backgroundStyle];
}

function SnapshotPreviewRenderInvalidator({
  layoutKey,
  revision,
}: {
  layoutKey: string;
  revision: number;
}) {
  const getThreeState = useThree((state) => state.get);
  const invalidate = useThree((state) => state.invalidate);
  const size = useThree((state) => state.size);

  useEffect(() => {
    let cancelled = false;
    const frameIds: number[] = [];
    const timeoutIds: number[] = [];

    const renderFrame = () => {
      if (cancelled) {
        return;
      }

      const { camera, controls, gl, scene } = getThreeState();
      (controls as { update?: () => void } | undefined)?.update?.();
      scene.updateMatrixWorld(true);
      camera.updateMatrixWorld(true);
      invalidate();
      gl.render(scene, camera);
    };

    const scheduleFrame = () => {
      frameIds.push(window.requestAnimationFrame(renderFrame));
    };

    renderFrame();
    scheduleFrame();
    [60, 180, 360].forEach((delayMs) => {
      timeoutIds.push(window.setTimeout(scheduleFrame, delayMs));
    });

    return () => {
      cancelled = true;
      frameIds.forEach((frameId) => window.cancelAnimationFrame(frameId));
      timeoutIds.forEach((timeoutId) => window.clearTimeout(timeoutId));
    };
  }, [getThreeState, invalidate, layoutKey, revision, size.height, size.width]);

  return null;
}

export function resolveSnapshotPreviewRenderInvalidationKey(
  options: SnapshotCaptureOptions,
  aspectRatio: number,
) {
  return [
    options.aspectRatioPreset,
    aspectRatio,
    options.backgroundStyle,
    options.environmentPreset,
    options.shadowStyle,
    options.groundStyle,
    options.hideGrid ? 'grid-hidden' : 'grid-visible',
  ].join(':');
}

function SnapshotPreviewLiveLook({
  options,
  theme,
  groundOffset,
}: {
  options: SnapshotCaptureOptions;
  theme: SnapshotPreviewSession['theme'];
  groundOffset: number;
}) {
  const scene = useThree((state) => state.scene);
  const gl = useThree((state) => state.gl);
  const invalidate = useThree((state) => state.invalidate);
  const snapshotRenderActive = useSnapshotRenderActive();

  useEffect(() => {
    if (snapshotRenderActive) {
      invalidate();
      return undefined;
    }

    const restoreLighting = applySnapshotLightingPreset(scene, gl, options.environmentPreset);
    const restoreShadow = applySnapshotShadowQuality(
      scene,
      gl,
      options.detailLevel,
      options.shadowStyle,
    );

    scene.updateMatrixWorld(true);
    gl.shadowMap.needsUpdate = true;
    invalidate();

    return () => {
      restoreShadow();
      restoreLighting();
      gl.shadowMap.needsUpdate = true;
      invalidate();
    };
  }, [
    gl,
    invalidate,
    options.detailLevel,
    options.environmentPreset,
    options.shadowStyle,
    scene,
    snapshotRenderActive,
  ]);

  if (snapshotRenderActive) {
    return null;
  }

  return <SnapshotExportLook options={options} theme={theme} groundOffset={groundOffset} />;
}

function SnapshotPreviewAutoFrame({
  frameCamera,
  runtimeRobotStore,
  readySettleMs,
  onWarmupComplete,
}: {
  frameCamera: boolean;
  runtimeRobotStore: SnapshotPreviewRuntimeRobotStore;
  readySettleMs: number;
  onWarmupComplete?: (revision: number) => void;
}) {
  const getThreeState = useThree((state) => state.get);
  const gl = useThree((state) => state.gl);
  const invalidate = useThree((state) => state.invalidate);
  const controls = useThree((state) => state.controls) as {
    addEventListener?: (type: 'start', listener: () => void) => void;
    removeEventListener?: (type: 'start', listener: () => void) => void;
  } | null;
  const userInteractedRef = useRef(false);
  const { robot, revision } = useSyncExternalStore(
    runtimeRobotStore.subscribe,
    runtimeRobotStore.getSnapshot,
    runtimeRobotStore.getSnapshot,
  );

  useEffect(() => {
    userInteractedRef.current = false;
  }, [frameCamera, revision, robot]);

  useEffect(() => {
    if (!controls) {
      return undefined;
    }

    const handleUserInteractionStart = () => {
      userInteractedRef.current = true;
    };

    controls.addEventListener?.('start', handleUserInteractionStart);
    return () => {
      controls.removeEventListener?.('start', handleUserInteractionStart);
    };
  }, [controls]);

  useEffect(() => {
    const element = gl.domElement.parentElement ?? gl.domElement;
    const handleUserInteractionStart = () => {
      userInteractedRef.current = true;
    };

    element.addEventListener('pointerdown', handleUserInteractionStart, { capture: true });
    element.addEventListener('wheel', handleUserInteractionStart, {
      capture: true,
      passive: true,
    });
    element.addEventListener('touchstart', handleUserInteractionStart, {
      capture: true,
      passive: true,
    });
    return () => {
      element.removeEventListener('pointerdown', handleUserInteractionStart, { capture: true });
      element.removeEventListener('wheel', handleUserInteractionStart, { capture: true });
      element.removeEventListener('touchstart', handleUserInteractionStart, { capture: true });
    };
  }, [gl]);

  useEffect(() => {
    if (!robot) {
      return undefined;
    }

    let cancelled = false;
    let compiled = false;
    const frameIds: number[] = [];
    const timeoutIds: number[] = [];

    const applyFrame = (finalFrame = false) => {
      if (cancelled) {
        return;
      }

      const { camera, controls, gl, scene } = getThreeState();
      const controlsWithTarget = controls as { target?: Vector3; update?: () => void } | undefined;

      if (frameCamera && !userInteractedRef.current && controlsWithTarget?.target) {
        const bounds = computeVisibleMeshBounds(robot, { includeInvisible: false });
        const frame = computeCameraFrame(robot, camera, controlsWithTarget.target, bounds);
        if (frame) {
          controlsWithTarget.target.copy(frame.focusTarget);
          camera.position.copy(frame.cameraPosition);
          camera.lookAt(frame.focusTarget);
          if ('updateProjectionMatrix' in camera) {
            (camera as { updateProjectionMatrix: () => void }).updateProjectionMatrix();
          }
          camera.updateMatrixWorld(true);
          controlsWithTarget.update?.();
        }
      }

      scene.updateMatrixWorld(true);
      camera.updateMatrixWorld(true);
      if (!compiled) {
        try {
          gl.compile(scene, camera);
        } catch (error) {
          if (import.meta.env.DEV) {
            console.warn('[SnapshotPreviewAutoFrame] Failed to precompile preview scene:', error);
          }
        }
        compiled = true;
      }
      invalidate();
      // The preview canvas uses demand rendering; render once immediately after
      // programmatic camera framing so the freshly loaded robot is visible.
      gl.render(scene, camera);
      if (finalFrame && !cancelled) {
        timeoutIds.push(
          window.setTimeout(
            () => {
              if (!cancelled) {
                onWarmupComplete?.(revision);
              }
            },
            Math.max(0, readySettleMs),
          ),
        );
      }
    };

    const scheduleFrame = (finalFrame = false) => {
      frameIds.push(window.requestAnimationFrame(() => applyFrame(finalFrame)));
    };

    scheduleFrame();
    [50, 150, 320].forEach((delayMs, index, delays) => {
      timeoutIds.push(window.setTimeout(() => scheduleFrame(index === delays.length - 1), delayMs));
    });

    return () => {
      cancelled = true;
      frameIds.forEach((frameId) => window.cancelAnimationFrame(frameId));
      timeoutIds.forEach((timeoutId) => window.clearTimeout(timeoutId));
    };
  }, [frameCamera, getThreeState, invalidate, onWarmupComplete, readySettleMs, revision, robot]);

  return null;
}

function readRuntimeParentLinkName(object: Object3D): string | null {
  const runtimeParentLinkName = object.userData?.runtimeParentLinkName;
  if (typeof runtimeParentLinkName === 'string' && runtimeParentLinkName.trim()) {
    return runtimeParentLinkName;
  }

  const parentLinkName = object.userData?.parentLinkName;
  if (typeof parentLinkName === 'string' && parentLinkName.trim()) {
    return parentLinkName;
  }

  return null;
}

function resolveNearestRuntimeLinkName(object: Object3D): string | null {
  let current: Object3D | null = object;
  while (current) {
    const runtimeObject = current as typeof current & { isURDFLink?: boolean };
    if (runtimeObject.isURDFLink) {
      return current.name || null;
    }

    current = current.parent;
  }

  return null;
}

function isMjcfWorldVisualRoot(visualRoot: Object3D): boolean {
  const parentLinkName = readRuntimeParentLinkName(visualRoot);
  if (parentLinkName) {
    return parentLinkName === 'world';
  }

  return resolveNearestRuntimeLinkName(visualRoot) === 'world';
}

function setSubtreeVisible(root: Object3D, visible: boolean) {
  root.traverse((object) => {
    object.visible = visible;
  });
}

function restoreSnapshotPreviewRuntimeVisuals(
  robot: Object3D,
  sourceFormat: SnapshotPreviewSession['viewerSourceFormat'],
) {
  const visualRoots: Object3D[] = [];
  const collisionRoots: Object3D[] = [];
  const shouldHideMjcfWorldVisuals = sourceFormat === 'mjcf';

  robot.traverse((object) => {
    const runtimeObject = object as typeof object & {
      isURDFLink?: boolean;
      isURDFVisual?: boolean;
      isURDFCollider?: boolean;
    };

    if (runtimeObject.isURDFLink) {
      object.visible = true;
    }

    if (
      runtimeObject.isURDFVisual ||
      object.userData?.isVisual === true ||
      object.userData?.isVisualGroup === true
    ) {
      visualRoots.push(object);
    }

    if (
      runtimeObject.isURDFCollider ||
      object.userData?.isCollision === true ||
      object.userData?.isCollisionMesh === true ||
      object.userData?.isCollisionGroup === true
    ) {
      collisionRoots.push(object);
    }
  });

  visualRoots.forEach((visualRoot) => {
    if (shouldHideMjcfWorldVisuals && isMjcfWorldVisualRoot(visualRoot)) {
      setSubtreeVisible(visualRoot, false);
      return;
    }

    visualRoot.traverse((object) => {
      object.visible = true;
      if ('isMesh' in object && object.isMesh) {
        object.frustumCulled = false;
      }
    });
  });

  collisionRoots.forEach((collisionRoot) => {
    setSubtreeVisible(collisionRoot, false);
  });
  robot.updateMatrixWorld(true);
}

export function SnapshotPreviewRenderer({
  isOpen,
  lang,
  session,
  options,
  onStateChange,
  onCaptureActionChange,
  className = 'relative h-full w-full',
}: SnapshotPreviewRendererProps) {
  const t = translations[lang];
  const [previewLoadRevision, setPreviewLoadRevision] = useState(0);
  const [previewWarmupRevision, setPreviewWarmupRevision] = useState(0);
  const [hasCompletedPreviewWarmup, setHasCompletedPreviewWarmup] = useState(false);
  const [previewCaptureActionReady, setPreviewCaptureActionReady] = useState(false);
  const runtimeRobotStore = useMemo(() => createSnapshotPreviewRuntimeRobotStore(), []);
  const activeSessionRef = useRef<SnapshotPreviewSession | null>(null);
  const previousViewerResourceScopeRef = useRef<
    ReturnType<typeof buildUnifiedViewerResourceScopes>['viewerResourceScope'] | null
  >(null);
  const effectiveTheme = useWorkspaceCanvasTheme(session?.theme ?? 'light');
  // The preview shares the main viewport's render-quality profile so a scene
  // never looks softer here than it does in the editor it was opened from.
  const renderQuality = useUIStore((state) => state.viewOptions.renderQuality);
  const renderQualityProfile = VIEWER_RENDER_QUALITY_PROFILES[renderQuality];
  const previewBackground = useMemo(
    () => resolvePreviewBackground(options.backgroundStyle),
    [options.backgroundStyle],
  );
  const previewEnvironment = 'none';
  const previewSourceFile = useMemo<RobotFile | null>(() => {
    if (!session) {
      return null;
    }
    if (session.sourceFile) {
      return session.sourceFile;
    }
    if (!session.urdfContent.trim()) {
      return null;
    }

    return {
      name: `${session.robotName || 'robot'}-snapshot-preview.urdf`,
      content: session.urdfContent,
      format: 'urdf',
    };
  }, [session]);
  const previewSourceFormat =
    previewSourceFile === session?.sourceFile ? session?.viewerSourceFormat : 'urdf';
  const previewReadySettleMs =
    previewSourceFormat === 'mjcf' && hasMjcfInclude(previewSourceFile?.content)
      ? SNAPSHOT_PREVIEW_INCLUDE_READY_SETTLE_MS
      : SNAPSHOT_PREVIEW_READY_SETTLE_MS;
  const previewAspectRatio = useMemo(
    () => resolveSnapshotAspectRatio(options.aspectRatioPreset, session?.viewportAspectRatio),
    [options.aspectRatioPreset, session?.viewportAspectRatio],
  );
  const previewRenderInvalidationKey = useMemo(
    () => resolveSnapshotPreviewRenderInvalidationKey(options, previewAspectRatio),
    [options, previewAspectRatio],
  );
  const initialPreviewCameraSnapshot = useMemo<WorkspaceCameraSnapshot | null>(() => {
    if (!session?.cameraSnapshot) {
      return null;
    }

    return { ...session.cameraSnapshot };
  }, [session?.cameraSnapshot]);
  const emitState = useCallback(
    (status: SnapshotDialogPreviewState['status']) => {
      onStateChange({
        status,
        imageUrl: null,
        aspectRatio: previewAspectRatio,
      });
    },
    [onStateChange, previewAspectRatio],
  );
  const handleCaptureActionChange = useCallback(
    (action: SnapshotCaptureAction | null) => {
      setPreviewCaptureActionReady(Boolean(action));
      onCaptureActionChange?.(action);
    },
    [onCaptureActionChange],
  );
  const previewRuntimeReady = resolveSnapshotPreviewRuntimeReady({
    previewLoadRevision,
    previewWarmupRevision,
    hasCompletedWarmup: hasCompletedPreviewWarmup,
  });
  const handlePreviewWarmupComplete = useCallback((revision: number) => {
    setPreviewWarmupRevision((currentRevision) => Math.max(currentRevision, revision));
    setHasCompletedPreviewWarmup(true);
  }, []);

  const controller = useViewerController({
    active: true,
    enableRegressionBridge: false,
    showJointPanel: false,
    jointAngleState: session?.jointAngleState,
    jointMotionState: session?.jointMotionState,
    showVisual: true,
    groundPlaneOffset: session?.groundPlaneOffset ?? 0,
    groundPlaneOffsetReadOnly: true,
    defaultToolMode: resolveDefaultViewerToolMode(previewSourceFile?.format),
    toolModeScopeKey: previewSourceFile?.name
      ? `snapshot-preview:${previewSourceFile.name}`
      : 'snapshot-preview:inline',
  });

  const viewerResourceScope = useMemo(() => {
    const next = buildUnifiedViewerResourceScopes({
      activePreview: undefined,
      urdfContent: session?.urdfContent ?? '',
      sourceFilePath: session?.sourceFilePath,
      sourceFile: previewSourceFile,
      assets: session?.assets ?? {},
      availableFiles: session?.availableFiles ?? [],
      viewerRobotLinks: session?.robot.links,
      viewerRobotMaterials: session?.robot.materials,
      previousViewerResourceScope: previousViewerResourceScopeRef.current,
    });
    previousViewerResourceScopeRef.current = next.viewerResourceScope;
    return next.viewerResourceScope;
  }, [
    session?.assets,
    session?.availableFiles,
    session?.robot.links,
    session?.robot.materials,
    session?.sourceFilePath,
    session?.urdfContent,
    previewSourceFile,
  ]);

  useLayoutEffect(() => {
    if (!isOpen || !session) {
      activeSessionRef.current = null;
      runtimeRobotStore.reset();
      setPreviewLoadRevision(0);
      setPreviewWarmupRevision(0);
      setHasCompletedPreviewWarmup(false);
      setPreviewCaptureActionReady(false);
      onCaptureActionChange?.(null);
      onStateChange({
        status: 'idle',
        imageUrl: null,
        aspectRatio: session?.viewportAspectRatio ?? 16 / 9,
      });
      return;
    }

    if (activeSessionRef.current !== session) {
      activeSessionRef.current = session;
      runtimeRobotStore.reset();
      setPreviewLoadRevision(0);
      setPreviewWarmupRevision(0);
      setHasCompletedPreviewWarmup(false);
      setPreviewCaptureActionReady(false);
    }

    emitState('loading');
  }, [emitState, isOpen, onCaptureActionChange, onStateChange, runtimeRobotStore, session]);

  useLayoutEffect(() => {
    if (!isOpen || !session) {
      return;
    }

    emitState(previewRuntimeReady && previewCaptureActionReady ? 'ready' : 'loading');
  }, [emitState, isOpen, previewCaptureActionReady, previewRuntimeReady, session]);

  if (!isOpen || !session) {
    return null;
  }

  return (
    <div
      className={className}
      data-testid="snapshot-preview-canvas"
      data-runtime-loaded={previewLoadRevision > 0 ? 'true' : 'false'}
      data-runtime-revision={String(previewLoadRevision)}
      data-preview-interactive={previewRuntimeReady ? 'true' : 'false'}
    >
      <WorkspaceCanvas
        theme={session.theme}
        lang={lang}
        className="relative h-full w-full"
        robotName={session.robotName}
        onSnapshotActionChange={handleCaptureActionChange}
        renderKey={`snapshot-preview:${session.viewerReloadKey}`}
        environment={previewEnvironment}
        environmentIntensity={STUDIO_ENVIRONMENT_INTENSITY.viewer[effectiveTheme]}
        enableShadows
        shadowMapSize={SNAPSHOT_PREVIEW_SHADOW_MAP_SIZE}
        minDpr={renderQualityProfile.minDpr}
        maxDpr={renderQualityProfile.maxDpr}
        background={previewBackground}
        cameraFollowPrimary
        showWorldOriginAxes={false}
        showUsageGuide={false}
        showGroundPlane={!options.hideGrid}
        showGroundShadow={false}
        showViewportGizmo={false}
        groundOffset={session.groundPlaneOffset}
        subscribeGroundPlaneInvalidation={subscribeWorkspaceGroundPlaneInvalidation}
        initialCameraSnapshot={initialPreviewCameraSnapshot}
        orbitControlsEventSource="canvas"
        orbitControlsProps={{
          enabled: previewRuntimeReady,
          enablePan: true,
          enableRotate: true,
          enableZoom: true,
          screenSpacePanning: true,
        }}
        contextLostMessage={t.webglContextRestoring}
      >
        <SnapshotPreviewRenderInvalidator
          layoutKey={previewRenderInvalidationKey}
          revision={previewLoadRevision}
        />
        <SnapshotPreviewLiveLook
          options={options}
          theme={session.theme}
          groundOffset={session.groundPlaneOffset}
        />
        <SnapshotPreviewAutoFrame
          frameCamera={!initialPreviewCameraSnapshot}
          runtimeRobotStore={runtimeRobotStore}
          readySettleMs={previewReadySettleMs}
          onWarmupComplete={handlePreviewWarmupComplete}
        />
        <group visible>
          <React.Suspense fallback={null}>
            <ViewerSceneConnector
              controller={controller}
              active
              modelInteractionEnabled={false}
              viewerResourceScope={viewerResourceScope}
              effectiveSourceFile={previewSourceFile}
              effectiveSourceFilePath={session.sourceFilePath}
              effectiveUrdfContent={session.urdfContent}
              effectiveSourceFormat={previewSourceFormat}
              onRuntimeRobotLoaded={(robot) => {
                restoreSnapshotPreviewRuntimeVisuals(robot, previewSourceFormat);
                setPreviewWarmupRevision(0);
                setPreviewLoadRevision(runtimeRobotStore.setRobot(robot));
              }}
              mode="editor"
              robot={session.robot}
              showCollision={false}
              showCollisionAlwaysOnTop={false}
              focusTarget={null}
              isMeshPreview={session.isMeshPreview}
              viewerReloadKey={session.viewerReloadKey}
              t={t}
            />
          </React.Suspense>
        </group>
      </WorkspaceCanvas>
    </div>
  );
}
