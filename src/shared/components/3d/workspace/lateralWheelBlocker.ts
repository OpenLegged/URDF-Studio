/**
 * Block horizontal trackpad/wheel swipes from reaching the document.
 *
 * On macOS, Edge/Chrome turn a horizontal two-finger trackpad swipe into a
 * `wheel` event with dominant `deltaX`. The 3D workspace does not scroll, so
 * that wheel has no scroll target and overscrolls the document — which the
 * browser then turns into back/forward navigation, hijacking viewer
 * zoom/pan/rotate mid-gesture.
 *
 * `overscroll-behavior: none` on html/body is the spec-correct fix, but
 * Chromium (https://issues.chromium.org/issues/745137) does not honor it for
 * trackpad-driven navigation on macOS. So we also choke the source: call
 * `preventDefault()` on lateral wheel while it is still inside the viewer
 * container, before it can bubble into the document overscroll pipeline.
 *
 * Vertical wheel is left untouched — OrbitControls consumes `deltaY` for zoom
 * and must keep receiving it. Only a horizontal-dominant wheel is blocked.
 *
 * Limitation: this only intercepts the wheel path. A swipe that macOS/Chromium
 * recognises as a navigation gesture before a wheel event reaches content
 * cannot be blocked from page code; that requires the browser/OS setting
 * (edge://flags/#overscroll-history-navigation or System Settings → Trackpad
 * → Swipe between pages).
 */

const WHEEL_LISTENER_OPTIONS: AddEventListenerOptions = { passive: false };

/**
 * Whether a wheel event is horizontal-dominant and should be blocked from
 * bubbling into the document overscroll pipeline.
 *
 * Equal-magnitude wheels (|deltaX| == |deltaY|) pass through so an ambiguous
 * diagonal pinch never loses its vertical (zoom) component.
 */
export function shouldBlockLateralWheel(deltaX: number, deltaY: number): boolean {
  return Math.abs(deltaX) > Math.abs(deltaY);
}

/**
 * Attach a non-passive wheel listener to `target` that calls
 * `preventDefault()` on horizontal-dominant wheels. Returns a disposer that
 * removes the listener — callers MUST call it on unmount/teardown.
 */
export function attachLateralWheelBlocker(target: HTMLElement): () => void {
  const onWheel = (event: WheelEvent) => {
    if (shouldBlockLateralWheel(event.deltaX, event.deltaY)) {
      event.preventDefault();
    }
  };
  target.addEventListener('wheel', onWheel, WHEEL_LISTENER_OPTIONS);
  return () => {
    target.removeEventListener('wheel', onWheel);
  };
}
