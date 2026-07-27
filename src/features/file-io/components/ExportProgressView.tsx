import React from 'react';
import { Loader2 } from 'lucide-react';

import type { TranslationKeys } from '@/shared/i18n';

import type { ExportProgressState } from '../types';

interface ExportProgressViewProps {
  progress: ExportProgressState;
  t: TranslationKeys;
}

function splitProgressDetail(detail: string): { summary: string; artifact: string | null } {
  const normalized = detail.trim();
  if (!normalized) {
    return { summary: '', artifact: null };
  }

  const pathMatch = normalized.match(/^(.*?)([A-Za-z0-9._-]+(?:\/[^\s]+)+)$/);
  if (pathMatch) {
    return {
      summary: pathMatch[1].trim(),
      artifact: pathMatch[2],
    };
  }

  const fileMatch = normalized.match(/^(.*?)([A-Za-z0-9._-]+\.[A-Za-z0-9._-]+)$/);
  if (fileMatch) {
    return {
      summary: fileMatch[1].trim(),
      artifact: fileMatch[2],
    };
  }

  return {
    summary: normalized,
    artifact: null,
  };
}

export function ExportProgressView({
  progress,
  t,
}: ExportProgressViewProps) {
  const progressWidth = `${Math.round(Math.min(1, Math.max(0, progress.progress)) * 100)}%`;
  const currentStepLabel = t.exportProgressStepCounter
    .replace('{current}', String(progress.currentStep))
    .replace('{total}', String(progress.totalSteps));
  const percentageLabel = `${Math.round(Math.min(1, Math.max(0, progress.progress)) * 100)}%`;
  const { summary, artifact } = splitProgressDetail(progress.detail);

  return (
    <div className="flex min-h-full flex-col gap-2.5">
      <section className="rounded-2xl border border-border-black bg-element-bg/70 p-3.5 shadow-sm">
        <div className="flex items-start gap-2.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border-black bg-panel-bg text-system-blue shadow-sm">
            <Loader2 className="h-4.5 w-4.5 animate-spin" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-ui-caption font-semibold uppercase tracking-[0.14em] text-text-tertiary">
                {t.exportProgressTitle}
              </div>
              <div className="rounded-full border border-border-black bg-panel-bg px-1.5 py-0.5 text-ui-caption font-medium text-text-secondary">
                {currentStepLabel}
              </div>
            </div>
            <h3 className="mt-1.5 text-[18px] font-semibold leading-snug text-text-primary">
              {progress.stepLabel}
            </h3>
            {summary && (
              <p className="mt-1.5 text-ui-label leading-5 text-text-secondary">
                {summary}
              </p>
            )}
            {artifact && (
              <div className="mt-2.5 rounded-xl border border-border-black bg-panel-bg px-2.5 py-1.5 font-mono text-ui-label leading-4 text-text-primary break-all">
                {artifact}
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-border-black bg-element-bg/55 p-3.5">
        <div className="flex items-center justify-between gap-3 text-ui-caption font-medium text-text-secondary">
          <span>{t.exporting}</span>
          <span>{percentageLabel}</span>
        </div>
        <div className="mt-2.5 h-2 overflow-hidden rounded-full bg-panel-bg">
          <div
            aria-hidden="true"
            className={`h-full rounded-full bg-slider-accent ${
              progress.indeterminate
                ? 'motion-safe:animate-pulse'
                : 'transition-[width] duration-200 ease-out motion-reduce:transition-none'
            }`}
            style={{ width: progressWidth }}
          />
        </div>
        <div
          className="mt-2.5 grid gap-1.5"
          style={{ gridTemplateColumns: `repeat(${progress.totalSteps}, minmax(0, 1fr))` }}
        >
          {Array.from({ length: progress.totalSteps }, (_, index) => {
            const step = index + 1;
            const isCompleted = step < progress.currentStep;
            const isActive = step === progress.currentStep;

            return (
              <div
                key={step}
                className={`h-1.5 rounded-full transition-colors ${
                  isCompleted
                    ? 'bg-slider-accent'
                    : isActive
                      ? 'bg-system-blue/60'
                      : 'bg-panel-bg'
                }`}
              />
            );
          })}
        </div>
      </section>

      <section className="rounded-2xl border border-border-black bg-element-bg/45 px-3 py-2.5 text-ui-caption leading-5 text-text-secondary">
        {t.exportProgressKeepWindowOpen}
      </section>
    </div>
  );
}
