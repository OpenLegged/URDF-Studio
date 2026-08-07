import React from 'react';
import { ArrowUpRight } from 'lucide-react';
import type { TranslationKeys } from '@/shared/i18n/types';
import { HeaderMenuOverlay } from './HeaderMenuOverlay';
import type { ToolboxItem } from './types';

interface ToolboxMenuProps {
  t: TranslationKeys;
  onClose: () => void;
  items: ToolboxItem[];
}

function ToolboxItemCard({
  item,
  isActive,
  onHoverStart,
  onHoverEnd,
  onClose,
}: {
  item: ToolboxItem;
  isActive: boolean;
  onHoverStart: (item: ToolboxItem) => void;
  onHoverEnd: () => void;
  onClose: () => void;
}) {
  const iconToneClassName =
    item.tone === 'primary'
      ? `${isActive ? 'border-system-blue-solid bg-system-blue-solid text-white scale-[1.04]' : 'text-system-blue'} group-hover:border-system-blue-solid group-hover:bg-system-blue-solid group-hover:text-white group-hover:scale-[1.04] group-focus-visible:border-system-blue-solid group-focus-visible:bg-system-blue-solid group-focus-visible:text-white group-focus-visible:scale-[1.04]`
      : item.tone === 'logo'
        ? `${isActive ? 'border-system-blue/35 bg-system-blue/10 scale-[1.04]' : 'overflow-hidden'} group-hover:border-system-blue/35 group-hover:bg-system-blue/10 group-hover:scale-[1.04] group-focus-visible:border-system-blue/35 group-focus-visible:bg-system-blue/10 group-focus-visible:scale-[1.04]`
        : `${isActive ? 'border-system-blue/35 bg-system-blue/10 text-system-blue scale-[1.04]' : 'text-text-secondary'} group-hover:border-system-blue/35 group-hover:bg-system-blue/10 group-hover:text-system-blue group-hover:scale-[1.04] group-focus-visible:border-system-blue/35 group-focus-visible:bg-system-blue/10 group-focus-visible:text-system-blue group-focus-visible:scale-[1.04]`;

  return (
    <button
      type="button"
      onClick={() => {
        onClose();
        item.onClick();
      }}
      onPointerEnter={() => {
        item.onPrefetch?.();
        onHoverStart(item);
      }}
      onPointerDown={item.onPrefetch}
      onPointerLeave={onHoverEnd}
      onFocus={() => {
        item.onPrefetch?.();
        onHoverStart(item);
      }}
      onBlur={onHoverEnd}
      aria-label={item.title}
      className={`group relative flex min-h-[3.45rem] flex-col items-center justify-center gap-0.5 rounded-xl px-0.5 py-1.5 text-center transition-all duration-100 hover:-translate-y-0.5 hover:bg-element-hover/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-system-blue/30 ${
        isActive ? '-translate-y-0.5 bg-element-hover/90 shadow-sm' : ''
      }`}
    >
      {item.external && (
        <span
          className={`absolute right-1 top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-panel-bg/90 text-text-tertiary transition-all duration-100 ${
            isActive
              ? 'translate-y-0 opacity-100 text-system-blue'
              : '-translate-y-0.5 opacity-0 group-hover:translate-y-0 group-hover:opacity-100 group-hover:text-system-blue group-focus-visible:translate-y-0 group-focus-visible:opacity-100 group-focus-visible:text-system-blue'
          }`}
        >
          <ArrowUpRight className="h-2.5 w-2.5" />
        </span>
      )}

      <span
        className={`flex h-8 w-8 items-center justify-center rounded-[0.9rem] border border-border-black bg-panel-bg shadow-sm transition-all duration-100 ${iconToneClassName}`}
      >
        {item.icon}
      </span>

      <span
        className={`line-clamp-2 text-[10px] font-semibold leading-tight transition-colors duration-100 ${
          isActive ? 'text-system-blue' : 'text-text-primary'
        }`}
      >
        {item.title}
      </span>
    </button>
  );
}

// 安全边距：面板与视口左右边界保留的最小间距（px）。
const PANEL_VIEWPORT_MARGIN = 8;

