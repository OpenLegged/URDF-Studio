import React from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';

export interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  options: readonly SelectOption[];
  label?: string;
  error?: string;
  containerClassName?: string;
  labelClassName?: string;
  menuClassName?: string;
  optionClassName?: string;
  optionButtonClassName?: string;
}

interface SelectMenuLayout {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
}

const MENU_GAP_PX = 6;
const MENU_MARGIN_PX = 8;
const MENU_MAX_HEIGHT_PX = 224;
const MENU_MIN_HEIGHT_PX = 112;
const OPTION_HEIGHT_PX = 32;
const MENU_Z_INDEX_CLASS = 'z-[340]';

function resolveOptionValue(
  value: string | number | readonly string[] | undefined,
  options: readonly SelectOption[],
): string {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number') {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.length > 0 ? String(value[0]) : '';
  }
  return options[0]?.value ?? '';
}

function createSyntheticChangeEvent(
  target: HTMLSelectElement,
): React.ChangeEvent<HTMLSelectElement> {
  const nativeEvent = new Event('change', { bubbles: true });

  return {
    target,
    currentTarget: target,
    nativeEvent,
    bubbles: true,
    cancelable: true,
    defaultPrevented: false,
    eventPhase: nativeEvent.eventPhase,
    isTrusted: false,
    preventDefault: () => nativeEvent.preventDefault(),
    isDefaultPrevented: () => nativeEvent.defaultPrevented,
    stopPropagation: () => nativeEvent.stopPropagation(),
    isPropagationStopped: () => false,
    persist: () => {},
    timeStamp: nativeEvent.timeStamp,
    type: nativeEvent.type,
  } as React.ChangeEvent<HTMLSelectElement>;
}

function resolveMenuLayout(trigger: HTMLButtonElement, optionCount: number): SelectMenuLayout {
  const rect = trigger.getBoundingClientRect();
  const estimatedHeight = Math.min(
    MENU_MAX_HEIGHT_PX,
    Math.max(OPTION_HEIGHT_PX + 8, optionCount * OPTION_HEIGHT_PX + 8),
  );
  const availableBelow = window.innerHeight - rect.bottom - MENU_MARGIN_PX;
  const availableAbove = rect.top - MENU_MARGIN_PX;
  const shouldOpenUpward =
    availableBelow < Math.min(estimatedHeight, 160) && availableAbove > availableBelow;
  const availableSpace = shouldOpenUpward ? availableAbove : availableBelow;
  const maxHeight = Math.max(
    MENU_MIN_HEIGHT_PX,
    Math.min(MENU_MAX_HEIGHT_PX, availableSpace - MENU_GAP_PX),
  );
  const menuHeight = Math.min(estimatedHeight, maxHeight);
  const width = Math.max(rect.width, 96);
  const left = Math.min(
    Math.max(MENU_MARGIN_PX, rect.left),
    Math.max(MENU_MARGIN_PX, window.innerWidth - MENU_MARGIN_PX - width),
  );
  const top = shouldOpenUpward
    ? Math.max(MENU_MARGIN_PX, rect.top - MENU_GAP_PX - menuHeight)
    : Math.min(window.innerHeight - MENU_MARGIN_PX - menuHeight, rect.bottom + MENU_GAP_PX);

  return { left, top, width, maxHeight };
}

