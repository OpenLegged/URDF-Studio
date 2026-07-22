import { useCallback, useRef } from 'react';

interface UseSourceCodeEditorWarmupParams {
  isSelectedUsdHydrating: boolean;
  setIsCodeViewerOpen: (open: boolean) => void;
  showToast: (message: string, type?: 'info' | 'success') => void;
  usdLoadInProgressMessage: string;
  preloadRuntime: () => Promise<void>;
  onPreloadError?: (error: unknown) => void;
}

export function useSourceCodeEditorWarmup({
  isSelectedUsdHydrating,
  setIsCodeViewerOpen,
  showToast,
  usdLoadInProgressMessage,
  preloadRuntime,
  onPreloadError,
}: UseSourceCodeEditorWarmupParams) {
  const sourceCodeEditorRuntimeWarmupPromiseRef = useRef<Promise<void> | null>(null);

  const warmSourceCodeEditorRuntime = useCallback(() => {
    if (!sourceCodeEditorRuntimeWarmupPromiseRef.current) {
      sourceCodeEditorRuntimeWarmupPromiseRef.current = preloadRuntime().catch((error) => {
        sourceCodeEditorRuntimeWarmupPromiseRef.current = null;
        onPreloadError?.(error);
      });
    }

    return sourceCodeEditorRuntimeWarmupPromiseRef.current;
  }, [onPreloadError, preloadRuntime]);

  const handleOpenCodeViewer = useCallback(() => {
    if (isSelectedUsdHydrating) {
      showToast(usdLoadInProgressMessage, 'info');
      return;
    }

    void warmSourceCodeEditorRuntime();
    setIsCodeViewerOpen(true);
  }, [
    isSelectedUsdHydrating,
    setIsCodeViewerOpen,
    showToast,
    usdLoadInProgressMessage,
    warmSourceCodeEditorRuntime,
  ]);

  const handlePrefetchCodeViewer = useCallback(() => {
    void warmSourceCodeEditorRuntime();
  }, [warmSourceCodeEditorRuntime]);

  return {
    warmSourceCodeEditorRuntime,
    handleOpenCodeViewer,
    handlePrefetchCodeViewer,
  };
}
