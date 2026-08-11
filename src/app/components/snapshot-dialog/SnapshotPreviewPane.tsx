import type { RefObject } from 'react';

import {
  type SnapshotCaptureAction,
  type SnapshotCaptureOptions,
} from '@/shared/components/3d/scene/snapshotConfig';
import type { Language, TranslationKeys } from '@/shared/i18n';

import { SnapshotPreviewRenderer } from '../snapshot-preview/SnapshotPreviewRenderer';
import type { SnapshotDialogPreviewState, SnapshotPreviewSession } from '../snapshot-preview/types';

interface SnapshotPreviewPaneProps {
  isOpen: boolean;
  lang: Language;
  t: TranslationKeys;
  isCompactLayout: boolean;
  previewFrameAreaRef: RefObject<HTMLDivElement | null>;
  previewFrameMaxWidth: number;
  previewAspectRatio: number;
  previewStatusText: string;
  captureSummary: string;
  previewSession: SnapshotPreviewSession | null;
  effectivePreviewState: SnapshotDialogPreviewState;
  options: SnapshotCaptureOptions;
  onInternalPreviewStateChange: (state: SnapshotDialogPreviewState) => void;
  onPreviewCaptureActionChange?: (action: SnapshotCaptureAction | null) => void;
}

export function SnapshotPreviewPane({
  isOpen,
  lang,
  t,
  isCompactLayout,
  previewFrameAreaRef,
  previewFrameMaxWidth,
  previewAspectRatio,
  previewStatusText,
  captureSummary,
  previewSession,
  effectivePreviewState,
  options,
  onInternalPreviewStateChange,
  onPreviewCaptureActionChange,
}: SnapshotPreviewPaneProps) {
  const previewCardClassName = `flex shrink-0 flex-col rounded-lg border border-border-black bg-element-bg px-2.5 py-1.5 shadow-sm ${
    isCompactLayout ? 'min-h-[190px]' : 'min-h-[220px]'
  }`;

  return (
    <div data-testid="snapshot-preview-card" className={previewCardClassName}>
      <div
        className={`mb-1.5 flex shrink-0 gap-2 ${
          isCompactLayout ? 'flex-col items-start' : 'items-start justify-between'
        }`}
      >
        <div className="min-w-0">
          <div className="text-[9px] font-semibold text-text-primary">{t.snapshotPreviewTitle}</div>
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
                options={options}
                onStateChange={onInternalPreviewStateChange}
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
          <div className={`text-[9px] text-danger ${isCompactLayout ? '' : 'shrink-0 text-right'}`}>
            {t.snapshotPreviewRetryingHint}
          </div>
        ) : null}
      </div>
    </div>
  );
}
