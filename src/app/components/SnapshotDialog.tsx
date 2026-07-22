import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Camera, X } from 'lucide-react';
import {
  Button,
  CLOSE_BUTTON_DANGER_TERTIARY_CLASS,
  CompactSwitch,
  PanelSegmentedControl,
  PanelSelect,
} from '@/shared/components/ui';
import {
  DraggableWindow,
  FLOATING_WINDOW_HEADER_HEIGHT_CLASS,
  FLOATING_WINDOW_RADIUS_CLASS,
  FLOATING_WINDOW_TITLE_CLASS,
} from '@/shared/components/DraggableWindow';
import { useDraggableWindow } from '@/shared/hooks/useDraggableWindow';
import {
  resolveSnapshotAspectRatio,
  type SnapshotCaptureAction,
  type SnapshotAspectRatioPreset,
  type SnapshotCaptureOptions,
  type SnapshotCaptureProgress,
} from '@/shared/components/3d/scene/snapshotConfig';
import { translations, type Language, type TranslationKeys } from '@/shared/i18n';
import { useManagedWindowLayer } from '@/store';
import { SnapshotPreviewRenderer } from './snapshot-preview/SnapshotPreviewRenderer';
import type { SnapshotDialogPreviewState, SnapshotPreviewSession } from './snapshot-preview/types';
import {
  createSnapshotCaptureChoiceModel,
  resolveSnapshotCompressionControlValue,
  SNAPSHOT_RESOLUTION_OPTIONS,
  useSnapshotCaptureForm,
} from './snapshot-dialog/snapshotCaptureForm.ts';

const PANEL_SECTION_CLASS_NAME =
  'rounded-lg border border-border-black bg-panel-bg px-2.5 py-1.5 shadow-sm';
const FIELD_ROW_CLASS_NAME = 'grid grid-cols-[68px_minmax(0,1fr)] items-center gap-1.5';
const FIELD_LABEL_CLASS_NAME = 'truncate text-[9px] font-medium text-text-secondary';
const SNAPSHOT_SEGMENTED_CLASS_NAME = 'w-full !min-h-[24px] !rounded-md';
const SNAPSHOT_SEGMENTED_ITEM_CLASS_NAME = '!h-[21px] px-1.5 text-[10px]';
const SNAPSHOT_DIALOG_DEFAULT_SIZE = {
  width: 520,
  height: 590,
} as const;
const SNAPSHOT_DIALOG_MIN_SIZE = {
  width: 320,
  height: 420,
} as const;
const SNAPSHOT_DIALOG_VIEWPORT_MIN_SIZE = {
  width: 320,
  height: 320,
} as const;
const SNAPSHOT_DIALOG_HEADER_HEIGHT = 40;
const SNAPSHOT_DIALOG_VIEWPORT_MARGIN = 24;
const SNAPSHOT_DIALOG_VIEWPORT_MIN_HEIGHT = 320;
const SNAPSHOT_DIALOG_DESKTOP_MAX_HEIGHT = 660;
const SNAPSHOT_DIALOG_COMPACT_LAYOUT_WIDTH = 500;
const SNAPSHOT_PREVIEW_MIN_WIDTH = 200;
// Horizontal chrome around the preview frame (scroll body padding + preview card
// padding + scrollbar slack). The frame fills the remaining card width instead of
// being capped at a fixed max, so the preview reads as the hero element.
const SNAPSHOT_PREVIEW_WIDTH_GUTTER = 52;
// Upper bound on the preview height so portrait/tall aspect ratios don't push the
// dialog past the viewport; landscape previews stay width-driven and fill the card.
const SNAPSHOT_PREVIEW_MAX_HEIGHT = 300;
const SNAPSHOT_PREVIEW_VIEWPORT_HEIGHT_RATIO = 0.38;

const clamp = (value: number, min: number, max: number) => {
  if (max < min) {
    return min;
  }
  return Math.max(min, Math.min(max, value));
};

