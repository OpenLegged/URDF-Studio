import React, { createContext, useContext, useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

import { useSnapshotRenderActive } from './SnapshotRenderContext';
import { useWorkspaceCanvasInteractionState } from './interactionQuality';
import {
  createSemanticOutlineComposer,
  type SemanticOutlineIntent,
} from './semanticOutlineComposer';
import {
  shouldRenderRealtimeAmbientOcclusion,
  type RealtimeViewportComposer,
  type RealtimeViewportDiagnostics,
} from './realtimeViewportComposer';

interface SemanticOutlineEntry {
  intent: SemanticOutlineIntent;
  targets: readonly THREE.Object3D[];
}

interface SemanticOutlineRegistry {
  clearTargets: (owner: symbol) => void;
  setTargets: (
    owner: symbol,
    targets: readonly THREE.Object3D[],
    intent?: SemanticOutlineIntent,
  ) => void;
}

const SemanticOutlineContext = createContext<SemanticOutlineRegistry | null>(null);

// The outline overlay carries semantics (what is hovered / selected), not
// decoration, so it is dropped only while the whole frame is already in motion
// from a camera move — never for object-level drags such as rotating a joint by
// dragging its link, where the outline is the feedback the user is watching.
//
// Selection outlines are a persistent, committed state (like text selection in
// a document editor) and MUST remain visible during all viewport navigation —
// matching Blender, Fusion 360, and other professional 3D tools.  Only
// transient hover outlines are suppressed during camera movement.
export function shouldRenderSemanticOutlineOverlay({
  hasTargets,
  cameraMoving,
  snapshotRenderActive,
  hasSelectionTargets = false,
}: {
  hasTargets: boolean;
  cameraMoving: boolean;
  snapshotRenderActive: boolean;
  hasSelectionTargets?: boolean;
}): boolean {
  if (snapshotRenderActive) return false;
  if (!hasTargets) return false;
  // Suppress hover-only overlays during camera movement, but keep selection
  // outlines visible so the user always knows what is selected.
  if (cameraMoving && !hasSelectionTargets) return false;
  return true;
}

// Controls rewrite the camera transform every frame, so an idle camera still
// drifts by float rounding (~1e-15). Exact comparison would read that as motion
// and keep the overlay off forever; these thresholds sit far below any camera
// change a viewer can perceive but well above the rounding noise.
const CAMERA_MOTION_POSITION_EPSILON_SQUARED = 1e-12;
const CAMERA_MOTION_ROTATION_EPSILON = 1e-9;
const CAMERA_MOTION_ZOOM_EPSILON = 1e-6;

function readCameraZoom(camera: THREE.Camera): number {
  return 'zoom' in camera && typeof camera.zoom === 'number' ? camera.zoom : 1;
}

export function isCameraPoseMoving({
  position,
  quaternion,
  zoom,
  previousPosition,
  previousQuaternion,
  previousZoom,
}: {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  zoom: number;
  previousPosition: THREE.Vector3;
  previousQuaternion: THREE.Quaternion;
  previousZoom: number;
}): boolean {
  return (
    position.distanceToSquared(previousPosition) > CAMERA_MOTION_POSITION_EPSILON_SQUARED ||
    1 - Math.abs(quaternion.dot(previousQuaternion)) > CAMERA_MOTION_ROTATION_EPSILON ||
    Math.abs(zoom - previousZoom) > CAMERA_MOTION_ZOOM_EPSILON
  );
}

function setAmbientOcclusionDiagnostics(
  canvas: HTMLCanvasElement,
  status: 'active' | 'unavailable',
  diagnostics?: RealtimeViewportDiagnostics,
): void {
  const { dataset } = canvas;
  dataset.realtimeAmbientOcclusion = status;
  if (diagnostics) {
    dataset.realtimeAmbientOcclusionPixelRatio = diagnostics.pixelRatio.toFixed(3);
    dataset.realtimeAmbientOcclusionTarget =
      `${diagnostics.targetWidth}x${diagnostics.targetHeight}`;
  } else {
    delete dataset.realtimeAmbientOcclusionPixelRatio;
    delete dataset.realtimeAmbientOcclusionTarget;
  }
}

function clearAmbientOcclusionDiagnostics(canvas: HTMLCanvasElement): void {
  const { dataset } = canvas;
  delete dataset.realtimeAmbientOcclusion;
  delete dataset.realtimeAmbientOcclusionPixelRatio;
  delete dataset.realtimeAmbientOcclusionTarget;
}

function SemanticOutlineRenderer({
  entriesRef,
  enableAmbientOcclusion,
}: {
  entriesRef: React.RefObject<Map<symbol, SemanticOutlineEntry>>;
  enableAmbientOcclusion: boolean;
}) {
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);
  const size = useThree((state) => state.size);
  const dpr = useThree((state) => state.viewport.dpr);
  const invalidate = useThree((state) => state.invalidate);
  const snapshotRenderActive = useSnapshotRenderActive();
  const isInteracting = useWorkspaceCanvasInteractionState();
  const realtimeComposerRef = useRef<RealtimeViewportComposer | null>(null);
  const lastCameraPoseRef = useRef<{
    sampled: boolean;
    position: THREE.Vector3;
    quaternion: THREE.Quaternion;
    zoom: number;
  }>({
    sampled: false,
    position: new THREE.Vector3(),
    quaternion: new THREE.Quaternion(),
    zoom: 1,
  });
  const latestSizeRef = useRef({
    width: size.width,
    height: size.height,
    rendererPixelRatio: dpr,
  });
  latestSizeRef.current = {
    width: size.width,
    height: size.height,
    rendererPixelRatio: dpr,
  };
  const outline = useMemo(
    () =>
      createSemanticOutlineComposer({
        renderer: gl,
        scene,
        camera,
        width: 1,
        height: 1,
        pixelRatio: gl.getPixelRatio(),
      }),
    [camera, gl, scene],
  );

  useEffect(() => {
    if (!enableAmbientOcclusion) {
      clearAmbientOcclusionDiagnostics(gl.domElement);
      return;
    }

    let cancelled = false;
    let ownedComposer: RealtimeViewportComposer | null = null;

    void import('./realtimeViewportComposer')
      .then(({ createRealtimeViewportComposer }) => {
        if (cancelled) return;

        const latestSize = latestSizeRef.current;
        ownedComposer = createRealtimeViewportComposer({
          renderer: gl,
          scene,
          camera,
          width: latestSize.width,
          height: latestSize.height,
          rendererPixelRatio: latestSize.rendererPixelRatio,
        });
        realtimeComposerRef.current = ownedComposer;
        setAmbientOcclusionDiagnostics(
          gl.domElement,
          'active',
          ownedComposer.getDiagnostics(),
        );
        invalidate();
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        console.warn('[SemanticOutline] Realtime GTAO unavailable; using direct rendering.', error);
        setAmbientOcclusionDiagnostics(gl.domElement, 'unavailable');
        invalidate();
      });

    return () => {
      cancelled = true;
      if (realtimeComposerRef.current === ownedComposer) {
        realtimeComposerRef.current = null;
      }
      ownedComposer?.dispose();
      clearAmbientOcclusionDiagnostics(gl.domElement);
      invalidate();
    };
  }, [camera, enableAmbientOcclusion, gl, invalidate, scene]);

  useEffect(() => {
    outline.setSize(size.width, size.height, dpr);
    const realtimeComposer = realtimeComposerRef.current;
    if (realtimeComposer) {
      realtimeComposer.setSize(size.width, size.height, dpr);
      setAmbientOcclusionDiagnostics(
        gl.domElement,
        'active',
        realtimeComposer.getDiagnostics(),
      );
    }
  }, [dpr, gl, outline, size.height, size.width]);

  useEffect(() => () => outline.dispose(), [outline]);

  useFrame((_, deltaTime) => {
    const targets: THREE.Object3D[] = [];
    const seenTargets = new Set<THREE.Object3D>();
    let intent: SemanticOutlineIntent = 'selection';
    let hasSelectionTargets = false;

    if (!snapshotRenderActive) {
      entriesRef.current.forEach((entry) => {
        if (entry.intent === 'hover') {
          intent = 'hover';
        }
        if (entry.intent === 'selection' && entry.targets.length > 0) {
          hasSelectionTargets = true;
        }
        entry.targets.forEach((target) => {
          if (!seenTargets.has(target)) {
            seenTargets.add(target);
            targets.push(target);
          }
        });
      });
    }

    const lastCameraPose = lastCameraPoseRef.current;
    const cameraZoom = readCameraZoom(camera);
    const cameraMoving =
      lastCameraPose.sampled &&
      isCameraPoseMoving({
        position: camera.position,
        quaternion: camera.quaternion,
        zoom: cameraZoom,
        previousPosition: lastCameraPose.position,
        previousQuaternion: lastCameraPose.quaternion,
        previousZoom: lastCameraPose.zoom,
      });
    lastCameraPose.sampled = true;
    lastCameraPose.position.copy(camera.position);
    lastCameraPose.quaternion.copy(camera.quaternion);
    lastCameraPose.zoom = cameraZoom;

    const realtimeComposer = shouldRenderRealtimeAmbientOcclusion({
      composerAvailable: realtimeComposerRef.current !== null,
      isInteracting,
      snapshotRenderActive,
    })
      ? realtimeComposerRef.current
      : null;

    // When the camera is moving, suppress transient hover outlines but keep
    // persistent selection outlines visible.  Force the effective intent to
    // 'selection' so that hover colours do not flicker on the selected object
    // while the user navigates the viewport.
    const effectiveIntent =
      cameraMoving && hasSelectionTargets ? 'selection' : intent;

    const shouldRenderOutlineOverlay = shouldRenderSemanticOutlineOverlay({
      hasTargets: targets.length > 0,
      cameraMoving,
      snapshotRenderActive,
      hasSelectionTargets,
    });

    // On-demand frameloops stop rendering as soon as the camera settles, so the
    // frame that skipped the overlay would otherwise be the last one drawn and
    // the outline would stay missing until an unrelated invalidate.
    if (cameraMoving && targets.length > 0 && !snapshotRenderActive) {
      invalidate();
    }

    // Diagnostics mirror of the overlay decision, so browser regressions can
    // assert that hover/selection outlines stay on screen (e.g. while a mouse
    // button is held down without moving).
    const outlineOverlayState = shouldRenderOutlineOverlay ? effectiveIntent : 'off';
    if (gl.domElement.dataset.semanticOutlineOverlay !== outlineOverlayState) {
      gl.domElement.dataset.semanticOutlineOverlay = outlineOverlayState;
    }

    if (!shouldRenderOutlineOverlay && !realtimeComposer) {
      gl.render(scene, camera);
      return;
    }

    if (realtimeComposer) {
      try {
        realtimeComposer.render(deltaTime);
      } catch (error: unknown) {
        console.warn('[SemanticOutline] Realtime GTAO render failed; using direct rendering.', error);
        realtimeComposerRef.current = null;
        realtimeComposer.dispose();
        setAmbientOcclusionDiagnostics(gl.domElement, 'unavailable');
        gl.render(scene, camera);
      }
    } else {
      gl.render(scene, camera);
    }

    if (!shouldRenderOutlineOverlay) return;

    outline.setCamera(camera);
    outline.setIntent(effectiveIntent);
    outline.setTargets(targets);
    outline.renderOverlay();
  }, 1);

  return null;
}

