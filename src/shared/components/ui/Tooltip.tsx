import React, { useState } from 'react';
import {
  autoUpdate,
  flip,
  offset,
  shift,
  useDismiss,
  useFloating,
  useFocus,
  useHover,
  useInteractions,
  useRole,
} from '@floating-ui/react';
import type { Placement } from '@floating-ui/react';
import { createPortal } from 'react-dom';

type TooltipSide = 'top' | 'bottom';
type TooltipAlign = 'start' | 'center' | 'end';

interface TooltipProps {
  content: React.ReactNode;
  children: React.ReactElement;
  side?: TooltipSide;
  align?: TooltipAlign;
  className?: string;
}

type FloatingDomGlobals = typeof globalThis & {
  Element?: typeof Element;
  HTMLElement?: typeof HTMLElement;
  Node?: typeof Node;
  ShadowRoot?: typeof ShadowRoot;
};

function getTooltipPlacement(side: TooltipSide, align: TooltipAlign): Placement {
  if (align === 'start') {
    return `${side}-start` as Placement;
  }
  if (align === 'end') {
    return `${side}-end` as Placement;
  }
  return side;
}

// Floating UI reads DOM constructors from globalThis; jsdom tests often install them on window only.
function ensureFloatingUiDomGlobals() {
  if (typeof window === 'undefined') {
    return;
  }

  const target = globalThis as FloatingDomGlobals;
  if (typeof target.Element === 'undefined' && typeof window.Element !== 'undefined') {
    target.Element = window.Element;
  }
  if (typeof target.HTMLElement === 'undefined' && typeof window.HTMLElement !== 'undefined') {
    target.HTMLElement = window.HTMLElement;
  }
  if (typeof target.Node === 'undefined' && typeof window.Node !== 'undefined') {
    target.Node = window.Node;
  }
  if (typeof target.ShadowRoot === 'undefined' && typeof window.ShadowRoot !== 'undefined') {
    target.ShadowRoot = window.ShadowRoot;
  }
}

export function Tooltip({
  content,
  children,
  side = 'bottom',
  align = 'center',
  className = '',
}: TooltipProps) {
  ensureFloatingUiDomGlobals();

  const [isOpen, setIsOpen] = useState(false);
  const { context, floatingStyles, refs } = useFloating({
    open: isOpen,
    onOpenChange: setIsOpen,
    placement: getTooltipPlacement(side, align),
    strategy: 'fixed',
    middleware: [offset(6), flip({ padding: 8 }), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });
  const hover = useHover(context, { mouseOnly: true, move: false });
  const focus = useFocus(context);
  const dismiss = useDismiss(context);
  const role = useRole(context, { role: 'tooltip' });
  const { getFloatingProps, getReferenceProps } = useInteractions([hover, focus, dismiss, role]);
  const { 'aria-describedby': tooltipDescriptionId, ...referenceProps } =
    getReferenceProps() as React.HTMLAttributes<HTMLSpanElement> & {
      'aria-describedby'?: string;
    };

  if (content == null || content === false || content === '') {
    return children;
  }

  const childAriaDescribedBy = (children.props as { 'aria-describedby'?: string })[
    'aria-describedby'
  ];
  const mergedAriaDescribedBy = [childAriaDescribedBy, tooltipDescriptionId]
    .filter(Boolean)
    .join(' ');
  const trigger = tooltipDescriptionId
    ? React.cloneElement(children, {
        'aria-describedby': mergedAriaDescribedBy || undefined,
      } as React.HTMLAttributes<HTMLElement>)
    : children;

  return (
    <span ref={refs.setReference} className="relative inline-flex" {...referenceProps}>
      {trigger}
      {isOpen && typeof document !== 'undefined'
        ? createPortal(
            <span
              ref={refs.setFloating}
              className={`pointer-events-none z-[500] w-max max-w-[18rem] rounded-md border border-border-black bg-element-active px-2 py-1.5 text-ui-micro font-medium leading-4 whitespace-pre-line text-text-primary shadow-md ${className}`.trim()}
              style={floatingStyles}
              {...getFloatingProps()}
            >
              {content}
            </span>,
            document.body,
          )
        : null}
    </span>
  );
}
