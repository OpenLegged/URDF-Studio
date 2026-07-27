import React from 'react';

import { SegmentedControl, type SegmentedControlOption } from './SegmentedControl';

interface PanelSegmentedControlProps<T extends string | number> {
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

const PANEL_SEGMENTED_CONTROL_CLASSNAME =
  'inline-flex min-h-7 max-w-full flex-wrap items-center rounded-[8px] border border-border-black bg-settings-muted p-0.5';
const PANEL_SEGMENTED_CONTROL_ITEM_CLASSNAME =
  'h-6 px-2.5 text-ui-label focus-visible:ring-2 focus-visible:ring-settings-accent-soft';
const PANEL_SEGMENTED_CONTROL_SELECTED_ITEM_CLASSNAME = 'ring-1 ring-border-black/60';
const PANEL_SEGMENTED_CONTROL_UNSELECTED_ITEM_CLASSNAME =
  'text-text-secondary hover:bg-segmented-active/70';

export function PanelSegmentedControl<T extends string | number>({
  options,
  value,
  onChange,
  size = 'xs',
  className = '',
  itemClassName = '',
  selectedItemClassName = '',
  unselectedItemClassName = '',
  disabled = false,
  stretch = false,
  ariaLabel,
}: PanelSegmentedControlProps<T>) {
  return (
    <SegmentedControl
      options={options}
      value={value}
      onChange={onChange}
      size={size}
      disabled={disabled}
      stretch={stretch}
      ariaLabel={ariaLabel}
      className={`${PANEL_SEGMENTED_CONTROL_CLASSNAME} ${className}`.trim()}
      itemClassName={`${PANEL_SEGMENTED_CONTROL_ITEM_CLASSNAME} ${itemClassName}`.trim()}
      selectedItemClassName={`${PANEL_SEGMENTED_CONTROL_SELECTED_ITEM_CLASSNAME} ${selectedItemClassName}`.trim()}
      unselectedItemClassName={`${PANEL_SEGMENTED_CONTROL_UNSELECTED_ITEM_CLASSNAME} ${unselectedItemClassName}`.trim()}
    />
  );
}
