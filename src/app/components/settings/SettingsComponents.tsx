import React from 'react';
import { Minus, Plus } from 'lucide-react';

import { CompactSwitch, IconButton } from '@/shared/components/ui';
import type { CodeEditorFontFamily } from '@/store';
import {
  SETTINGS_ICON_STROKE_WIDTH,
  formatSensitivityPercent,
  resolveCodeEditorFontFamilyCss,
  type CodePreviewLineProps,
  type SettingsNavButtonProps,
  type SettingsRowProps,
  type SettingsSectionProps,
  type SettingsStepperProps,
  type ToggleRowProps,
} from './settingsTypes';

export function SettingsSection({ icon, title, children, actions }: SettingsSectionProps) {
  return (
    <section className="overflow-hidden rounded-[10px] border border-border-black bg-settings-card/95">
      <div className="flex min-h-10 items-center justify-between gap-3 border-b border-border-black/70 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[7px] border border-border-black bg-panel-bg text-text-secondary">
            {icon}
          </span>
          <h3 className="truncate text-[11px] font-semibold tracking-[0.06em] text-text-secondary uppercase">
            {title}
          </h3>
        </div>
        {actions ? <div className="shrink-0">{actions}</div> : null}
      </div>
      <div className="divide-y divide-border-black/70">{children}</div>
    </section>
  );
}

export function SettingsRow({ label, children, stacked = false }: SettingsRowProps) {
  if (stacked) {
    return (
      <div className="space-y-2 px-3 py-2.5">
        {label ? (
          <div className="text-[11px] font-medium leading-4.5 text-text-secondary">{label}</div>
        ) : null}
        <div>{children}</div>
      </div>
    );
  }

  return (
    <div className="grid min-h-10 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-2">
      {label ? (
        <div className="min-w-0 text-[11px] font-medium leading-4.5 text-text-secondary">
          {label}
        </div>
      ) : null}
      <div className="flex max-w-full items-center justify-end gap-2">{children}</div>
    </div>
  );
}

export function ToggleRow({ label, checked, onChange }: ToggleRowProps) {
  return (
    <SettingsRow label={label}>
      <CompactSwitch checked={checked} onChange={onChange} />
    </SettingsRow>
  );
}

export function SettingsNavButton({ item, isActive, onSelect }: SettingsNavButtonProps) {
  return (
    <button
      type="button"
      data-settings-page={item.key}
      onClick={() => onSelect(item.key)}
      className={`relative flex w-full items-center gap-2 rounded-[8px] px-2.5 py-2 text-left transition-colors ${
        isActive
          ? 'bg-panel-bg/90 text-text-primary ring-1 ring-border-black/60'
          : 'text-text-secondary hover:bg-panel-bg/75 hover:text-text-primary'
      }`}
    >
      <span
        className={`absolute bottom-1.5 left-1 top-1.5 w-0.5 rounded-full ${
          isActive ? 'bg-settings-accent' : 'bg-transparent'
        }`}
      />
      <span className={`${isActive ? 'text-settings-accent' : 'text-text-tertiary'}`}>
        {item.icon}
      </span>
      <span className="min-w-0 flex-1 text-[11px] font-medium leading-4.5">{item.title}</span>
    </button>
  );
}

export function SettingsStepper({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  inputTestId,
  decreaseTestId,
  increaseTestId,
}: SettingsStepperProps) {
  const adjustValue = React.useCallback(
    (delta: number) => {
      onChange(value + delta);
    },
    [onChange, value],
  );

  const handleInputChange = React.useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const nextValue = Number(event.currentTarget.value);
      if (Number.isNaN(nextValue)) {
        return;
      }
      onChange(nextValue);
    },
    [onChange],
  );

  return (
    <div className="inline-flex h-7 items-center overflow-hidden rounded-[6px] border border-border-black bg-panel-bg shadow-sm">
      <IconButton
        type="button"
        data-testid={decreaseTestId}
        aria-label={`${label} -${step}`}
        variant="ghost"
        size="md"
        className="h-full w-7 rounded-none hover:bg-settings-muted"
        onClick={() => adjustValue(-step)}
        disabled={value <= min}
      >
        <Minus className="h-3.5 w-3.5" strokeWidth={SETTINGS_ICON_STROKE_WIDTH} />
      </IconButton>
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        data-testid={inputTestId}
        onChange={handleInputChange}
        className="h-full w-12 border-x border-border-black/70 bg-transparent px-0 text-center text-[12px] font-medium text-text-primary outline-none focus:ring-2 focus:ring-system-blue/30"
      />
      <IconButton
        type="button"
        data-testid={increaseTestId}
        aria-label={`${label} +${step}`}
        variant="ghost"
        size="md"
        className="h-full w-7 rounded-none hover:bg-settings-muted"
        onClick={() => adjustValue(step)}
        disabled={value >= max}
      >
        <Plus className="h-3.5 w-3.5" strokeWidth={SETTINGS_ICON_STROKE_WIDTH} />
      </IconButton>
    </div>
  );
}

