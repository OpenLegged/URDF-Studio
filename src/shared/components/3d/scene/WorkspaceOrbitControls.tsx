import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import {
  DEFAULT_WORKSPACE_ORBIT_CLIPPING,
  syncWorkspaceClipPlanes,
} from './workspaceOrbitClipping';
import {
  resolveWorkspaceOrbitPanSpeed,
  resolveWorkspaceOrbitZoomSpeed,
} from './workspaceOrbitPan';
import { useSceneBoundsCache } from './useSceneBoundsCache';
import {
  applyWorkspaceCameraSnapshot,
  type WorkspaceCameraSnapshot,
} from '../workspace/workspaceCameraSnapshot';

const WORKSPACE_ORBIT_CONTROL_TUNING = {
  dampingFactor: 0.08,
  rotateSpeed: 0.85,
  panSpeed: 0.9,
  // Calmer baseline wheel-zoom, closer to large 3D software (Blender / Maya).
  // OrbitControls dollies by Math.pow(0.95, zoomSpeed) per notch, so 0.8 ≈ 3.5%
  // per notch vs the previous 1.15 ≈ 5.9%. Users can further tune via the
  // Navigation sensitivity slider (zoomSensitivity multiplier).
  zoomSpeed: 0.8,
  zoomToCursor: true,
  enableDamping: true,
  minPolarAngle: 0.01,
  maxPolarAngle: Math.PI - 0.01,
  ...DEFAULT_WORKSPACE_ORBIT_CLIPPING,
} as const;

export interface WorkspaceOrbitControlsProps {
  enabled?: boolean;
  onStart?: () => void;
  onEnd?: () => void;
  enableDamping?: boolean;
  enableRotate?: boolean;
  enablePan?: boolean;
  enableZoom?: boolean;
  dampingFactor?: number;
  rotateSpeed?: number;
  panSpeed?: number;
  zoomSpeed?: number;
  /** User-facing navigation sensitivity multipliers (1 = 100% = base tuning). */
  zoomSensitivity?: number;
  rotateSensitivity?: number;
  panSensitivity?: number;
  zoomToCursor?: boolean;
  screenSpacePanning?: boolean;
  mouseButtons?: OrbitControlsImpl['mouseButtons'];
  touches?: OrbitControlsImpl['touches'];
  minPolarAngle?: number;
  maxPolarAngle?: number;
  minDistance?: number;
  maxDistance?: number;
  initialCameraSnapshot?: WorkspaceCameraSnapshot | null;
  eventSource?: 'default' | 'canvas';
}

