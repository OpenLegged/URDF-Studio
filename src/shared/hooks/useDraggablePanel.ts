/**
 * Draggable panel hook — pointer-driven drag positioning for a floating panel
 * extracted from OptionsPanel so it is reusable. Uses direct DOM manipulation
 * during drag for performance, then syncs the final position to React state.
 *
 * Boundary: shared hook. Imports React only.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export interface UseDraggablePanelReturn {
  panelRef: React.RefObject<HTMLDivElement | null>;
  position: { x: number; y: number } | null;
  isCollapsed: boolean;
  setPosition: (pos: { x: number; y: number } | null) => void;
  toggleCollapsed: () => void;
  handleMouseDown: (e: React.MouseEvent) => void;
  handleMouseMove: (e: MouseEvent) => void;
  handleMouseUp: () => void;
}

export function useDraggablePanel(initialCollapsed: boolean = false): UseDraggablePanelReturn {
  const panelRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const [isCollapsed, setIsCollapsed] = useState(initialCollapsed);
  const dragOffset = useRef({ x: 0, y: 0 });

  const toggleCollapsed = useCallback(() => {
    setIsCollapsed((prev) => !prev);
  }, []);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (panelRef.current) {
      // Direct DOM manipulation for performance (avoids React re-renders during drag)
      const newX = e.clientX - dragOffset.current.x;
      const newY = e.clientY - dragOffset.current.y;

      const rect = panelRef.current.getBoundingClientRect();
      const headerHeight = 36; // Approximate header height to ensure title bar remains visible

      // Clamp position to keep the title bar visible within viewport
      const minX = -rect.width + headerHeight;
      const maxX = window.innerWidth - headerHeight;
      const minY = 0; // Top edge can't go above viewport
      const maxY = window.innerHeight - headerHeight;

      const clampedX = Math.max(minX, Math.min(maxX, newX));
      const clampedY = Math.max(minY, Math.min(maxY, newY));

      panelRef.current.style.left = `${clampedX}px`;
      panelRef.current.style.top = `${clampedY}px`;
    }
  }, []);

  const handleMouseUp = useCallback(() => {
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);

    // Sync final position to React state to persist it
    if (panelRef.current) {
      const left = parseFloat(panelRef.current.style.left || '0');
      const top = parseFloat(panelRef.current.style.top || '0');
      setPosition({ x: left, y: top });
    }
  }, [handleMouseMove]);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (panelRef.current) {
        const rect = panelRef.current.getBoundingClientRect();
        dragOffset.current = {
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
        };

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
      }
    },
    [handleMouseMove, handleMouseUp],
  );

  useEffect(() => {
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [handleMouseMove, handleMouseUp]);

  return {
    panelRef,
    position,
    isCollapsed,
    setPosition,
    toggleCollapsed,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
  };
}