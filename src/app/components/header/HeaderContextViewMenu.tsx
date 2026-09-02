import { ChevronDown, Eye } from 'lucide-react';

import { HeaderButton } from './HeaderButton';
import { HeaderMenuOverlay } from './HeaderMenuOverlay';
import type { HeaderTranslations } from './types';
import { ViewMenuItem } from './ViewMenuItem';

interface HeaderContextViewMenuProps {
  closeLabel: string;
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  onVisibilityChange: (visible: boolean) => void;
  showLabel: boolean;
  t: HeaderTranslations;
  visible: boolean;
}

/** View menu for a host-owned alternate workspace surface. */
export function HeaderContextViewMenu({
  closeLabel,
  isOpen,
  onOpenChange,
  onVisibilityChange,
  showLabel,
  t,
  visible,
}: HeaderContextViewMenuProps) {
  return (
    <div className="relative">
      <HeaderButton
        isActive={isOpen}
        onClick={() => onOpenChange(!isOpen)}
        title={t.view}
        ariaLabel={t.view}
        ariaHaspopup="menu"
        ariaExpanded={isOpen}
      >
        <Eye className="h-3.5 w-3.5" />
        {showLabel ? <span>{t.view}</span> : null}
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
            className="absolute left-0 top-full z-50 mt-1 min-w-[10.5rem] overflow-hidden rounded-lg border border-border-black bg-panel-bg py-1 shadow-md dark:bg-panel-bg dark:shadow-xl"
            role="menu"
            aria-label={t.view}
          >
            <ViewMenuItem
              checked={visible}
              label={t.viewOptions}
              onClick={() => {
                onVisibilityChange(!visible);
                onOpenChange(false);
              }}
            />
          </div>
        </>
      ) : null}
    </div>
  );
}
