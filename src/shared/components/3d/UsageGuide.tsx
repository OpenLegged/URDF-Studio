import React, { useEffect, useState } from 'react';
import { CircleHelp, X } from 'lucide-react';
import { translations, Language } from '@/shared/i18n';
import { CLOSE_BUTTON_DANGER_TERTIARY_CLASS } from '@/shared/components/ui';

interface UsageGuideProps {
  lang: Language;
}

export const UsageGuide: React.FC<UsageGuideProps> = ({ lang }) => {
  const [detectedOS, setDetectedOS] = useState<'mac' | 'windows' | 'linux' | 'other'>('other');
  const [isVisible, setIsVisible] = useState(true);
  const t = translations[lang];

  useEffect(() => {
    const detectOS = (): 'mac' | 'windows' | 'linux' | 'other' => {
      if (typeof navigator === 'undefined') return 'other';

      const userAgent = navigator.userAgent || '';
      const userAgentDataPlatform =
        (
          navigator as Navigator & {
            userAgentData?: { platform?: string };
          }
        ).userAgentData?.platform || '';

      const raw = `${userAgent} ${userAgentDataPlatform}`.toLowerCase();

      if (raw.includes('mac') || raw.includes('darwin')) return 'mac';
      if (raw.includes('win')) return 'windows';
      if (raw.includes('linux') || raw.includes('x11') || raw.includes('cros')) return 'linux';
      return 'other';
    };

    setDetectedOS(detectOS());
  }, []);

  const instructionText = (() => {
    switch (detectedOS) {
      case 'mac':
        return t.instructionMac;
      case 'windows':
        return t.instructionWin;
      case 'linux':
        return t.instructionLinux;
      default:
        return t.instructionOther;
    }
  })();

  if (!isVisible) {
    return (
      <div className="pointer-events-none absolute bottom-[calc(4.25rem+env(safe-area-inset-bottom))] left-4 z-20 select-none sm:bottom-4">
        <button
          type="button"
          className="pointer-events-auto inline-flex h-7 w-7 items-center justify-center rounded-full border border-border-black bg-panel-bg text-text-secondary shadow-sm transition-colors hover:bg-element-hover hover:text-text-primary"
          onClick={() => setIsVisible(true)}
          title={t.showUsageGuide}
          aria-label={t.showUsageGuide}
        >
          <CircleHelp className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div className="pointer-events-none absolute bottom-[calc(4.25rem+env(safe-area-inset-bottom))] left-1/2 z-20 -translate-x-1/2 select-none sm:bottom-4">
      <div className="pointer-events-auto flex items-center gap-1.5 rounded-full border border-border-black/60 bg-panel-bg/75 px-2.5 py-1 text-[10px] font-medium leading-none text-text-secondary shadow-sm backdrop-blur sm:text-[11px]">
        <span className="max-w-[70vw] truncate sm:max-w-none">{instructionText}</span>
        <button
          type="button"
          className={`inline-flex h-4 w-4 items-center justify-center rounded-full ${CLOSE_BUTTON_DANGER_TERTIARY_CLASS}`}
          onClick={() => setIsVisible(false)}
          title={t.hideUsageGuide}
          aria-label={t.hideUsageGuide}
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
};
