import { ChevronDown, FileText } from 'lucide-react';

import { HeaderButton } from './HeaderButton';
import { HeaderMenuItem, HeaderMenuSeparator } from './HeaderMenuItem';
import { HeaderMenuOverlay } from './HeaderMenuOverlay';
import type { HeaderContextFileMenuConfig } from './types';

interface HeaderContextFileMenuProps {
  config: HeaderContextFileMenuConfig;
  closeLabel: string;
  isOpen: boolean;
  showLabel: boolean;
  onOpenChange: (isOpen: boolean) => void;
}

export function HeaderContextFileMenu({
  config,
  closeLabel,
  isOpen,
  showLabel,
  onOpenChange,
}: HeaderContextFileMenuProps) {
  return (
    <div className="relative">
      <HeaderButton
        isActive={isOpen}
        onClick={() => onOpenChange(!isOpen)}
        title={config.label}
        ariaLabel={config.label}
        ariaHaspopup="menu"
        ariaExpanded={isOpen}
      >
        <FileText className="h-3.5 w-3.5" />
        {showLabel ? <span>{config.label}</span> : null}
        {showLabel ? (
          <ChevronDown
            className={`h-3 w-3 opacity-60 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          />
        ) : null}
      </HeaderButton>

      {isOpen ? (
        <>
          <HeaderMenuOverlay onClose={() => onOpenChange(false)} label={closeLabel} />
          <div
            className="absolute left-0 top-full z-50 mt-1 w-max overflow-visible rounded-lg border border-border-black bg-panel-bg py-1 shadow-md dark:bg-panel-bg dark:shadow-xl"
            role="menu"
            aria-label={config.label}
          >
            {config.items.map((item) => (
              <div key={item.key}>
                {item.separatorBefore ? <HeaderMenuSeparator /> : null}
                <HeaderMenuItem
                  icon={item.icon}
                  disabled={item.disabled}
                  onClick={() => {
                    if (item.disabled) return;
                    onOpenChange(false);
                    item.onSelect();
                  }}
                >
                  {item.label}
                </HeaderMenuItem>
              </div>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
