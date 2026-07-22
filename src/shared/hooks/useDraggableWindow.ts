import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, Dispatch, MouseEvent, RefObject, SetStateAction } from 'react';

export type ResizeDirection = 'right' | 'bottom' | 'corner' | 'left' | 'e' | 's' | 'se' | 'w';

/**
 * Height of the fixed application top bar (`h-10` = 40px). A maximized
 * DraggableWindow insets its top edge by this amount so the header stays
 * visible and accessible, mirroring how OS-level maximized windows leave the
 * desktop menu bar exposed.
 */
export const APP_HEADER_HEIGHT_PX = 40;

interface Position {
  x: number;
  y: number;
}

interface WindowSize {
  width: number;
  height: number;
}

interface ViewportRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface DragBoundsOptions {
  allowNegativeX?: boolean;
  minVisibleWidth?: number;
  topMargin?: number;
  bottomMargin?: number;
}

export interface DraggableWindowOptions {
  isOpen?: boolean;
  defaultPosition?: Position;
  defaultSize: WindowSize;
  minSize?: WindowSize;
  viewportMinSize?: WindowSize;
  enableMinimize?: boolean;
  enableMaximize?: boolean;
  centerOnMount?: boolean;
  clampResizeToViewport?: boolean;
  dragBounds?: DragBoundsOptions;
}

export interface DraggableWindowReturn {
  isMaximized: boolean;
  isMinimized: boolean;
  position: Position;
  size: WindowSize;
  setSize: Dispatch<SetStateAction<WindowSize>>;
  isDragging: boolean;
  isResizing: boolean;
  containerRef: RefObject<HTMLDivElement | null>;
  handleDragStart: (e: MouseEvent) => void;
  handleResizeStart: (e: MouseEvent, direction: ResizeDirection) => void;
  toggleMaximize: () => void;
  toggleMinimize: () => void;
  windowStyle: CSSProperties;
}

const VIEWPORT_WINDOW_MARGIN = 24;
const MIN_VIEWPORT_WINDOW_SIZE: WindowSize = {
  width: 360,
  height: 320,
};
const DRAG_TRANSLATE_X_VAR = '--draggable-window-translate-x';
const DRAG_TRANSLATE_Y_VAR = '--draggable-window-translate-y';

const clamp = (value: number, min: number, max: number) => {
  if (max < min) return min;
  return Math.max(min, Math.min(max, value));
};

const getViewportRect = (): ViewportRect => {
  if (typeof window === 'undefined') {
    return {
      left: 0,
      top: 0,
      width: Number.POSITIVE_INFINITY,
      height: Number.POSITIVE_INFINITY,
    };
  }

  const visualViewport = window.visualViewport;
  return {
    left: visualViewport?.offsetLeft ?? 0,
    top: visualViewport?.offsetTop ?? 0,
    width: visualViewport?.width ?? window.innerWidth,
    height: visualViewport?.height ?? window.innerHeight,
  };
};

const normalizeResizeDirection = (
  direction: ResizeDirection,
): 'right' | 'bottom' | 'corner' | 'left' => {
  if (direction === 'e') return 'right';
  if (direction === 's') return 'bottom';
  if (direction === 'w' || direction === 'left') return 'left';
  return 'corner';
};

const getViewportWindowSizeLimit = (
  shouldClampToViewport: boolean,
  viewportMinSize: WindowSize = MIN_VIEWPORT_WINDOW_SIZE,
): WindowSize => {
  if (typeof window === 'undefined' || !shouldClampToViewport) {
    return {
      width: Number.POSITIVE_INFINITY,
      height: Number.POSITIVE_INFINITY,
    };
  }

  const viewport = getViewportRect();
  const viewportWidth = Math.max(1, viewport.width);
  const viewportHeight = Math.max(1, viewport.height);

  return {
    // Keep the configured compact-layout floor while there is room for it. On
    // exceptionally small or zoomed viewports, the visible viewport itself is
    // the hard limit so the title bar and window controls cannot be stranded
    // off-screen.
    width: Math.min(
      viewportWidth,
      Math.max(viewportMinSize.width, viewportWidth - VIEWPORT_WINDOW_MARGIN),
    ),
    height: Math.min(
      viewportHeight,
      Math.max(viewportMinSize.height, viewportHeight - VIEWPORT_WINDOW_MARGIN),
    ),
  };
};

