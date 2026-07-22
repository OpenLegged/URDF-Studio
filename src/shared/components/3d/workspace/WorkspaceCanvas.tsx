import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, type RootState, useThree } from '@react-three/fiber';
import { Environment, GizmoHelper, GizmoViewport, OrthographicCamera } from '@react-three/drei';
import * as THREE from 'three';

import type { Theme } from '@/types';
import type { Language } from '@/shared/i18n';
import { attachContextMenuBlocker } from '@/shared/utils';
import {
  POINTER_RESIZE_END_EVENT,
  POINTER_RESIZE_START_EVENT,
} from '@/shared/hooks/pointerResizeEvents';

import { UsageGuide } from '../UsageGuide';
import { WorldOriginAxes } from '../helpers';
import { SnapshotRenderStateProvider } from '../scene/SnapshotRenderContext';
import {
  AdaptiveGroundPlane,
  CanvasResizeSync,
  NeutralStudioEnvironment,
  SceneLighting,
  SemanticOutlineProvider,
  SnapshotManager,
  DEFAULT_WORKSPACE_OVERLAY_GIZMO_MARGIN,
  type SnapshotCaptureAction,
  type SnapshotPreviewAction,
  type WorkspaceOverlayGizmoMargin,
  useAdaptiveInteractionQuality,
  WorkspaceCanvasInteractionStateProvider,
  WorkspaceOrbitControls,
  resolveCameraFollowLightingStyle,
  WORKSPACE_CANVAS_BACKGROUND,
  WORKSPACE_DEFAULT_CAMERA_FOV,
  WORKSPACE_DEFAULT_CAMERA_ORTHOGRAPHIC_ZOOM,
  WORKSPACE_DEFAULT_CAMERA_POSITION,
  WORKSPACE_DEFAULT_CAMERA_UP,
} from '../scene';
import type { WorkspaceOrbitControlsProps } from '../scene/WorkspaceOrbitControls';
import {
  resolveWorkspaceCanvasEnvironmentIntensity,
  type WorkspaceCanvasEnvironmentIntensityByTheme,
  useWorkspaceCanvasTheme,
} from './workspaceCanvasConfig';
import type { WorkspaceCameraSnapshot } from './workspaceCameraSnapshot';
import { WorkspaceCanvasErrorBoundary } from './WorkspaceCanvasErrorBoundary';
import {
  getWorkspaceCanvasErrorDetail,
  probeWorkspaceCanvasWebglSupport,
  type WorkspaceCanvasWebglSupportState,
} from './workspaceCanvasWebgl';
import { cleanupWorkspaceCanvasRenderer } from './workspaceCanvasRendererCleanup';
import { shouldSuppressWorkspacePointerMissAfterDrag } from './workspacePointerMissPolicy';

interface WorkspaceCanvasProps {
  theme: Theme;
  lang?: Language;
  robotName?: string;
  className?: string;
  containerRef?: React.RefObject<HTMLDivElement | null>;
  sceneRef?: React.RefObject<THREE.Scene | null>;
  snapshotAction?: React.RefObject<SnapshotCaptureAction | null>;
  onSnapshotActionChange?: (action: SnapshotCaptureAction | null) => void;
  previewAction?: React.RefObject<SnapshotPreviewAction | null>;
  onPreviewActionChange?: (action: SnapshotPreviewAction | null) => void;
  subscribeGroundPlaneInvalidation?: (listener: () => void) => () => void;
  children: React.ReactNode;
  overlays?: React.ReactNode;
  onPointerMissed?: () => void;
  onPointerDownCapture?: React.PointerEventHandler<HTMLDivElement>;
  onCreated?: (state: RootState) => void;
  onMouseMove?: React.MouseEventHandler<HTMLDivElement>;
  onMouseUp?: React.MouseEventHandler<HTMLDivElement>;
  onMouseLeave?: React.MouseEventHandler<HTMLDivElement>;
  environment?: 'hdr' | 'studio' | 'none';
  environmentIntensity?: number;
  environmentIntensityByTheme?: WorkspaceCanvasEnvironmentIntensityByTheme;
  groundOffset?: number;
  enableAmbientOcclusion?: boolean;
  enableShadows?: boolean;
  shadowMapSize?: number;
  maxDpr?: number;
  toneMapping?: THREE.ToneMapping;
  toneMappingExposure?: number;
  cameraFollowPrimary?: boolean;
  orbitControlsProps?: Partial<WorkspaceOrbitControlsProps>;
  orbitControlsEventSource?: WorkspaceOrbitControlsProps['eventSource'];
  controlLayerKey?: string;
  showGroundShadow?: boolean;
  background?: {
    light: string;
    dark: string;
  };
  contextLostMessage?: string;
  showWorldOriginAxes?: boolean;
  showUsageGuide?: boolean;
  showGroundPlane?: boolean;
  showViewportGizmo?: boolean;
  cameraProjection?: 'perspective' | 'orthographic';
  renderKey?: string;
  initialCameraSnapshot?: WorkspaceCameraSnapshot | null;
  gizmoMargin?: WorkspaceOverlayGizmoMargin;
}