export const Select: React.FC<SelectProps> = ({
  options,
  label,
  error,
  containerClassName = '',
  labelClassName = '',
  menuClassName = '',
  optionClassName = 'text-sm',
  optionButtonClassName = 'rounded-lg px-2.5 py-1.5',
  className = '',
  id,
  value,
  defaultValue,
  onChange,
  onBlur,
  onFocus,
  disabled = false,
  autoFocus = false,
  'aria-label': ariaLabel,
  'aria-describedby': ariaDescribedBy,
  'aria-invalid': ariaInvalid,
  name,
  required,
  form,
  multiple,
  size,
  title,
  ...props
}) => {
  const generatedSelectId = React.useId();
  const selectId = id || generatedSelectId;
  const labelId = `${selectId}__label`;
  const triggerId = `${selectId}__trigger`;
  const listboxId = `${selectId}__listbox`;
  const isControlled = value !== undefined;
  const fallbackValue = resolveOptionValue(defaultValue, options);
  const [internalValue, setInternalValue] = React.useState(() =>
    value !== undefined ? resolveOptionValue(value, options) : fallbackValue,
  );
  const [isOpen, setIsOpen] = React.useState(false);
  const [menuLayout, setMenuLayout] = React.useState<SelectMenuLayout | null>(null);
  const triggerRef = React.useRef<HTMLButtonElement | null>(null);
  const menuRef = React.useRef<HTMLDivElement | null>(null);
  const hiddenSelectRef = React.useRef<HTMLSelectElement | null>(null);
  const optionRefs = React.useRef<Array<HTMLButtonElement | null>>([]);

  const selectedValue = isControlled ? resolveOptionValue(value, options) : internalValue;
  const selectedOption =
    options.find((option) => option.value === selectedValue) ?? options[0] ?? null;
  const describedBy =
    [ariaDescribedBy, error ? `${selectId}__error` : null].filter(Boolean).join(' ') || undefined;
  const invalid = ariaInvalid ?? Boolean(error);
  const usingNativeFallback = multiple === true || (typeof size === 'number' && size > 1);

  const syncHiddenSelectValue = React.useCallback((nextValue: string) => {
    const select = hiddenSelectRef.current;
    if (!select) {
      return null;
    }
    select.value = nextValue;
    return select;
  }, []);

  const emitChange = React.useCallback(
    (nextValue: string) => {
      const target = syncHiddenSelectValue(nextValue);
      if (!target) {
        return;
      }
      onChange?.(createSyntheticChangeEvent(target));
    },
    [onChange, syncHiddenSelectValue],
  );

  const updateMenuLayout = React.useCallback(() => {
    if (!triggerRef.current) {
      return;
    }
    setMenuLayout(resolveMenuLayout(triggerRef.current, options.length));
  }, [options.length]);

  const closeMenu = React.useCallback(() => {
    setIsOpen(false);
  }, []);

  const openMenu = React.useCallback(() => {
    if (disabled || options.length === 0) {
      return;
    }
    updateMenuLayout();
    setIsOpen(true);
  }, [disabled, options.length, updateMenuLayout]);

  const toggleMenu = React.useCallback(() => {
    if (isOpen) {
      closeMenu();
      return;
    }
    openMenu();
  }, [closeMenu, isOpen, openMenu]);

  const commitValue = React.useCallback(
    (nextValue: string) => {
      if (nextValue === selectedValue) {
        closeMenu();
        triggerRef.current?.focus();
        return;
      }
      if (!isControlled) {
        setInternalValue(nextValue);
      }
      emitChange(nextValue);
      closeMenu();
      triggerRef.current?.focus();
    },
    [closeMenu, emitChange, isControlled, selectedValue],
  );

  const handleHiddenSelectChange = React.useCallback(
    (event: React.ChangeEvent<HTMLSelectElement>) => {
      if (!isControlled) {
        setInternalValue(event.currentTarget.value);
      }
      onChange?.(event);
    },
    [isControlled, onChange],
  );

  React.useEffect(() => {
    if (!isControlled) {
      const nextValue = resolveOptionValue(internalValue, options);
      if (nextValue && nextValue !== internalValue) {
        setInternalValue(nextValue);
      }
      return;
    }
    setInternalValue(resolveOptionValue(value, options));
  }, [internalValue, isControlled, options, value]);

  React.useEffect(() => {
    if (usingNativeFallback) {
      return;
    }
    const target = syncHiddenSelectValue(selectedValue);
    if (!target) {
      return;
    }
  }, [selectedValue, syncHiddenSelectValue, usingNativeFallback]);

  React.useEffect(() => {
    if (!isOpen || usingNativeFallback) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) {
        return;
      }
      closeMenu();
    };

    const handleResize = () => {
      closeMenu();
    };

    // Close the menu when the *page* scrolls (so it never detaches from its
    // trigger), but ignore scrolls that originate inside the menu itself —
    // otherwise dragging the listbox scrollbar immediately closes the menu.
    // Scroll events do not bubble, but a capture-phase listener on window
    // receives them from every descendant, so we must filter by target.
    const handleScroll = (event: Event) => {
      const target = event.target;
      if (
        target instanceof Node &&
        (menuRef.current?.contains(target) || triggerRef.current?.contains(target))
      ) {
        return;
      }
      closeMenu();
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeMenu();
        triggerRef.current?.focus();
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('resize', handleResize);
    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('keydown', handleEscape);
    };
  }, [closeMenu, isOpen, usingNativeFallback]);

  React.useEffect(() => {
    if (!isOpen || usingNativeFallback) {
      return;
    }
    updateMenuLayout();
    const selectedIndex = Math.max(
      0,
      options.findIndex((option) => option.value === selectedValue),
    );
    optionRefs.current[selectedIndex]?.focus();
  }, [isOpen, options, selectedValue, updateMenuLayout, usingNativeFallback]);

  React.useEffect(() => {
    if (!autoFocus) {
      return;
    }
    const focusTarget = usingNativeFallback ? hiddenSelectRef.current : triggerRef.current;
    focusTarget?.focus();
  }, [autoFocus, usingNativeFallback]);

  const handleTriggerKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (disabled || options.length === 0) {
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      openMenu();
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      toggleMenu();
    }
  };

  const handleOptionKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    optionIndex: number,
  ) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      optionRefs.current[(optionIndex + 1) % options.length]?.focus();
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      optionRefs.current[(optionIndex - 1 + options.length) % options.length]?.focus();
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      optionRefs.current[0]?.focus();
      return;
    }
    if (event.key === 'End') {
      event.preventDefault();
      optionRefs.current[options.length - 1]?.focus();
      return;
    }
    if (event.key === 'Tab') {
      closeMenu();
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      commitValue(options[optionIndex]?.value ?? selectedValue);
    }
  };

  if (usingNativeFallback) {
    return (
      <div className={`w-full ${containerClassName}`.trim()}>
        {label && (
          <label
            htmlFor={selectId}
            className={`mb-1.5 ml-0.5 block text-xs font-semibold text-text-secondary ${labelClassName}`.trim()}
          >
            {label}
          </label>
        )}
        <div className="relative">
          <select
            id={selectId}
            ref={hiddenSelectRef}
            value={selectedValue}
            defaultValue={defaultValue}
            onChange={handleHiddenSelectChange}
            onBlur={onBlur}
            onFocus={onFocus}
            disabled={disabled}
            name={name}
            required={required}
            form={form}
            multiple={multiple}
            size={size}
            title={title}
            aria-label={ariaLabel}
            aria-describedby={describedBy}
            aria-invalid={invalid}
            className={`
              w-full appearance-none
              rounded-lg border border-border-black bg-input-bg px-3 py-1.5 text-sm text-text-primary
              hover:border-border-strong
              focus:outline-none focus:ring-2 focus:ring-system-blue/30 focus:border-system-blue
              transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-50
              ${error ? 'border-danger focus:border-danger focus:ring-danger/30' : ''}
              ${className}
            `}
            {...props}
          >
            {options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-text-tertiary">
            <ChevronDown className="h-4 w-4" />
          </div>
        </div>
        {error && (
          <p id={`${selectId}__error`} className="mt-1 ml-0.5 text-xs text-danger">
            {error}
          </p>
        )}
      </div>
    );
  }

  const menu =
    isOpen && menuLayout ? (
      <div
        ref={menuRef}
        className={`fixed ${MENU_Z_INDEX_CLASS} overflow-hidden rounded-xl border border-border-black bg-panel-bg p-1 shadow-xl ${menuClassName}`.trim()}
        style={{
          left: `${menuLayout.left}px`,
          top: `${menuLayout.top}px`,
          width: `${menuLayout.width}px`,
        }}
      >
        <div
          role="listbox"
          id={listboxId}
          aria-labelledby={label ? labelId : undefined}
          aria-label={!label ? ariaLabel : undefined}
          className="custom-scrollbar max-h-[224px] overflow-y-auto"
          style={{ maxHeight: `${menuLayout.maxHeight}px` }}
        >
          {options.map((option, optionIndex) => {
            const isSelected = option.value === selectedValue;
            return (
              <button
                key={option.value}
                ref={(node) => {
                  optionRefs.current[optionIndex] = node;
                }}
                type="button"
                role="option"
                aria-selected={isSelected}
                className={`flex w-full items-center justify-between gap-2 text-left font-medium transition-colors ${optionButtonClassName} ${optionClassName} ${
                  isSelected
                    ? 'bg-system-blue/12 text-system-blue'
                    : 'text-text-primary hover:bg-element-hover hover:text-text-primary'
                }`}
                onClick={() => commitValue(option.value)}
                onKeyDown={(event) => handleOptionKeyDown(event, optionIndex)}
              >
                <span className="min-w-0 truncate">{option.label}</span>
                <Check
                  className={`h-3.5 w-3.5 shrink-0 transition-opacity ${
                    isSelected ? 'opacity-100' : 'opacity-0'
                  }`}
                />
              </button>
            );
          })}
        </div>
      </div>
    ) : null;

  return (
    <div className={`w-full ${containerClassName}`.trim()}>
      {label && (
        <div
          id={labelId}
          className={`mb-1.5 ml-0.5 block text-xs font-semibold text-text-secondary ${labelClassName}`.trim()}
        >
          {label}
        </div>
      )}
      <div className="relative">
        <select
          id={selectId}
          ref={hiddenSelectRef}
          tabIndex={-1}
          aria-hidden="true"
          value={selectedValue}
          defaultValue={defaultValue}
          onChange={handleHiddenSelectChange}
          disabled={disabled}
          name={name}
          required={required}
          form={form}
          title={title}
          aria-label={ariaLabel}
          aria-describedby={describedBy}
          aria-invalid={invalid}
          className="sr-only"
          {...props}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <button
          id={triggerId}
          ref={triggerRef}
          type="button"
          role="combobox"
          aria-controls={listboxId}
          aria-expanded={isOpen}
          aria-haspopup="listbox"
          aria-labelledby={label ? `${labelId} ${triggerId}` : undefined}
          aria-label={!label ? ariaLabel : undefined}
          aria-describedby={describedBy}
          aria-invalid={invalid}
          title={title}
          disabled={disabled}
          className={`
            relative inline-flex w-full items-center rounded-lg border border-border-black bg-input-bg px-3 py-1.5 pr-8 text-left text-sm text-text-primary
            hover:border-border-strong
            transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-system-blue/30 focus:border-system-blue
            disabled:cursor-not-allowed disabled:opacity-50
            ${error ? 'border-danger focus:border-danger focus:ring-danger/30' : ''}
            ${className}
          `}
          onClick={toggleMenu}
          onKeyDown={handleTriggerKeyDown}
          onBlur={
            onBlur
              ? (event) => onBlur(event as unknown as React.FocusEvent<HTMLSelectElement>)
              : undefined
          }
          onFocus={
            onFocus
              ? (event) => onFocus(event as unknown as React.FocusEvent<HTMLSelectElement>)
              : undefined
          }
        >
          <span className="block min-w-0 truncate">{selectedOption?.label ?? ''}</span>
          <ChevronDown
            className={`pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-tertiary transition-transform ${
              isOpen ? 'rotate-180' : ''
            }`}
          />
        </button>
        {menu && typeof document !== 'undefined' && document.body
          ? createPortal(menu, document.body)
          : menu}
      </div>
      {error && (
        <p id={`${selectId}__error`} className="mt-1 ml-0.5 text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
};
