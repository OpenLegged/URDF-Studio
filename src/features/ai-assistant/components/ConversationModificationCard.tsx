import { useState } from 'react';
import { Check, Loader2, Wand2, X } from 'lucide-react';
import type { TranslationKeys } from '@/shared/i18n';
import { ConversationMessageMarkdown } from './ConversationMessageMarkdown';
import type { AIConversationModificationCard } from '../types';

interface ConversationModificationCardProps {
  card: AIConversationModificationCard;
  t: TranslationKeys;
  onApply: (componentId: string, proposedUrdf: string) => boolean;
  onDismiss: (proposedUrdf: string) => void;
}

type DiffLineType = 'unchanged' | 'added' | 'removed';
interface DiffLine {
  type: DiffLineType;
  text: string;
}

/**
 * Minimal LCS line diff. URDF sources are small enough that the O(m*n) table is
 * fine, and avoiding an extra dependency keeps the chat bubble lightweight.
 */
function diffLines(currentText: string, proposedText: string): DiffLine[] {
  const a = currentText.split('\n');
  const b = proposedText.split('\n');
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i -= 1) {
    for (let j = n - 1; j >= 0; j -= 1) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      out.push({ type: 'unchanged', text: a[i] });
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ type: 'removed', text: a[i] });
      i += 1;
    } else {
      out.push({ type: 'added', text: b[j] });
      j += 1;
    }
  }
  while (i < m) {
    out.push({ type: 'removed', text: a[i] });
    i += 1;
  }
  while (j < n) {
    out.push({ type: 'added', text: b[j] });
    j += 1;
  }
  return out;
}

export function ConversationModificationCard({
  card,
  t,
  onApply,
  onDismiss,
}: ConversationModificationCardProps) {
  const [applying, setApplying] = useState(false);
  const applied = card.status === 'applied';

  if (card.status === 'dismissed') {
    return null;
  }

  const handleApply = () => {
    if (applying || applied) {
      return;
    }
    setApplying(true);
    onApply(card.componentId, card.proposedUrdf);
    setApplying(false);
  };

  const diff = diffLines(card.currentUrdf, card.proposedUrdf);
  const addedCount = diff.filter((line) => line.type === 'added').length;
  const removedCount = diff.filter((line) => line.type === 'removed').length;

  return (
    <div className="rounded-xl border border-border-black bg-panel-bg shadow-sm dark:bg-element-bg">
      <div className="flex items-center gap-2 border-b border-border-black bg-element-bg px-3 py-2">
        <div className="rounded-lg border border-system-blue/20 bg-system-blue/10 p-1 text-system-blue">
          <Wand2 className="h-3.5 w-3.5" />
        </div>
        <span className="text-xs font-semibold text-text-primary">{t.aiModificationTitle}</span>
        <span className="ml-auto text-[10px] font-medium text-text-tertiary">
          <span className="text-system-green">+{addedCount}</span>
          {'  '}
          <span className="text-danger">-{removedCount}</span>
        </span>
      </div>

      {card.explanation && (
        <div className="border-b border-border-black px-3 py-2 text-sm text-text-secondary">
          <ConversationMessageMarkdown content={card.explanation} tone="assistant" />
        </div>
      )}

      <div className="max-h-64 overflow-auto custom-scrollbar bg-panel-bg/60 font-mono text-[11px] leading-relaxed dark:bg-panel-bg/40">
        {diff.map((line, index) => (
          <div
            key={index}
            className={`flex whitespace-pre ${
              line.type === 'added'
                ? 'bg-system-green/10 text-system-green'
                : line.type === 'removed'
                  ? 'bg-danger/10 text-danger'
                  : 'text-text-tertiary'
            }`}
          >
            <span className="w-6 shrink-0 select-none px-2 text-center opacity-70">
              {line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' '}
            </span>
            <span className="pr-3">{line.text || ' '}</span>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-border-black bg-element-bg px-3 py-2">
        {applied ? (
          <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-system-green">
            <Check className="h-3.5 w-3.5" />
            {t.aiModificationApplied}
            <span className="text-text-tertiary">· {t.aiModificationUndoHint}</span>
          </span>
        ) : (
          <>
            <button
              type="button"
              onClick={() => onDismiss(card.proposedUrdf)}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border-black bg-panel-bg px-3 text-xs font-semibold text-text-secondary transition-colors hover:bg-element-hover"
            >
              <X className="h-3.5 w-3.5" />
              {t.aiModificationDismiss}
            </button>
            <button
              type="button"
              onClick={handleApply}
              disabled={applying}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-system-blue-solid px-4 text-xs font-semibold text-white transition-colors hover:bg-system-blue-hover disabled:opacity-50"
            >
              {applying ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Check className="h-3.5 w-3.5" />
              )}
              {t.aiModificationApply}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default ConversationModificationCard;
