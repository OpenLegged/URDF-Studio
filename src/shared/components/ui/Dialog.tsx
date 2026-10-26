import React from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { IconButton } from './IconButton';
import { TooltipPortalContext } from './Tooltip';

interface DialogProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
  width?: string;
  zIndexClassName?: string;
  closeLabel?: string;
}

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function getFocusableElements(container: HTMLElement | null): HTMLElement[] {
  if (!container) {
    return [];
  }

  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) => {
      const computedStyle = element.ownerDocument.defaultView?.getComputedStyle(element);

      return (
        !element.hasAttribute('disabled') &&
        element.getAttribute('aria-hidden') !== 'true' &&
        element.getAttribute('tabindex') !== '-1' &&
        !element.hidden &&
        computedStyle?.display !== 'none' &&
        computedStyle?.visibility !== 'hidden'
      );
    },
  );
}

export const Dialog: React.FC<DialogProps> = ({
  isOpen,
  onClose,
  title,
  children,
  footer,
  className = '',
  width = 'w-[400px]',
  zIndexClassName = 'z-[100]',
  closeLabel = 'Close dialog',
}) => {
  const dialogRef = React.useRef<HTMLDivElement | null>(null);
  const [portalRoot, setPortalRoot] = React.useState<HTMLDivElement | null>(null);
  const setDialogRef = React.useCallback((node: HTMLDivElement | null) => {
    dialogRef.current = node;
    setPortalRoot(node);
  }, []);
  const previousFocusRef = React.useRef<HTMLElement | null>(null);
  const onCloseRef = React.useRef(onClose);

  React.useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  React.useEffect(() => {
    if (!isOpen || typeof document === 'undefined') {
      return undefined;
    }

    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    // Focus the dialog container itself, NOT the first focusable child. The
    // first focusable element is typically the backdrop or the header close
    // button; auto-focusing it means an in-flight Enter keyup (e.g. the Enter
    // that submitted the NumberInput which opened this dialog) would activate
    // that button and dismiss the dialog instantly. The container is
    // tabIndex={-1}, so it can receive focus without entering the Tab order,
    // and Tab still cycles through the focusable children normally.
    const focusTarget = dialogRef.current;
    focusTarget?.focus();

    return () => {
      const previousFocus = previousFocusRef.current;
      if (previousFocus && document.contains(previousFocus)) {
        previousFocus.focus();
      }
      previousFocusRef.current = null;
    };
  }, [isOpen]);

  React.useEffect(() => {
    if (!isOpen || typeof document === 'undefined') {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }

      if (event.key !== 'Tab') {
        return;
      }

      const focusableElements = getFocusableElements(dialogRef.current);
      if (focusableElements.length === 0) {
        event.preventDefault();
        dialogRef.current?.focus();
        return;
      }

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];
      const activeElement =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;

      if (event.shiftKey && activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
        return;
      }

      if (!event.shiftKey && activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const content = (
    <div
      ref={setDialogRef}
      className={`fixed inset-0 ${zIndexClassName} flex items-center justify-center`}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      tabIndex={-1}
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/40 transition-opacity"
        onMouseDown={(event) => {
          // Close only on a direct press of the backdrop itself, not on
          // clicks that started inside the dialog content. Using mousedown
          // (instead of click) also prevents the dialog from being dismissed
          // by the same Enter keystroke that triggered it from a caller's
          // input — Enter only synthesizes a `click`, never a mousedown.
          if (event.target === event.currentTarget) {
            onClose();
          }
        }}
        aria-label={closeLabel}
        tabIndex={-1}
      />

      <div
        className={`
          relative bg-panel-bg
          rounded-2xl
          shadow-xl
          border border-border-black
          overflow-hidden flex flex-col
          transform transition-all duration-200 scale-100 opacity-100
          ${width} ${className}
        `}
      >
        <div className="bg-element-bg px-4 py-3 border-b border-border-black flex items-center justify-between shrink-0">
          <h2 className="text-[13px] font-semibold text-text-primary truncate">{title}</h2>
          <IconButton
            onClick={onClose}
            variant="close"
            aria-label={closeLabel}
            title={closeLabel}
          >
            <X className="w-4 h-4" />
          </IconButton>
        </div>

        <div className="p-4 overflow-y-auto max-h-[70vh] bg-panel-bg">{children}</div>

        {footer && (
          <div className="bg-element-bg px-4 py-3 border-t border-border-black shrink-0">
            {footer}
          </div>
        )}
      </div>
    </div>
  );

  return createPortal(
    <TooltipPortalContext.Provider value={portalRoot}>{content}</TooltipPortalContext.Provider>,
    document.body,
  );
};
