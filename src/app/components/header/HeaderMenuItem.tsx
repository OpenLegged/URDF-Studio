import type { ComponentType, MouseEvent, ReactNode } from 'react';

type HeaderMenuIcon = ComponentType<{ className?: string }>;

interface HeaderMenuItemProps {
  icon?: HeaderMenuIcon;
  children: ReactNode;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
  disabled?: boolean;
  shortcut?: string;
  onMouseEnter?: () => void;
  onPointerEnter?: () => void;
  onPointerDown?: () => void;
  onFocus?: () => void;
  onTouchStart?: () => void;
  iconClassName?: string;
  className?: string;
}

export function HeaderMenuItem({
  icon: Icon,
  children,
  onClick,
  disabled = false,
  shortcut,
  onMouseEnter,
  onPointerEnter,
  onPointerDown,
  onFocus,
  onTouchStart,
  iconClassName = 'w-4 h-4 text-text-tertiary',
  className = '',
}: HeaderMenuItemProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={onMouseEnter}
      onPointerEnter={onPointerEnter}
      onPointerDown={onPointerDown}
      onFocus={onFocus}
      onTouchStart={onTouchStart}
      className={`flex w-full items-center px-3 py-2 text-left text-xs whitespace-nowrap text-text-primary transition-colors hover:bg-element-hover focus:outline-none focus-visible:bg-element-hover focus-visible:ring-2 focus-visible:ring-system-blue/30 ${
        shortcut ? 'justify-between gap-6' : 'gap-2.5'
      } disabled:cursor-not-allowed disabled:opacity-50 ${className}`.trim()}
    >
      <span className="flex items-center gap-2.5">
        {Icon ? <Icon className={iconClassName} /> : null}
        {children}
      </span>
      {shortcut ? (
        <span className="text-[10px] text-text-tertiary">{shortcut}</span>
      ) : null}
    </button>
  );
}

export function HeaderMenuSeparator() {
  return <div className="my-1 h-px bg-border-black" />;
}