export function ToolboxMenu({ t, onClose, items }: ToolboxMenuProps) {
  const [hoveredItemKey, setHoveredItemKey] = React.useState<string | null>(null);

  const hoveredItem = React.useMemo(
    () => items.find((item) => item.key === hoveredItemKey) ?? null,
    [items, hoveredItemKey],
  );

  const panelRef = React.useRef<HTMLDivElement | null>(null);
  // null 表示沿用默认 CSS 定位；否则切到 position:fixed 用视口坐标直接定位。
  const [fixedPosition, setFixedPosition] = React.useState<{ left: number; top: number } | null>(
    null,
  );

  React.useLayoutEffect(() => {
    const panel = panelRef.current;

    if (!panel) {
      return;
    }

    // 触发按钮位于面板父级（relative 容器）内，是其唯一的按钮。
    const trigger = panel.parentElement?.querySelector('button');

    if (!trigger) {
      return;
    }

    const measure = () => {
      const triggerRect = trigger.getBoundingClientRect();
      const panelRect = panel.getBoundingClientRect();

      // jsdom 等无真实布局环境下尺寸为 0，保持默认 CSS 定位，不产生错误偏移。
      if (panelRect.width === 0 || triggerRect.width === 0) {
        setFixedPosition(null);
        return;
      }

      const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
      const maxLeft = viewportWidth - panelRect.width - PANEL_VIEWPORT_MARGIN;
      // 居中对齐触发按钮时的视口左边界。
      const centeredLeft = triggerRect.left + (triggerRect.width - panelRect.width) / 2;

      let nextLeft = centeredLeft;
      // 左溢出：贴齐视口左边安全边距。
      if (nextLeft < PANEL_VIEWPORT_MARGIN) {
        nextLeft = PANEL_VIEWPORT_MARGIN;
      }
      // 右溢出：贴齐视口右边安全边距。
      if (nextLeft > maxLeft) {
        nextLeft = Math.max(PANEL_VIEWPORT_MARGIN, maxLeft);
      }

      // 用 fixed 定位直接控制视口坐标，避免 absolute 定位上下文歧义。
      setFixedPosition({ left: Math.round(nextLeft), top: Math.round(triggerRect.bottom + 4) });
    };

    let frameId: number | null = null;
    const scheduleMeasure = () => {
      measure();

      if (typeof window.requestAnimationFrame !== 'function') {
        return;
      }

      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }

      frameId = window.requestAnimationFrame(() => {
        frameId = null;
        measure();
      });
    };

    measure();

    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(scheduleMeasure);
      observer.observe(panel);
      observer.observe(trigger);
    }

    const handleWindowResize = () => scheduleMeasure();
    window.addEventListener('resize', handleWindowResize);

    return () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }
      observer?.disconnect();
      window.removeEventListener('resize', handleWindowResize);
    };
  }, []);

  // fixedPosition 命中时用 position:fixed + 视口坐标覆盖默认 absolute 定位，
  // 此时必须清除所有冲突的 Tailwind 定位类（top-full/left-*/translate），
  // 否则它们会与 inline style 互相覆盖，导致位置错误。
  const panelStyle = fixedPosition
    ? { position: 'fixed' as const, left: `${fixedPosition.left}px`, top: `${fixedPosition.top}px` }
    : undefined;
  const panelPositionClassName = fixedPosition
    ? 'z-50'
    : 'absolute top-full left-0 z-50 mt-1 sm:left-1/2 sm:-translate-x-1/2';

  return (
    <>
      <HeaderMenuOverlay onClose={onClose} label={t.close} />
      <div
        ref={panelRef}
        style={panelStyle}
        className={`${panelPositionClassName} w-[23rem] max-w-[calc(100vw-1rem)] rounded-2xl border border-border-black bg-panel-bg p-2 shadow-xl dark:shadow-black`}>
        <div className="grid grid-cols-4 gap-x-0.5 gap-y-0.5">
          {items.map((item) => (
            <ToolboxItemCard
              key={item.key}
              item={item}
              isActive={hoveredItemKey === item.key}
              onHoverStart={(nextItem) => setHoveredItemKey(nextItem.key)}
              onHoverEnd={() =>
                setHoveredItemKey((currentKey) => (currentKey === item.key ? null : currentKey))
              }
              onClose={onClose}
            />
          ))}
        </div>
        <div className="mt-1.5 min-h-8 border-t border-border-black/70 px-1 pt-1.5">
          <div className="ui-static-copy-guard text-[10px] leading-4 text-text-tertiary transition-all duration-75">
            {hoveredItem ? hoveredItem.description : t.toolboxHoverHint}
          </div>
        </div>
      </div>
    </>
  );
}
