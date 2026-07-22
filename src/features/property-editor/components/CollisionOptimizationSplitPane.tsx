import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePointerResize } from '@/shared/hooks/usePointerResize';
import {
  COLLISION_OPTIMIZATION_DEFAULT_PRIMARY_WIDTH,
  COLLISION_OPTIMIZATION_DIVIDER_WIDTH,
  getCollisionOptimizationPrimaryWidthRange,
  shouldStackCollisionOptimizationPanels,
} from './collisionOptimizationSplitLayout';

const KEYBOARD_RESIZE_STEP = 16;

interface CollisionOptimizationSplitPaneProps {
  dialogWidth: number;
  primary: React.ReactNode;
  primaryPanelId: string;
  resizeLabel: string;
  secondary: React.ReactNode;
  secondaryPanelId: string;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function applyPrimaryWidth(
  splitPane: HTMLDivElement | null,
  separator: HTMLButtonElement | null,
  width: number,
) {
  if (splitPane) {
    splitPane.style.gridTemplateColumns = `${Math.round(width)}px ${COLLISION_OPTIMIZATION_DIVIDER_WIDTH}px minmax(0, 1fr)`;
  }
  separator?.setAttribute('aria-valuenow', String(Math.round(width)));
}

export function CollisionOptimizationSplitPane({
  dialogWidth,
  primary,
  primaryPanelId,
  resizeLabel,
  secondary,
  secondaryPanelId,
}: CollisionOptimizationSplitPaneProps) {
  const splitPaneRef = useRef<HTMLDivElement>(null);
  const separatorRef = useRef<HTMLButtonElement>(null);
  const [preferredPrimaryWidth, setPreferredPrimaryWidth] = useState(
    COLLISION_OPTIMIZATION_DEFAULT_PRIMARY_WIDTH,
  );
  const isStacked = shouldStackCollisionOptimizationPanels(dialogWidth);
  const range = useMemo(
    () => getCollisionOptimizationPrimaryWidthRange(dialogWidth),
    [dialogWidth],
  );
  const primaryWidth = clamp(preferredPrimaryWidth, range.min, range.max);
  // jsx-a11y models `separator` as non-interactive, but WAI-ARIA defines a
  // focusable separator with value attributes as the window-splitter widget.
  const windowSplitterAccessibilityProps = {
    role: 'separator' as const,
    'aria-orientation': 'vertical' as const,
    'aria-valuemin': range.min,
    'aria-valuemax': range.max,
    'aria-valuenow': Math.round(primaryWidth),
  };

  useEffect(() => {
    if (isStacked) {
      return;
    }
    applyPrimaryWidth(splitPaneRef.current, separatorRef.current, primaryWidth);
  }, [isStacked, primaryWidth]);

  const resize = usePointerResize({
    axis: 'x',
    cursor: 'col-resize',
    min: range.min,
    max: range.max,
    value: primaryWidth,
    onChange: (nextWidth) => {
      applyPrimaryWidth(splitPaneRef.current, separatorRef.current, nextWidth);
    },
    onCommit: setPreferredPrimaryWidth,
  });

  const handleSeparatorKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>) => {
      let nextWidth: number | null = null;
      if (event.key === 'ArrowLeft') {
        nextWidth = primaryWidth - KEYBOARD_RESIZE_STEP;
      } else if (event.key === 'ArrowRight') {
        nextWidth = primaryWidth + KEYBOARD_RESIZE_STEP;
      } else if (event.key === 'Home') {
        nextWidth = range.min;
      } else if (event.key === 'End') {
        nextWidth = range.max;
      }

      if (nextWidth === null) {
        return;
      }

      event.preventDefault();
      setPreferredPrimaryWidth(clamp(nextWidth, range.min, range.max));
    },
    [primaryWidth, range.max, range.min],
  );

  return (
    <div
      ref={splitPaneRef}
      data-collision-optimization-layout={isStacked ? 'stacked' : 'split'}
      className={
        isStacked
          ? 'grid h-full min-h-[36rem] min-w-0 grid-cols-1 grid-rows-2 gap-2'
          : 'grid h-full min-h-0 min-w-0'
      }
      style={{
        gridTemplateColumns: isStacked
          ? undefined
          : `${primaryWidth}px ${COLLISION_OPTIMIZATION_DIVIDER_WIDTH}px minmax(0, 1fr)`,
      }}
    >
      {primary}

      {!isStacked ? (
        <button
          ref={separatorRef}
          type="button"
          {...windowSplitterAccessibilityProps}
          aria-label={resizeLabel}
          aria-controls={`${primaryPanelId} ${secondaryPanelId}`}
          data-collision-optimization-splitter="true"
          onKeyDown={handleSeparatorKeyDown}
          onMouseDown={resize.handleResizeStart}
          className={`group relative z-10 h-full cursor-col-resize border-0 bg-transparent p-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-system-blue/30 ${
            resize.isDragging ? 'bg-system-blue/8' : ''
          }`}
        >
          <span className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border-black transition-colors group-hover:bg-system-blue/50 group-active:bg-system-blue/70" />
          <span className="pointer-events-none absolute left-1/2 top-1/2 h-8 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-text-tertiary/25 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 group-active:bg-system-blue/60 group-active:opacity-100" />
        </button>
      ) : null}

      {secondary}
    </div>
  );
}
