import { Redo, Undo } from 'lucide-react';
import { IconButton } from '@/shared/components/ui';
import type { HistoryActions } from '../../hooks/useActiveHistory';
import type { HeaderTranslations } from './types';

export function HeaderHistoryButtons({ undo, redo, canUndo, canRedo, t }: HistoryActions & { t: HeaderTranslations }) {
  return (
    <>
      <div className="w-px h-5 bg-border-black mx-1.5 hidden sm:block" />

      <div className="items-center gap-0.5 hidden sm:flex">
        <IconButton
          type="button"
          onClick={undo}
          disabled={!canUndo}
          data-testid="history-undo"
          variant="ghost"
          size="sm"
          title={`${t.undo} (Ctrl+Z)`}
          aria-label={t.undo}
        >
          <Undo className="w-4 h-4" />
        </IconButton>
        <IconButton
          type="button"
          onClick={redo}
          disabled={!canRedo}
          data-testid="history-redo"
          variant="ghost"
          size="sm"
          title={`${t.redo} (Ctrl+Shift+Z)`}
          aria-label={t.redo}
        >
          <Redo className="w-4 h-4" />
        </IconButton>
      </div>
    </>
  );
}
