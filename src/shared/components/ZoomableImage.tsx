import React, { useCallback, useEffect, useRef, useState } from 'react';
import { LocateFixed, ZoomIn, ZoomOut } from 'lucide-react';

import { IconButton } from '@/shared/components/ui';

const MIN_SCALE = 1;
const MAX_SCALE = 8;
const DOUBLE_TAP_SCALE = 2.5;
const BUTTON_ZOOM_FACTOR = 1.2;

// Chrome/Edge/Safari 的 wheel delta 以像素计；Firefox 以行/页计（deltaMode=1/2），
// 归一化到像素后各平台一格滚轮的缩放步进一致。
const WHEEL_PIXELS_PER_LINE = 40;
const WHEEL_PIXELS_PER_PAGE = 100;
const WHEEL_ZOOM_SENSITIVITY = 0.0022;
// 触控板捏合在 Chrome/Edge 上表现为 ctrl+wheel，每帧 delta 很小，需要更高灵敏度才能跟手。
const PINCH_WHEEL_ZOOM_SENSITIVITY = 0.004;

function normalizeWheelDeltaY(event: WheelEvent): number {
  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) {
    return event.deltaY * WHEEL_PIXELS_PER_LINE;
  }
  if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
    return event.deltaY * WHEEL_PIXELS_PER_PAGE;
  }
  return event.deltaY;
}

interface ImageViewportState {
  scale: number;
  x: number;
  y: number;
}

interface GestureLikeEvent extends Event {
  clientX: number;
  clientY: number;
  scale: number;
}

interface PointerSample {
  x: number;
  y: number;
}

interface PanSession {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startViewport: ImageViewportState;
}

interface PinchSession {
  startDistance: number;
  startClientX: number;
  startClientY: number;
  startViewport: ImageViewportState;
}

export interface ZoomableImageLabels {
  zoomIn: string;
  zoomOut: string;
  resetZoom: string;
}

export interface ZoomableImageProps {
  src: string;
  alt: string;
  labels: ZoomableImageLabels;
  className?: string;
}

const RESET_VIEWPORT: ImageViewportState = { scale: 1, x: 0, y: 0 };

function isAtMinScale(viewport: ImageViewportState): boolean {
  return viewport.scale <= MIN_SCALE + 1e-4;
}

