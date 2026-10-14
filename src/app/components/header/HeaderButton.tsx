import type { ReactNode } from 'react';

interface HeaderButtonProps {
  isActive: boolean;
  onClick: () => void;
  children: ReactNode;
  className?: string;
  title?: string;
  ariaLabel?: string;
  ariaHaspopup?: 'menu';
  ariaExpanded?: boolean;
}

export function HeaderButton({
  isActive,
  onClick,
  children,
  className = '',
  title,
  ariaLabel,
  ariaHaspopup,
  ariaExpanded,
}: HeaderButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative z-50 flex shrink-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-xs font-medium whitespace-nowrap transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-system-blue/30 sm:px-2.5 ${
        isActive
          ? 'bg-element-active text-text-primary'
          : 'text-text-secondary hover:bg-element-hover hover:text-text-primary'
      } ${className}`}
      title={title}
      aria-label={ariaLabel}
      aria-haspopup={ariaHaspopup}
      aria-expanded={ariaExpanded}
    >
      {children}
    </button>
  );
}
