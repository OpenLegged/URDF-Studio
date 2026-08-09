import { useCallback, useEffect, useRef, useState } from 'react';
import { useSelectionStore, type HoverFreezeOwner } from '@/store/selectionStore';

interface UseViewerInteractionLockOptions {
  active: boolean;
  onTransformPendingChange?: (pending: boolean) => void;
}

/** Owns this viewer's drag/transform hover-freeze token and global release listeners. */
export function useViewerInteractionLock({
  active,
  onTransformPendingChange,
}: UseViewerInteractionLockOptions) {
  const setHoverFrozen = useSelectionStore((state) => state.setHoverFrozen);
  const hoverFreezeOwner = useRef<HoverFreezeOwner>(Symbol('viewer-controller')).current;
  const isDraggingRef = useRef(false);
  const transformPendingRef = useRef(false);
  const [isDragging, setIsDraggingState] = useState(false);

  const setOwnedHoverFrozen = useCallback(
    (frozen: boolean) => setHoverFrozen(hoverFreezeOwner, frozen),
    [hoverFreezeOwner, setHoverFrozen],
  );

  const setIsDragging = useCallback(
    (nextDragging: boolean | ((previousDragging: boolean) => boolean)) => {
      const resolvedDragging =
        typeof nextDragging === 'function' ? nextDragging(isDraggingRef.current) : nextDragging;
      isDraggingRef.current = resolvedDragging;
      if (active) {
        setOwnedHoverFrozen(resolvedDragging || transformPendingRef.current);
      }
      setIsDraggingState(resolvedDragging);
    },
    [active, setOwnedHoverFrozen],
  );

  const handleTransformPending = useCallback(
    (pending: boolean) => {
      transformPendingRef.current = pending;
      if (active) {
        setOwnedHoverFrozen(pending || isDraggingRef.current);
      }
      onTransformPendingChange?.(pending);
    },
    [active, onTransformPendingChange, setOwnedHoverFrozen],
  );

  useEffect(() => {
    if (active) {
      setOwnedHoverFrozen(isDragging || transformPendingRef.current);
    }
  }, [active, isDragging, setOwnedHoverFrozen]);

  useEffect(() => {
    isDraggingRef.current = isDragging;
  }, [isDragging]);

  useEffect(() => {
    if (!active) {
      setOwnedHoverFrozen(false);
    }
  }, [active, setOwnedHoverFrozen]);

  useEffect(() => {
    const releaseDragLock = () => setIsDragging(false);
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        setIsDragging(false);
      }
    };

    window.addEventListener('mouseup', releaseDragLock);
    window.addEventListener('pointerup', releaseDragLock);
    window.addEventListener('blur', releaseDragLock);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('mouseup', releaseDragLock);
      window.removeEventListener('pointerup', releaseDragLock);
      window.removeEventListener('blur', releaseDragLock);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [setIsDragging]);

  useEffect(() => {
    return () => {
      transformPendingRef.current = false;
      setOwnedHoverFrozen(false);
      onTransformPendingChange?.(false);
    };
  }, [onTransformPendingChange, setOwnedHoverFrozen]);

  return {
    handleTransformPending,
    isDragging,
    isDraggingRef,
    setIsDragging,
    transformPendingRef,
  };
}
