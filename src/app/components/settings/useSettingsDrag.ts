import React from 'react';

import { useUIStore } from '@/store';
import {
  DEFAULT_SETTINGS_MAX_HEIGHT,
  DEFAULT_SETTINGS_MAX_WIDTH,
  DEFAULT_SETTINGS_WIDTH,
  SETTINGS_ESTIMATED_HEIGHT,
  SETTINGS_VIEWPORT_MARGIN,
  clamp,
} from './settingsTypes';

export interface SettingsDrag {
  maxPanelWidth: number;
  maxPanelHeight: number;
  onDragStart: (event: React.MouseEvent) => void;
  panelRef: React.RefObject<HTMLDivElement | null>;
  syncPosition: () => void;
}

const readViewportLimits = () => ({
  maxPanelWidth:
    typeof window === 'undefined'
      ? DEFAULT_SETTINGS_MAX_WIDTH
      : Math.max(
          1,
          Math.min(DEFAULT_SETTINGS_MAX_WIDTH, window.innerWidth - SETTINGS_VIEWPORT_MARGIN * 2),
        ),
  maxPanelHeight:
    typeof window === 'undefined'
      ? DEFAULT_SETTINGS_MAX_HEIGHT
      : Math.max(
          1,
          Math.min(DEFAULT_SETTINGS_MAX_HEIGHT, window.innerHeight - SETTINGS_VIEWPORT_MARGIN * 2),
        ),
});

/**
 * Owns the settings window drag/resize/reposition lifecycle: position clamping,
 * window resize + ResizeObserver sync, and the pointer-drag listeners with
 * symmetric cleanup. Callers only consume the stable `SettingsDrag` surface.
 */
export function useSettingsDrag(isOpen: boolean): SettingsDrag {
  const settingsPos = useUIStore((state) => state.settingsPos);
  const setSettingsPos = useUIStore((state) => state.setSettingsPos);
  const panelRef = React.useRef<HTMLDivElement>(null);
  const dragMoveHandlerRef = React.useRef<((event: MouseEvent) => void) | null>(null);
  const dragEndHandlerRef = React.useRef<(() => void) | null>(null);
  const dragPreviousUserSelectRef = React.useRef('');
  const dragPreviousCursorRef = React.useRef('');

  const [{ maxPanelWidth, maxPanelHeight }, setViewportLimits] = React.useState(readViewportLimits);

  const clampSettingsPosition = React.useCallback((x: number, y: number) => {
    if (typeof window === 'undefined') {
      return { x, y };
    }

    const rect = panelRef.current?.getBoundingClientRect();
    const width = rect?.width ?? DEFAULT_SETTINGS_WIDTH;
    const height = rect?.height ?? SETTINGS_ESTIMATED_HEIGHT;

    return {
      x: clamp(x, SETTINGS_VIEWPORT_MARGIN, window.innerWidth - width - SETTINGS_VIEWPORT_MARGIN),
      y: clamp(y, SETTINGS_VIEWPORT_MARGIN, window.innerHeight - height - SETTINGS_VIEWPORT_MARGIN),
    };
  }, []);

  const clearDragListeners = React.useCallback(() => {
    const moveHandler = dragMoveHandlerRef.current;
    const endHandler = dragEndHandlerRef.current;

    if (moveHandler) {
      document.removeEventListener('mousemove', moveHandler);
      dragMoveHandlerRef.current = null;
    }

    if (endHandler) {
      document.removeEventListener('mouseup', endHandler);
      window.removeEventListener('blur', endHandler);
      dragEndHandlerRef.current = null;
    }

    document.body.style.userSelect = dragPreviousUserSelectRef.current;
    document.body.style.cursor = dragPreviousCursorRef.current;
  }, []);

  const syncPosition = React.useCallback(() => {
    const currentPos = useUIStore.getState().settingsPos;
    const nextPos = clampSettingsPosition(currentPos.x, currentPos.y);

    if (nextPos.x !== currentPos.x || nextPos.y !== currentPos.y) {
      setSettingsPos(nextPos);
    }
  }, [clampSettingsPosition, setSettingsPos]);

  React.useEffect(() => {
    if (!isOpen || typeof window === 'undefined' || !panelRef.current) {
      return undefined;
    }

    const handleResize = () => {
      setViewportLimits(readViewportLimits());
      syncPosition();
    };
    handleResize();
    window.addEventListener('resize', handleResize);

    if (typeof ResizeObserver === 'undefined') {
      return () => {
        window.removeEventListener('resize', handleResize);
      };
    }

    const observer = new ResizeObserver(() => {
      syncPosition();
    });

    observer.observe(panelRef.current);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', handleResize);
    };
  }, [isOpen, syncPosition]);

  React.useLayoutEffect(() => {
    if (isOpen) syncPosition();
  }, [isOpen, maxPanelWidth, maxPanelHeight, syncPosition]);

  React.useEffect(() => {
    if (!isOpen) return undefined;
    return () => clearDragListeners();
  }, [clearDragListeners, isOpen]);

  const handleDragStart = React.useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      clearDragListeners();
      const startX = event.clientX;
      const startY = event.clientY;
      const initialX = settingsPos.x;
      const initialY = settingsPos.y;
      dragPreviousUserSelectRef.current = document.body.style.userSelect;
      dragPreviousCursorRef.current = document.body.style.cursor;
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'move';

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const dx = moveEvent.clientX - startX;
        const dy = moveEvent.clientY - startY;
        const nextPosition = clampSettingsPosition(initialX + dx, initialY + dy);
        setSettingsPos(nextPosition);
      };

      const handleMouseUp = () => {
        clearDragListeners();
      };

      dragMoveHandlerRef.current = handleMouseMove;
      dragEndHandlerRef.current = handleMouseUp;
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      window.addEventListener('blur', handleMouseUp);
    },
    [clampSettingsPosition, clearDragListeners, setSettingsPos, settingsPos],
  );

  return {
    maxPanelWidth,
    maxPanelHeight,
    onDragStart: handleDragStart,
    panelRef,
    syncPosition,
  };
}