import { useCallback, useEffect, useRef, useState } from 'react';
import type { ComponentType, RefObject } from 'react';
import type { Theme } from '@/types';
import {
  createSnapshotCaptureAbortError,
  throwIfSnapshotCaptureAborted,
  type SnapshotCaptureAction,
  type SnapshotPreviewAction,
} from './snapshotConfig';
import type { SnapshotManagerRuntimeProps } from './SnapshotManagerRuntime';
import {
  createSnapshotRuntimeActionRegistry,
  type SnapshotRuntimeActionRegistry,
} from './snapshotRuntimeActionRegistry';

export interface SnapshotManagerProps {
  actionRef?: RefObject<SnapshotCaptureAction | null>;
  onSnapshotActionChange?: (action: SnapshotCaptureAction | null) => void;
  previewActionRef?: RefObject<SnapshotPreviewAction | null>;
  onPreviewActionChange?: (action: SnapshotPreviewAction | null) => void;
  robotName: string;
  theme: Theme;
  groundOffset?: number;
}

type SnapshotManagerRuntimeComponent = ComponentType<SnapshotManagerRuntimeProps>;

let snapshotManagerRuntimePromise: Promise<SnapshotManagerRuntimeComponent> | null = null;

function loadSnapshotManagerRuntime(): Promise<SnapshotManagerRuntimeComponent> {
  snapshotManagerRuntimePromise ??= import('./SnapshotManagerRuntime')
    .then(({ SnapshotManagerRuntime }) => SnapshotManagerRuntime)
    .catch((error: unknown) => {
      // A transient chunk/network failure must not disable snapshots for the
      // remainder of the session; the next user request gets a fresh attempt.
      snapshotManagerRuntimePromise = null;
      throw error;
    });
  return snapshotManagerRuntimePromise;
}

/**
 * Keeps the snapshot action contract available without loading the rendering,
 * HDR, and PNG optimization runtime until the first capture or preview request.
 */
export function SnapshotManager({
  actionRef,
  onSnapshotActionChange,
  previewActionRef,
  onPreviewActionChange,
  robotName,
  theme,
  groundOffset = 0,
}: SnapshotManagerProps) {
  const [RuntimeComponent, setRuntimeComponent] =
    useState<SnapshotManagerRuntimeComponent | null>(null);
  const runtimeCaptureActionRef = useRef<SnapshotCaptureAction | null>(null);
  const runtimePreviewActionRef = useRef<SnapshotPreviewAction | null>(null);
  const captureRegistryRef = useRef<SnapshotRuntimeActionRegistry<SnapshotCaptureAction> | null>(
    null,
  );
  const previewRegistryRef = useRef<SnapshotRuntimeActionRegistry<SnapshotPreviewAction> | null>(
    null,
  );
  captureRegistryRef.current ??= createSnapshotRuntimeActionRegistry();
  previewRegistryRef.current ??= createSnapshotRuntimeActionRegistry();
  const captureRegistry = captureRegistryRef.current;
  const previewRegistry = previewRegistryRef.current;
  const activeRef = useRef(false);
  const generationRef = useRef(0);

  useEffect(() => {
    activeRef.current = true;
    generationRef.current += 1;

    return () => {
      activeRef.current = false;
      generationRef.current += 1;
      const abortError = createSnapshotCaptureAbortError();
      captureRegistry.rejectAll(abortError);
      previewRegistry.rejectAll(abortError);
      runtimeCaptureActionRef.current = null;
      runtimePreviewActionRef.current = null;
    };
  }, [captureRegistry, previewRegistry]);

  const ensureRuntimeMounted = useCallback(async (signal?: AbortSignal) => {
    throwIfSnapshotCaptureAborted(signal);
    const requestGeneration = generationRef.current;
    const component = await loadSnapshotManagerRuntime();
    throwIfSnapshotCaptureAborted(signal);
    if (!activeRef.current || generationRef.current !== requestGeneration) {
      throw createSnapshotCaptureAbortError();
    }
    setRuntimeComponent(
      (currentComponent: SnapshotManagerRuntimeComponent | null) => currentComponent ?? component,
    );
  }, []);

  const handleRuntimeCaptureActionChange = useCallback(
    (runtimeAction: SnapshotCaptureAction | null) => {
      runtimeCaptureActionRef.current = runtimeAction;
      if (runtimeAction) {
        captureRegistry.resolve(runtimeAction);
      }
    },
    [captureRegistry],
  );

  const handleRuntimePreviewActionChange = useCallback(
    (runtimeAction: SnapshotPreviewAction | null) => {
      runtimePreviewActionRef.current = runtimeAction;
      if (runtimeAction) {
        previewRegistry.resolve(runtimeAction);
      }
    },
    [previewRegistry],
  );

  useEffect(() => {
    if (!actionRef && !onSnapshotActionChange && !previewActionRef && !onPreviewActionChange) {
      return;
    }

    const captureAction: SnapshotCaptureAction = async (requestedOptions) => {
      const signal = requestedOptions?.signal;
      await ensureRuntimeMounted(signal);
      const runtimeAction = await captureRegistry.waitForAction({
        getCurrentAction: () => runtimeCaptureActionRef.current,
        signal,
        isActive: () => activeRef.current,
      });
      throwIfSnapshotCaptureAborted(signal);
      if (!activeRef.current) {
        throw createSnapshotCaptureAbortError();
      }
      return (runtimeCaptureActionRef.current ?? runtimeAction)(requestedOptions);
    };
    const previewAction: SnapshotPreviewAction = async (requestedOptions) => {
      await ensureRuntimeMounted();
      const runtimeAction = await previewRegistry.waitForAction({
        getCurrentAction: () => runtimePreviewActionRef.current,
        isActive: () => activeRef.current,
      });
      if (!activeRef.current) {
        throw createSnapshotCaptureAbortError();
      }
      return (runtimePreviewActionRef.current ?? runtimeAction)(requestedOptions);
    };

    if (actionRef) {
      actionRef.current = captureAction;
    }
    onSnapshotActionChange?.(captureAction);
    if (previewActionRef) {
      previewActionRef.current = previewAction;
    }
    onPreviewActionChange?.(previewAction);

    return () => {
      if (actionRef?.current === captureAction) {
        actionRef.current = null;
      }
      onSnapshotActionChange?.(null);
      if (previewActionRef?.current === previewAction) {
        previewActionRef.current = null;
      }
      onPreviewActionChange?.(null);
    };
  }, [
    actionRef,
    captureRegistry,
    ensureRuntimeMounted,
    onPreviewActionChange,
    onSnapshotActionChange,
    previewRegistry,
    previewActionRef,
  ]);

  return RuntimeComponent ? (
    <RuntimeComponent
      actionRef={runtimeCaptureActionRef}
      onSnapshotActionChange={handleRuntimeCaptureActionChange}
      previewActionRef={runtimePreviewActionRef}
      onPreviewActionChange={handleRuntimePreviewActionChange}
      robotName={robotName}
      theme={theme}
      groundOffset={groundOffset}
    />
  ) : null;
}
