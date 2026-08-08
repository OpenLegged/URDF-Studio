import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import type { ViewerDocumentLoadEvent } from '../types';
import {
  createLoadingDispatchKey,
  normalizeExternalDocumentLoadEvent,
  type PendingLoadingDispatch,
  type RobotLoadingProgress,
} from './robotLoaderSupport';

interface UseRobotLoadingDispatchOptions {
  onDocumentLoadEvent?: (event: ViewerDocumentLoadEvent) => void;
  setLoadingProgress: Dispatch<SetStateAction<RobotLoadingProgress | null>>;
}

interface PublishLoadingDispatchOptions {
  defer?: boolean;
}

/** Owns loading-event de-duplication and frame-coalesced progress delivery. */
export function useRobotLoadingDispatch({
  onDocumentLoadEvent,
  setLoadingProgress,
}: UseRobotLoadingDispatchOptions) {
  const progressDispatchFrameRef = useRef<number | null>(null);
  const pendingLoadingDispatchRef = useRef<PendingLoadingDispatch | null>(null);
  const lastPublishedLoadingDispatchKeyRef = useRef('');
  const lastPublishedProgressRef = useRef<RobotLoadingProgress | null>(null);
  const onDocumentLoadEventRef = useRef(onDocumentLoadEvent);

  useEffect(() => {
    onDocumentLoadEventRef.current = onDocumentLoadEvent;
  }, [onDocumentLoadEvent]);

  const applyLoadingDispatch = useCallback(
    (dispatch: PendingLoadingDispatch) => {
      const normalizedExternalEvent = onDocumentLoadEventRef.current
        ? normalizeExternalDocumentLoadEvent(dispatch.event)
        : dispatch.event;
      const dispatchKey = createLoadingDispatchKey(
        onDocumentLoadEventRef.current ? null : dispatch.progress,
        normalizedExternalEvent,
      );
      if (dispatchKey === lastPublishedLoadingDispatchKeyRef.current) {
        return;
      }

      lastPublishedLoadingDispatchKeyRef.current = dispatchKey;
      lastPublishedProgressRef.current = dispatch.progress;
      // AppLayout owns the global loading overlay state for the main viewer.
      // Publishing both channels for every mesh tick can create a render loop.
      if (!onDocumentLoadEventRef.current) {
        setLoadingProgress(dispatch.progress);
      }
      onDocumentLoadEventRef.current?.(normalizedExternalEvent);
    },
    [setLoadingProgress],
  );

  const flushPendingLoadingDispatch = useCallback(() => {
    if (progressDispatchFrameRef.current !== null && typeof window !== 'undefined') {
      window.cancelAnimationFrame(progressDispatchFrameRef.current);
      progressDispatchFrameRef.current = null;
    }

    const pendingDispatch = pendingLoadingDispatchRef.current;
    pendingLoadingDispatchRef.current = null;
    if (pendingDispatch) {
      applyLoadingDispatch(pendingDispatch);
    }
  }, [applyLoadingDispatch]);

  const publishLoadingDispatch = useCallback(
    (
      progress: RobotLoadingProgress | null,
      event: ViewerDocumentLoadEvent,
      options: PublishLoadingDispatchOptions = {},
    ) => {
      const nextDispatch: PendingLoadingDispatch = { progress, event };

      if (!options.defer) {
        pendingLoadingDispatchRef.current = null;
        flushPendingLoadingDispatch();
        applyLoadingDispatch(nextDispatch);
        return;
      }

      pendingLoadingDispatchRef.current = nextDispatch;
      if (progressDispatchFrameRef.current !== null) {
        return;
      }

      if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
        progressDispatchFrameRef.current = window.requestAnimationFrame(() => {
          progressDispatchFrameRef.current = null;
          flushPendingLoadingDispatch();
        });
        return;
      }

      queueMicrotask(flushPendingLoadingDispatch);
    },
    [applyLoadingDispatch, flushPendingLoadingDispatch],
  );

  const getLatestLoadingProgress = useCallback(
    () => pendingLoadingDispatchRef.current?.progress ?? lastPublishedProgressRef.current,
    [],
  );

  return {
    flushPendingLoadingDispatch,
    getLatestLoadingProgress,
    publishLoadingDispatch,
  };
}