export function SemanticOutlineProvider({
  children,
  enableAmbientOcclusion = false,
}: {
  children: React.ReactNode;
  enableAmbientOcclusion?: boolean;
}) {
  const invalidate = useThree((state) => state.invalidate);
  const entriesRef = useRef(new Map<symbol, SemanticOutlineEntry>());
  const registry = useMemo<SemanticOutlineRegistry>(
    () => ({
      clearTargets(owner) {
        if (entriesRef.current.delete(owner)) {
          invalidate();
        }
      },
      setTargets(owner, targets, intent = 'hover') {
        if (targets.length === 0) {
          if (entriesRef.current.delete(owner)) {
            invalidate();
          }
          return;
        }
        entriesRef.current.set(owner, { intent, targets: [...targets] });
        invalidate();
      },
    }),
    [invalidate],
  );

  useEffect(() => () => entriesRef.current.clear(), []);

  return (
    <SemanticOutlineContext.Provider value={registry}>
      {children}
      <SemanticOutlineRenderer
        entriesRef={entriesRef}
        enableAmbientOcclusion={enableAmbientOcclusion}
      />
    </SemanticOutlineContext.Provider>
  );
}

export function useSemanticOutline(): SemanticOutlineRegistry | null {
  return useContext(SemanticOutlineContext);
}
