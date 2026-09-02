import { useEffect, useRef } from 'react';

import {
  resolveSnapshotAspectRatio,
  type SnapshotCaptureOptions,
  type SnapshotPreviewAction,
} from '@/shared/components/3d';

import type { SnapshotDialogPreviewState } from './types';

interface SnapshotActionPreviewRendererProps {
  action: SnapshotPreviewAction;
  isOpen: boolean;
  onStateChange: (state: SnapshotDialogPreviewState) => void;
  options: SnapshotCaptureOptions;
}

/** Renders a host-owned live canvas through the shared snapshot preview contract. */
export function SnapshotActionPreviewRenderer({
  action,
  isOpen,
  onStateChange,
  options,
}: SnapshotActionPreviewRendererProps) {
  const imageUrlRef = useRef<string | null>(null);
  const lastRequestKeyRef = useRef<string | null>(null);
  const requestIdRef = useRef(0);
  const actionRef = useRef(action);
  const onStateChangeRef = useRef(onStateChange);
  const optionsRef = useRef(options);
  const requestKey = JSON.stringify(options);
  if (actionRef.current !== action) {
    actionRef.current = action;
    lastRequestKeyRef.current = null;
  }
  onStateChangeRef.current = onStateChange;
  optionsRef.current = options;

  useEffect(() => {
    if (!isOpen) return;
    if (lastRequestKeyRef.current === requestKey) return;
    lastRequestKeyRef.current = requestKey;

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    const currentImageUrl = imageUrlRef.current;
    onStateChangeRef.current({
      status: currentImageUrl ? 'refreshing' : 'loading',
      imageUrl: currentImageUrl,
      aspectRatio: resolveSnapshotAspectRatio(
        optionsRef.current.aspectRatioPreset,
        undefined,
      ),
    });

    // Defer the capture so React StrictMode can replay the effect without
    // launching two concurrent WebGL captures for the same preview request.
    const timeoutId = window.setTimeout(() => {
      void actionRef.current(optionsRef.current).then((result) => {
        if (requestIdRef.current !== requestId) return;
        const imageUrl = URL.createObjectURL(result.blob);
        if (imageUrlRef.current) URL.revokeObjectURL(imageUrlRef.current);
        imageUrlRef.current = imageUrl;
        onStateChangeRef.current({
          status: 'ready',
          imageUrl,
          aspectRatio: result.width / result.height,
        });
      }).catch(() => {
        if (requestIdRef.current !== requestId) return;
        onStateChangeRef.current({
          status: 'error',
          imageUrl: imageUrlRef.current,
          aspectRatio: resolveSnapshotAspectRatio(
            optionsRef.current.aspectRatioPreset,
            undefined,
          ),
        });
      });
    }, 80);

    return () => {
      window.clearTimeout(timeoutId);
      if (requestIdRef.current === requestId) requestIdRef.current += 1;
    };
  }, [action, isOpen, requestKey]);

  useEffect(() => () => {
    requestIdRef.current += 1;
    lastRequestKeyRef.current = null;
    if (imageUrlRef.current) {
      URL.revokeObjectURL(imageUrlRef.current);
      imageUrlRef.current = null;
    }
  }, []);

  return null;
}
