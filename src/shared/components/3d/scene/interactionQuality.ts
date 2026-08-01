import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export const INTERACTION_RECOVERY_DELAY_MS = 180;
export const RESTING_DPR_CAP = 1.75;
export const MIN_RENDER_DPR = 1.5;
export const ADAPTIVE_INTERACTION_MIN_DPR = 1;
export const ADAPTIVE_INTERACTION_DPR_STEP = 0.25;
export const ADAPTIVE_INTERACTION_DEFAULT_FRAME_BUDGET_MS = 1000 / 60;
export const ADAPTIVE_INTERACTION_SLOW_FRAME_BUDGET_MULTIPLIER = 60 / 45;
export const ADAPTIVE_INTERACTION_FAST_FRAME_BUDGET_MULTIPLIER = 60 / 57;
export const ADAPTIVE_INTERACTION_SLOW_FRAME_COUNT = 3;
export const ADAPTIVE_INTERACTION_FAST_FRAME_COUNT = 45;
export const ADAPTIVE_INTERACTION_CALIBRATION_FRAME_COUNT = 24;

const WorkspaceCanvasInteractionStateContext = React.createContext(false);

interface ResolveCanvasDprOptions {
  devicePixelRatio: number;
  isInteracting: boolean;
  restingCap?: number;
  interactionCap?: number;
  minRenderDpr?: number;
}

interface AdaptiveInteractionQualityOptions {
  recoveryDelayMs?: number;
  restingCap?: number;
  minRenderDpr?: number;
}

export interface AdaptiveInteractionDprState {
  readonly dpr: number;
  readonly slowFrameCount: number;
  readonly fastFrameCount: number;
}

interface AdaptiveInteractionDprSampleOptions {
  readonly state: AdaptiveInteractionDprState;
  readonly frameTimeMs: number;
  readonly targetDpr: number;
  readonly minimumDpr?: number;
  readonly frameBudgetMs?: number;
}

function resolvePositiveDpr(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && Number(value) > 0 ? Number(value) : fallback;
}

function readDevicePixelRatio(): number {
  return typeof window === 'undefined' ? 1 : resolvePositiveDpr(window.devicePixelRatio, 1);
}

export function resolveNativeInteractionDpr(
  devicePixelRatio: number,
  restingCap = RESTING_DPR_CAP,
): number {
  const safeDevicePixelRatio = resolvePositiveDpr(devicePixelRatio, 1);
  const safeRestingCap = resolvePositiveDpr(restingCap, RESTING_DPR_CAP);
  return Math.min(safeDevicePixelRatio, safeRestingCap);
}

export function resolveAdaptiveInteractionFrameBudget(frameIntervalsMs: readonly number[]): number {
  const validIntervals = frameIntervalsMs
    .filter((interval) => Number.isFinite(interval) && interval > 0 && interval <= 100)
    .sort((left, right) => left - right);
  if (validIntervals.length === 0) {
    return ADAPTIVE_INTERACTION_DEFAULT_FRAME_BUDGET_MS;
  }

  // The fastest quartile filters startup work and occasional main-thread stalls.
  // Capping the target at 60 FPS avoids treating a stable 60 FPS viewport as slow
  // on 120/144 Hz displays.
  const representativeInterval = validIntervals[Math.floor((validIntervals.length - 1) / 4)]!;
  return Math.max(ADAPTIVE_INTERACTION_DEFAULT_FRAME_BUDGET_MS, representativeInterval);
}

