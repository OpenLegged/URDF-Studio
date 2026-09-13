import { useCallback, useEffect, useRef, type RefObject } from 'react';

import type { CollisionTransformMode, DraggingControlLike } from '@/shared/components/3d/robot/utils/collisionTransformControlsShared';
import {
  resolveActiveCollisionDraggingControls,
  resolveCollisionTransformControlMode,
  shouldUseCollisionTranslateProxy,
} from '@/shared/components/3d/robot/utils/collisionTransformControlsShared';

interface UseCollisionTransformDragLifecycleOptions<TControl extends DraggingControlLike> {
  transformMode: CollisionTransformMode;
  transformRef: RefObject<TControl | null>;
  rotateTransformRef: RefObject<TControl | null>;
  invalidate: () => void;
  setIsDragging: (dragging: boolean) => void;
  onTransformPending?: (pending: boolean) => void;
  onBeginDrag: (controls?: TControl | null) => boolean;
  onFinishDrag: () => void;
  onCancelDrag: () => void;
  onObjectChange?: (context: { isDragging: boolean; isTranslateDragging: boolean }) => void;
}

export function useCollisionTransformDragLifecycle<TControl extends DraggingControlLike>({
  transformMode,
  transformRef,
  rotateTransformRef,
  invalidate,
  setIsDragging,
  onTransformPending,
  onBeginDrag,
  onFinishDrag,
  onCancelDrag,
  onObjectChange,
}: UseCollisionTransformDragLifecycleOptions<TControl>) {
  const isDraggingRef = useRef(false);
  const activeControlsRef = useRef<TControl | null>(null);

  const setIsDraggingRef = useRef(setIsDragging);
  const onTransformPendingRef = useRef(onTransformPending);
  const onBeginDragRef = useRef(onBeginDrag);
  const onFinishDragRef = useRef(onFinishDrag);
  const onCancelDragRef = useRef(onCancelDrag);
  const onObjectChangeRef = useRef(onObjectChange);

  useEffect(() => {
    setIsDraggingRef.current = setIsDragging;
  }, [setIsDragging]);

  useEffect(() => {
    onTransformPendingRef.current = onTransformPending;
  }, [onTransformPending]);

  useEffect(() => {
    onBeginDragRef.current = onBeginDrag;
  }, [onBeginDrag]);

  useEffect(() => {
    onFinishDragRef.current = onFinishDrag;
  }, [onFinishDrag]);

  useEffect(() => {
    onCancelDragRef.current = onCancelDrag;
  }, [onCancelDrag]);

  useEffect(() => {
    onObjectChangeRef.current = onObjectChange;
  }, [onObjectChange]);

  const beginActiveDrag = useCallback((controls?: TControl | null) => {
    if (isDraggingRef.current) {
      return false;
    }

    const didBegin = onBeginDragRef.current?.(controls) ?? false;
    if (!didBegin) {
      return false;
    }

    isDraggingRef.current = true;
    activeControlsRef.current = controls ?? activeControlsRef.current;
    setIsDraggingRef.current(true);
    onTransformPendingRef.current?.(true);
    return true;
  }, []);

  const finishActiveDrag = useCallback(() => {
    if (!isDraggingRef.current) {
      return false;
    }

    onFinishDragRef.current?.();
    isDraggingRef.current = false;
    activeControlsRef.current = null;
    setIsDraggingRef.current(false);
    onTransformPendingRef.current?.(false);
    invalidate();
    return true;
  }, [invalidate]);

  const cancelActiveDrag = useCallback(() => {
    if (!isDraggingRef.current) {
      return false;
    }

    onCancelDragRef.current?.();
    isDraggingRef.current = false;
    activeControlsRef.current = null;
    setIsDraggingRef.current(false);
    onTransformPendingRef.current?.(false);
    invalidate();
    return true;
  }, [invalidate]);

  const handleDraggingChanged = useCallback((event?: { target?: TControl | null; value?: boolean }) => {
    const translateControls = transformRef.current;
    const rotateControls = rotateTransformRef.current;
    const draggingControls = resolveActiveCollisionDraggingControls(
      translateControls,
      rotateControls,
      event?.target ?? activeControlsRef.current,
    );

    if (event?.value) {
      if (!draggingControls) {
        return;
      }

      if (isDraggingRef.current && activeControlsRef.current !== draggingControls) {
        return;
      }

      beginActiveDrag(draggingControls);
      return;
    }

    finishActiveDrag();
  }, [beginActiveDrag, finishActiveDrag, rotateTransformRef, transformRef]);

  const handleObjectChange = useCallback((event?: { target?: TControl | null }) => {
    const translateControls = transformRef.current;
    const rotateControls = rotateTransformRef.current;
    const draggingControls = resolveActiveCollisionDraggingControls(
      translateControls,
      rotateControls,
      event?.target ?? null,
    );

    if (draggingControls && !isDraggingRef.current) {
      beginActiveDrag(draggingControls);
    }

    onObjectChangeRef.current?.({
      isDragging: isDraggingRef.current,
      isTranslateDragging: Boolean(translateControls?.dragging),
    });

    invalidate();
  }, [beginActiveDrag, invalidate, rotateTransformRef, transformRef]);

  useEffect(() => {
    return () => {
      cancelActiveDrag();
    };
  }, [cancelActiveDrag]);

  return {
    activeControlsRef,
    beginActiveDrag,
    cancelActiveDrag,
    controlMode: resolveCollisionTransformControlMode(transformMode),
    finishActiveDrag,
    handleDraggingChanged,
    handleObjectChange,
    isDraggingRef,
    shouldUseTranslateProxy: shouldUseCollisionTranslateProxy(transformMode),
  };
}