interface PointerMissGesture {
  pointerId: number;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}

const WORKSPACE_CANVAS_RESIZE_OPTIONS = {
  debounce: {
    scroll: 50,
    resize: 120,
  },
};
const WORKSPACE_CANVAS_ACTIVE_RESIZE_OPTIONS = {
  debounce: {
    scroll: 50,
    resize: 0,
  },
};

export function resolveWorkspaceCanvasResizeOptions(layoutResizeActive: boolean) {
  return layoutResizeActive
    ? WORKSPACE_CANVAS_ACTIVE_RESIZE_OPTIONS
    : WORKSPACE_CANVAS_RESIZE_OPTIONS;
}

interface WorkspaceCanvasResizeEventTarget {
  dispatchEvent: (event: Event) => boolean;
  requestAnimationFrame: (callback: FrameRequestCallback) => number;
}

export function scheduleWorkspaceCanvasResizeEvent(target: WorkspaceCanvasResizeEventTarget) {
  return target.requestAnimationFrame(() => {
    target.dispatchEvent(new Event('resize'));
  });
}

function CanvasRenderKeyInvalidator({ renderKey }: { renderKey: string }) {
  const invalidate = useThree((state) => state.invalidate);

  useEffect(() => {
    invalidate();
  }, [invalidate, renderKey]);

  return null;
}

