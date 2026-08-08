import { useEffect, useRef } from 'react';
import type { InteractionSelection } from '@/types';

interface UseExternalHoverHighlightSyncOptions {
  hoveredSelection: InteractionSelection | undefined;
  hoverSelectionEnabled: boolean;
  syncHoverHighlight: (hoveredSelection?: InteractionSelection) => void;
}

/** Keeps the renderer highlight aligned with an externally owned hover selection. */
export function useExternalHoverHighlightSync({
  hoveredSelection,
  hoverSelectionEnabled,
  syncHoverHighlight,
}: UseExternalHoverHighlightSyncOptions) {
  const usesExternalHoverSelection = hoveredSelection !== undefined;
  const previousUsesExternalHoverSelectionRef = useRef(usesExternalHoverSelection);
  const hoveredSelectionRef = useRef(hoveredSelection);
  hoveredSelectionRef.current = hoveredSelection;

  useEffect(() => {
    const usedExternalHoverSelection = previousUsesExternalHoverSelectionRef.current;
    previousUsesExternalHoverSelectionRef.current = usesExternalHoverSelection;

    if (!usesExternalHoverSelection && usedExternalHoverSelection) {
      syncHoverHighlight(undefined);
    }
  }, [syncHoverHighlight, usesExternalHoverSelection]);

  useEffect(() => {
    if (!usesExternalHoverSelection) {
      return;
    }

    syncHoverHighlight(hoverSelectionEnabled ? hoveredSelectionRef.current : undefined);
  }, [
    hoverSelectionEnabled,
    hoveredSelection?.type,
    hoveredSelection?.id,
    hoveredSelection?.subType,
    hoveredSelection?.objectIndex,
    hoveredSelection?.helperKind,
    hoveredSelection?.highlightObjectId,
    syncHoverHighlight,
    usesExternalHoverSelection,
  ]);
}