function pointerDistance(a: PointerSample, b: PointerSample): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function midpoint(a: PointerSample, b: PointerSample): PointerSample {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/**
 * 图片预览缩放交互，跨平台输入统一收敛到 zoomAtClientPoint：
 * - 触摸屏双指 pinch：PointerEvent（touch-action: none 接管原生手势）；
 * - 触控板捏合：Chrome/Edge/Windows PTP 走 ctrl+wheel（delta 归一化 + 捏合灵敏度），
 *   Safari 走 gesturestart/gesturechange/gestureend；
 * - 鼠标/触控板滚轮：wheel，Firefox 的行/页模式 deltaMode 已折算为像素；
 * - 单指/鼠标拖拽平移、双击切换缩放、控制按钮。
 * 图片经 flex 居中后以中心为原点做 translate + scale，缩放锚点换算均以容器中心为参考系。
 */
export function ZoomableImage({ src, alt, labels, className = '' }: ZoomableImageProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState<ImageViewportState>(RESET_VIEWPORT);
  const [isDragging, setIsDragging] = useState(false);
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;

  const activePointersRef = useRef(new Map<number, PointerSample>());
  const panSessionRef = useRef<PanSession | null>(null);
  const pinchSessionRef = useRef<PinchSession | null>(null);
  const gestureScaleRef = useRef(1);

  const applyViewport = useCallback((next: ImageViewportState) => {
    viewportRef.current = next;
    setViewport(next);
  }, []);

  const zoomAtClientPoint = useCallback(
    (clientX: number, clientY: number, scaleFactor: number) => {
      const container = containerRef.current;
      if (!container || !Number.isFinite(scaleFactor) || scaleFactor <= 0) {
        return;
      }

      const rect = container.getBoundingClientRect();
      const current = viewportRef.current;
      const nextScale = Math.min(Math.max(current.scale * scaleFactor, MIN_SCALE), MAX_SCALE);

      if (Math.abs(nextScale - current.scale) <= 1e-4) {
        return;
      }
      if (nextScale <= MIN_SCALE + 1e-4) {
        applyViewport(RESET_VIEWPORT);
        return;
      }

      const centerX = rect.width / 2;
      const centerY = rect.height / 2;
      const anchorX = clientX - rect.left;
      const anchorY = clientY - rect.top;
      const layoutX = (anchorX - centerX - current.x) / current.scale;
      const layoutY = (anchorY - centerY - current.y) / current.scale;

      applyViewport({
        scale: nextScale,
        x: anchorX - centerX - layoutX * nextScale,
        y: anchorY - centerY - layoutY * nextScale,
      });
    },
    [applyViewport],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const handleWheelEvent = (event: WheelEvent) => {
      event.preventDefault();
      const sensitivity = event.ctrlKey ? PINCH_WHEEL_ZOOM_SENSITIVITY : WHEEL_ZOOM_SENSITIVITY;
      zoomAtClientPoint(
        event.clientX,
        event.clientY,
        Math.exp(-normalizeWheelDeltaY(event) * sensitivity),
      );
    };

    const handleGestureStart = (event: Event) => {
      const gestureEvent = event as GestureLikeEvent;
      gestureScaleRef.current =
        Number.isFinite(gestureEvent.scale) && gestureEvent.scale > 0 ? gestureEvent.scale : 1;
      event.preventDefault();
    };

    const handleGestureChange = (event: Event) => {
      const gestureEvent = event as GestureLikeEvent;
      event.preventDefault();

      const nextGestureScale =
        Number.isFinite(gestureEvent.scale) && gestureEvent.scale > 0
          ? gestureEvent.scale
          : gestureScaleRef.current;
      const scaleFactor = nextGestureScale / Math.max(gestureScaleRef.current, 1e-4);
      gestureScaleRef.current = nextGestureScale;
      zoomAtClientPoint(gestureEvent.clientX, gestureEvent.clientY, scaleFactor);
    };

    const handleGestureEnd = (event: Event) => {
      gestureScaleRef.current = 1;
      event.preventDefault();
    };

    container.addEventListener('wheel', handleWheelEvent, { passive: false });
    container.addEventListener('gesturestart', handleGestureStart as EventListener, {
      passive: false,
    });
    container.addEventListener('gesturechange', handleGestureChange as EventListener, {
      passive: false,
    });
    container.addEventListener('gestureend', handleGestureEnd as EventListener, { passive: false });

    return () => {
      container.removeEventListener('wheel', handleWheelEvent);
      container.removeEventListener('gesturestart', handleGestureStart as EventListener);
      container.removeEventListener('gesturechange', handleGestureChange as EventListener);
      container.removeEventListener('gestureend', handleGestureEnd as EventListener);
    };
  }, [zoomAtClientPoint]);

  const startPanSession = useCallback((pointerId: number, sample: PointerSample) => {
    panSessionRef.current = {
      pointerId,
      startClientX: sample.x,
      startClientY: sample.y,
      startViewport: viewportRef.current,
    };
  }, []);

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.pointerType === 'mouse' && event.button !== 0) {
        return;
      }

      const container = containerRef.current;
      if (!container) {
        return;
      }

      if (typeof container.setPointerCapture === 'function') {
        try {
          container.setPointerCapture(event.pointerId);
        } catch {
          // 指针已不活跃（快速点按竞态）时捕获会抛 NotFoundError，退化为基础事件流即可
        }
      }
      activePointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      setIsDragging(true);

      if (activePointersRef.current.size === 2) {
        const [first, second] = [...activePointersRef.current.values()];
        panSessionRef.current = null;
        pinchSessionRef.current = {
          startDistance: Math.max(pointerDistance(first, second), 1e-4),
          startClientX: midpoint(first, second).x,
          startClientY: midpoint(first, second).y,
          startViewport: viewportRef.current,
        };
      } else if (activePointersRef.current.size === 1) {
        startPanSession(event.pointerId, { x: event.clientX, y: event.clientY });
      }
    },
    [startPanSession],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!activePointersRef.current.has(event.pointerId)) {
        return;
      }

      activePointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

      const pinch = pinchSessionRef.current;
      if (pinch && activePointersRef.current.size >= 2) {
        const [first, second] = [...activePointersRef.current.values()];
        const container = containerRef.current;
        if (!container) {
          return;
        }

        const rect = container.getBoundingClientRect();
        const distance = pointerDistance(first, second);
        const nextScale = Math.min(
          Math.max((pinch.startViewport.scale * distance) / pinch.startDistance, MIN_SCALE),
          MAX_SCALE,
        );

        if (nextScale <= MIN_SCALE + 1e-4) {
          applyViewport(RESET_VIEWPORT);
          return;
        }

        const mid = midpoint(first, second);
        const centerX = rect.width / 2;
        const centerY = rect.height / 2;
        const anchorX = pinch.startClientX - rect.left;
        const anchorY = pinch.startClientY - rect.top;
        const layoutX = (anchorX - centerX - pinch.startViewport.x) / pinch.startViewport.scale;
        const layoutY = (anchorY - centerY - pinch.startViewport.y) / pinch.startViewport.scale;
        const targetX = mid.x - rect.left;
        const targetY = mid.y - rect.top;

        applyViewport({
          scale: nextScale,
          x: targetX - centerX - layoutX * nextScale,
          y: targetY - centerY - layoutY * nextScale,
        });
        return;
      }

      const pan = panSessionRef.current;
      if (pan && pan.pointerId === event.pointerId && !isAtMinScale(pan.startViewport)) {
        applyViewport({
          scale: pan.startViewport.scale,
          x: pan.startViewport.x + (event.clientX - pan.startClientX),
          y: pan.startViewport.y + (event.clientY - pan.startClientY),
        });
      }
    },
    [applyViewport],
  );

  const handlePointerEnd = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!activePointersRef.current.has(event.pointerId)) {
        return;
      }

      activePointersRef.current.delete(event.pointerId);
      pinchSessionRef.current = null;
      panSessionRef.current = null;

      const remaining = [...activePointersRef.current.entries()][0];
      if (remaining) {
        startPanSession(remaining[0], remaining[1]);
      } else {
        setIsDragging(false);
      }
    },
    [startPanSession],
  );

  const handleDoubleClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (isAtMinScale(viewportRef.current)) {
        zoomAtClientPoint(event.clientX, event.clientY, DOUBLE_TAP_SCALE);
      } else {
        applyViewport(RESET_VIEWPORT);
      }
    },
    [applyViewport, zoomAtClientPoint],
  );

  const zoomFromControl = useCallback(
    (scaleFactor: number) => {
      const container = containerRef.current;
      if (!container) {
        return;
      }

      const rect = container.getBoundingClientRect();
      zoomAtClientPoint(
        rect.left + rect.width / 2,
        rect.top + rect.height / 2,
        scaleFactor,
      );
    },
    [zoomAtClientPoint],
  );

  const cursorClass = isAtMinScale(viewport)
    ? 'cursor-default'
    : isDragging
      ? 'cursor-grabbing'
      : 'cursor-grab';

  return (
    <div
      ref={containerRef}
      data-zoom-image-surface="true"
      className={`relative h-full w-full select-none overflow-hidden ${cursorClass} ${className}`.trim()}
      style={{ touchAction: 'none' }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      onDoubleClick={handleDoubleClick}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div className="absolute inset-0 flex items-center justify-center p-4">
        <img
          src={src}
          alt={alt}
          draggable={false}
          className="pointer-events-none max-h-full max-w-full rounded-md object-contain"
          style={{
            transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})`,
          }}
        />
      </div>

      <div className="absolute right-2.5 top-2 z-20 flex items-center gap-1 rounded-full border border-border-black bg-element-bg/95 p-1 shadow-sm">
        <IconButton
          variant="toolbar"
          size="sm"
          aria-label={labels.zoomOut}
          title={labels.zoomOut}
          onClick={() => zoomFromControl(1 / BUTTON_ZOOM_FACTOR)}
          className="h-7 w-7 rounded-full"
        >
          <ZoomOut className="h-3.5 w-3.5" />
        </IconButton>
        <IconButton
          variant="toolbar"
          size="sm"
          aria-label={labels.zoomIn}
          title={labels.zoomIn}
          onClick={() => zoomFromControl(BUTTON_ZOOM_FACTOR)}
          className="h-7 w-7 rounded-full"
        >
          <ZoomIn className="h-3.5 w-3.5" />
        </IconButton>
        <IconButton
          variant="toolbar"
          size="sm"
          aria-label={labels.resetZoom}
          title={labels.resetZoom}
          onClick={() => applyViewport(RESET_VIEWPORT)}
          className="h-7 w-7 rounded-full"
        >
          <LocateFixed className="h-3.5 w-3.5" />
        </IconButton>
      </div>
    </div>
  );
}