const constrainWindowSizeToViewport = (
  nextSize: WindowSize,
  shouldClampToViewport: boolean,
  viewportMinSize?: WindowSize,
): WindowSize => {
  const viewportLimit = getViewportWindowSizeLimit(shouldClampToViewport, viewportMinSize);
  return {
    width: Math.min(nextSize.width, viewportLimit.width),
    height: Math.min(nextSize.height, viewportLimit.height),
  };
};

const getEffectiveMinWindowSize = (
  nextMinSize: WindowSize,
  shouldClampToViewport: boolean,
  viewportMinSize?: WindowSize,
): WindowSize => {
  const viewportLimit = getViewportWindowSizeLimit(shouldClampToViewport, viewportMinSize);
  return {
    width: Math.min(nextMinSize.width, viewportLimit.width),
    height: Math.min(nextMinSize.height, viewportLimit.height),
  };
};

export const useDraggableWindow = ({
  isOpen,
  defaultPosition = { x: 100, y: 100 },
  defaultSize,
  minSize = { width: 600, height: 400 },
  viewportMinSize = MIN_VIEWPORT_WINDOW_SIZE,
  enableMinimize = true,
  enableMaximize = true,
  centerOnMount = true,
  clampResizeToViewport = true,
  dragBounds,
}: DraggableWindowOptions): DraggableWindowReturn => {
  const minWidth = minSize.width;
  const minHeight = minSize.height;
  const viewportMinWidth = viewportMinSize.width;
  const viewportMinHeight = viewportMinSize.height;
  const [isMaximized, setIsMaximized] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [position, setPosition] = useState<Position>(defaultPosition);
  const [size, setSizeState] = useState<WindowSize>(() =>
    constrainWindowSizeToViewport(defaultSize, clampResizeToViewport, viewportMinSize),
  );
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [resizeDirection, setResizeDirection] = useState<
    'right' | 'bottom' | 'corner' | 'left' | null
  >(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef<Position>({ x: 0, y: 0 });
  const resizeStartRef = useRef({
    x: 0,
    y: 0,
    width: defaultSize.width,
    height: defaultSize.height,
    posX: 0,
  });
  const positionRef = useRef(position);
  const sizeRef = useRef(size);
  const dragTransformRef = useRef<Position>({ x: 0, y: 0 });
  const dragFrameRef = useRef<number | null>(null);
  const centeredOnceRef = useRef(false);
  const preMaximizeRef = useRef<{ position: Position; size: WindowSize } | null>(null);
  const bodyUserSelectRef = useRef('');
  const bodyCursorRef = useRef('');

  const setSize = useCallback<Dispatch<SetStateAction<WindowSize>>>(
    (nextSizeAction) => {
      setSizeState((previousSize) => {
        const requestedSize =
          typeof nextSizeAction === 'function'
            ? nextSizeAction(previousSize)
            : nextSizeAction;
        const nextSize = constrainWindowSizeToViewport(
          requestedSize,
          clampResizeToViewport,
          { width: viewportMinWidth, height: viewportMinHeight },
        );

        sizeRef.current = nextSize;
        return nextSize.width === previousSize.width && nextSize.height === previousSize.height
          ? previousSize
          : nextSize;
      });
    },
    [clampResizeToViewport, viewportMinHeight, viewportMinWidth],
  );

  useEffect(() => {
    positionRef.current = position;
  }, [position]);

  useEffect(() => {
    sizeRef.current = size;
  }, [size]);

  const flushDragTransform = useCallback(() => {
    dragFrameRef.current = null;

    if (!containerRef.current) return;

    containerRef.current.style.setProperty(DRAG_TRANSLATE_X_VAR, `${dragTransformRef.current.x}px`);
    containerRef.current.style.setProperty(DRAG_TRANSLATE_Y_VAR, `${dragTransformRef.current.y}px`);
  }, []);

  const scheduleDragTransform = useCallback(() => {
    if (dragFrameRef.current !== null) return;
    dragFrameRef.current = window.requestAnimationFrame(flushDragTransform);
  }, [flushDragTransform]);

  const resetDragTransform = useCallback(() => {
    if (dragFrameRef.current !== null) {
      window.cancelAnimationFrame(dragFrameRef.current);
      dragFrameRef.current = null;
    }

    if (!containerRef.current) return;

    containerRef.current.style.setProperty(DRAG_TRANSLATE_X_VAR, '0px');
    containerRef.current.style.setProperty(DRAG_TRANSLATE_Y_VAR, '0px');
  }, []);

  const captureBodyInteractionStyles = useCallback(() => {
    bodyUserSelectRef.current = document.body.style.userSelect;
    bodyCursorRef.current = document.body.style.cursor;
  }, []);

  const restoreBodyInteractionStyles = useCallback(() => {
    document.body.style.userSelect = bodyUserSelectRef.current;
    document.body.style.cursor = bodyCursorRef.current;
  }, []);

  const getDragLimits = useCallback(
    (currentSize: WindowSize) => {
      const viewport = getViewportRect();
      const viewportRight = viewport.left + viewport.width;
      const viewportBottom = viewport.top + viewport.height;
      const allowNegativeX = dragBounds?.allowNegativeX ?? false;
      const minVisibleWidth = dragBounds?.minVisibleWidth ?? 100;
      const fullyVisibleMaxX = viewportRight - currentSize.width;
      const fitsViewportWidth = fullyVisibleMaxX >= viewport.left;
      const minX =
        clampResizeToViewport && fitsViewportWidth
          ? viewport.left
          : allowNegativeX
            ? viewport.left - currentSize.width + minVisibleWidth
            : viewport.left;
      const maxX =
        clampResizeToViewport && fitsViewportWidth
          ? fullyVisibleMaxX
          : allowNegativeX
            ? viewportRight - minVisibleWidth
            : fullyVisibleMaxX;

      const preferredMinY = viewport.top + (dragBounds?.topMargin ?? 0);
      const fullyVisibleMaxY = viewportBottom - currentSize.height;
      const fitsViewportHeight = fullyVisibleMaxY >= viewport.top;
      const canHonorTopMargin = fullyVisibleMaxY >= preferredMinY;
      const minY =
        clampResizeToViewport && fitsViewportHeight
          ? canHonorTopMargin
            ? preferredMinY
            : viewport.top
          : preferredMinY;
      const maxY =
        clampResizeToViewport && fitsViewportHeight
          ? fullyVisibleMaxY
          : viewportBottom - (dragBounds?.bottomMargin ?? 48);
      return { minX, maxX, minY, maxY };
    },
    [
      clampResizeToViewport,
      dragBounds?.allowNegativeX,
      dragBounds?.bottomMargin,
      dragBounds?.minVisibleWidth,
      dragBounds?.topMargin,
    ],
  );

  const centerWindow = useCallback(() => {
    const currentSize = sizeRef.current;
    const viewport = getViewportRect();
    const centerX = viewport.left + (viewport.width - currentSize.width) / 2;
    const centerY = viewport.top + (viewport.height - currentSize.height) / 2;
    const limits = getDragLimits(currentSize);
    const nextPosition = {
      x: clamp(centerX, limits.minX, limits.maxX),
      y: clamp(centerY, limits.minY, limits.maxY),
    };
    positionRef.current = nextPosition;
    setPosition(nextPosition);
  }, [getDragLimits]);

  useEffect(() => {
    if (!centerOnMount) return;

    if (typeof isOpen === 'boolean') {
      if (isOpen) {
        centerWindow();
      }
      return;
    }

    if (!centeredOnceRef.current) {
      centeredOnceRef.current = true;
      centerWindow();
    }
  }, [centerOnMount, centerWindow, isOpen]);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: globalThis.MouseEvent) => {
      dragTransformRef.current = {
        x: e.clientX - dragStartRef.current.x,
        y: e.clientY - dragStartRef.current.y,
      };
      scheduleDragTransform();
    };

    const handleMouseUp = () => {
      const transform = dragTransformRef.current;
      if (transform.x !== 0 || transform.y !== 0) {
        const limits = getDragLimits(sizeRef.current);
        const nextX = clamp(positionRef.current.x + transform.x, limits.minX, limits.maxX);
        const nextY = clamp(positionRef.current.y + transform.y, limits.minY, limits.maxY);
        positionRef.current = { x: nextX, y: nextY };
        setPosition(positionRef.current);
      }

      dragTransformRef.current = { x: 0, y: 0 };
      resetDragTransform();
      restoreBodyInteractionStyles();
      setIsDragging(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('blur', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('blur', handleMouseUp);
      restoreBodyInteractionStyles();
    };
  }, [
    getDragLimits,
    isDragging,
    resetDragTransform,
    restoreBodyInteractionStyles,
    scheduleDragTransform,
  ]);

  useEffect(() => {
    if (!isResizing || !resizeDirection) return;

    const handleMouseMove = (e: globalThis.MouseEvent) => {
      const deltaX = e.clientX - resizeStartRef.current.x;
      const deltaY = e.clientY - resizeStartRef.current.y;
      const effectiveMinSize = getEffectiveMinWindowSize(
        { width: minWidth, height: minHeight },
        clampResizeToViewport,
        { width: viewportMinWidth, height: viewportMinHeight },
      );

      if (resizeDirection === 'left') {
        const viewport = getViewportRect();
        const newWidth = clamp(
          resizeStartRef.current.width - deltaX,
          effectiveMinSize.width,
          resizeStartRef.current.width + resizeStartRef.current.posX - viewport.left,
        );
        const newX = resizeStartRef.current.posX + (resizeStartRef.current.width - newWidth);
        setSize((prev) => (prev.width === newWidth ? prev : { ...prev, width: newWidth }));
        setPosition((prev) => {
          if (prev.x === newX) return prev;
          const nextPosition = { ...prev, x: newX };
          positionRef.current = nextPosition;
          return nextPosition;
        });
        return;
      }

      const viewport = getViewportRect();
      const maxWidth = clampResizeToViewport
        ? viewport.left + viewport.width - positionRef.current.x
        : Number.POSITIVE_INFINITY;
      const maxHeight = clampResizeToViewport
        ? viewport.top + viewport.height - positionRef.current.y
        : Number.POSITIVE_INFINITY;

      const shouldResizeWidth = resizeDirection === 'right' || resizeDirection === 'corner';
      const shouldResizeHeight = resizeDirection === 'bottom' || resizeDirection === 'corner';

      setSize((prev) => {
        const nextWidth = shouldResizeWidth
          ? clamp(resizeStartRef.current.width + deltaX, effectiveMinSize.width, maxWidth)
          : prev.width;
        const nextHeight = shouldResizeHeight
          ? clamp(resizeStartRef.current.height + deltaY, effectiveMinSize.height, maxHeight)
          : prev.height;

        if (nextWidth === prev.width && nextHeight === prev.height) {
          return prev;
        }

        return { width: nextWidth, height: nextHeight };
      });
    };

    const handleMouseUp = () => {
      restoreBodyInteractionStyles();
      setIsResizing(false);
      setResizeDirection(null);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('blur', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('blur', handleMouseUp);
      restoreBodyInteractionStyles();
    };
  }, [
    clampResizeToViewport,
    isResizing,
    minHeight,
    minWidth,
    resizeDirection,
    restoreBodyInteractionStyles,
    setSize,
    viewportMinHeight,
    viewportMinWidth,
  ]);

  useEffect(() => {
    resetDragTransform();
    return () => {
      resetDragTransform();
      restoreBodyInteractionStyles();
    };
  }, [resetDragTransform, restoreBodyInteractionStyles]);

  useEffect(() => {
    if (typeof window === 'undefined' || !clampResizeToViewport) return;

    const handleViewportResize = () => {
      const constrainedSize = constrainWindowSizeToViewport(
        sizeRef.current,
        clampResizeToViewport,
        { width: viewportMinWidth, height: viewportMinHeight },
      );
      const effectiveMinSize = getEffectiveMinWindowSize(
        { width: minWidth, height: minHeight },
        clampResizeToViewport,
        { width: viewportMinWidth, height: viewportMinHeight },
      );
      const nextSize = {
        width: clamp(constrainedSize.width, effectiveMinSize.width, constrainedSize.width),
        height: clamp(constrainedSize.height, effectiveMinSize.height, constrainedSize.height),
      };

      if (nextSize.width !== sizeRef.current.width || nextSize.height !== sizeRef.current.height) {
        setSize(nextSize);
      }

      const limits = getDragLimits(nextSize);
      const nextPosition = {
        x: clamp(positionRef.current.x, limits.minX, limits.maxX),
        y: clamp(positionRef.current.y, limits.minY, limits.maxY),
      };

      if (nextPosition.x !== positionRef.current.x || nextPosition.y !== positionRef.current.y) {
        positionRef.current = nextPosition;
        setPosition(nextPosition);
      }
    };

    handleViewportResize();
    const visualViewport = window.visualViewport;
    window.addEventListener('resize', handleViewportResize);
    visualViewport?.addEventListener('resize', handleViewportResize);
    visualViewport?.addEventListener('scroll', handleViewportResize);
    return () => {
      window.removeEventListener('resize', handleViewportResize);
      visualViewport?.removeEventListener('resize', handleViewportResize);
      visualViewport?.removeEventListener('scroll', handleViewportResize);
    };
  }, [
    clampResizeToViewport,
    getDragLimits,
    minHeight,
    minWidth,
    setSize,
    viewportMinHeight,
    viewportMinWidth,
  ]);

  useEffect(() => {
    if (typeof window === 'undefined' || !clampResizeToViewport) return;

    const limits = getDragLimits({ width: size.width, height: size.height });
    const nextPosition = {
      x: clamp(positionRef.current.x, limits.minX, limits.maxX),
      y: clamp(positionRef.current.y, limits.minY, limits.maxY),
    };

    if (nextPosition.x !== positionRef.current.x || nextPosition.y !== positionRef.current.y) {
      positionRef.current = nextPosition;
      setPosition(nextPosition);
    }
  }, [clampResizeToViewport, getDragLimits, size.height, size.width]);

  const handleDragStart = useCallback(
    (e: MouseEvent) => {
      if (isMaximized) return;

      const target = e.target as HTMLElement;
      if (target.closest('button, input, textarea, select, [data-window-control]')) {
        return;
      }

      e.preventDefault();
      dragStartRef.current = {
        x: e.clientX,
        y: e.clientY,
      };
      dragTransformRef.current = { x: 0, y: 0 };
      resetDragTransform();
      captureBodyInteractionStyles();
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'grabbing';
      setIsDragging(true);
    },
    [captureBodyInteractionStyles, isMaximized, resetDragTransform],
  );

  const handleResizeStart = useCallback(
    (e: MouseEvent, direction: ResizeDirection) => {
      if (isMaximized || isMinimized) return;

      e.preventDefault();
      e.stopPropagation();
      captureBodyInteractionStyles();
      document.body.style.userSelect = 'none';
      document.body.style.cursor =
        direction === 'left' || direction === 'w'
          ? 'ew-resize'
          : direction === 'bottom' || direction === 's'
            ? 'ns-resize'
            : 'nwse-resize';
      setIsResizing(true);
      setResizeDirection(normalizeResizeDirection(direction));
      resizeStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        width: sizeRef.current.width,
        height: sizeRef.current.height,
        posX: positionRef.current.x,
      };
    },
    [captureBodyInteractionStyles, isMaximized, isMinimized],
  );

  const toggleMaximize = useCallback(() => {
    if (!enableMaximize) return;

    setIsMaximized((prev) => {
      if (prev) {
        if (preMaximizeRef.current) {
          const restoredSize = constrainWindowSizeToViewport(
            preMaximizeRef.current.size,
            clampResizeToViewport,
            { width: viewportMinWidth, height: viewportMinHeight },
          );
          const limits = getDragLimits(restoredSize);
          const restoredPosition = {
            x: clamp(preMaximizeRef.current.position.x, limits.minX, limits.maxX),
            y: clamp(preMaximizeRef.current.position.y, limits.minY, limits.maxY),
          };
          positionRef.current = restoredPosition;
          setPosition(restoredPosition);
          setSize(restoredSize);
        }
        return false;
      }

      preMaximizeRef.current = {
        position: positionRef.current,
        size: sizeRef.current,
      };
      setIsMinimized(false);
      return true;
    });
  }, [
    clampResizeToViewport,
    enableMaximize,
    getDragLimits,
    setSize,
    viewportMinHeight,
    viewportMinWidth,
  ]);

  const toggleMinimize = useCallback(() => {
    if (!enableMinimize) return;
    setIsMinimized((prev) => !prev);
  }, [enableMinimize]);

  const windowStyle = useMemo<CSSProperties>(() => {
    if (isMaximized) {
      return {
        position: 'fixed',
        // Leave the fixed app header exposed at the top, the way maximized OS
        // windows leave a menu bar visible.
        top: APP_HEADER_HEIGHT_PX,
        left: 0,
        right: 0,
        bottom: 0,
        width: '100%',
        // Fill the viewport below the header without relying on height:100%
        // (which would be measured from the inset top edge).
        height: `calc(100% - ${APP_HEADER_HEIGHT_PX}px)`,
        transform: 'none',
      };
    }

    if (isMinimized) {
      return {
        position: 'fixed',
        left: position.x,
        top: position.y,
        width: size.width,
        height: 48,
        transform: 'none',
      };
    }

    return {
      position: 'fixed',
      left: position.x,
      top: position.y,
      width: size.width,
      height: size.height,
      transform: `translate3d(var(${DRAG_TRANSLATE_X_VAR}, 0px), var(${DRAG_TRANSLATE_Y_VAR}, 0px), 0)`,
      willChange: isDragging ? 'transform' : undefined,
    };
  }, [isDragging, isMaximized, isMinimized, position.x, position.y, size.height, size.width]);

  return {
    isMaximized,
    isMinimized,
    position,
    size,
    setSize,
    isDragging,
    isResizing,
    containerRef,
    handleDragStart,
    handleResizeStart,
    toggleMaximize,
    toggleMinimize,
    windowStyle,
  };
};