export function sampleAdaptiveInteractionDpr({
  state,
  frameTimeMs,
  targetDpr,
  minimumDpr = ADAPTIVE_INTERACTION_MIN_DPR,
  frameBudgetMs = ADAPTIVE_INTERACTION_DEFAULT_FRAME_BUDGET_MS,
}: AdaptiveInteractionDprSampleOptions): AdaptiveInteractionDprState {
  const safeTargetDpr = resolvePositiveDpr(targetDpr, 1);
  const safeMinimumDpr = Math.min(
    resolvePositiveDpr(minimumDpr, ADAPTIVE_INTERACTION_MIN_DPR),
    safeTargetDpr,
  );
  const safeFrameBudgetMs = resolvePositiveDpr(
    frameBudgetMs,
    ADAPTIVE_INTERACTION_DEFAULT_FRAME_BUDGET_MS,
  );
  const safeCurrentDpr = Math.min(
    Math.max(resolvePositiveDpr(state.dpr, safeTargetDpr), safeMinimumDpr),
    safeTargetDpr,
  );

  if (!Number.isFinite(frameTimeMs) || frameTimeMs <= 0) {
    return { dpr: safeCurrentDpr, slowFrameCount: 0, fastFrameCount: 0 };
  }

  if (frameTimeMs >= safeFrameBudgetMs * ADAPTIVE_INTERACTION_SLOW_FRAME_BUDGET_MULTIPLIER) {
    const slowFrameCount = state.slowFrameCount + 1;
    if (
      slowFrameCount >= ADAPTIVE_INTERACTION_SLOW_FRAME_COUNT &&
      safeCurrentDpr > safeMinimumDpr
    ) {
      return {
        dpr: Math.max(safeMinimumDpr, safeCurrentDpr - ADAPTIVE_INTERACTION_DPR_STEP),
        slowFrameCount: 0,
        fastFrameCount: 0,
      };
    }
    return { dpr: safeCurrentDpr, slowFrameCount, fastFrameCount: 0 };
  }

  if (frameTimeMs <= safeFrameBudgetMs * ADAPTIVE_INTERACTION_FAST_FRAME_BUDGET_MULTIPLIER) {
    const fastFrameCount = state.fastFrameCount + 1;
    if (fastFrameCount >= ADAPTIVE_INTERACTION_FAST_FRAME_COUNT && safeCurrentDpr < safeTargetDpr) {
      return {
        dpr: Math.min(safeTargetDpr, safeCurrentDpr + ADAPTIVE_INTERACTION_DPR_STEP),
        slowFrameCount: 0,
        fastFrameCount: 0,
      };
    }
    return { dpr: safeCurrentDpr, slowFrameCount: 0, fastFrameCount };
  }

  return { dpr: safeCurrentDpr, slowFrameCount: 0, fastFrameCount: 0 };
}

export function resolveCanvasDpr({
  devicePixelRatio,
  isInteracting,
  restingCap = RESTING_DPR_CAP,
  interactionCap,
  minRenderDpr = MIN_RENDER_DPR,
}: ResolveCanvasDprOptions) {
  const safeDevicePixelRatio = resolvePositiveDpr(devicePixelRatio, 1);
  const safeRestingCap = resolvePositiveDpr(restingCap, RESTING_DPR_CAP);
  const safeInteractionCap = resolvePositiveDpr(
    interactionCap,
    resolveNativeInteractionDpr(safeDevicePixelRatio, safeRestingCap),
  );
  const safeMinRenderDpr = resolvePositiveDpr(minRenderDpr, 1);
  const activeCap = isInteracting ? Math.min(safeRestingCap, safeInteractionCap) : safeRestingCap;
  return Math.min(Math.max(safeDevicePixelRatio, safeMinRenderDpr), activeCap);
}

