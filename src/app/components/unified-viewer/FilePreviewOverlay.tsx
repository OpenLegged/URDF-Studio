import React, { useEffect } from 'react';
import { AlertCircle, FileCode, X } from 'lucide-react';

import type { Language } from '@/shared/i18n';
import { translations } from '@/shared/i18n';
import { CLOSE_BUTTON_DANGER_TERTIARY_CLASS } from '@/shared/components/ui';
import { useOverlayHoverBlock } from '@/shared/hooks/useOverlayHoverBlock';

export function FilePreviewBanner({
  fileName,
  onClose,
  lang,
}: {
  fileName: string;
  onClose: () => void;
  lang: Language;
}) {
  const t = translations[lang];
  const displayName = fileName.split('/').pop() ?? fileName;
  const { activateHoverBlock, deactivateHoverBlock } = useOverlayHoverBlock();

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  return (
    <div
      className="absolute top-3 left-1/2 z-30 flex -translate-x-1/2 items-center gap-2 rounded-lg border border-border-black bg-panel-bg px-3 py-2 shadow-lg"
      onMouseEnter={activateHoverBlock}
      onMouseLeave={deactivateHoverBlock}
    >
      <FileCode className="h-4 w-4 shrink-0 text-system-blue" />
      <span
        className="max-w-[320px] truncate text-sm font-medium text-text-primary"
        title={fileName}
      >
        {t.filePreview}: {displayName}
      </span>
      <button
        onClick={onClose}
        className={`ml-1 rounded p-0.5 ${CLOSE_BUTTON_DANGER_TERTIARY_CLASS}`}
        title={t.closePreview}
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

export function FilePreviewError({ lang }: { lang: Language }) {
  const t = translations[lang];
  return (
    <div className="pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 text-text-tertiary">
      <AlertCircle className="h-5 w-5" />
      <span className="text-sm">{t.noPreviewImage}</span>
    </div>
  );
}
