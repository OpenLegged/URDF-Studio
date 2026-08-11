import type { ComponentType, HTMLAttributes } from 'react';

import { IconButton } from './IconButton';

export interface ToolbarToggleItem<Value extends string> {
  value: Value;
  label: string;
  icon: ComponentType<{ className?: string }>;
}

interface ToolbarToggleGroupProps<Value extends string>
  extends Omit<HTMLAttributes<HTMLDivElement>, 'onChange'> {
  items: readonly ToolbarToggleItem<Value>[];
  value: Value;
  onValueChange: (value: Value) => void;
  ariaLabel: string;
  compact?: boolean;
  className?: string;
  itemClassName?: string;
  iconClassName?: string;
  itemDataAttribute?: `data-${string}`;
}

export function ToolbarToggleGroup<Value extends string>({
  items,
  value,
  onValueChange,
  ariaLabel,
  compact = true,
  className = '',
  itemClassName = '',
  iconClassName: iconClassNameOverride,
  itemDataAttribute,
  ...props
}: ToolbarToggleGroupProps<Value>) {
  const buttonClassName = `${
    compact ? 'h-7 w-7 rounded-md' : 'h-9 w-9 rounded-lg'
  } ${itemClassName}`.trim();
  const iconClassName = iconClassNameOverride ?? (compact ? 'h-4 w-4' : 'h-5 w-5');

  return (
    <div
      className={`flex items-center gap-0.5 ${className}`.trim()}
      role="toolbar"
      aria-label={ariaLabel}
      {...props}
    >
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <IconButton
            key={item.value}
            type="button"
            onClick={() => onValueChange(item.value)}
            variant="toolbar"
            size="sm"
            isActive={value === item.value}
            aria-label={item.label}
            title={item.label}
            data-toolbar-value={item.value}
            {...(itemDataAttribute ? { [itemDataAttribute]: item.value } : {})}
            className={buttonClassName}
          >
            <Icon className={iconClassName} />
          </IconButton>
        );
      })}
    </div>
  );
}
