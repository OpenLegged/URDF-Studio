import React from 'react';

interface BooleanSegmentedControlProps {
  value: boolean;
  onChange: (value: boolean) => void;
  trueLabel?: string;
  falseLabel?: string;
  ariaLabel?: string;
  disabled?: boolean;
  className?: string;
}

export function BooleanSegmentedControl({
  value,
  onChange,
  trueLabel = 'Yes',
  falseLabel = 'No',
  ariaLabel,
  disabled = false,
  className = '',
}: BooleanSegmentedControlProps) {
  const options = [
    { label: trueLabel, selected: value, nextValue: true },
    { label: falseLabel, selected: !value, nextValue: false },
  ] as const;

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={`inline-flex min-h-7 max-w-full items-center rounded-[8px] border border-border-black bg-segmented-bg p-0.5 ${className}`.trim()}
    >
      {options.map((option) => (
        <button
          key={String(option.nextValue)}
          type="button"
          role="radio"
          aria-checked={option.selected}
          disabled={disabled}
          onClick={() => {
            if (!disabled && option.nextValue !== value) {
              onChange(option.nextValue);
            }
          }}
          className={`inline-flex h-6 min-w-[3.25rem] items-center justify-center rounded-[6px] px-2.5 text-ui-label font-medium transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-system-blue/30 disabled:cursor-not-allowed disabled:opacity-50 ${
            option.selected
              ? 'bg-segmented-active text-text-primary shadow-sm ring-1 ring-border-black/60'
              : 'text-text-secondary hover:bg-segmented-active/70 hover:text-text-primary'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
