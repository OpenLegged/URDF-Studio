import React, {
  cloneElement,
  isValidElement,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';

interface ContextMenuSize {
  width: number;
  height: number;
}

interface ContextMenuViewport {
  left?: number;
  top?: number;
  width: number;
  height: number;
}

const CONTEXT_MENU_VIEWPORT_GUTTER = 8;

interface ContextMenuLayout {
  position: { x: number; y: number } | null;
  maxWidth: number;
  maxHeight: number;
}

function getContextMenuViewport(): Required<ContextMenuViewport> {
  if (typeof window === 'undefined') {
    return {
      left: 0,
      top: 0,
      width: Number.POSITIVE_INFINITY,
      height: Number.POSITIVE_INFINITY,
    };
  }

  const visualViewport = window.visualViewport;
  return {
    left: visualViewport?.offsetLeft ?? 0,
    top: visualViewport?.offsetTop ?? 0,
    width: Math.max(1, visualViewport?.width ?? window.innerWidth),
    height: Math.max(1, visualViewport?.height ?? window.innerHeight),
  };
}

function resolveContextMenuAvailableSize(
  viewport: ContextMenuViewport,
  gutter = CONTEXT_MENU_VIEWPORT_GUTTER,
) {
  const horizontalGutter = viewport.width > gutter * 2 ? gutter : 0;
  const verticalGutter = viewport.height > gutter * 2 ? gutter : 0;
  return {
    horizontalGutter,
    verticalGutter,
    maxWidth: Math.max(1, viewport.width - horizontalGutter * 2),
    maxHeight: Math.max(1, viewport.height - verticalGutter * 2),
  };
}

export function resolveContextMenuPosition(
  position: { x: number; y: number },
  menu: ContextMenuSize,
  viewport: ContextMenuViewport,
  gutter = CONTEXT_MENU_VIEWPORT_GUTTER,
) {
  const left = viewport.left ?? 0;
  const top = viewport.top ?? 0;
  const availableSize = resolveContextMenuAvailableSize(viewport, gutter);
  const minX = left + availableSize.horizontalGutter;
  const minY = top + availableSize.verticalGutter;
  const maxX = Math.max(
    minX,
    left + viewport.width - Math.min(menu.width, availableSize.maxWidth)
      - availableSize.horizontalGutter,
  );
  const maxY = Math.max(
    minY,
    top + viewport.height - Math.min(menu.height, availableSize.maxHeight)
      - availableSize.verticalGutter,
  );
  return {
    x: Math.min(Math.max(minX, position.x), maxX),
    y: Math.min(Math.max(minY, position.y), maxY),
  };
}

interface ContextMenuFrameProps {
  position: { x: number; y: number } | null;
  children: React.ReactNode;
  widthClassName?: string;
  className?: string;
}

interface ContextMenuItemProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: React.ReactNode;
  tone?: 'default' | 'danger';
  iconClassName?: string;
}

export const ContextMenuFrame: React.FC<ContextMenuFrameProps> = ({
  position,
  children,
  widthClassName = 'w-[170px]',
  className = '',
}) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<ContextMenuLayout>(() => {
    const viewport = getContextMenuViewport();
    const availableSize = resolveContextMenuAvailableSize(viewport);
    return {
      position,
      maxWidth: availableSize.maxWidth,
      maxHeight: availableSize.maxHeight,
    };
  });

  const updateLayout = useCallback(() => {
    if (!position || !menuRef.current) return;
    const viewport = getContextMenuViewport();
    const availableSize = resolveContextMenuAvailableSize(viewport);
    const bounds = menuRef.current.getBoundingClientRect();
    const nextPosition = resolveContextMenuPosition(
      position,
      {
        width: Math.min(bounds.width, availableSize.maxWidth),
        height: Math.min(bounds.height, availableSize.maxHeight),
      },
      viewport,
    );
    setLayout((current) => {
      if (
        current.position?.x === nextPosition.x
        && current.position.y === nextPosition.y
        && current.maxWidth === availableSize.maxWidth
        && current.maxHeight === availableSize.maxHeight
      ) {
        return current;
      }

      return {
        position: nextPosition,
        maxWidth: availableSize.maxWidth,
        maxHeight: availableSize.maxHeight,
      };
    });
  }, [position]);

  useLayoutEffect(() => {
    updateLayout();
  }, [
    children,
    className,
    layout.maxHeight,
    layout.maxWidth,
    updateLayout,
    widthClassName,
  ]);

  useLayoutEffect(() => {
    if (!position || typeof window === 'undefined') return;

    const visualViewport = window.visualViewport;
    window.addEventListener('resize', updateLayout);
    visualViewport?.addEventListener('resize', updateLayout);
    visualViewport?.addEventListener('scroll', updateLayout);
    return () => {
      window.removeEventListener('resize', updateLayout);
      visualViewport?.removeEventListener('resize', updateLayout);
      visualViewport?.removeEventListener('scroll', updateLayout);
    };
  }, [position, updateLayout]);

  if (!position) return null;

  const menu = (
    <div
      ref={menuRef}
      className={`fixed z-[120] overflow-auto ${widthClassName} rounded-md border border-border-black bg-panel-bg p-1 shadow-xl ${className}`.trim()}
      style={{
        left: `${layout.position?.x ?? position.x}px`,
        top: `${layout.position?.y ?? position.y}px`,
        maxWidth: Number.isFinite(layout.maxWidth) ? `${layout.maxWidth}px` : undefined,
        maxHeight: Number.isFinite(layout.maxHeight) ? `${layout.maxHeight}px` : undefined,
      }}
      role="menu"
      tabIndex={-1}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      {children}
    </div>
  );

  if (typeof document === 'undefined' || !document.body) {
    return menu;
  }

  return createPortal(menu, document.body);
};

export const ContextMenuItem: React.FC<ContextMenuItemProps> = ({
  icon,
  tone = 'default',
  iconClassName,
  className = '',
  children,
  type = 'button',
  ...props
}) => {
  type IconElementProps = { className?: string };
  const itemClasses =
    tone === 'danger'
      ? 'text-danger hover:bg-danger-soft dark:hover:bg-danger-soft hover:text-danger-hover dark:hover:text-danger'
      : 'text-text-secondary hover:bg-system-blue/10 dark:hover:bg-system-blue/20 hover:text-system-blue';
  const mergedIconClassName =
    iconClassName
    ?? (tone === 'danger'
      ? 'transition-colors group/menu-item:text-danger-hover dark:group/menu-item:text-danger'
      : 'text-system-blue transition-colors group/menu-item:text-system-blue-hover');

  const renderedIcon = isValidElement<IconElementProps>(icon)
    ? cloneElement(icon, {
        className: `${mergedIconClassName} ${icon.props.className ?? ''}`.trim(),
      })
    : icon;

  return (
    <button
      type={type}
      role="menuitem"
      className={`group/menu-item flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-xs transition-colors ${itemClasses} ${className}`.trim()}
      {...props}
    >
      {renderedIcon}
      <span>{children}</span>
    </button>
  );
};
