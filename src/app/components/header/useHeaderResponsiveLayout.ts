import { useEffect, useMemo, useState } from 'react';
import type { RefObject } from 'react';
import type { HeaderResponsiveLayout } from './types';

interface HeaderResponsiveLayoutOptions {
  hasQuickAction: boolean;
  hasSecondaryAction: boolean;
}

const OPTIONAL_ACTION_WIDTH_BONUS = 96;
const CENTER_TOOLBAR_MEDIUM_WIDTH_PENALTY = 160;
const CENTER_TOOLBAR_COMPACT_WIDTH_PENALTY = 240;
// Reserve room for the persistent trailing actions and the larger 32px controls.
const PERSISTENT_ACTION_WIDTH_PENALTY = 32;

function resolveCenterToolbarWidthPenalty(width: number) {
  if (width >= 1440) {
    return 0;
  }

  if (width >= 1280) {
    return CENTER_TOOLBAR_MEDIUM_WIDTH_PENALTY;
  }

  return CENTER_TOOLBAR_COMPACT_WIDTH_PENALTY;
}

export function getHeaderResponsiveLayout(
  width: number,
  { hasQuickAction, hasSecondaryAction }: HeaderResponsiveLayoutOptions,
): HeaderResponsiveLayout {
  // The header now permanently hosts the mode toolbar in the center. Reserve
  // space for that cluster before deciding how many left/right controls remain inline.
  const centerToolbarWidthPenalty = resolveCenterToolbarWidthPenalty(width);

  // When optional header actions are absent, reclaim some of that space so desktop
  // layouts can keep more controls inline before collapsing into overflow.
  const effectiveWidth =
    width -
    centerToolbarWidthPenalty +
    (hasQuickAction ? 0 : OPTIONAL_ACTION_WIDTH_BONUS) +
    (hasSecondaryAction ? 0 : OPTIONAL_ACTION_WIDTH_BONUS) -
    PERSISTENT_ACTION_WIDTH_PENALTY;

  const showMenuLabels = effectiveWidth >= 1080;
  const showSourceInline = effectiveWidth >= 1120;
  const showSourceText = effectiveWidth >= 1280;
  const showUndoRedoInline = effectiveWidth >= 1400;
  const showQuickActionInline = effectiveWidth >= 720;
  const showQuickActionLabel = effectiveWidth >= 1360;
  const showSnapshotInline = effectiveWidth >= 1024;
  const showSettingsInline = true;
  const showLanguageInline = effectiveWidth >= 900;
  const showThemeInline = effectiveWidth >= 840;
  const showSecondaryActionInline = true;
  const showSecondaryActionLabel = width >= 1100;

  return {
    isDesktop: width >= 640,
    showMenuLabels,
    showSourceInline,
    showSourceText,
    showUndoRedoInline,
    showQuickActionInline,
    showQuickActionLabel,
    showSnapshotInline,
    showSettingsInline,
    showLanguageInline,
    showThemeInline,
    showSecondaryActionInline,
    showSecondaryActionLabel,
    showDesktopOverflow:
      width >= 640 &&
      (!showQuickActionInline ||
        !showSourceInline ||
        !showUndoRedoInline ||
        !showSnapshotInline ||
        !showSettingsInline ||
        !showLanguageInline ||
        !showThemeInline ||
        !showSecondaryActionInline),
  };
}

export function useHeaderResponsiveLayout(
  headerRef: RefObject<HTMLElement | null>,
  options: HeaderResponsiveLayoutOptions,
): HeaderResponsiveLayout {
  const [headerWidth, setHeaderWidth] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth : 0,
  );

  useEffect(() => {
    const node = headerRef.current;

    if (!node || typeof ResizeObserver === 'undefined') {
      return;
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      const nextWidth = Math.round(entry?.borderBoxSize?.[0]?.inlineSize ?? node.clientWidth);
      setHeaderWidth((prevWidth) => (prevWidth === nextWidth ? prevWidth : nextWidth));
    });

    observer.observe(node);

    return () => {
      observer.disconnect();
    };
  }, [headerRef]);

  return useMemo(() => getHeaderResponsiveLayout(headerWidth, options), [headerWidth, options]);
}
