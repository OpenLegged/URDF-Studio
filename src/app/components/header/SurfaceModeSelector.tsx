import React from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { HeaderMenuOverlay } from './HeaderMenuOverlay';
import type {
  HeaderSurfaceMode,
  HeaderSurfaceModeSelectorConfig,
  HeaderSurfaceModeSelectorCopy,
} from './types';

const SURFACE_MODES: readonly HeaderSurfaceMode[] = ['primary', 'alternate'];

export interface SurfaceModeSelectorProps {
  config: HeaderSurfaceModeSelectorConfig;
  copy: HeaderSurfaceModeSelectorCopy;
  closeLabel: string;
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
}

export function SurfaceModeSelector({
  config,
  copy,
  closeLabel,
  isOpen,
  onOpenChange,
}: SurfaceModeSelectorProps) {
  const triggerRef = React.useRef<HTMLButtonElement | null>(null);
  const optionRefs = React.useRef<Record<HeaderSurfaceMode, HTMLButtonElement | null>>({
    primary: null,
    alternate: null,
  });
  const menuId = React.useId();
  const currentMode = config.current;
  const currentCopy = copy[currentMode];

  React.useEffect(() => {
    if (isOpen) {
      optionRefs.current[currentMode]?.focus();
    }
  }, [currentMode, isOpen]);

  const closeAndFocusTrigger = () => {
    onOpenChange(false);
    triggerRef.current?.focus();
  };

  const focusModeAt = (index: number) => {
    const normalizedIndex = (index + SURFACE_MODES.length) % SURFACE_MODES.length;
    optionRefs.current[SURFACE_MODES[normalizedIndex]]?.focus();
  };

  const handleOptionKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    mode: HeaderSurfaceMode,
  ) => {
    const currentIndex = SURFACE_MODES.indexOf(mode);

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        focusModeAt(currentIndex + 1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        focusModeAt(currentIndex - 1);
        break;
      case 'Home':
        event.preventDefault();
        focusModeAt(0);
        break;
      case 'End':
        event.preventDefault();
        focusModeAt(SURFACE_MODES.length - 1);
        break;
      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        closeAndFocusTrigger();
        break;
      case 'Tab':
        onOpenChange(false);
        break;
      default:
        break;
    }
  };

  const handleSelect = (mode: HeaderSurfaceMode) => {
    if (mode !== config.current) {
      config.onChange(mode);
    }
    closeAndFocusTrigger();
  };

  return (
    <div className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        className="relative z-50 flex items-center gap-1.5 rounded-md bg-element-bg px-2.5 py-1 text-xs font-semibold whitespace-nowrap text-text-primary transition-colors hover:bg-element-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-system-blue/30"
        aria-label={copy.ariaLabel}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-controls={isOpen ? menuId : undefined}
        onClick={() => onOpenChange(!isOpen)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            onOpenChange(true);
          }
        }}
      >
        <span>{currentCopy.label}</span>
        <ChevronDown
          aria-hidden="true"
          className={`h-3.5 w-3.5 text-text-tertiary transition-transform ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      {isOpen ? (
        <>
          <HeaderMenuOverlay onClose={() => onOpenChange(false)} label={closeLabel} />
          <div
            id={menuId}
            role="menu"
            aria-label={copy.ariaLabel}
            className="absolute top-full left-0 z-50 mt-1 w-64 overflow-hidden rounded-lg border border-border-black bg-panel-bg py-1 shadow-md dark:bg-panel-bg dark:shadow-xl"
          >
            {SURFACE_MODES.map((mode) => {
              const option = copy[mode];
              const isCurrent = mode === config.current;

              return (
                <button
                  key={mode}
                  ref={(node) => {
                    optionRefs.current[mode] = node;
                  }}
                  type="button"
                  role="menuitemradio"
                  aria-checked={isCurrent}
                  tabIndex={isCurrent ? 0 : -1}
                  className="flex w-full items-start gap-3 px-3 py-2 text-left transition-colors hover:bg-element-bg focus:outline-none focus-visible:bg-element-bg focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-system-blue/30"
                  onClick={() => handleSelect(mode)}
                  onKeyDown={(event) => handleOptionKeyDown(event, mode)}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-text-primary">
                      {option.label}
                    </span>
                    <span className="mt-0.5 block text-xs leading-4 text-text-tertiary">
                      {option.description}
                    </span>
                  </span>
                  <Check
                    aria-hidden="true"
                    className={`mt-0.5 h-4 w-4 shrink-0 text-system-blue ${
                      isCurrent ? 'opacity-100' : 'opacity-0'
                    }`}
                  />
                </button>
              );
            })}
          </div>
        </>
      ) : null}
    </div>
  );
}