const resolveSnapshotDialogHeight = ({
  scrollContentHeight,
  footerHeight,
  viewportHeight,
}: {
  scrollContentHeight: number;
  footerHeight: number;
  viewportHeight: number;
}) => {
  const viewportLimit = Math.max(
    SNAPSHOT_DIALOG_VIEWPORT_MIN_HEIGHT,
    viewportHeight - SNAPSHOT_DIALOG_VIEWPORT_MARGIN,
  );
  const adaptiveViewportLimit =
    viewportHeight >= 720
      ? Math.min(viewportLimit, SNAPSHOT_DIALOG_DESKTOP_MAX_HEIGHT)
      : viewportLimit;
  const minHeight = Math.min(SNAPSHOT_DIALOG_MIN_SIZE.height, adaptiveViewportLimit);
  const naturalHeight = SNAPSHOT_DIALOG_HEADER_HEIGHT + footerHeight + scrollContentHeight;
  return clamp(naturalHeight, minHeight, adaptiveViewportLimit);
};

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

function SnapshotSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className={PANEL_SECTION_CLASS_NAME}>
      <div className="mb-1 text-[9px] font-semibold text-text-tertiary">{title}</div>
      {children}
    </div>
  );
}

function SnapshotField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className={FIELD_ROW_CLASS_NAME}>
      <div className={FIELD_LABEL_CLASS_NAME}>{label}</div>
      <div className="min-w-0">{children}</div>
    </div>
  );
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
  const {
    aspectRatioPreset,
    backgroundStyle,
    detailLevel,
    environmentPreset,
    groundStyle,
    hideGrid,
    imageFormat,
    longEdgePx,
    shadowStyle,
  } = resolvedOptions;
  const resolutionPreset = String(longEdgePx);
  const [internalPreviewState, setInternalPreviewState] = useState<SnapshotDialogPreviewState>({
    status: 'idle',
    imageUrl: null,
    aspectRatio: previewSession?.viewportAspectRatio ?? 16 / 9,
  });
  const scrollBodyRef = useRef<HTMLDivElement | null>(null);
  const footerRef = useRef<HTMLDivElement | null>(null);
  const previewFrameAreaRef = useRef<HTMLDivElement | null>(null);
  const [previewFrameAreaWidth, setPreviewFrameAreaWidth] = useState<number | null>(null);

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

  useLayoutEffect(() => {
    if (!isOpen) {
      return;
    }

    const scrollBody = scrollBodyRef.current;
    const footer = footerRef.current;

    if (!scrollBody || !footer) {
      return;
    }

    const nextHeight = resolveSnapshotDialogHeight({
      scrollContentHeight: scrollBody.scrollHeight,
      footerHeight: footer.offsetHeight,
      viewportHeight: window.innerHeight,
    });

    windowState.setSize((currentSize) =>
      currentSize.height === nextHeight ? currentSize : { ...currentSize, height: nextHeight },
    );
  }, [
    aspectRatioPreset,
    isOpen,
    isCapturing,
    lang,
    internalPreviewState.aspectRatio,
    internalPreviewState.imageUrl,
    internalPreviewState.status,
    previewState?.imageUrl,
    previewState?.status,
    previewSession?.viewportAspectRatio,
    previewState?.aspectRatio,
    windowState.setSize,
  ]);

  useLayoutEffect(() => {
    if (!isOpen) {
      setPreviewFrameAreaWidth(null);
      return;
    }

    const previewFrameArea = previewFrameAreaRef.current;
    if (!previewFrameArea) {
      return;
    }

    const measurePreviewFrameArea = () => {
      const rect = previewFrameArea.getBoundingClientRect();
      const nextWidth = Math.floor(rect.width || previewFrameArea.clientWidth || 0);
      setPreviewFrameAreaWidth((currentWidth) => {
        const normalizedWidth = nextWidth > 0 ? nextWidth : null;
        return currentWidth === normalizedWidth ? currentWidth : normalizedWidth;
      });
    };

    measurePreviewFrameArea();
    const resizeObserver =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measurePreviewFrameArea) : null;
    resizeObserver?.observe(previewFrameArea);
    window.addEventListener('resize', measurePreviewFrameArea);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', measurePreviewFrameArea);
    };
  }, [isOpen, windowState.size.width]);

  const supportsLossyCompression = imageFormat !== 'png';
  const {
    antialiasOptions,
    aspectRatioOptions,
    backgroundOptions,
    compactLabels,
    compressionOptions,
    environmentOptions,
    formatOptions,
    groundOptions,
    resolutionOptions,
    shadowOptions,
  } = useMemo(() => createSnapshotCaptureChoiceModel(imageFormat, t), [imageFormat, t]);
  const selectedAntialiasOption =
    antialiasOptions.find((option) => option.value === detailLevel) ?? antialiasOptions[1];
  const selectedResolutionLabel =
    SNAPSHOT_RESOLUTION_OPTIONS.find((option) => option.value === resolutionPreset)?.label ??
    `${resolutionPreset}px`;
  const selectedAspectRatioLabel =
    aspectRatioOptions.find((option) => option.value === aspectRatioPreset)?.label ??
    aspectRatioPreset;
  const captureSummary = [
    selectedResolutionLabel,
    selectedAspectRatioLabel,
    imageFormat.toUpperCase(),
    selectedAntialiasOption.label,
  ].join(' · ');
  const compressionControlValue = resolveSnapshotCompressionControlValue(resolvedOptions);
  const effectivePreviewState = previewState ?? internalPreviewState;
  const captureProgressPhase = captureProgress?.phase ?? 'preparing';
  const captureProgressPercent = clamp(
    Math.round((captureProgress?.progress ?? 0.02) * 100),
    2,
    100,
  );
  const captureProgressLabel = resolveSnapshotCaptureProgressLabel(captureProgressPhase, t);
  const isCompactLayout = windowState.size.width <= SNAPSHOT_DIALOG_COMPACT_LAYOUT_WIDTH;
  const settingsGridClassName = isCompactLayout
    ? 'grid grid-cols-1 gap-y-1'
    : 'grid grid-cols-2 gap-x-2.5 gap-y-1';
  const previewCardClassName = `flex shrink-0 flex-col rounded-lg border border-border-black bg-element-bg px-2.5 py-1.5 shadow-sm ${
    isCompactLayout ? 'min-h-[190px]' : 'min-h-[220px]'
  }`;
  const previewStatusText =
    effectivePreviewState.status === 'loading' || effectivePreviewState.status === 'idle'
      ? t.snapshotPreviewLoading
      : effectivePreviewState.status === 'refreshing'
        ? t.snapshotPreviewRefreshing
        : effectivePreviewState.status === 'error'
          ? t.snapshotPreviewFailed
          : t.snapshotPreviewReady;
  const selectedPreviewAspectRatio = previewSession
    ? resolveSnapshotAspectRatio(aspectRatioPreset, previewSession.viewportAspectRatio)
    : null;
  const previewAspectRatio =
    selectedPreviewAspectRatio ??
    (effectivePreviewState.aspectRatio > 0 ? effectivePreviewState.aspectRatio : 16 / 9);
  const fallbackPreviewAvailableWidth = Math.max(
    SNAPSHOT_PREVIEW_MIN_WIDTH,
    windowState.size.width - SNAPSHOT_PREVIEW_WIDTH_GUTTER,
  );
  const previewAvailableWidth = previewFrameAreaWidth ?? fallbackPreviewAvailableWidth;
  const previewMaxHeight =
    typeof window !== 'undefined'
      ? clamp(
          window.innerHeight * SNAPSHOT_PREVIEW_VIEWPORT_HEIGHT_RATIO,
          200,
          SNAPSHOT_PREVIEW_MAX_HEIGHT,
        )
      : SNAPSHOT_PREVIEW_MAX_HEIGHT;
  // Fill the available card width, but never let a tall aspect ratio exceed the
  // height ceiling — derive the width back from that ceiling when it would.
  const previewHeightBoundedWidth = Math.max(1, Math.floor(previewMaxHeight * previewAspectRatio));
  const previewFrameMinWidth = Math.min(
    SNAPSHOT_PREVIEW_MIN_WIDTH,
    previewAvailableWidth,
    previewHeightBoundedWidth,
  );
  const previewFrameMaxWidth = clamp(
    Math.min(previewAvailableWidth, previewHeightBoundedWidth),
    previewFrameMinWidth,
    previewAvailableWidth,
  );

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
            <SnapshotSection title={compactLabels.output}>
              <div className={settingsGridClassName}>
                <SnapshotField label={compactLabels.resolution}>
                  <PanelSelect
                    variant="snapshot"
                    value={resolutionPreset}
                    options={resolutionOptions}
                    disabled={isCapturing}
                    onChange={(event) => updateOptions({ longEdgePx: Number(event.target.value) })}
                  />
                </SnapshotField>
                <SnapshotField label={compactLabels.aspect}>
                  <PanelSelect
                    variant="snapshot"
                    value={aspectRatioPreset}
                    options={aspectRatioOptions}
                    disabled={isCapturing}
                    onChange={(event) =>
                      updateOptions({
                        aspectRatioPreset: event.target.value as SnapshotAspectRatioPreset,
                      })
                    }
                  />
                </SnapshotField>
                <SnapshotField label={compactLabels.format}>
                  <PanelSelect
                    variant="snapshot"
                    value={imageFormat}
                    options={formatOptions}
                    disabled={isCapturing}
                    onChange={(event) =>
                      updateOptions({
                        imageFormat: event.target.value as SnapshotCaptureOptions['imageFormat'],
                      })
                    }
                  />
                </SnapshotField>
                <SnapshotField label={compactLabels.aa}>
                  <PanelSegmentedControl
                    value={detailLevel}
                    options={antialiasOptions}
                    disabled={isCapturing}
                    className={SNAPSHOT_SEGMENTED_CLASS_NAME}
                    itemClassName={SNAPSHOT_SEGMENTED_ITEM_CLASS_NAME}
                    stretch
                    onChange={(value) =>
                      updateOptions({
                        detailLevel: value as SnapshotCaptureOptions['detailLevel'],
                      })
                    }
                  />
                </SnapshotField>
                <SnapshotField label={compactLabels.quality}>
                  <PanelSegmentedControl
                    value={compressionControlValue}
                    options={compressionOptions}
                    disabled={isCapturing}
                    className={SNAPSHOT_SEGMENTED_CLASS_NAME}
                    itemClassName={SNAPSHOT_SEGMENTED_ITEM_CLASS_NAME}
                    stretch
                    onChange={(value) => {
                      if (typeof value !== 'number') {
                        return;
                      }
                      if (supportsLossyCompression) {
                        updateOptions({ imageQuality: value });
                      } else {
                        updateOptions({
                          pngOptimizeLevel: value as SnapshotCaptureOptions['pngOptimizeLevel'],
                        });
                      }
                    }}
                  />
                </SnapshotField>
              </div>
            </SnapshotSection>

            <SnapshotSection title={compactLabels.scene}>
              <div className={settingsGridClassName}>
                <SnapshotField label={compactLabels.lighting}>
                  <PanelSelect
                    variant="snapshot"
                    value={environmentPreset}
                    options={environmentOptions}
                    disabled={isCapturing}
                    onChange={(event) =>
                      updateOptions({
                        environmentPreset: event.target
                          .value as SnapshotCaptureOptions['environmentPreset'],
                      })
                    }
                  />
                </SnapshotField>
                <SnapshotField label={compactLabels.background}>
                  <PanelSelect
                    variant="snapshot"
                    value={backgroundStyle}
                    options={backgroundOptions}
                    disabled={isCapturing}
                    onChange={(event) =>
                      updateOptions({
                        backgroundStyle: event.target
                          .value as SnapshotCaptureOptions['backgroundStyle'],
                      })
                    }
                  />
                </SnapshotField>
                <SnapshotField label={compactLabels.shadow}>
                  <PanelSelect
                    variant="snapshot"
                    value={shadowStyle}
                    options={shadowOptions}
                    disabled={isCapturing}
                    onChange={(event) =>
                      updateOptions({
                        shadowStyle: event.target.value as SnapshotCaptureOptions['shadowStyle'],
                      })
                    }
                  />
                </SnapshotField>
                <SnapshotField label={compactLabels.ground}>
                  <PanelSelect
                    variant="snapshot"
                    value={groundStyle}
                    options={groundOptions}
                    disabled={isCapturing}
                    onChange={(event) =>
                      updateOptions({
                        groundStyle: event.target.value as SnapshotCaptureOptions['groundStyle'],
                      })
                    }
                  />
                </SnapshotField>
                <SnapshotField label={compactLabels.grid}>
                  <CompactSwitch
                    checked={!hideGrid}
                    onChange={(checked) => updateOptions({ hideGrid: !checked })}
                    disabled={isCapturing}
                    ariaLabel={t.snapshotHideGrid}
                    className="w-full justify-start"
                  />
                </SnapshotField>
              </div>
            </SnapshotSection>

            <div data-testid="snapshot-preview-card" className={previewCardClassName}>
              <div
                className={`mb-1.5 flex shrink-0 gap-2 ${isCompactLayout ? 'flex-col items-start' : 'items-start justify-between'}`}
              >
                <div className="min-w-0">
                  <div className="text-[9px] font-semibold text-text-primary">
                    {t.snapshotPreviewTitle}
                  </div>
                </div>
                <div className="shrink-0 rounded-md border border-border-black bg-panel-bg px-1.5 py-0.5 text-[8px] font-medium text-text-secondary">
                  {previewStatusText}
                </div>
              </div>

              {/* shrink-0 is essential: the frame's height is aspect-ratio driven, so
                the wrapper must keep that exact height. Without it the default
                flex-shrink:1 compresses this row below the frame, and items-center
                then centers the oversized frame so it overflows onto the title and
                summary rows. Keeping the real height also lets the dialog's
                scrollHeight auto-sizing grow to fit instead of under-sizing. */}
              <div
                ref={previewFrameAreaRef}
                className="flex min-h-[130px] shrink-0 items-center justify-center"
              >
                <div
                  data-testid="snapshot-preview-frame-shell"
                  className="w-full"
                  style={{ maxWidth: `${previewFrameMaxWidth}px` }}
                >
                  <div
                    data-testid="snapshot-preview-frame"
                    className="w-full overflow-hidden rounded-lg border border-border-black bg-panel-bg"
                    style={{ aspectRatio: String(previewAspectRatio) }}
                  >
                    {previewSession ? (
                      <SnapshotPreviewRenderer
                        isOpen={isOpen}
                        lang={lang}
                        session={previewSession}
                        options={resolvedOptions}
                        onStateChange={setInternalPreviewState}
                        onCaptureActionChange={onPreviewCaptureActionChange}
                        className="h-full w-full"
                      />
                    ) : effectivePreviewState.imageUrl ? (
                      // The previous render stays visible while a new one is computed;
                      // the top-right status chip already signals "refreshing", so no
                      // on-image overlay is needed (it just clutters the preview).
                      <img
                        src={effectivePreviewState.imageUrl}
                        alt={t.snapshotPreviewAlt}
                        draggable={false}
                        className="h-full w-full object-contain"
                      />
                    ) : (
                      <div className="flex h-full min-h-[100px] items-center justify-center px-4 text-center text-[10px] text-text-secondary">
                        {effectivePreviewState.status === 'error'
                          ? t.snapshotPreviewFailed
                          : t.snapshotPreviewLoading}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div
                className={`mt-1.5 flex shrink-0 gap-2 text-[9px] text-text-secondary ${
                  isCompactLayout ? 'flex-col items-start' : 'items-start justify-between'
                }`}
              >
                <div className={`min-w-0 ${isCompactLayout ? 'break-words' : 'truncate'}`}>
                  {captureSummary}
                </div>
                {effectivePreviewState.status === 'error' ? (
                  <div
                    className={`text-[9px] text-danger ${isCompactLayout ? '' : 'shrink-0 text-right'}`}
                  >
                    {t.snapshotPreviewRetryingHint}
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          {isCapturing ? (
            <div
              data-testid="snapshot-export-progress"
              className="absolute inset-0 z-10 flex items-center justify-center bg-panel-bg/95 px-4 py-6 backdrop-blur-sm"
            >
              <div className="w-full max-w-[360px] rounded-lg border border-border-black bg-element-bg p-3 shadow-sm">
                <div className="mb-2 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[11px] font-semibold text-text-primary">
                      {t.snapshotProgressTitle}
                    </div>
                    <div className="mt-1 text-[10px] text-text-secondary">
                      {captureProgressLabel}
                    </div>
                  </div>
                  <div className="shrink-0 rounded-md border border-border-black bg-panel-bg px-1.5 py-0.5 text-[9px] font-medium text-text-secondary">
                    {captureProgressPercent}%
                  </div>
                </div>
                <div
                  role="progressbar"
                  aria-label={t.snapshotProgressTitle}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={captureProgressPercent}
                  className="h-2 overflow-hidden rounded-full border border-border-black bg-panel-bg"
                >
                  <div
                    className="h-full rounded-full bg-system-blue-solid transition-[width] duration-200"
                    style={{ width: `${captureProgressPercent}%` }}
                  />
                </div>
                <div className="mt-2 text-[9px] text-text-tertiary">
                  {t.snapshotProgressCancelHint}
                </div>
              </div>
            </div>
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
