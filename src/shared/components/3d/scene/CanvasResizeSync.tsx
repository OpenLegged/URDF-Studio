import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { useThree } from '@react-three/fiber';

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
    // The observer also runs while a sidebar animates the canvas container.
    // Document-wide transition events include unrelated overlays and progress
    // bars, which must not start a continuous 3D loop when this size is unchanged.
    let resizeObserver: ResizeObserver | null = null;
    if (parent && typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(handleResizeActivity);
      resizeObserver.observe(parent);
    }

    window.addEventListener('resize', handleResizeActivity);

    return () => {
      window.removeEventListener('resize', handleResizeActivity);
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
