import { useState } from 'react';
import { Check, ChevronDown, ChevronRight, Loader2, Wand2, X } from 'lucide-react';
import type { TranslationKeys } from '@/shared/i18n';
import { ConversationMessageMarkdown } from './ConversationMessageMarkdown';
import type { AIConversationModificationCard } from '../types';

interface ConversationModificationCardProps {
  card: AIConversationModificationCard;
  t: TranslationKeys;
  onApply: (componentId: string, proposedUrdf: string) => boolean;
  onDismiss: (proposedUrdf: string) => void;
}

type DiffLineType = 'unchanged' | 'added' | 'removed' | 'collapsed';
interface DiffLine {
  type: DiffLineType;
  text: string;
  collapsedCount?: number;
}

const CONTEXT_LINES = 3;
const COLLAPSE_THRESHOLD = 6;

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
  const raw: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      raw.push({ type: 'unchanged', text: a[i] });
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      raw.push({ type: 'removed', text: a[i] });
      i += 1;
    } else {
      raw.push({ type: 'added', text: b[j] });
      j += 1;
    }
  }
  while (i < m) {
    raw.push({ type: 'removed', text: a[i] });
    i += 1;
  }
  while (j < n) {
    raw.push({ type: 'added', text: b[j] });
    j += 1;
  }
  return collapseUnchangedRuns(raw);
}

function collapseUnchangedRuns(lines: DiffLine[]): DiffLine[] {
  const out: DiffLine[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.type !== 'unchanged') {
      out.push(line);
      i += 1;
      continue;
    }
    const runStart = i;
    while (i < lines.length && lines[i].type === 'unchanged') {
      i += 1;
    }
    const runEnd = i;
    const runLength = runEnd - runStart;
    if (runLength <= COLLAPSE_THRESHOLD) {
      for (let k = runStart; k < runEnd; k += 1) {
        out.push(lines[k]);
      }
      continue;
    }
    for (let k = runStart; k < runStart + CONTEXT_LINES && k < runEnd; k += 1) {
      out.push(lines[k]);
    }
    const collapsedCount = runLength - CONTEXT_LINES * 2;
    if (collapsedCount > 0) {
      out.push({ type: 'collapsed', text: '', collapsedCount });
    }
    for (let k = Math.max(runStart + CONTEXT_LINES, runEnd - CONTEXT_LINES); k < runEnd; k += 1) {
      out.push(lines[k]);
    }
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
  const [expandedSections, setExpandedSections] = useState<Set<number>>(new Set());
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

  const toggleSection = (index: number) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  const diff = diffLines(card.currentUrdf, card.proposedUrdf);
  const addedCount = diff.filter((line) => line.type === 'added').length;
  const removedCount = diff.filter((line) => line.type === 'removed').length;
  const hasCollapsedSections = diff.some((line) => line.type === 'collapsed');

  return (
    <div className="rounded-xl border border-border-black bg-panel-bg shadow-sm dark:bg-element-bg">
      <div className="flex items-center gap-2 border-b border-border-black bg-element-bg px-2 py-1.5">
        <div className="rounded-lg border border-system-blue/20 bg-system-blue/10 p-0.5 text-system-blue">
          <Wand2 className="h-3 w-3" />
        </div>
        <span className="text-[11px] font-semibold text-text-primary">{t.aiModificationTitle}</span>
        <span className="ml-auto text-[9px] font-medium text-text-tertiary">
          <span className="text-system-green">+{addedCount}</span>
          {'  '}
          <span className="text-danger">-{removedCount}</span>
        </span>
      </div>

      {card.explanation && (
        <div className="border-b border-border-black px-2 py-1.5 text-xs text-text-secondary">
          <ConversationMessageMarkdown content={card.explanation} tone="assistant" />
        </div>
      )}

      <div className="max-h-56 overflow-auto custom-scrollbar bg-panel-bg/60 font-mono text-[10px] leading-relaxed dark:bg-panel-bg/40">
        {diff.map((line, index) => {
          if (line.type === 'collapsed') {
            const isExpanded = expandedSections.has(index);
            return (
              <button
                key={index}
                type="button"
                className="flex w-full cursor-pointer items-center gap-1 border-y border-border-black/30 bg-element-bg/50 px-1.5 py-0.5 text-left text-text-tertiary hover:bg-element-hover"
                onClick={() => toggleSection(index)}
              >
                {isExpanded ? (
                  <ChevronDown className="h-2.5 w-2.5" />
                ) : (
                  <ChevronRight className="h-2.5 w-2.5" />
                )}
                <span className="text-[9px]">
                  {t.aiDiffCollapsedLines.replace('{count}', String(line.collapsedCount))}
                </span>
              </button>
            );
          }

          return (
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
          );
        })}
      </div>

      {hasCollapsedSections && (
        <div className="border-t border-border-black bg-element-bg/50 px-2 py-1 text-[9px] text-text-tertiary">
          {t.aiDiffCollapsedHint}
        </div>
      )}

      <div className="flex items-center justify-end gap-2 border-t border-border-black bg-element-bg px-2 py-1.5">
        {applied ? (
          <span className="inline-flex items-center gap-1.5 text-[10px] font-medium text-system-green">
            <Check className="h-3 w-3" />
            {t.aiModificationApplied}
            <span className="text-text-tertiary">· {t.aiModificationUndoHint}</span>
          </span>
        ) : (
          <>
            <button
              type="button"
              onClick={() => onDismiss(card.proposedUrdf)}
              className="inline-flex h-6 items-center gap-1 rounded-lg border border-border-black bg-panel-bg px-2 text-[11px] font-semibold text-text-secondary transition-colors hover:bg-element-hover"
            >
              <X className="h-3 w-3" />
              {t.aiModificationDismiss}
            </button>
            <button
              type="button"
              onClick={handleApply}
              disabled={applying}
              className="inline-flex h-6 items-center gap-1 rounded-lg bg-system-blue-solid px-2.5 text-[11px] font-semibold text-white transition-colors hover:bg-system-blue-hover disabled:opacity-50"
            >
              {applying ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Check className="h-3 w-3" />
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
