import type { ReactNode } from 'react';
import { Info } from 'lucide-react';
import { CompactSwitch, PanelSelect, Tooltip } from '@/shared/components/ui';

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="text-ui-caption font-semibold tracking-[0.02em] text-text-tertiary mb-1.5 mt-3 first:mt-0">
      {children}
    </div>
  );
}

export function Row({
  label,
  desc,
  hint,
  stacked = false,
  children,
}: {
  label: string;
  desc?: string;
  hint?: string;
  stacked?: boolean;
  children: ReactNode;
}) {
  const isCenteredRow = !stacked && !desc;

  return (
    <div
      className={`flex gap-3 border-b border-border-black py-1.5 last:border-0 ${
        stacked
          ? 'flex-col'
          : isCenteredRow
            ? 'items-center justify-between'
            : 'items-start justify-between'
      }`}
    >
      <div className={`min-w-0 flex flex-col gap-0.5 ${isCenteredRow ? 'justify-center' : ''}`}>
        <div className={`flex min-w-0 gap-1.5 ${isCenteredRow ? 'items-center' : 'items-start'}`}>
          <span className="text-ui-label text-text-primary leading-tight">{label}</span>
          {hint && (
            <Tooltip content={hint} side="top" align="start" className="max-w-[20rem]">
              <button
                type="button"
                aria-label={hint}
                className="mt-px inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-text-tertiary transition-colors hover:bg-system-blue/10 hover:text-system-blue focus:outline-none focus-visible:ring-2 focus-visible:ring-system-blue/30"
              >
                <Info className="h-3 w-3" />
              </button>
            </Tooltip>
          )}
        </div>
        {desc && <span className="text-ui-caption text-text-tertiary leading-tight">{desc}</span>}
      </div>
      <div
        className={stacked ? 'w-full min-w-0' : isCenteredRow ? 'shrink-0 self-center' : 'shrink-0'}
      >
        {children}
      </div>
    </div>
  );
}

export function Toggle({
  value,
  onChange,
  ariaLabel,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
  ariaLabel?: string;
}) {
  return <CompactSwitch checked={value} onChange={onChange} ariaLabel={ariaLabel} />;
}

export function SelectField({
  value,
  options,
  onChange,
  title,
  fullWidth = false,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
  title?: string;
  fullWidth?: boolean;
}) {
  return (
    <PanelSelect
      variant="compact"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      options={options}
      title={title}
      className={fullWidth ? 'w-full min-w-0' : 'min-w-[9rem]'}
    />
  );
}

export function SegmentedChoiceField<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-1 rounded-xl border border-border-black bg-segmented-bg p-1">
      {options.map((option) => {
        const isActive = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={isActive}
            onClick={() => onChange(option.value)}
            className={`inline-flex min-h-8 items-center justify-center rounded-lg px-3 py-1.5 text-center text-xs font-medium leading-none transition-all ${
              isActive
                ? 'bg-segmented-active text-text-primary shadow-sm'
                : 'text-text-secondary hover:bg-element-hover hover:text-text-primary'
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export function TextField({
  value,
  onChange,
  placeholder,
  fullWidth = false,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  fullWidth?: boolean;
}) {
  return (
    <input
      type="text"
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className={`bg-input-bg border border-border-black text-text-primary text-xs rounded-md px-2 py-1 focus:ring-2 focus:ring-system-blue/25 focus:border-system-blue transition-all ${
        fullWidth ? 'w-full min-w-0' : 'w-28'
      }`}
    />
  );
}
