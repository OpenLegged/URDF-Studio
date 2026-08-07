import { useEffect, useState } from 'react';

interface LazyOverlayFallbackProps {
  label: string;
  detail?: string;
  delayMs?: number;
}

export function LazyOverlayFallback({ label, detail, delayMs = 150 }: LazyOverlayFallbackProps) {
  const [isVisible, setIsVisible] = useState(delayMs <= 0);

  useEffect(() => {
    if (delayMs <= 0) {
      setIsVisible(true);
      return;
    }

    setIsVisible(false);
    const timerId = window.setTimeout(() => {
      setIsVisible(true);
    }, delayMs);

    return () => {
      window.clearTimeout(timerId);
    };
  }, [delayMs]);

  if (!isVisible) {
    return null;
  }

  return (
    <div className="pointer-events-none fixed inset-0 z-[160] flex items-center justify-center">
      <div
        role="status"
        aria-live="polite"
        className={`flex flex-col gap-2 rounded-xl border border-border-black bg-panel-bg px-4 py-3 text-sm font-medium text-text-primary shadow-xl ${
          detail ? 'w-[min(22rem,calc(100vw-2rem))]' : 'max-w-md'
        }`}
      >
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-system-blue" />
          <span>{label}</span>
        </div>
        {detail ? (
          <p className="max-w-[19rem] pl-[18px] text-sm leading-5 font-normal text-text-secondary text-pretty">
            {detail}
          </p>
        ) : null}
      </div>
    </div>
  );
}
