import { useLayoutEffect, useMemo, useState } from 'react';
import { Camera, X } from 'lucide-react';

import { Button, CLOSE_BUTTON_DANGER_TERTIARY_CLASS } from '@/shared/components/ui';
import {
  DraggableWindow,
  FLOATING_WINDOW_HEADER_HEIGHT_CLASS,
  FLOATING_WINDOW_RADIUS_CLASS,
  FLOATING_WINDOW_TITLE_CLASS,
} from '@/shared/components/DraggableWindow';
import { useDraggableWindow } from '@/shared/hooks/useDraggableWindow';
import {
  type SnapshotCaptureAction,
  type SnapshotCaptureOptions,
  type SnapshotCaptureProgress,
} from '@/shared/components/3d/scene/snapshotConfig';
import { translations, type Language, type TranslationKeys } from '@/shared/i18n';
import { useManagedWindowLayer } from '@/store';

import type { SnapshotDialogPreviewState, SnapshotPreviewSession } from './snapshot-preview/types';
import { SnapshotPreviewPane } from './snapshot-dialog/SnapshotPreviewPane';
import { SnapshotProgressOverlay } from './snapshot-dialog/SnapshotProgressOverlay';
import { SnapshotSettingsPane } from './snapshot-dialog/SnapshotSettingsPane';
import {
  createSnapshotCaptureChoiceModel,
  resolveSnapshotCompressionControlValue,
  SNAPSHOT_RESOLUTION_OPTIONS,
  useSnapshotCaptureForm,
} from './snapshot-dialog/snapshotCaptureForm.ts';
import {
  clampSnapshotDialogValue,
  SNAPSHOT_DIALOG_DEFAULT_SIZE,
  SNAPSHOT_DIALOG_MIN_SIZE,
  SNAPSHOT_DIALOG_VIEWPORT_MIN_SIZE,
  useSnapshotDialogLayout,
} from './snapshot-dialog/useSnapshotDialogLayout';

interface SnapshotDialogProps {
  isOpen: boolean;
  isCapturing: boolean;
  captureProgress?: SnapshotCaptureProgress | null;
  lang: Language;
  onClose: () => void;
  onCapture: (options: SnapshotCaptureOptions) => Promise<void> | void;
  onCancelCapture?: () => void;
  previewSession?: SnapshotPreviewSession | null;
  previewState?: SnapshotDialogPreviewState;
  onPreviewCaptureActionChange?: (action: SnapshotCaptureAction | null) => void;
}

function resolveSnapshotCaptureProgressLabel(
  phase: SnapshotCaptureProgress['phase'],
  t: TranslationKeys,
) {
  switch (phase) {
    case 'warming-up':
      return t.snapshotProgressWarmingUp;
    case 'rendering':
      return t.snapshotProgressRendering;
    case 'encoding':
      return t.snapshotProgressEncoding;
    case 'optimizing':
      return t.snapshotProgressOptimizing;
    case 'downloading':
      return t.snapshotProgressDownloading;
    case 'complete':
      return t.snapshotProgressComplete;
    case 'preparing':
    default:
      return t.snapshotProgressPreparing;
  }
}