function CodePreviewLine({ number, children }: CodePreviewLineProps) {
  return (
    <div className="grid grid-cols-[18px_minmax(0,1fr)] items-start gap-2.5">
      <span className="select-none text-right text-[11px] text-text-tertiary/80">{number}</span>
      <span>{children}</span>
    </div>
  );
}

export function SettingsCodePreview({
  codeEditorFontFamily,
  codeEditorFontSize,
  codeEditorOpacity,
}: {
  codeEditorFontFamily: CodeEditorFontFamily;
  codeEditorFontSize: number;
  codeEditorOpacity: number;
}) {
  return (
    <div
      className="source-code-editor-window overflow-hidden rounded-[10px] border border-border-black"
      style={
        {
          '--source-code-editor-opacity-percent': formatSensitivityPercent(codeEditorOpacity),
        } as React.CSSProperties
      }
    >
      <div className="source-code-editor-chrome flex items-center justify-between border-b border-border-black px-2.5 py-1.5">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-text-tertiary/70" />
          <span className="text-[10px] font-medium text-text-secondary">preview.urdf</span>
        </div>
        <span className="text-[10px] text-text-tertiary">XML</span>
      </div>
      <pre
        className="source-code-editor-panel overflow-x-auto p-2.5 text-text-secondary"
        style={{
          fontFamily: resolveCodeEditorFontFamilyCss(codeEditorFontFamily),
          fontSize: `${codeEditorFontSize}px`,
          lineHeight: 1.6,
        }}
      >
        <code>
          <CodePreviewLine number={1}>
            <span className="text-code-tag">&lt;joint</span>{' '}
            <span className="text-code-attr">name</span>
            <span className="text-text-secondary">=</span>
            <span className="text-code-value">&quot;hip_joint&quot;</span>{' '}
            <span className="text-code-attr">type</span>
            <span className="text-text-secondary">=</span>
            <span className="text-code-value">&quot;revolute&quot;</span>
            <span className="text-code-tag">&gt;</span>
          </CodePreviewLine>
          <CodePreviewLine number={2}>
            <span className="text-code-tag">&lt;origin</span>{' '}
            <span className="text-code-attr">xyz</span>
            <span className="text-text-secondary">=</span>
            <span className="text-code-value">&quot;0 0 0&quot;</span>{' '}
            <span className="text-code-attr">rpy</span>
            <span className="text-text-secondary">=</span>
            <span className="text-code-value">&quot;0 0 0&quot;</span>{' '}
            <span className="text-code-tag">/&gt;</span>
          </CodePreviewLine>
          <CodePreviewLine number={3}>
            <span className="text-code-tag">&lt;limit</span>{' '}
            <span className="text-code-attr">effort</span>
            <span className="text-text-secondary">=</span>
            <span className="text-code-value">&quot;42&quot;</span>{' '}
            <span className="text-code-attr">velocity</span>
            <span className="text-text-secondary">=</span>
            <span className="text-code-value">&quot;8.0&quot;</span>{' '}
            <span className="text-code-tag">/&gt;</span>
          </CodePreviewLine>
          <CodePreviewLine number={4}>
            <span className="text-code-tag">&lt;/joint&gt;</span>
          </CodePreviewLine>
        </code>
      </pre>
    </div>
  );
}