export const WorkspaceCanvas = ({
  theme,
  lang,
  robotName = 'robot',
  className = 'relative w-full h-full',
  containerRef,
  sceneRef,
  snapshotAction,
  onSnapshotActionChange,
  previewAction,
  onPreviewActionChange,
  subscribeGroundPlaneInvalidation,
  children,
  overlays,
  onPointerMissed,
  onPointerDownCapture,
  onCreated,
  onMouseMove,
  onMouseUp,
  onMouseLeave,
  environment = 'none',
  environmentIntensity = 0.36,
  environmentIntensityByTheme,
  groundOffset = 0,
  enableAmbientOcclusion = false,
  enableShadows = true,
  shadowMapSize,
  maxDpr,
  toneMapping = THREE.ACESFilmicToneMapping,
  toneMappingExposure,
  cameraFollowPrimary = false,
  orbitControlsProps,
  orbitControlsEventSource = 'default',
  controlLayerKey = 'default',
  showGroundShadow = true,
  background = WORKSPACE_CANVAS_BACKGROUND,
  showWorldOriginAxes = true,
  showUsageGuide = true,
  showGroundPlane = true,
  showViewportGizmo = true,
  cameraProjection = 'perspective',
  renderKey = 'default',
  initialCameraSnapshot = null,
  gizmoMargin = DEFAULT_WORKSPACE_OVERLAY_GIZMO_MARGIN,
}: WorkspaceCanvasProps) => {
  const effectiveTheme = useWorkspaceCanvasTheme(theme);
  const [contextEpoch, setContextEpoch] = useState(0);
  const [canvasFailure, setCanvasFailure] = useState(false);
  const [layoutResizeActive, setLayoutResizeActive] = useState(false);
  const [webglSupport, setWebglSupport] = useState<WorkspaceCanvasWebglSupportState | null>(null);
  const [snapshotRenderActive, setSnapshotRenderActive] = useState(false);
  const contextMenuCleanupRef = useRef<(() => void) | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const canvasReadyRef = useRef(false);
  const contextLossInFlightRef = useRef(false);
  const pointerMissGestureRef = useRef<PointerMissGesture | null>(null);
  const suppressNextPointerMissRef = useRef(false);
  const { dpr, isInteracting, beginInteraction, endInteraction, pulseInteraction } =
    useAdaptiveInteractionQuality();

  // Render content changes should only invalidate the current frame. Only a real WebGL context
  // loss should force a full canvas/renderer rebuild. A change in camera projection also
  // forces a remount because R3F's <Canvas> only reads the `camera` prop at init — switching
  // between PerspectiveCamera and OrthographicCamera requires a fresh canvas, which also
  // resets the view (intended: ortho three-views should start from a neutral framing).
  const canvasResetKey = useMemo(
    () => `context:${contextEpoch}:proj:${cameraProjection}`,
    [contextEpoch, cameraProjection],
  );
  const failureResetKey = useMemo(() => `${renderKey}:${contextEpoch}`, [renderKey, contextEpoch]);
  const activeBackgroundColor = effectiveTheme === 'light' ? background.light : background.dark;
  const cameraFollowLightingStyle = resolveCameraFollowLightingStyle(effectiveTheme);

  const resolvedEnvironmentIntensity = useMemo(
    () =>
      resolveWorkspaceCanvasEnvironmentIntensity({
        effectiveTheme,
        environmentIntensity,
        environmentIntensityByTheme,
      }),
    [effectiveTheme, environmentIntensity, environmentIntensityByTheme],
  );

  const finalOrbitControlsProps = useMemo<Partial<WorkspaceOrbitControlsProps>>(
    () => ({
      enableDamping: false,
      ...orbitControlsProps,
      onStart: () => {
        beginInteraction();
        orbitControlsProps?.onStart?.();
      },
      onEnd: () => {
        endInteraction();
        orbitControlsProps?.onEnd?.();
      },
    }),
    [beginInteraction, endInteraction, orbitControlsProps],
  );
  // R3F's <Canvas camera> prop always creates a PerspectiveCamera regardless
  // of which keys are present, so switching to an OrthographicCamera must be
  // done via a drei <OrthographicCamera makeDefault> rendered inside the canvas.
  // The projection type is only read at canvas init, so a projection change is
  // handled by remounting (see canvasResetKey above) rather than swapping live.
  const canvasCamera = useMemo(
    () => ({
      position: WORKSPACE_DEFAULT_CAMERA_POSITION,
      up: WORKSPACE_DEFAULT_CAMERA_UP,
      fov: WORKSPACE_DEFAULT_CAMERA_FOV,
    }),
    [],
  );
  const canvasGl = useMemo(
    () => ({
      antialias: true,
      alpha: true,
      logarithmicDepthBuffer: true,
      toneMapping: cameraFollowPrimary ? THREE.NeutralToneMapping : toneMapping,
      toneMappingExposure: cameraFollowPrimary
        ? cameraFollowLightingStyle.toneMappingExposure
        : (toneMappingExposure ?? (environment === 'hdr' ? 1.0 : 1.1)),
      powerPreference: 'high-performance' as const,
      failIfMajorPerformanceCaveat: false,
    }),
    [
      cameraFollowLightingStyle.toneMappingExposure,
      cameraFollowPrimary,
      environment,
      toneMapping,
      toneMappingExposure,
    ],
  );

  useEffect(() => {
    canvasReadyRef.current = false;
  }, [canvasResetKey]);

  useEffect(() => {
    setCanvasFailure(false);
  }, [failureResetKey]);

  useEffect(() => {
    const support = probeWorkspaceCanvasWebglSupport();
    setWebglSupport(support);

    if (!support.supported) {
      console.error(
        '[WorkspaceCanvas] WebGL is unavailable; skipping 3D canvas rendering.',
        support.detail ?? support.reason ?? 'Unknown WebGL support failure.',
      );
    }
  }, []);

  useEffect(() => {
    const handleResizeStart = () => {
      setLayoutResizeActive(true);
    };
    const handleResizeEnd = () => {
      setLayoutResizeActive(false);
      window.requestAnimationFrame(() => {
        window.dispatchEvent(new Event('resize'));
      });
    };

    window.addEventListener(POINTER_RESIZE_START_EVENT, handleResizeStart);
    window.addEventListener(POINTER_RESIZE_END_EVENT, handleResizeEnd);
    return () => {
      window.removeEventListener(POINTER_RESIZE_START_EVENT, handleResizeStart);
      window.removeEventListener(POINTER_RESIZE_END_EVENT, handleResizeEnd);
    };
  }, []);

  const handleCreated = useCallback(
    (state: RootState) => {
      if (rendererRef.current && rendererRef.current !== state.gl) {
        cleanupWorkspaceCanvasRenderer(rendererRef.current, contextMenuCleanupRef.current);
        contextMenuCleanupRef.current = null;
        rendererRef.current = null;
      }

      canvasReadyRef.current = true;
      setCanvasFailure(false);
      contextLossInFlightRef.current = false;
      rendererRef.current = state.gl;

      if (sceneRef) {
        sceneRef.current = state.scene;
      }

      if (typeof window !== 'undefined' && import.meta.env.DEV) {
        (window as Window & { scene?: THREE.Scene; THREE?: typeof THREE }).scene = state.scene;
        (window as Window & { scene?: THREE.Scene; THREE?: typeof THREE }).THREE = THREE;
      }

      const canvas = state.gl.domElement;
      const surfaceEventTarget = canvas.parentElement ?? canvas;

      contextMenuCleanupRef.current?.();
      const cleanupCanvasBlocker = attachContextMenuBlocker(canvas);
      const cleanupSurfaceBlocker =
        surfaceEventTarget === canvas ? () => {} : attachContextMenuBlocker(surfaceEventTarget);
      contextMenuCleanupRef.current = () => {
        cleanupSurfaceBlocker();
        cleanupCanvasBlocker();
      };

      const handleContextLost = (event: Event) => {
        event.preventDefault();
        console.error('[WorkspaceCanvas] WebGL context lost; rebuilding 3D canvas renderer.');
        if (!contextLossInFlightRef.current) {
          contextLossInFlightRef.current = true;
          // Force a full renderer rebuild instead of leaving the canvas in a stale state.
          setContextEpoch((value) => value + 1);
        }
      };

      const handleContextRestored = () => {
        // If the browser restored the context without us remounting, schedule a redraw.
        // In practice, the epoch-based remount above is the more reliable recovery path.
        contextLossInFlightRef.current = false;
        state.invalidate();
      };

      canvas.addEventListener('webglcontextlost', handleContextLost, false);
      canvas.addEventListener('webglcontextrestored', handleContextRestored, false);

      (
        canvas as HTMLCanvasElement & {
          __workspaceCanvasCleanup?: () => void;
        }
      ).__workspaceCanvasCleanup = () => {
        canvas.removeEventListener('webglcontextlost', handleContextLost);
        canvas.removeEventListener('webglcontextrestored', handleContextRestored);
        contextMenuCleanupRef.current?.();
        contextMenuCleanupRef.current = null;
      };

      onCreated?.(state);
    },
    [onCreated, sceneRef],
  );

  const handleCanvasError = useCallback((error: unknown) => {
    const kind = canvasReadyRef.current ? 'runtime' : 'initialization';
    const detail = getWorkspaceCanvasErrorDetail(error);

    console.error(
      kind === 'runtime'
        ? '[WorkspaceCanvas] Unexpected error inside the 3D canvas.'
        : '[WorkspaceCanvas] Failed to initialize the 3D canvas.',
      error,
    );

    if (detail) {
      console.error('[WorkspaceCanvas] Canvas error detail:', detail);
    }

    setCanvasFailure(true);
  }, []);

  useEffect(() => {
    return () => {
      cleanupWorkspaceCanvasRenderer(rendererRef.current, contextMenuCleanupRef.current);
      contextMenuCleanupRef.current = null;
      rendererRef.current = null;
    };
  }, []);

  const handlePointerDownCapture = useCallback<React.PointerEventHandler<HTMLDivElement>>(
    (event) => {
      beginInteraction();
      if (event.button === 0) {
        pointerMissGestureRef.current = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          endX: event.clientX,
          endY: event.clientY,
        };
        suppressNextPointerMissRef.current = false;
      }
      onPointerDownCapture?.(event);
    },
    [beginInteraction, onPointerDownCapture],
  );

  const updatePointerMissGesture = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const gesture = pointerMissGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;

    gesture.endX = event.clientX;
    gesture.endY = event.clientY;
  }, []);

  const handlePointerMoveCapture = useCallback<React.PointerEventHandler<HTMLDivElement>>(
    (event) => {
      updatePointerMissGesture(event);
    },
    [updatePointerMissGesture],
  );

  const handlePointerUpCapture = useCallback<React.PointerEventHandler<HTMLDivElement>>(
    (event) => {
      updatePointerMissGesture(event);

      const gesture = pointerMissGestureRef.current;
      if (gesture && gesture.pointerId === event.pointerId) {
        suppressNextPointerMissRef.current = shouldSuppressWorkspacePointerMissAfterDrag(gesture);
        pointerMissGestureRef.current = null;
      }

      endInteraction();
    },
    [endInteraction, updatePointerMissGesture],
  );

  const handlePointerLeave = useCallback<React.PointerEventHandler<HTMLDivElement>>(
    (event) => {
      updatePointerMissGesture(event);
      pointerMissGestureRef.current = null;
      endInteraction(0);
    },
    [endInteraction, updatePointerMissGesture],
  );

  const handlePointerMissed = useCallback(() => {
    if (suppressNextPointerMissRef.current) {
      suppressNextPointerMissRef.current = false;
      return;
    }

    onPointerMissed?.();
  }, [onPointerMissed]);

  const handleMouseMove = useCallback<React.MouseEventHandler<HTMLDivElement>>(
    (event) => {
      if (event.buttons !== 0) {
        beginInteraction();
      }
      onMouseMove?.(event);
    },
    [beginInteraction, onMouseMove],
  );

  const handleMouseUp = useCallback<React.MouseEventHandler<HTMLDivElement>>(
    (event) => {
      endInteraction();
      onMouseUp?.(event);
    },
    [endInteraction, onMouseUp],
  );

  const handleMouseLeave = useCallback<React.MouseEventHandler<HTMLDivElement>>(
    (event) => {
      endInteraction(0);
      onMouseLeave?.(event);
    },
    [endInteraction, onMouseLeave],
  );

  const shouldRenderCanvas = webglSupport?.supported === true && !canvasFailure;
  const rootClassName = `${className} [&_canvas]:!h-full [&_canvas]:!w-full`;
  const resizeOptions = resolveWorkspaceCanvasResizeOptions(layoutResizeActive);
  const effectiveDpr =
    Number.isFinite(maxDpr) && Number(maxDpr) > 0 ? Math.min(dpr, Number(maxDpr)) : dpr;
  const shouldEnableShadows = enableShadows || snapshotRenderActive;

  useEffect(() => {
    if (!shouldRenderCanvas) {
      return undefined;
    }

    const frameId = scheduleWorkspaceCanvasResizeEvent(window);
    return () => window.cancelAnimationFrame(frameId);
  }, [canvasResetKey, shouldRenderCanvas]);

  return (
    <div
      ref={containerRef}
      className={rootClassName}
      style={{
        touchAction: 'none',
        userSelect: 'none',
        backgroundColor: activeBackgroundColor,
      }}
      onPointerDownCapture={handlePointerDownCapture}
      onPointerMoveCapture={handlePointerMoveCapture}
      onPointerUpCapture={handlePointerUpCapture}
      onPointerLeave={handlePointerLeave}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
      onWheelCapture={() => pulseInteraction()}
      onContextMenuCapture={(event) => event.preventDefault()}
      role="button"
      aria-label={`${robotName} workspace`}
      tabIndex={-1}
    >
      {overlays}
      {shouldRenderCanvas ? (
        <WorkspaceCanvasErrorBoundary
          fallback={null}
          onError={handleCanvasError}
          resetKey={failureResetKey}
        >
          <Canvas
            key={canvasResetKey}
            dpr={effectiveDpr}
            shadows={shouldEnableShadows}
            resize={resizeOptions}
            frameloop="demand"
            camera={canvasCamera}
            gl={canvasGl}
            onCreated={handleCreated}
            onPointerMissed={handlePointerMissed}
            translate="no"
          >
            <WorkspaceCanvasInteractionStateProvider isInteracting={isInteracting}>
              <SnapshotRenderStateProvider
                value={{
                  snapshotRenderActive,
                  setSnapshotRenderActive,
                }}
              >
                <SemanticOutlineProvider enableAmbientOcclusion={enableAmbientOcclusion}>
                <CanvasRenderKeyInvalidator renderKey={renderKey} />
                <CanvasResizeSync />
                {cameraProjection === 'orthographic' && (
                  <OrthographicCamera
                    makeDefault
                    position={WORKSPACE_DEFAULT_CAMERA_POSITION}
                    up={WORKSPACE_DEFAULT_CAMERA_UP}
                    zoom={WORKSPACE_DEFAULT_CAMERA_ORTHOGRAPHIC_ZOOM}
                    near={0.1}
                    far={1000}
                  />
                )}
                {/* Keep the live stage transparent so tone mapping only grades
                    rendered geometry. The container supplies the exact theme
                    background, avoiding a washed-grey flat color. */}
                <Suspense fallback={null}>
                  {environment === 'hdr' && (
                    <Environment
                      files="/potsdamer_platz_1k.hdr"
                      environmentIntensity={effectiveTheme === 'light' ? 0.8 : 1.0}
                    />
                  )}
                  {environment === 'studio' && (
                    <NeutralStudioEnvironment intensity={resolvedEnvironmentIntensity} />
                  )}
                </Suspense>
                <SceneLighting
                  theme={effectiveTheme}
                  cameraFollowPrimary={cameraFollowPrimary}
                  // Keep shadows enabled and updating across interaction so
                  // orbiting and dragging use the exact same lighting path.
                  enableShadows={enableShadows}
                  shadowMapSize={shadowMapSize}
                />
                <SnapshotManager
                  actionRef={snapshotAction}
                  onSnapshotActionChange={onSnapshotActionChange}
                  previewActionRef={previewAction}
                  onPreviewActionChange={onPreviewActionChange}
                  robotName={robotName}
                  theme={effectiveTheme}
                  groundOffset={groundOffset}
                />
                <Suspense fallback={null}>{children}</Suspense>
                {showGroundPlane ? (
                  <AdaptiveGroundPlane
                    theme={effectiveTheme}
                    groundOffset={groundOffset}
                    showShadow={showGroundShadow && shouldEnableShadows}
                    subscribeInvalidation={subscribeGroundPlaneInvalidation}
                  />
                ) : null}
                {showWorldOriginAxes && !snapshotRenderActive && <WorldOriginAxes />}
                <WorkspaceOrbitControls
                  key={`orbit-${controlLayerKey}`}
                  initialCameraSnapshot={initialCameraSnapshot}
                  {...finalOrbitControlsProps}
                  eventSource={orbitControlsEventSource}
                />
                {showViewportGizmo && !snapshotRenderActive && (
                  <GizmoHelper
                    key={`gizmo-${controlLayerKey}`}
                    alignment="bottom-right"
                    margin={gizmoMargin}
                  >
                    <GizmoViewport
                      axisColors={['#ef4444', '#22c55e', '#3b82f6']}
                      labelColor={effectiveTheme === 'light' ? '#0f172a' : 'white'}
                      axisHeadScale={0.9}
                      scale={34}
                    />
                  </GizmoHelper>
                )}
                </SemanticOutlineProvider>
              </SnapshotRenderStateProvider>
            </WorkspaceCanvasInteractionStateProvider>
          </Canvas>
        </WorkspaceCanvasErrorBoundary>
      ) : null}

      {lang && showUsageGuide && shouldRenderCanvas ? <UsageGuide lang={lang} /> : null}
    </div>
  );
};