export function WorkspaceOrbitControls({
  enabled = true,
  onStart,
  onEnd,
  enableDamping = WORKSPACE_ORBIT_CONTROL_TUNING.enableDamping,
  enableRotate = true,
  enablePan = true,
  enableZoom = true,
  dampingFactor = WORKSPACE_ORBIT_CONTROL_TUNING.dampingFactor,
  rotateSpeed = WORKSPACE_ORBIT_CONTROL_TUNING.rotateSpeed,
  panSpeed = WORKSPACE_ORBIT_CONTROL_TUNING.panSpeed,
  zoomSpeed = WORKSPACE_ORBIT_CONTROL_TUNING.zoomSpeed,
  zoomSensitivity = 1,
  rotateSensitivity = 1,
  panSensitivity = 1,
  zoomToCursor = WORKSPACE_ORBIT_CONTROL_TUNING.zoomToCursor,
  screenSpacePanning = true,
  mouseButtons,
  touches,
  minPolarAngle = WORKSPACE_ORBIT_CONTROL_TUNING.minPolarAngle,
  maxPolarAngle = WORKSPACE_ORBIT_CONTROL_TUNING.maxPolarAngle,
  minDistance = WORKSPACE_ORBIT_CONTROL_TUNING.minDistance,
  maxDistance,
  initialCameraSnapshot = null,
  eventSource = 'default',
}: WorkspaceOrbitControlsProps) {
  const camera = useThree((state) => state.camera);
  const gl = useThree((state) => state.gl);
  const events = useThree((state) => state.events);
  const invalidate = useThree((state) => state.invalidate);
  const set = useThree((state) => state.set);
  const get = useThree((state) => state.get);
  const size = useThree((state) => state.size);
  const controls = useMemo(() => new OrbitControlsImpl(camera), [camera]);
  const controlsRef = useRef<OrbitControlsImpl | null>(controls);
  const { getClipBounds, getPanBounds, invalidate: invalidateSceneBounds } = useSceneBoundsCache();

  // Fold the user sensitivity multiplier into the base tuning so the adaptive
  // pan/zoom resolvers and the OrbitControls props all share one effective
  // speed. Rotate has no distance-based resolver, so it is applied directly.
  const effectiveRotateSpeed = rotateSpeed * rotateSensitivity;
  const effectivePanSpeed = panSpeed * panSensitivity;
  const effectiveZoomSpeed = zoomSpeed * zoomSensitivity;
  const domElement = eventSource === 'canvas' ? gl.domElement : (events.connected ?? gl.domElement);

  controlsRef.current = controls;
  controls.enabled = enabled;
  controls.enableDamping = enableDamping;
  controls.enableRotate = enableRotate;
  controls.enablePan = enablePan;
  controls.enableZoom = enableZoom;
  controls.dampingFactor = dampingFactor;
  controls.rotateSpeed = effectiveRotateSpeed;
  controls.panSpeed = effectivePanSpeed;
  controls.zoomSpeed = effectiveZoomSpeed;
  controls.zoomToCursor = zoomToCursor;
  controls.screenSpacePanning = screenSpacePanning;
  if (mouseButtons) {
    controls.mouseButtons = mouseButtons;
  }
  if (touches) {
    controls.touches = touches;
  }
  controls.minPolarAngle = minPolarAngle;
  controls.maxPolarAngle = maxPolarAngle;
  controls.minDistance = minDistance;
  controls.maxDistance = maxDistance ?? Infinity;

  useFrame(() => {
    if (controls.enabled) {
      const cameraChanged = controls.update() as unknown as boolean;
      if (cameraChanged) {
        invalidate();
      }
    }
  }, -1);

  useLayoutEffect(() => {
    controls.connect(domElement);
    return () => {
      controls.dispose();
    };
  }, [controls, domElement, gl.domElement]);

  useEffect(() => {
    const previousControls = get().controls;
    set({ controls });
    return () => {
      set({ controls: previousControls });
    };
  }, [controls, get, set]);

  useEffect(() => {
    let scheduledFrame: number | null = null;
    const scheduleRender = () => {
      if (!controls.enabled) {
        return;
      }

      if (scheduledFrame !== null) {
        return;
      }

      scheduledFrame = window.requestAnimationFrame(() => {
        scheduledFrame = null;
        if (!controls.enabled) {
          return;
        }

        const { camera } = get();
        const cameraChanged = controls.update() as unknown as boolean;
        controls.dispatchEvent({ type: 'change', target: controls });
        camera.updateMatrixWorld(true);
        // Let R3F run the full demand-frame pipeline; direct gl.render() skips Hud passes.
        invalidate();

        if (controls.enableDamping && cameraChanged) {
          scheduleRender();
        }
      });
    };
    const handlePointerMove = (event: PointerEvent) => {
      if (event.buttons !== 0) {
        scheduleRender();
      }
    };

    domElement.addEventListener('pointerdown', scheduleRender, { passive: true });
    domElement.addEventListener('pointerup', scheduleRender, { passive: true });
    domElement.addEventListener('pointercancel', scheduleRender, { passive: true });
    domElement.addEventListener('pointermove', handlePointerMove, { passive: true });
    domElement.addEventListener('wheel', scheduleRender, { passive: true });
    domElement.addEventListener('touchstart', scheduleRender, { passive: true });
    domElement.addEventListener('touchmove', scheduleRender, { passive: true });
    domElement.addEventListener('touchend', scheduleRender, { passive: true });

    return () => {
      if (scheduledFrame !== null) {
        window.cancelAnimationFrame(scheduledFrame);
        scheduledFrame = null;
      }
      domElement.removeEventListener('pointerdown', scheduleRender);
      domElement.removeEventListener('pointerup', scheduleRender);
      domElement.removeEventListener('pointercancel', scheduleRender);
      domElement.removeEventListener('pointermove', handlePointerMove);
      domElement.removeEventListener('wheel', scheduleRender);
      domElement.removeEventListener('touchstart', scheduleRender);
      domElement.removeEventListener('touchmove', scheduleRender);
      domElement.removeEventListener('touchend', scheduleRender);
    };
  }, [controls, domElement, get, invalidate]);

  useEffect(() => {
    controls.enabled = enabled;
    controls.enableDamping = enableDamping;
    controls.enableRotate = enableRotate;
    controls.enablePan = enablePan;
    controls.enableZoom = enableZoom;
    controls.dampingFactor = dampingFactor;
    controls.rotateSpeed = effectiveRotateSpeed;
    controls.panSpeed = effectivePanSpeed;
    controls.zoomSpeed = effectiveZoomSpeed;
    controls.zoomToCursor = zoomToCursor;
    controls.screenSpacePanning = screenSpacePanning;
    if (mouseButtons) {
      controls.mouseButtons = mouseButtons;
    }
    if (touches) {
      controls.touches = touches;
    }
    controls.minPolarAngle = minPolarAngle;
    controls.maxPolarAngle = maxPolarAngle;
    controls.minDistance = minDistance;
    controls.maxDistance = maxDistance ?? Infinity;
    controls.update();
    invalidate();
  }, [
    controls,
    dampingFactor,
    effectivePanSpeed,
    effectiveRotateSpeed,
    effectiveZoomSpeed,
    enableDamping,
    enablePan,
    enableRotate,
    enableZoom,
    enabled,
    invalidate,
    maxPolarAngle,
    maxDistance,
    minPolarAngle,
    minDistance,
    mouseButtons,
    screenSpacePanning,
    touches,
    zoomToCursor,
  ]);

  useEffect(() => {
    if (!controlsRef.current) {
      return;
    }

    // The snapshot stores the aspect ratio of the workspace it was captured in.
    // When it seeds a preview whose frame has a different shape (a fixed
    // 16:9 / 1:1 / … preset, or the inset-adjusted viewport aspect), copying
    // that stored aspect squishes the model. Seed with the live render-surface
    // aspect instead so only the initial view angle is inherited.
    const { width, height } = get().size;
    const surfaceAspectRatio = width > 0 && height > 0 ? width / height : null;
    applyWorkspaceCameraSnapshot(camera, controlsRef.current, initialCameraSnapshot, {
      aspectRatioOverride: surfaceAspectRatio,
    });
    invalidate();
  }, [camera, get, initialCameraSnapshot, invalidate]);

  // Keep the perspective aspect ratio locked to the actual render surface on
  // every resize (e.g. switching the snapshot aspect preset reshapes the
  // preview canvas). This only touches the projection aspect, so a user's
  // current orbit/pan/zoom is preserved. Orthographic cameras manage their own
  // framing via drei's <OrthographicCamera>, so they are left untouched.
  useEffect(() => {
    const perspectiveCamera = camera as typeof camera & {
      isPerspectiveCamera?: boolean;
      aspect?: number;
      updateProjectionMatrix?: () => void;
    };
    if (!perspectiveCamera.isPerspectiveCamera || typeof perspectiveCamera.aspect !== 'number') {
      return;
    }
    if (size.width <= 0 || size.height <= 0) {
      return;
    }

    const nextAspect = size.width / size.height;
    if (Math.abs(perspectiveCamera.aspect - nextAspect) <= 1e-6) {
      return;
    }

    perspectiveCamera.aspect = nextAspect;
    perspectiveCamera.updateProjectionMatrix?.();
    invalidate();
  }, [camera, invalidate, size.height, size.width]);

  // Sync clip planes + pan/zoom speed on every controls 'change' event
  // (rotate / pan / zoom / damping ticks / programmatic controls.update())
  // instead of every demanded frame. The clip planes also need a one-shot
  // sync at mount so the very first rendered frame uses correct near/far
  // (otherwise dense robot geometry can clip away until the user moves the
  // camera).
  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls) {
      return;
    }

    const syncControls = () => {
      const clipBounds = getClipBounds();
      const panBounds = getPanBounds();

      // `zoomToCursor` can place the camera very close to one surface while
      // the orbit target remains deeper in the model. Keep the near plane
      // conservative so dense robot geometry does not clip away while
      // zooming.
      syncWorkspaceClipPlanes(camera, controls, {
        minDistance,
        sceneBounds: clipBounds,
      });

      const resolvedPanSpeed = resolveWorkspaceOrbitPanSpeed({
        basePanSpeed: effectivePanSpeed,
        camera,
        target: controls.target,
        sceneBounds: panBounds,
        minDistance,
      });
      if (Math.abs(controls.panSpeed - resolvedPanSpeed) > 1e-4) {
        controls.panSpeed = resolvedPanSpeed;
      }

      const resolvedZoomSpeed = resolveWorkspaceOrbitZoomSpeed({
        baseZoomSpeed: effectiveZoomSpeed,
        camera,
        target: controls.target,
        sceneBounds: panBounds,
        minDistance,
      });
      if (Math.abs(controls.zoomSpeed - resolvedZoomSpeed) > 1e-4) {
        controls.zoomSpeed = resolvedZoomSpeed;
      }
    };

    // One-shot sync at mount + whenever any of the tuning inputs change so
    // the very first frame already has correct near/far + speed scaling.
    syncControls();

    controls.addEventListener('change', syncControls);
    return () => {
      controls.removeEventListener('change', syncControls);
    };
  }, [camera, getClipBounds, getPanBounds, minDistance, effectivePanSpeed, effectiveZoomSpeed]);

  useEffect(() => {
    const handleChange = () => {
      invalidate();
    };
    const handleStart = () => {
      // Refresh bounds before a user interaction so any drift since the
      // last compute (e.g. programmatic joint motion that did not mutate
      // the scene tree) is rebuilt before pan/zoom tuning is evaluated.
      invalidateSceneBounds();
      onStart?.();
    };
    const handleEnd = () => {
      onEnd?.();
    };

    controls.addEventListener('change', handleChange);
    controls.addEventListener('start', handleStart);
    controls.addEventListener('end', handleEnd);
    return () => {
      controls.removeEventListener('change', handleChange);
      controls.removeEventListener('start', handleStart);
      controls.removeEventListener('end', handleEnd);
    };
  }, [controls, invalidate, invalidateSceneBounds, onEnd, onStart]);

  return null;
}
