/**
 * Panel resize hook — pointer-driven right/bottom/corner resize state machine
 * extracted from OptionsPanelContainer so it is reusable and independently
 * testable. Owns panelSize + pointer lifecycle; rendering stays in the caller.
 *
 * Boundary: shared hook. Imports React only.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export interface UsePanelResizeArgs {
  width: number | string;
  height?: number | string;
  minWidth?: number;
  maxWidth?: number;
  minHeight?: number;
  maxHeight?: number;
}

export interface UsePanelResizeReturn {
  panelSize: { width: number | string; height: number | string };
  handleResizeStart: (
    e: React.PointerEvent<HTMLElement>,
    direction: 'right' | 'bottom' | 'corner',
  ) => void;
}

export function usePanelResize({
  width,
  height,
  minWidth = 160,
  maxWidth = 600,
  minHeight = 150,
  maxHeight = 800,
}: UsePanelResizeArgs): UsePanelResizeReturn {
  const [panelSize, setPanelSize] = useState<{ width: number | string; height: number | string }>({
    width,
    height: height || 'auto',
  });

  const hasManualResizeRef = useRef(false);
  const startSize = useRef<{ width: number; height: number }>({ width: 0, height: 0 });
  const startPos = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const resizeDirection = useRef<'right' | 'bottom' | 'corner' | null>(null);
  const activePointerId = useRef<number | null>(null);
  const bodyCursorRef = useRef('');
  const bodyUserSelectRef = useRef('');

  const captureBodyInteractionStyles = useCallback(() => {
    bodyCursorRef.current = document.body.style.cursor;
    bodyUserSelectRef.current = document.body.style.userSelect;
  }, []);

  const restoreBodyInteractionStyles = useCallback(() => {
    document.body.style.cursor = bodyCursorRef.current;
    document.body.style.userSelect = bodyUserSelectRef.current;
  }, []);

  const handleResizeMove = useCallback(
    (e: PointerEvent) => {
      if (!resizeDirection.current) return;
      if (activePointerId.current !== null && e.pointerId !== activePointerId.current) return;

      e.preventDefault();

      const deltaX = e.clientX - startPos.current.x;
      const deltaY = e.clientY - startPos.current.y;

      let newWidth = startSize.current.width;
      let newHeight = startSize.current.height;

      if (resizeDirection.current === 'right' || resizeDirection.current === 'corner') {
        newWidth += deltaX;
        if (newWidth < minWidth) newWidth = minWidth;
        if (newWidth > maxWidth) newWidth = maxWidth;
      }

      if (resizeDirection.current === 'bottom' || resizeDirection.current === 'corner') {
        newHeight += deltaY;
        if (newHeight < minHeight) newHeight = minHeight;
        if (newHeight > maxHeight) newHeight = maxHeight;
      }

      hasManualResizeRef.current = true;
      setPanelSize((prev) => ({
        width:
          resizeDirection.current === 'right' || resizeDirection.current === 'corner'
            ? newWidth
            : prev.width,
        height:
          resizeDirection.current === 'bottom' || resizeDirection.current === 'corner'
            ? newHeight
            : prev.height,
      }));
    },
    [maxHeight, maxWidth, minHeight, minWidth],
  );

  const handleResizeEnd = useCallback(
    (e?: PointerEvent | Event) => {
      if (
        e &&
        'pointerId' in e &&
        activePointerId.current !== null &&
        e.pointerId !== activePointerId.current
      ) {
        return;
      }

      document.removeEventListener('pointermove', handleResizeMove);
      document.removeEventListener('pointerup', handleResizeEnd);
      document.removeEventListener('pointercancel', handleResizeEnd);
      window.removeEventListener('blur', handleResizeEnd);

      restoreBodyInteractionStyles();
      resizeDirection.current = null;
      activePointerId.current = null;
    },
    [handleResizeMove, restoreBodyInteractionStyles],
  );

  const handleResizeStart = useCallback(
    (e: React.PointerEvent<HTMLElement>, direction: 'right' | 'bottom' | 'corner') => {
      e.preventDefault();
      e.stopPropagation();

      const currentElement = e.currentTarget.parentElement;
      if (!currentElement) return;

      startSize.current = {
        width: currentElement.offsetWidth,
        height: currentElement.offsetHeight,
      };
      startPos.current = { x: e.clientX, y: e.clientY };
      resizeDirection.current = direction;
      activePointerId.current = e.pointerId;

      if (e.currentTarget.setPointerCapture) {
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          // Ignore if pointer capture is not available for current environment.
        }
      }

      document.addEventListener('pointermove', handleResizeMove);
      document.addEventListener('pointerup', handleResizeEnd);
      document.addEventListener('pointercancel', handleResizeEnd);
      window.addEventListener('blur', handleResizeEnd);

      const cursor =
        direction === 'right' ? 'ew-resize' : direction === 'bottom' ? 'ns-resize' : 'nwse-resize';
      captureBodyInteractionStyles();
      document.body.style.cursor = cursor;
      document.body.style.userSelect = 'none';
    },
    [captureBodyInteractionStyles, handleResizeEnd, handleResizeMove],
  );

  useEffect(() => {
    return () => {
      handleResizeEnd();
    };
  }, [handleResizeEnd]);

  useEffect(() => {
    if (hasManualResizeRef.current) {
      return;
    }

    setPanelSize((previous) => {
      const nextSize = {
        width,
        height: height || 'auto',
      };

      return previous.width === nextSize.width && previous.height === nextSize.height
        ? previous
        : nextSize;
    });
  }, [height, width]);

  return { panelSize, handleResizeStart };
}