import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export const INTERACTION_RECOVERY_DELAY_MS = 180;
export const RESTING_DPR_CAP = 1.75;
export const MIN_RENDER_DPR = 1.5;

const WorkspaceCanvasInteractionStateContext = React.createContext(false);

interface ResolveCanvasDprOptions {
  devicePixelRatio: number;
  restingCap?: number;
  minRenderDpr?: number;
}

interface ViewportInteractionQualityOptions {
  recoveryDelayMs?: number;
  restingCap?: number;
  minRenderDpr?: number;
}

function resolvePositiveDpr(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && Number(value) > 0 ? Number(value) : fallback;
}

function readDevicePixelRatio(): number {
  return typeof window === 'undefined' ? 1 : resolvePositiveDpr(window.devicePixelRatio, 1);
}

/**
 * Resolves the one render resolution the viewport uses, at rest and while a
 * link, joint, or the camera is being dragged alike.
 *
 * Professional 3D editors never trade framebuffer resolution for frame time
 * mid-gesture: a viewport that goes soft the moment the user grabs something
 * reads as broken, and every resolution change also reallocates the drawing
 * buffer and every render target, which is a stutter of its own. Interaction
 * still buys frame time here, but by skipping *work* (shadow map refresh,
 * ambient occlusion, outline overlays) rather than by dropping pixels.
 *
 * The render-quality profile supplies both bounds: `minRenderDpr` supersamples
 * low-DPR displays to keep edges clean, `restingCap` keeps high-DPR displays
 * from rendering more pixels than the profile budgets for. The cap wins when a
 * profile sets a floor above it.
 */
export function resolveCanvasDpr({
  devicePixelRatio,
  restingCap = RESTING_DPR_CAP,
  minRenderDpr = MIN_RENDER_DPR,
}: ResolveCanvasDprOptions) {
  const safeDevicePixelRatio = resolvePositiveDpr(devicePixelRatio, 1);
  const safeRestingCap = resolvePositiveDpr(restingCap, RESTING_DPR_CAP);
  const safeMinRenderDpr = resolvePositiveDpr(minRenderDpr, 1);
  return Math.min(Math.max(safeDevicePixelRatio, safeMinRenderDpr), safeRestingCap);
}

/**
 * Owns the viewport's interaction state: a stable render DPR plus the
 * begin/end gesture signals the canvas uses to switch its frameloop and that
 * scene consumers use to skip optional per-frame work while dragging.
 */
export function useViewportInteractionQuality({
  recoveryDelayMs = INTERACTION_RECOVERY_DELAY_MS,
  restingCap = RESTING_DPR_CAP,
  minRenderDpr = MIN_RENDER_DPR,
}: ViewportInteractionQualityOptions = {}) {
  const [devicePixelRatio, setDevicePixelRatio] = useState(readDevicePixelRatio);
  const [isInteracting, setIsInteracting] = useState(false);
  const interactionActiveRef = useRef(false);
  const interactionTimeoutRef = useRef<number | null>(null);

  const clearInteractionTimeout = useCallback(() => {
    if (typeof window === 'undefined' || interactionTimeoutRef.current === null) {
      return;
    }

    window.clearTimeout(interactionTimeoutRef.current);
    interactionTimeoutRef.current = null;
  }, []);

  const finishInteraction = useCallback(() => {
    clearInteractionTimeout();
    interactionActiveRef.current = false;
    setIsInteracting(false);
  }, [clearInteractionTimeout]);

  const beginInteraction = useCallback(() => {
    const recoveryPending = interactionTimeoutRef.current !== null;
    clearInteractionTimeout();
    if (interactionActiveRef.current && !recoveryPending) {
      return;
    }

    interactionActiveRef.current = true;
    setIsInteracting(true);
  }, [clearInteractionTimeout]);

  const endInteraction = useCallback(
    (delay = recoveryDelayMs) => {
      if (typeof window === 'undefined') {
        finishInteraction();
        return;
      }

      clearInteractionTimeout();
      interactionTimeoutRef.current = window.setTimeout(() => {
        interactionTimeoutRef.current = null;
        finishInteraction();
      }, delay);
    },
    [clearInteractionTimeout, finishInteraction, recoveryDelayMs],
  );

  const pulseInteraction = useCallback(
    (delay = recoveryDelayMs) => {
      beginInteraction();
      endInteraction(delay);
    },
    [beginInteraction, endInteraction, recoveryDelayMs],
  );

  useEffect(() => {
    const handlePointerEnd = () => endInteraction();
    const handlePointerCancel = () => finishInteraction();

    window.addEventListener('pointerup', handlePointerEnd);
    window.addEventListener('mouseup', handlePointerEnd);
    window.addEventListener('pointercancel', handlePointerCancel);
    return () => {
      window.removeEventListener('pointerup', handlePointerEnd);
      window.removeEventListener('mouseup', handlePointerEnd);
      window.removeEventListener('pointercancel', handlePointerCancel);
    };
  }, [endInteraction, finishInteraction]);

  // Dragging a window between monitors changes devicePixelRatio without a
  // remount, so the render resolution has to follow the active display.
  useEffect(() => {
    const refreshDisplayMetrics = () => {
      setDevicePixelRatio((current) => {
        const next = readDevicePixelRatio();
        return next === current ? current : next;
      });
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') {
        finishInteraction();
        return;
      }
      refreshDisplayMetrics();
    };

    window.addEventListener('resize', refreshDisplayMetrics);
    window.addEventListener('blur', finishInteraction);
    window.addEventListener('focus', refreshDisplayMetrics);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.removeEventListener('resize', refreshDisplayMetrics);
      window.removeEventListener('blur', finishInteraction);
      window.removeEventListener('focus', refreshDisplayMetrics);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [finishInteraction]);

  useEffect(
    () => () => {
      interactionActiveRef.current = false;
      clearInteractionTimeout();
    },
    [clearInteractionTimeout],
  );

  const dpr = useMemo(
    () => resolveCanvasDpr({ devicePixelRatio, restingCap, minRenderDpr }),
    [devicePixelRatio, minRenderDpr, restingCap],
  );

  return {
    dpr,
    isInteracting,
    beginInteraction,
    endInteraction,
    pulseInteraction,
  };
}

export function WorkspaceCanvasInteractionStateProvider({
  children,
  isInteracting,
}: {
  children: React.ReactNode;
  isInteracting: boolean;
}) {
  return React.createElement(
    WorkspaceCanvasInteractionStateContext.Provider,
    { value: isInteracting },
    children,
  );
}

export function useWorkspaceCanvasInteractionState(): boolean {
  return React.useContext(WorkspaceCanvasInteractionStateContext);
}
