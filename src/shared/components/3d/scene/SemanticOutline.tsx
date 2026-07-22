import React, { createContext, useContext, useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import type * as THREE from 'three';

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
  const invalidate = useThree((state) => state.invalidate);
  const snapshotRenderActive = useSnapshotRenderActive();
  const isInteracting = useWorkspaceCanvasInteractionState();
  const realtimeComposerRef = useRef<RealtimeViewportComposer | null>(null);
  const latestSizeRef = useRef({
    width: size.width,
    height: size.height,
    rendererPixelRatio: gl.getPixelRatio(),
  });
  latestSizeRef.current = {
    width: size.width,
    height: size.height,
    rendererPixelRatio: gl.getPixelRatio(),
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
    outline.setSize(size.width, size.height, gl.getPixelRatio());
    const realtimeComposer = realtimeComposerRef.current;
    if (realtimeComposer) {
      realtimeComposer.setSize(size.width, size.height, gl.getPixelRatio());
      setAmbientOcclusionDiagnostics(
        gl.domElement,
        'active',
        realtimeComposer.getDiagnostics(),
      );
    }
  }, [gl, outline, size.height, size.width]);

  useEffect(() => () => outline.dispose(), [outline]);

  useFrame((_, deltaTime) => {
    const targets: THREE.Object3D[] = [];
    const seenTargets = new Set<THREE.Object3D>();
    let intent: SemanticOutlineIntent = 'selection';

    if (!snapshotRenderActive) {
      entriesRef.current.forEach((entry) => {
        if (entry.intent === 'hover') {
          intent = 'hover';
        }
        entry.targets.forEach((target) => {
          if (!seenTargets.has(target)) {
            seenTargets.add(target);
            targets.push(target);
          }
        });
      });
    }

    const realtimeComposer = shouldRenderRealtimeAmbientOcclusion({
      composerAvailable: realtimeComposerRef.current !== null,
      isInteracting,
      snapshotRenderActive,
    })
      ? realtimeComposerRef.current
      : null;
    if (targets.length === 0 && !realtimeComposer) {
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

    if (targets.length === 0) return;

    outline.setCamera(camera);
    outline.setIntent(intent);
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