export function useAdaptiveInteractionQuality({
  recoveryDelayMs = INTERACTION_RECOVERY_DELAY_MS,
  restingCap = RESTING_DPR_CAP,
  minRenderDpr = MIN_RENDER_DPR,
}: AdaptiveInteractionQualityOptions = {}) {
  const [devicePixelRatio, setDevicePixelRatio] = useState(readDevicePixelRatio);
  const [isInteracting, setIsInteracting] = useState(false);
  const nativeInteractionDpr = useMemo(
    () => resolveNativeInteractionDpr(devicePixelRatio, restingCap),
    [devicePixelRatio, restingCap],
  );
  const [adaptiveInteractionDpr, setAdaptiveInteractionDpr] = useState(nativeInteractionDpr);
  const adaptiveDprStateRef = useRef<AdaptiveInteractionDprState>({
    dpr: nativeInteractionDpr,
    slowFrameCount: 0,
    fastFrameCount: 0,
  });
  const [frameBudgetMs, setFrameBudgetMs] = useState<number | null>(null);
  const [displayCalibrationEpoch, setDisplayCalibrationEpoch] = useState(0);
  const interactionFrameCountRef = useRef(0);
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
    interactionFrameCountRef.current = 0;
    setIsInteracting(false);
  }, [clearInteractionTimeout]);

  const beginInteraction = useCallback(() => {
    const recoveryPending = interactionTimeoutRef.current !== null;
    clearInteractionTimeout();
    if (interactionActiveRef.current && !recoveryPending) {
      return;
    }

    interactionActiveRef.current = true;
    interactionFrameCountRef.current = 0;
    const nextState = {
      dpr: nativeInteractionDpr,
      slowFrameCount: 0,
      fastFrameCount: 0,
    };
    adaptiveDprStateRef.current = nextState;
    setAdaptiveInteractionDpr(nativeInteractionDpr);
    setIsInteracting(true);
  }, [clearInteractionTimeout, nativeInteractionDpr]);

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

  useEffect(() => {
    setFrameBudgetMs(null);
    let frameId: number | null = null;
    let previousFrameTime: number | null = null;
    const frameIntervals: number[] = [];
    const sampleDisplayRefresh = (frameTime: number) => {
      if (previousFrameTime !== null) {
        frameIntervals.push(frameTime - previousFrameTime);
      }

      if (frameIntervals.length >= ADAPTIVE_INTERACTION_CALIBRATION_FRAME_COUNT) {
        setFrameBudgetMs(resolveAdaptiveInteractionFrameBudget(frameIntervals));
        return;
      }

      previousFrameTime = frameTime;
      frameId = window.requestAnimationFrame(sampleDisplayRefresh);
    };

    frameId = window.requestAnimationFrame(sampleDisplayRefresh);
    return () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }
    };
  }, [displayCalibrationEpoch]);

  useEffect(() => {
    const refreshDisplayMetrics = () => {
      setDevicePixelRatio((current) => {
        const next = readDevicePixelRatio();
        return next === current ? current : next;
      });
      setDisplayCalibrationEpoch((current) => current + 1);
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

  useEffect(() => {
    const nextState = {
      dpr: nativeInteractionDpr,
      slowFrameCount: 0,
      fastFrameCount: 0,
    };
    adaptiveDprStateRef.current = nextState;
    setAdaptiveInteractionDpr(nativeInteractionDpr);
  }, [nativeInteractionDpr]);

  const reportInteractionFrame = useCallback(
    (frameTimeMs: number) => {
      if (!interactionActiveRef.current || frameBudgetMs === null) {
        return;
      }
      if (interactionFrameCountRef.current === 0) {
        interactionFrameCountRef.current = 1;
        return;
      }

      const currentState = adaptiveDprStateRef.current;
      const nextState = sampleAdaptiveInteractionDpr({
        state: currentState,
        frameTimeMs,
        targetDpr: nativeInteractionDpr,
        frameBudgetMs,
      });
      adaptiveDprStateRef.current = nextState;
      if (nextState.dpr !== currentState.dpr) {
        setAdaptiveInteractionDpr(nextState.dpr);
      }
    },
    [frameBudgetMs, nativeInteractionDpr],
  );

  useEffect(() => {
    if (isInteracting) {
      return;
    }
    interactionFrameCountRef.current = 0;
  }, [isInteracting]);

  useEffect(
    () => () => {
      interactionActiveRef.current = false;
      clearInteractionTimeout();
    },
    [clearInteractionTimeout],
  );

  const dpr = useMemo(() => {
    return resolveCanvasDpr({
      devicePixelRatio,
      isInteracting,
      restingCap,
      interactionCap: adaptiveInteractionDpr,
      minRenderDpr,
    });
  }, [adaptiveInteractionDpr, devicePixelRatio, isInteracting, minRenderDpr, restingCap]);

  return {
    dpr,
    isInteracting,
    beginInteraction,
    endInteraction,
    pulseInteraction,
    reportInteractionFrame,
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
