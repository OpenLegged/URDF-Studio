import type { AppToastState } from '../hooks/useAppShellState';
import { CLOSE_BUTTON_DANGER_TERTIARY_CLASS } from '@/shared/components/ui';

interface AppToastProps {
  toast: AppToastState;
  onClose: () => void;
}

function resolveToastPresentation(type: AppToastState['type']) {
  if (type === 'success') {
    return {
      badgeClassName: 'border border-success-border bg-success-soft text-success',
      iconPath: 'M5 13l4 4L19 7',
    };
  }

  if (type === 'error') {
    return {
      badgeClassName: 'border border-danger-border bg-danger-soft text-danger',
      iconPath:
        'M12 8v4m0 4h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z',
    };
  }

  return {
    badgeClassName: 'border border-system-blue/20 bg-system-blue/10 text-system-blue',
    iconPath: 'M12 8h.01M11 12h1v4h1m-1-13a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z',
  };
}

export function AppToast({ toast, onClose }: AppToastProps) {
  if (!toast.show) {
    return null;
  }

  const presentation = resolveToastPresentation(toast.type);

  return (
    <div className="fixed top-20 left-1/2 -translate-x-1/2 z-[200] animate-in fade-in slide-in-from-top-4 duration-300">
      <div
        className="flex max-w-[min(44rem,calc(100vw-2rem))] items-center gap-2.5 rounded-[1.75rem] border border-border-black bg-panel-bg px-3.5 py-2.5 shadow-2xl dark:shadow-black/40"
        role={toast.type === 'error' ? 'alert' : 'status'}
        aria-live={toast.type === 'error' ? 'assertive' : 'polite'}
        aria-atomic="true"
      >
        <div
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${presentation.badgeClassName}`}
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d={presentation.iconPath}
            />
          </svg>
        </div>
        <div className="flex min-h-6 min-w-0 flex-1 items-center whitespace-pre-line break-words text-[15px] font-semibold leading-5 text-text-primary">
          {toast.message}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close notification"
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-system-blue/30 ${CLOSE_BUTTON_DANGER_TERTIARY_CLASS}`}
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}
