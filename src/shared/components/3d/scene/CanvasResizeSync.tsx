import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { useThree } from '@react-three/fiber';

const CANVAS_LAYOUT_TRANSITION_PROPERTIES = new Set([
  'all',
  'flex',
  'flex-basis',
  'max-width',
  'min-width',
  'width',
]);

export function isCanvasLayoutTransitionProperty(propertyName: string) {
  return CANVAS_LAYOUT_TRANSITION_PROPERTIES.has(propertyName.trim().toLowerCase());
}

export function shouldStartCanvasResizeFrameloop(isResizeFrameloopActive: boolean) {
  return !isResizeFrameloopActive;
}

export const CanvasResizeSync = ({
  transitionMs = 260,
  targetFrameloop = 'demand',
}: {
  transitionMs?: number;
  targetFrameloop?: 'always' | 'demand';
}) => {
  const { gl, size, invalidate, setFrameloop } = useThree();
  const loopFrameRef = useRef<number | null>(null);
  const resizeWatchUntilRef = useRef(0);
  const restoreFrameLoopTimerRef = useRef<number | null>(null);
  const resizeFrameloopActiveRef = useRef(false);
  const targetFrameloopRef = useRef(targetFrameloop);
  targetFrameloopRef.current = targetFrameloop;

  const beginSmoothResize = useCallback(() => {
    if (shouldStartCanvasResizeFrameloop(resizeFrameloopActiveRef.current)) {
      resizeFrameloopActiveRef.current = true;
      setFrameloop('always');
    }

    if (restoreFrameLoopTimerRef.current !== null) {
      clearTimeout(restoreFrameLoopTimerRef.current);
    }
    restoreFrameLoopTimerRef.current = window.setTimeout(() => {
      resizeFrameloopActiveRef.current = false;
      setFrameloop(targetFrameloopRef.current);
      invalidate();
      restoreFrameLoopTimerRef.current = null;
    }, transitionMs + 120);
    invalidate();
  }, [invalidate, setFrameloop, transitionMs]);

  const ensureResizeWatch = useCallback(
    (durationMs = transitionMs + 120) => {
      const now = performance.now();
      resizeWatchUntilRef.current = Math.max(resizeWatchUntilRef.current, now + durationMs);
      if (loopFrameRef.current !== null) return;

      const loop = () => {
        loopFrameRef.current = null;
        invalidate();
        if (performance.now() < resizeWatchUntilRef.current) {
          loopFrameRef.current = requestAnimationFrame(loop);
        }
      };

      loopFrameRef.current = requestAnimationFrame(loop);
    },
    [invalidate, transitionMs],
  );

  useEffect(() => {
    invalidate();
  }, [invalidate, size.height, size.width]);

  useEffect(() => {
    if (!resizeFrameloopActiveRef.current) {
      setFrameloop(targetFrameloop);
      invalidate();
    }
  }, [invalidate, setFrameloop, targetFrameloop]);

  useLayoutEffect(() => {
    const parent = gl.domElement.parentElement;
    const handleResizeActivity = () => {
      beginSmoothResize();
      ensureResizeWatch();
    };
    const handleTransitionActivity = (event: TransitionEvent) => {
      if (isCanvasLayoutTransitionProperty(event.propertyName)) {
        handleResizeActivity();
      }
    };

    let resizeObserver: ResizeObserver | null = null;
    if (parent && typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(handleResizeActivity);
      resizeObserver.observe(parent);
    }

    window.addEventListener('resize', handleResizeActivity);
    document.addEventListener('transitionrun', handleTransitionActivity, true);
    document.addEventListener('transitionstart', handleTransitionActivity, true);

    return () => {
      window.removeEventListener('resize', handleResizeActivity);
      document.removeEventListener('transitionrun', handleTransitionActivity, true);
      document.removeEventListener('transitionstart', handleTransitionActivity, true);
      resizeObserver?.disconnect();
      if (loopFrameRef.current !== null) {
        cancelAnimationFrame(loopFrameRef.current);
        loopFrameRef.current = null;
      }
      if (restoreFrameLoopTimerRef.current !== null) {
        clearTimeout(restoreFrameLoopTimerRef.current);
        restoreFrameLoopTimerRef.current = null;
      }
      resizeFrameloopActiveRef.current = false;
      setFrameloop(targetFrameloopRef.current);
    };
  }, [beginSmoothResize, ensureResizeWatch, gl, setFrameloop]);

  return null;
};
