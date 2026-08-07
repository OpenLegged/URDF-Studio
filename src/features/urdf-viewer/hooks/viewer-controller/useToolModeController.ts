import { useCallback, useMemo, useRef, useState } from 'react';
import type {
  MeasureAnchorMode,
  MeasureMode,
  MeasurePoseRepresentation,
  MeasureState,
  ToolMode,
  ViewerPaintOperation,
  ViewerPaintInteractionState,
  ViewerPaintSelectionScope,
  ViewerPaintStatus,
} from '../../types';
import { createEmptyMeasureState, setMeasureMode as applyMeasureMode } from '../../utils/measurements';
import { createScopedToolModeState, resolveScopedToolModeState } from '../../utils/scopedToolMode';

interface UseToolModeControllerParams {
  defaultToolMode: ToolMode;
  toolModeScopeKey: string | null;
}

export function useToolModeController({
  defaultToolMode,
  toolModeScopeKey,
}: UseToolModeControllerParams) {
  const normalizedToolModeScopeKey = toolModeScopeKey ?? null;
  const [toolModeState, setToolModeState] = useState(() =>
    createScopedToolModeState(normalizedToolModeScopeKey, defaultToolMode),
  );
  const resolvedToolModeState = useMemo(
    () => resolveScopedToolModeState(toolModeState, normalizedToolModeScopeKey, defaultToolMode),
    [defaultToolMode, normalizedToolModeScopeKey, toolModeState],
  );
  const toolMode = resolvedToolModeState.mode;
  const [measureState, setMeasureState] = useState<MeasureState>(createEmptyMeasureState);
  const setMeasureMode = useCallback(
    (mode: MeasureMode) => setMeasureState((prev) => applyMeasureMode(prev, mode)),
    [],
  );
  const [measureAnchorMode, setMeasureAnchorMode] = useState<MeasureAnchorMode>('frame');
  const [showMeasureDecomposition, setShowMeasureDecomposition] = useState(false);
  const [measurePoseRepresentation, setMeasurePoseRepresentation] =
    useState<MeasurePoseRepresentation>('matrix');
  const [paintColor, setPaintColor] = useState('#ff6c0a');
  const [paintSelectionScope, setPaintSelectionScope] =
    useState<ViewerPaintSelectionScope>('island');
  const [paintOperation, setPaintOperation] = useState<ViewerPaintOperation>('paint');
  const [paintStatus, setPaintStatus] = useState<ViewerPaintStatus | null>(null);
  const paintInteractionRef = useRef<ViewerPaintInteractionState>({
    color: paintColor,
    operation: paintOperation,
    selectionScope: paintSelectionScope,
  });
  paintInteractionRef.current = {
    color: paintColor,
    operation: paintOperation,
    selectionScope: paintSelectionScope,
  };
  const transformMode = (
    ['translate', 'rotate', 'universal'].includes(toolMode) ? toolMode : 'select'
  ) as 'select' | 'translate' | 'rotate' | 'universal';

  return {
    normalizedToolModeScopeKey,
    toolModeState,
    setToolModeState,
    resolvedToolModeState,
    toolMode,
    transformMode,
    measureState,
    setMeasureState,
    setMeasureMode,
    measureAnchorMode,
    setMeasureAnchorMode,
    showMeasureDecomposition,
    setShowMeasureDecomposition,
    measurePoseRepresentation,
    setMeasurePoseRepresentation,
    paintColor,
    setPaintColor,
    paintSelectionScope,
    setPaintSelectionScope,
    paintOperation,
    setPaintOperation,
    paintInteractionRef,
    paintStatus,
    setPaintStatus,
  };
}
