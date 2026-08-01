import { useRef, useState } from 'react';
import { useUIStore } from '@/store/uiStore';
import { usePointerResize } from '@/shared/hooks/usePointerResize';

const PROPERTY_EDITOR_MIN_WIDTH = 220;
const PROPERTY_EDITOR_MAX_WIDTH = 420;

function applyPropertyEditorWidth(node: HTMLDivElement | null, width: number) {
  if (!node) {
    return;
  }

  const widthPx = `${Math.round(width)}px`;
  node.style.width = widthPx;
  node.style.minWidth = widthPx;
  node.style.flex = `0 0 ${widthPx}`;
}

export function useResizablePanel() {
  const sidebarRef = useRef<HTMLDivElement>(null);
  const committedWidth = useUIStore((state) => state.panelLayout.propertyEditorWidth);
  const setPanelLayout = useUIStore((state) => state.setPanelLayout);
  const [dragWidth, setDragWidth] = useState<number | null>(null);

  const resize = usePointerResize({
    axis: 'x',
    cursor: 'col-resize',
    direction: -1,
    min: PROPERTY_EDITOR_MIN_WIDTH,
    max: PROPERTY_EDITOR_MAX_WIDTH,
    value: committedWidth,
    onChange: (nextWidth) => {
      applyPropertyEditorWidth(sidebarRef.current, nextWidth);
      setDragWidth(nextWidth);
    },
    onCommit: (nextWidth) => {
      setPanelLayout('propertyEditorWidth', nextWidth);
      setDragWidth(null);
    },
  });

  const width = dragWidth ?? committedWidth;

  return {
    sidebarRef,
    width,
    isDragging: resize.isDragging,
    handleResizeMouseDown: resize.handleResizeStart,
  };
}
