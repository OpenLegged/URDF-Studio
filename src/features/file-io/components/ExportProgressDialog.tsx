import React from 'react';
import { Briefcase } from 'lucide-react';

import {
  DraggableWindow,
  FLOATING_WINDOW_HEADER_HEIGHT_CLASS,
  FLOATING_WINDOW_RADIUS_CLASS,
  FLOATING_WINDOW_TITLE_CLASS,
} from '@/shared/components/DraggableWindow';
import { useDraggableWindow } from '@/shared/hooks/useDraggableWindow';
import { translations, type Language } from '@/shared/i18n';
import { useManagedWindowLayer } from '@/store';

import type { ExportProgressState } from '../types';
import { ExportProgressView } from './ExportProgressView';

interface ExportProgressDialogProps {
  lang: Language;
  progress: ExportProgressState;
}

export function ExportProgressDialog({ lang, progress }: ExportProgressDialogProps) {
  const t = translations[lang];
  const exportProgressWindowLayer = useManagedWindowLayer('exportProgress');
  const windowState = useDraggableWindow({
    defaultSize: { width: 560, height: 540 },
    minSize: { width: 480, height: 420 },
    centerOnMount: true,
    enableMinimize: false,
    enableMaximize: false,
  });

  return (
    <DraggableWindow
      window={windowState}
      onClose={() => {}}
      title={
        <div className="flex items-center gap-2">
          <div className="rounded-md border border-border-black bg-element-bg p-1 text-text-secondary">
            <Briefcase className="h-3.5 w-3.5" />
          </div>
          <span className={FLOATING_WINDOW_TITLE_CLASS}>{t.exportProject}</span>
        </div>
      }
      className={`flex flex-col overflow-hidden ${FLOATING_WINDOW_RADIUS_CLASS} border border-border-black bg-panel-bg text-text-primary shadow-xl`}
      zIndex={exportProgressWindowLayer.zIndex}
      onActivate={exportProgressWindowLayer.onActivate}
      headerClassName={`flex ${FLOATING_WINDOW_HEADER_HEIGHT_CLASS} shrink-0 items-center justify-between border-b border-border-black bg-element-bg px-3`}
      interactionClassName="select-none"
      showMinimizeButton={false}
      showMaximizeButton={false}
      showCloseButton={false}
      showResizeHandles={false}
    >
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4">
        <ExportProgressView progress={progress} t={t} />
      </div>
    </DraggableWindow>
  );
}
