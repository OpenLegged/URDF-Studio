/**
 * Schedule a callback after the next two animation frames, so reads observe
 * post-paint layout. Returns a cancel function. Falls back to setTimeout(0)
 * when `requestAnimationFrame` is unavailable (SSR / non-browser env).
 *
 * Boundary: shared util. No imports.
 */
export function afterNextPaint(callback: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
    const timeoutId = setTimeout(callback, 0);
    return () => clearTimeout(timeoutId);
  }

  let cancelled = false;
  let frameA = 0;
  let frameB = 0;

  frameA = window.requestAnimationFrame(() => {
    frameB = window.requestAnimationFrame(() => {
      if (!cancelled) {
        callback();
      }
    });
  });

  return () => {
    cancelled = true;
    window.cancelAnimationFrame(frameA);
    window.cancelAnimationFrame(frameB);
  };
}
