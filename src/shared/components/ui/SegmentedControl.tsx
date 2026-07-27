import React from 'react';

export interface SegmentedControlOption<T> {
  value: T;
  label: string;
  icon?: React.ReactNode;
  disabled?: boolean;
}

interface SegmentedControlProps<T> {
  options: ReadonlyArray<SegmentedControlOption<T>>;
  value: T;
  onChange: (value: T) => void;
  size?: 'xs' | 'sm' | 'md';
  className?: string;
  itemClassName?: string;
  selectedItemClassName?: string;
  unselectedItemClassName?: string;
  disabled?: boolean;
  stretch?: boolean;
  ariaLabel?: string;
}

export function SegmentedControl<T extends string | number>({
  options,
  value,
  onChange,
  size = 'sm',
  className = '',
  itemClassName = '',
  selectedItemClassName = '',
  unselectedItemClassName = '',
  disabled = false,
  stretch = true,
  ariaLabel,
}: SegmentedControlProps<T>) {
  const itemRefs = React.useRef<Array<HTMLButtonElement | null>>([]);
  const containerPadding = 'p-0.5';
  const itemPadding =
    size === 'xs'
      ? stretch
        ? 'py-0.5'
        : 'px-6 py-1.5'
      : size === 'sm'
        ? stretch
          ? 'py-1'
          : 'px-4 py-1'
        : stretch
          ? 'py-1.5'
          : 'px-4 py-1.5';
  const textSize = size === 'xs' ? 'text-ui-label' : size === 'sm' ? 'text-ui-control' : 'text-sm';
  const iconSize = size === 'xs' ? 'w-3 h-3' : size === 'sm' ? 'w-3.5 h-3.5' : 'w-4 h-4';
  const enabledOptions = options.filter((option) => !option.disabled);
  const enabledValues = enabledOptions.map((option) => option.value);
  const selectEnabledOption = (nextValue: T) => {
    if (disabled) {
      return;
    }

    const nextIndex = options.findIndex((option) => option.value === nextValue);
    if (nextIndex < 0 || options[nextIndex]?.disabled) {
      return;
    }

    onChange(nextValue);
    window.requestAnimationFrame(() => {
      itemRefs.current[nextIndex]?.focus();
    });
  };
  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (disabled || enabledValues.length === 0) {
      return;
    }

    const currentEnabledIndex = Math.max(0, enabledValues.findIndex((optionValue) => optionValue === value));
    let nextEnabledIndex: number | null = null;

    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      nextEnabledIndex = (currentEnabledIndex + 1) % enabledValues.length;
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      nextEnabledIndex = (currentEnabledIndex - 1 + enabledValues.length) % enabledValues.length;
    } else if (event.key === 'Home') {
      nextEnabledIndex = 0;
    } else if (event.key === 'End') {
      nextEnabledIndex = enabledValues.length - 1;
    }

    if (nextEnabledIndex === null) {
      return;
    }

    event.preventDefault();
    selectEnabledOption(enabledValues[nextEnabledIndex]!);
  };

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      onKeyDown={handleKeyDown}
      tabIndex={disabled ? -1 : 0}
      className={`bg-segmented-bg rounded-lg ${containerPadding} ${
        stretch ? 'flex min-w-0' : 'inline-flex w-fit max-w-full'
      } ${className}`}
    >
      {options.map((option, index) => {
        const isSelected = value === option.value;
        return (
          <button
            key={String(option.value)}
            ref={(element) => {
              itemRefs.current[index] = element;
            }}
            type="button"
            role="radio"
            aria-checked={isSelected}
            aria-label={option.label}
            tabIndex={isSelected && !disabled && !option.disabled ? 0 : -1}
            onClick={() => !disabled && !option.disabled && onChange(option.value)}
            disabled={disabled || option.disabled}
            title={option.label}
            className={`
              ${stretch ? 'min-w-0 flex-1' : 'flex-none'} relative flex min-w-0 items-center justify-center gap-1.5 overflow-hidden
              ${itemPadding} ${textSize} font-medium rounded-md
              transition-all duration-200
              focus:outline-none focus-visible:ring-2 focus-visible:ring-system-blue/30
              disabled:opacity-50 disabled:cursor-not-allowed
              ${
                isSelected
                  ? 'bg-segmented-active text-text-primary shadow-sm'
                  : 'text-text-tertiary hover:bg-segmented-active/70 hover:text-text-primary'
              }
              ${itemClassName}
              ${isSelected ? selectedItemClassName : unselectedItemClassName}
            `}
          >
            {option.icon && (
              <span
                className={`${isSelected ? 'text-current' : 'opacity-70'} ${iconSize} shrink-0 flex items-center justify-center`}
              >
                {option.icon}
              </span>
            )}
            <span className="min-w-0 truncate">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
