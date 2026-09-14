import { useCallback, useEffect, useRef, useState } from 'react';

export interface AppToastState {
  show: boolean;
  message: string;
  type: 'info' | 'success' | 'error';
}

export interface AppViewConfig {
  showOptionsPanel: boolean;
  showJointPanel: boolean;
  showStructureGraph: boolean;
}

const DEFAULT_TOAST_STATE: AppToastState = {
  show: false,
  message: '',
  type: 'info',
};

const DEFAULT_VIEW_CONFIG: AppViewConfig = {
  showOptionsPanel: true,
  showJointPanel: true,
  showStructureGraph: false,
};

export function useAppShellState() {
  const [toast, setToast] = useState<AppToastState>(DEFAULT_TOAST_STATE);
  const [isAboutOpen, setIsAboutOpen] = useState(false);
  const [isCodeViewerOpen, setIsCodeViewerOpen] = useState(false);
  const [viewConfig, setViewConfig] = useState<AppViewConfig>(DEFAULT_VIEW_CONFIG);

  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((message: string, type: 'info' | 'success' | 'error' = 'info') => {
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
    }

    setToast({ show: true, message, type });
    toastTimerRef.current = setTimeout(() => {
      setToast((prev) => ({ ...prev, show: false }));
    }, 5000);
  }, []);

  const closeToast = useCallback(() => {
    setToast((prev) => ({ ...prev, show: false }));
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  return {
    toast,
    setToast,
    closeToast,
    showToast,
    isAboutOpen,
    setIsAboutOpen,
    isCodeViewerOpen,
    setIsCodeViewerOpen,
    viewConfig,
    setViewConfig,
  };
}
