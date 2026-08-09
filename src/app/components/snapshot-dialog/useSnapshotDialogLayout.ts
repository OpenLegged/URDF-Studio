import { useLayoutEffect, useRef, useState } from 'react';
import type { Dispatch, RefObject, SetStateAction } from 'react';

import {
  resolveSnapshotAspectRatio,
  type SnapshotAspectRatioPreset,
} from '@/shared/components/3d/scene/snapshotConfig';
import type { Language } from '@/shared/i18n';

export const SNAPSHOT_DIALOG_DEFAULT_SIZE = {
  width: 520,
  height: 590,
} as const;
export const SNAPSHOT_DIALOG_MIN_SIZE = {
  width: 320,
  height: 420,
} as const;
export const SNAPSHOT_DIALOG_VIEWPORT_MIN_SIZE = {
  width: 320,
  height: 320,
} as const;

export const SNAPSHOT_DIALOG_COMPACT_LAYOUT_WIDTH = 500;

const SNAPSHOT_DIALOG_HEADER_HEIGHT = 40;
const SNAPSHOT_DIALOG_VIEWPORT_MARGIN = 24;
const SNAPSHOT_DIALOG_VIEWPORT_MIN_HEIGHT = 320;
const SNAPSHOT_DIALOG_DESKTOP_MAX_HEIGHT = 660;
const SNAPSHOT_PREVIEW_MIN_WIDTH = 200;
// Horizontal chrome around the preview frame (scroll body padding + preview card
// padding + scrollbar slack). The frame fills the remaining card width instead of
// being capped at a fixed max, so the preview reads as the hero element.
const SNAPSHOT_PREVIEW_WIDTH_GUTTER = 52;
// Upper bound on the preview height so portrait/tall aspect ratios don't push the
// dialog past the viewport; landscape previews stay width-driven and fill the card.
const SNAPSHOT_PREVIEW_MAX_HEIGHT = 300;
const SNAPSHOT_PREVIEW_VIEWPORT_HEIGHT_RATIO = 0.38;

interface WindowSize {
  width: number;
  height: number;
}

interface PreviewLayoutState {
  status: string;
  imageUrl: string | null;
  aspectRatio: number;
}

interface UseSnapshotDialogLayoutParams {
  isOpen: boolean;
  isCapturing: boolean;
  lang: Language;
  dialogWidth: number;
  setDialogSize: Dispatch<SetStateAction<WindowSize>>;
  aspectRatioPreset: SnapshotAspectRatioPreset;
  previewSessionViewportAspectRatio: number | null;
  effectivePreviewState: PreviewLayoutState;
}

interface SnapshotDialogLayout {
  scrollBodyRef: RefObject<HTMLDivElement | null>;
  footerRef: RefObject<HTMLDivElement | null>;
  previewFrameAreaRef: RefObject<HTMLDivElement | null>;
  isCompactLayout: boolean;
  previewAspectRatio: number;
  previewFrameMaxWidth: number;
}

export const clampSnapshotDialogValue = (value: number, min: number, max: number) => {
  if (max < min) {
    return min;
  }
  return Math.max(min, Math.min(max, value));
};

function resolveSnapshotDialogHeight({
  scrollContentHeight,
  footerHeight,
  viewportHeight,
}: {
  scrollContentHeight: number;
  footerHeight: number;
  viewportHeight: number;
}) {
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
  return clampSnapshotDialogValue(naturalHeight, minHeight, adaptiveViewportLimit);
}

export function useSnapshotDialogLayout({
  isOpen,
  isCapturing,
  lang,
  dialogWidth,
  setDialogSize,
  aspectRatioPreset,
  previewSessionViewportAspectRatio,
  effectivePreviewState,
}: UseSnapshotDialogLayoutParams): SnapshotDialogLayout {
  const scrollBodyRef = useRef<HTMLDivElement | null>(null);
  const footerRef = useRef<HTMLDivElement | null>(null);
  const previewFrameAreaRef = useRef<HTMLDivElement | null>(null);
  const [previewFrameAreaWidth, setPreviewFrameAreaWidth] = useState<number | null>(null);
  const selectedPreviewAspectRatio =
    previewSessionViewportAspectRatio !== null
      ? resolveSnapshotAspectRatio(aspectRatioPreset, previewSessionViewportAspectRatio)
      : null;
  const previewAspectRatio =
    selectedPreviewAspectRatio ??
    (effectivePreviewState.aspectRatio > 0 ? effectivePreviewState.aspectRatio : 16 / 9);
  const fallbackPreviewAvailableWidth = Math.max(
    SNAPSHOT_PREVIEW_MIN_WIDTH,
    dialogWidth - SNAPSHOT_PREVIEW_WIDTH_GUTTER,
  );
  const previewAvailableWidth = previewFrameAreaWidth ?? fallbackPreviewAvailableWidth;
  const previewMaxHeight =
    typeof window !== 'undefined'
      ? clampSnapshotDialogValue(
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
  const previewFrameMaxWidth = clampSnapshotDialogValue(
    Math.min(previewAvailableWidth, previewHeightBoundedWidth),
    previewFrameMinWidth,
    previewAvailableWidth,
  );

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

    setDialogSize((currentSize) =>
      currentSize.height === nextHeight ? currentSize : { ...currentSize, height: nextHeight },
    );
  }, [
    aspectRatioPreset,
    effectivePreviewState.aspectRatio,
    effectivePreviewState.imageUrl,
    effectivePreviewState.status,
    isCapturing,
    isOpen,
    lang,
    previewSessionViewportAspectRatio,
    setDialogSize,
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
  }, [dialogWidth, isOpen]);

  return {
    scrollBodyRef,
    footerRef,
    previewFrameAreaRef,
    isCompactLayout: dialogWidth <= SNAPSHOT_DIALOG_COMPACT_LAYOUT_WIDTH,
    previewAspectRatio,
    previewFrameMaxWidth,
  };
}