export function SnapshotDialog({
  isOpen,
  isCapturing,
  captureProgress = null,
  lang,
  onClose,
  onCapture,
  onCancelCapture,
  previewSession = null,
  previewState,
  onPreviewCaptureActionChange,
}: SnapshotDialogProps) {
  const t = translations[lang];
  const snapshotWindowLayer = useManagedWindowLayer('snapshot');
  const { options: resolvedOptions, updateOptions } = useSnapshotCaptureForm(isOpen);
  const { aspectRatioPreset, detailLevel, imageFormat, longEdgePx } = resolvedOptions;
  const resolutionPreset = String(longEdgePx);
  const [internalPreviewState, setInternalPreviewState] = useState<SnapshotDialogPreviewState>({
    status: 'idle',
    imageUrl: null,
    aspectRatio: previewSession?.viewportAspectRatio ?? 16 / 9,
  });

  const windowState = useDraggableWindow({
    isOpen,
    defaultSize: SNAPSHOT_DIALOG_DEFAULT_SIZE,
    minSize: SNAPSHOT_DIALOG_MIN_SIZE,
    viewportMinSize: SNAPSHOT_DIALOG_VIEWPORT_MIN_SIZE,
    centerOnMount: true,
    enableMinimize: false,
    enableMaximize: false,
    clampResizeToViewport: true,
    dragBounds: {
      allowNegativeX: false,
      minVisibleWidth: 280,
      topMargin: 12,
      bottomMargin: 56,
    },
  });

  useLayoutEffect(() => {
    if (!isOpen) {
      return;
    }

    setInternalPreviewState({
      status: 'idle',
      imageUrl: null,
      aspectRatio: previewSession?.viewportAspectRatio ?? 16 / 9,
    });
  }, [isOpen, previewSession?.viewportAspectRatio]);

  const supportsLossyCompression = imageFormat !== 'png';
  const choiceModel = useMemo(
    () => createSnapshotCaptureChoiceModel(imageFormat, t),
    [imageFormat, t],
  );
  const selectedAntialiasOption =
    choiceModel.antialiasOptions.find((option) => option.value === detailLevel) ??
    choiceModel.antialiasOptions[1];
  const selectedResolutionLabel =
    SNAPSHOT_RESOLUTION_OPTIONS.find((option) => option.value === resolutionPreset)?.label ??
    `${resolutionPreset}px`;
  const selectedAspectRatioLabel =
    choiceModel.aspectRatioOptions.find((option) => option.value === aspectRatioPreset)?.label ??
    aspectRatioPreset;
  const captureSummary = [
    selectedResolutionLabel,
    selectedAspectRatioLabel,
    imageFormat.toUpperCase(),
    selectedAntialiasOption.label,
  ].join(' · ');
  const compressionControlValue = resolveSnapshotCompressionControlValue(resolvedOptions);
  const effectivePreviewState = previewState ?? internalPreviewState;
  const {
    scrollBodyRef,
    footerRef,
    previewFrameAreaRef,
    isCompactLayout,
    previewAspectRatio,
    previewFrameMaxWidth,
  } = useSnapshotDialogLayout({
    isOpen,
    isCapturing,
    lang,
    dialogWidth: windowState.size.width,
    setDialogSize: windowState.setSize,
    aspectRatioPreset,
    previewSessionViewportAspectRatio: previewSession?.viewportAspectRatio ?? null,
    effectivePreviewState,
  });
  const captureProgressPhase = captureProgress?.phase ?? 'preparing';
  const captureProgressPercent = clampSnapshotDialogValue(
    Math.round((captureProgress?.progress ?? 0.02) * 100),
    2,
    100,
  );
  const captureProgressLabel = resolveSnapshotCaptureProgressLabel(captureProgressPhase, t);
  const previewStatusText =
    effectivePreviewState.status === 'loading' || effectivePreviewState.status === 'idle'
      ? t.snapshotPreviewLoading
      : effectivePreviewState.status === 'refreshing'
        ? t.snapshotPreviewRefreshing
        : effectivePreviewState.status === 'error'
          ? t.snapshotPreviewFailed
          : t.snapshotPreviewReady;

  if (!isOpen) {
    return null;
  }

  return (
    <DraggableWindow
      window={windowState}
      onClose={() => {
        if (!isCapturing) {
          onClose();
        }
      }}
      title={
        <div className="flex items-center gap-2">
          <div className="rounded-lg border border-border-black bg-panel-bg p-1 text-system-blue shadow-sm">
            <Camera className="h-3 w-3" />
          </div>
          <div className={FLOATING_WINDOW_TITLE_CLASS}>{t.snapshotCapture}</div>
        </div>
      }
      className={`overflow-hidden ${FLOATING_WINDOW_RADIUS_CLASS} border border-border-black bg-panel-bg text-text-primary shadow-xl pointer-events-auto`}
      zIndex={snapshotWindowLayer.zIndex}
      onActivate={snapshotWindowLayer.onActivate}
      headerClassName={`flex ${FLOATING_WINDOW_HEADER_HEIGHT_CLASS} shrink-0 items-center justify-between border-b border-border-black bg-element-bg px-3`}
      interactionClassName="select-none"
      controlButtonClassName="rounded-md p-1 text-text-tertiary transition-colors hover:bg-panel-bg hover:text-text-primary"
      closeButtonClassName={`rounded-md p-1 ${CLOSE_BUTTON_DANGER_TERTIARY_CLASS}`}
      controlIcons={{ close: <X className="h-3.5 w-3.5" /> }}
      showMinimizeButton={false}
      showMaximizeButton={false}
      showResizeHandles
      leftResizeHandleClassName="hidden"
      rightResizeHandleClassName="absolute resize-edge-right resize-edge-visual-right top-0 bottom-3 z-20 w-2 cursor-ew-resize after:absolute after:right-0 after:top-0 after:bottom-0 after:w-px after:bg-transparent after:content-[''] after:transition-colors hover:after:bg-system-blue/50 active:after:bg-system-blue/70"
      bottomResizeHandleClassName="absolute resize-edge-bottom resize-edge-visual-bottom left-0 right-3 z-20 h-2 cursor-ns-resize after:absolute after:bottom-0 after:left-0 after:right-0 after:h-px after:bg-transparent after:content-[''] after:transition-colors hover:after:bg-system-blue/50 active:after:bg-system-blue/70"
      cornerResizeHandleClassName="absolute resize-edge-bottom resize-edge-right z-30 h-3 w-3 cursor-nwse-resize"
      cornerResizeHandle={
        <div className="absolute bottom-0 right-0 h-2.5 w-2.5 border-b border-r border-border-strong/80" />
      }
      closeTitle={t.close}
    >
      <div className="flex h-[calc(100%-40px)] min-h-0 flex-col overflow-hidden bg-panel-bg">
        <div
          ref={scrollBodyRef}
          className="relative flex flex-1 min-h-0 flex-col gap-1 overflow-y-auto px-2 py-1.5"
        >
          <div
            aria-hidden={isCapturing ? true : undefined}
            className={`flex flex-col gap-1 transition-opacity ${
              isCapturing ? 'pointer-events-none opacity-30' : 'opacity-100'
            }`}
          >
            <SnapshotSettingsPane
              t={t}
              isCapturing={isCapturing}
              isCompactLayout={isCompactLayout}
              options={resolvedOptions}
              resolutionPreset={resolutionPreset}
              compressionControlValue={compressionControlValue}
              supportsLossyCompression={supportsLossyCompression}
              choiceModel={choiceModel}
              updateOptions={updateOptions}
            />
            <SnapshotPreviewPane
              isOpen={isOpen}
              lang={lang}
              t={t}
              isCompactLayout={isCompactLayout}
              previewFrameAreaRef={previewFrameAreaRef}
              previewFrameMaxWidth={previewFrameMaxWidth}
              previewAspectRatio={previewAspectRatio}
              previewStatusText={previewStatusText}
              captureSummary={captureSummary}
              previewSession={previewSession}
              effectivePreviewState={effectivePreviewState}
              options={resolvedOptions}
              onInternalPreviewStateChange={setInternalPreviewState}
              onPreviewCaptureActionChange={onPreviewCaptureActionChange}
            />
          </div>

          {isCapturing ? (
            <SnapshotProgressOverlay
              t={t}
              label={captureProgressLabel}
              percent={captureProgressPercent}
            />
          ) : null}
        </div>

        <div
          ref={footerRef}
          className="shrink-0 border-t border-border-black bg-element-bg/95 px-3 py-2 backdrop-blur-sm"
        >
          <div className="flex flex-wrap items-center justify-end gap-1.5">
            {isCapturing ? (
              <Button
                type="button"
                variant="secondary"
                onClick={onCancelCapture}
                className="h-[26px] min-w-[104px] rounded-lg px-3 text-[11px]"
              >
                {t.snapshotCancelCapture}
              </Button>
            ) : (
              <>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={onClose}
                  className="h-[26px] rounded-lg px-2.5 text-[11px]"
                >
                  {t.close}
                </Button>
                <Button
                  type="button"
                  onClick={() => void onCapture(resolvedOptions)}
                  icon={<Camera className="h-3 w-3" />}
                  className="h-[26px] min-w-[118px] rounded-lg px-3 text-[11px]"
                >
                  {t.snapshotCapture}
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </DraggableWindow>
  );
}

export default SnapshotDialog;
