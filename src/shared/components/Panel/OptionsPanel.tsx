/**
 * Shared UI Components for Options Panels
 * Extracted common panel patterns used across the unified editor viewers.
 */

import React, { useRef, useState, useCallback, useEffect, ReactNode } from 'react';
import { Paperclip } from 'lucide-react';
import { ResizeCornerIndicator } from '@/shared/components/DraggableWindow/ResizeCornerIndicator';
import {
  FLOATING_WINDOW_HEADER_HEIGHT_CLASS,
  FLOATING_WINDOW_RADIUS_CLASS,
  FLOATING_WINDOW_TITLE_CLASS,
} from '@/shared/components/DraggableWindow/floatingWindowStyles';
import { Checkbox, IconButton, Slider as UiSlider } from '@/shared/components/ui';
import { useOverlayHoverBlock } from '@/shared/hooks/useOverlayHoverBlock';

// Drag grip icon SVG path
const DRAG_GRIP_PATH =
  'M7 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM7 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM7 14a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM13 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM13 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM13 14a2 2 0 1 0 0 4 2 2 0 0 0 0-4z';

// Chevron icons
const ChevronDown = () => (
  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
  </svg>
);

const ChevronUp = () => (
  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
  </svg>
);

const ChevronRight = () => (
  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
  </svg>
);

const CloseIcon = () => (
  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
  </svg>
);

const DragGripIcon = ({ className = 'w-3 h-3' }: { className?: string }) => (
  <svg className={className} fill="currentColor" viewBox="0 0 20 20">
    <path d={DRAG_GRIP_PATH} />
  </svg>
);

interface PanelOverlayToggleButtonProps {
  active: boolean;
  label: string;
  onClick: () => void;
  className?: string;
}

export function PanelOverlayToggleButton({
  active,
  label,
  onClick,
  className = '',
}: PanelOverlayToggleButtonProps) {
  return (
    <IconButton
      type="button"
      variant="toolbar"
      size="xs"
      isActive={active}
      aria-pressed={active}
      title={label}
      onClick={onClick}
      className={`h-5 w-5 ${className}`.trim()}
    >
      <Paperclip className="h-3 w-3" />
    </IconButton>
  );
}

// ============== Checkbox Option ==============
interface CheckboxOptionProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  icon?: ReactNode;
  compact?: boolean;
  labelClassName?: string;
}

export const CheckboxOption: React.FC<CheckboxOptionProps> = ({
  checked,
  onChange,
  label,
  icon,
  compact = false,
  labelClassName = '',
}) => {
  const contentHeightClassName = compact ? 'min-h-4' : 'min-h-5';
  const textLineHeightClassName = compact ? 'leading-[14px]' : 'leading-4';
  // Use the new Checkbox component but preserve the layout logic
  const content = (
    <div className={`flex ${contentHeightClassName} items-center gap-2`}>
      {icon}
      <span className={`text-[11px] ${textLineHeightClassName} ${labelClassName}`}>
        {label}
      </span>
    </div>
  );

  return (
    <div className={`flex min-w-0 items-center ${compact ? 'px-1 py-0.5' : ''}`.trim()}>
      <Checkbox
        checked={checked}
        onChange={onChange}
        label={content as any}
        className="text-[11px]" // Ensure checkbox text is small
      />
    </div>
  );
};

// ============== Slider Option ==============
interface SliderOptionProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step: number;
  decimals?: number;
  indent?: boolean;
  compact?: boolean;
  icon?: ReactNode;
  showPercentage?: boolean;
  labelClassName?: string;
  disabled?: boolean;
}

export const SliderOption: React.FC<SliderOptionProps> = ({
  label,
  value,
  onChange,
  min,
  max,
  step,
  decimals = 2,
  indent = true,
  compact = false,
  icon,
  showPercentage = false,
  labelClassName = '',
  disabled = false,
}) => {
  const paddingClass = compact
    ? `${indent ? 'pl-2.5' : ''} pr-1.5 pb-1`
    : `${indent ? 'pl-4' : ''} pr-1.5 pb-1.5`;
  const formatSliderValue = React.useCallback(
    (nextValue: number) =>
      showPercentage ? `${Math.round(nextValue * 100)}%` : nextValue.toFixed(decimals),
    [decimals, showPercentage],
  );
  const parseSliderValue = React.useCallback(
    (input: string) => {
      const normalized = input.trim().replace(/,/g, '');
      if (!normalized) {
        return null;
      }

      const numericValue = Number.parseFloat(normalized.replace(/[^0-9eE+.-]/g, ''));
      if (!Number.isFinite(numericValue)) {
        return null;
      }

      if (!showPercentage) {
        return numericValue;
      }

      const hasPercentSign = normalized.includes('%');
      const looksLikeRawRatio =
        !hasPercentSign && normalized.includes('.') && Math.abs(numericValue) <= 1;
      return looksLikeRawRatio ? numericValue : numericValue / 100;
    },
    [showPercentage],
  );

  return (
    <div className={paddingClass}>
      <UiSlider
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={onChange}
        label={label}
        icon={icon}
        showValue={true}
        formatValue={formatSliderValue}
        parseValue={parseSliderValue}
        labelClassName={`text-[10px] text-text-tertiary mb-1 ${labelClassName}`}
        compactThumb={compact}
        disabled={disabled}
      />
    </div>
  );
};

interface ToggleSliderOptionProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  icon?: ReactNode;
  compact?: boolean;
  labelClassName?: string;
  className?: string;
  rowClassName?: string;
  trailingControl?: ReactNode;
  sliderConfig?: Omit<SliderOptionProps, 'value' | 'onChange' | 'label'> & {
    label: string;
    value: number;
    onChange: (value: number) => void;
  };
}

export const ToggleSliderOption: React.FC<ToggleSliderOptionProps> = ({
  checked,
  onChange,
  label,
  icon,
  compact = false,
  labelClassName = '',
  className = '',
  rowClassName = '',
  trailingControl,
  sliderConfig,
}) => {
  const checkbox = (
    <CheckboxOption
      checked={checked}
      onChange={onChange}
      label={label}
      icon={icon}
      compact={compact}
      labelClassName={labelClassName}
    />
  );

  return (
    <div className={className}>
      {trailingControl ? (
        <div className={`flex items-center justify-between ${rowClassName}`}>
          {checkbox}
          <div className="flex shrink-0 items-center">{trailingControl}</div>
        </div>
      ) : (
        checkbox
      )}

      {checked && sliderConfig && (
        <SliderOption
          label={sliderConfig.label}
          value={sliderConfig.value}
          onChange={sliderConfig.onChange}
          min={sliderConfig.min}
          max={sliderConfig.max}
          step={sliderConfig.step}
          decimals={sliderConfig.decimals}
          indent={sliderConfig.indent}
          compact={sliderConfig.compact}
          icon={sliderConfig.icon}
          showPercentage={sliderConfig.showPercentage}
          labelClassName={sliderConfig.labelClassName}
          disabled={sliderConfig.disabled}
        />
      )}
    </div>
  );
};

// ============== Section Divider ==============
export const SectionDivider = () => <div className="border-t border-border-black my-1" />;

// ============== Collapsible Section ==============
interface CollapsibleSectionProps {
  title: string;
  children: ReactNode;
  isCollapsed?: boolean;
  onToggle?: () => void;
  defaultOpen?: boolean;
  storageKey?: string;
  className?: string;
  useDividerStyle?: boolean;
  triggerClassName?: string;
  titleClassName?: string;
  iconClassName?: string;
  contentClassName?: string;
  contentInnerClassName?: string;
  expandedMaxHeightClassName?: string;
}

export const CollapsibleSection: React.FC<CollapsibleSectionProps> = ({
  title,
  children,
  isCollapsed,
  onToggle,
  defaultOpen = true,
  storageKey,
  className = '',
  useDividerStyle = true,
  triggerClassName = '',
  titleClassName = '',
  iconClassName = '',
  contentClassName = '',
  contentInnerClassName = '',
  expandedMaxHeightClassName = 'max-h-[300px]',
}) => {
  const isControlled = isCollapsed !== undefined;
  const [internalCollapsed, setInternalCollapsed] = useState(() => {
    if (storageKey && typeof window !== 'undefined') {
      const saved = window.localStorage.getItem(`collapse_state_${storageKey}`);
      if (saved !== null) {
        return saved !== 'true';
      }
    }
    return !defaultOpen;
  });
  const collapsed = isControlled ? isCollapsed : internalCollapsed;

  const handleToggle = () => {
    const nextCollapsed = !collapsed;

    if (!isControlled) {
      setInternalCollapsed(nextCollapsed);
      if (storageKey && typeof window !== 'undefined') {
        window.localStorage.setItem(`collapse_state_${storageKey}`, String(!nextCollapsed));
      }
    }

    onToggle?.();
  };

  return (
    <div
      className={`${useDividerStyle ? 'border-t border-border-black/60 first:border-t-0' : ''} ${className}`}
    >
      <button
        type="button"
        onClick={handleToggle}
        className={`flex w-full items-center justify-between px-2 py-2 text-left text-[10px] font-semibold tracking-[0.02em] text-text-tertiary transition-colors hover:bg-element-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-system-blue/30 ${triggerClassName}`}
      >
        <span className={titleClassName}>{title}</span>
        <span
          className={`transition-transform duration-200 ${collapsed ? '' : 'rotate-90'} ${iconClassName}`}
        >
          <ChevronRight />
        </span>
      </button>
      <div
        className={`overflow-hidden transition-all duration-200 ${
          collapsed ? 'max-h-0 opacity-0' : `${expandedMaxHeightClassName} opacity-100`
        } ${contentClassName}`}
      >
        <div className={`px-1 py-1.5 space-y-1.5 ${contentInnerClassName}`}>{children}</div>
      </div>
    </div>
  );
};

interface GroundPlaneControlsProps {
  autoFitLabel?: string;
  autoFitIcon?: ReactNode;
  compact?: boolean;
  disabled?: boolean;
  offsetLabel: string;
  offsetValue: number;
  onAutoFit?: () => void;
  onOffsetChange: (value: number) => void;
  onReset: () => void;
  resetLabel: string;
  sliderIndent?: boolean;
  sliderLabelClassName?: string;
}

export const GroundPlaneControls: React.FC<GroundPlaneControlsProps> = ({
  autoFitLabel,
  autoFitIcon,
  compact = true,
  disabled = false,
  offsetLabel,
  offsetValue,
  onAutoFit,
  onOffsetChange,
  onReset,
  resetLabel,
  sliderIndent = false,
  sliderLabelClassName = '',
}) => {
  return (
    <>
      <SliderOption
        label={offsetLabel}
        value={offsetValue}
        onChange={onOffsetChange}
        min={-2}
        max={2}
        step={0.01}
        compact={compact}
        indent={sliderIndent}
        labelClassName={sliderLabelClassName}
        disabled={disabled}
      />
      <div className="flex gap-1.5 px-2 pb-2">
        {onAutoFit && autoFitLabel && (
          <button
            type="button"
            onClick={onAutoFit}
            disabled={disabled}
            className="flex flex-1 items-center justify-center gap-1 rounded-md border border-system-blue/20 bg-system-blue/10 px-2 py-1 text-[10px] font-medium text-system-blue transition-colors hover:bg-system-blue/15 focus:outline-none focus-visible:ring-2 focus-visible:ring-system-blue/30 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-system-blue/10 dark:border-system-blue/30 dark:bg-system-blue/20 dark:hover:bg-system-blue/25 dark:disabled:hover:bg-system-blue/20"
          >
            {autoFitIcon}
            {autoFitLabel}
          </button>
        )}
        <button
          type="button"
          onClick={onReset}
          disabled={disabled}
          className="flex items-center justify-center gap-1 rounded-md bg-element-bg px-2 py-1 text-[10px] font-medium text-text-secondary transition-colors hover:bg-element-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-system-blue/30 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-element-bg"
        >
          {resetLabel}
        </button>
      </div>
    </>
  );
};

// ============== Options Panel Header ==============
interface OptionsPanelHeaderProps {
  title: string;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  showCollapseButton?: boolean;
  showDragGrip?: boolean;
  onClose?: () => void;
  onMouseDown?: (e: React.MouseEvent) => void;
  expandText?: string;
  collapseText?: string;
  closeText?: string;
  additionalControls?: ReactNode;
  className?: string;
  titleClassName?: string;
}

export const OptionsPanelHeader: React.FC<OptionsPanelHeaderProps> = ({
  title,
  isCollapsed,
  onToggleCollapse,
  showCollapseButton = true,
  showDragGrip = false,
  onClose,
  onMouseDown,
  expandText = 'Expand',
  collapseText = 'Collapse',
  closeText = 'Close',
  additionalControls,
  className = '',
  titleClassName = '',
}) => {
  return (
    <div
      className={`group flex min-w-0 ${FLOATING_WINDOW_HEADER_HEIGHT_CLASS} shrink-0 select-none touch-none items-center justify-between gap-1.5 border-b border-border-black/60 bg-element-bg px-2 text-[10px] transition-colors hover:bg-element-hover ${className}`}
      onMouseDown={onMouseDown}
      onKeyDown={(e) => e.stopPropagation()}
      role="toolbar"
      aria-label={title}
      tabIndex={-1}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {showDragGrip ? (
          <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-border-black/60 bg-panel-bg text-text-tertiary shadow-sm transition-colors group-hover:border-system-blue/20 group-hover:text-system-blue">
            <DragGripIcon className="w-3.5 h-3.5" />
          </span>
        ) : null}
        <span
          className={`truncate whitespace-nowrap leading-4 ${FLOATING_WINDOW_TITLE_CLASS} ${titleClassName}`}
        >
          {title}
        </span>
      </div>
      <div className="flex min-w-fit shrink-0 items-center gap-1">
        {additionalControls}
        {showCollapseButton && (
          <IconButton
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onToggleCollapse();
            }}
            size="sm"
            className="p-0.5"
            variant="ghost"
            title={isCollapsed ? expandText : collapseText}
            aria-expanded={!isCollapsed}
          >
            {isCollapsed ? <ChevronDown /> : <ChevronUp />}
          </IconButton>
        )}
        {onClose && (
          <IconButton
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            size="sm"
            className="p-0.5"
            variant="close"
            title={closeText}
          >
            <CloseIcon />
          </IconButton>
        )}
      </div>
    </div>
  );
};

// ============== Options Panel Content ==============
interface OptionsPanelContentProps {
  isCollapsed: boolean;
  children: ReactNode;
  className?: string;
}

export const OptionsPanelContent: React.FC<OptionsPanelContentProps> = ({
  isCollapsed,
  children,
  className = '',
}) => {
  return (
    <div
      className={`transition-all duration-200 ease-in-out ${
        isCollapsed ? 'max-h-0 opacity-0' : 'max-h-[70vh] opacity-100'
      } ${className} flex flex-1 flex-col min-h-0`}
    >
      <div className="flex-1 overflow-y-auto overflow-x-hidden custom-scrollbar min-h-0">
        {/* No padding here, padding moved to sections or specific children */}
        {children}
      </div>
    </div>
  );
};

// ============== Options Panel Container ==============
interface OptionsPanelContainerProps {
  children: ReactNode;
  className?: string;
  width?: number | string;
  height?: number | string;
  resizable?: boolean;
  minWidth?: number;
  maxWidth?: number;
  minHeight?: number;
  maxHeight?: number;
  isCollapsed?: boolean;
  resizeTitle?: string;
  showRightResizeHandle?: boolean;
}

export const OptionsPanelContainer: React.FC<OptionsPanelContainerProps> = ({
  children,
  className = '',
  width = '13rem',
  height,
  resizable = false,
  minWidth = 160,
  maxWidth = 600,
  minHeight = 150,
  maxHeight = 800,
  isCollapsed = false,
  resizeTitle = 'Resize',
  showRightResizeHandle = true,
}) => {
  const [panelSize, setPanelSize] = useState<{ width: number | string; height: number | string }>({
    width,
    height: height || 'auto',
  });

  const hasManualResizeRef = useRef(false);
  const startSize = useRef<{ width: number; height: number }>({ width: 0, height: 0 });
  const startPos = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const resizeDirection = useRef<'right' | 'bottom' | 'corner' | null>(null);
  const activePointerId = useRef<number | null>(null);
  const bodyCursorRef = useRef('');
  const bodyUserSelectRef = useRef('');

  const captureBodyInteractionStyles = useCallback(() => {
    bodyCursorRef.current = document.body.style.cursor;
    bodyUserSelectRef.current = document.body.style.userSelect;
  }, []);

  const restoreBodyInteractionStyles = useCallback(() => {
    document.body.style.cursor = bodyCursorRef.current;
    document.body.style.userSelect = bodyUserSelectRef.current;
  }, []);

  const handleResizeMove = useCallback(
    (e: PointerEvent) => {
      if (!resizeDirection.current) return;
      if (activePointerId.current !== null && e.pointerId !== activePointerId.current) return;

      e.preventDefault();

      const deltaX = e.clientX - startPos.current.x;
      const deltaY = e.clientY - startPos.current.y;

      let newWidth = startSize.current.width;
      let newHeight = startSize.current.height;

      if (resizeDirection.current === 'right' || resizeDirection.current === 'corner') {
        newWidth += deltaX;
        if (newWidth < minWidth) newWidth = minWidth;
        if (newWidth > maxWidth) newWidth = maxWidth;
      }

      if (resizeDirection.current === 'bottom' || resizeDirection.current === 'corner') {
        newHeight += deltaY;
        if (newHeight < minHeight) newHeight = minHeight;
        if (newHeight > maxHeight) newHeight = maxHeight;
      }

      hasManualResizeRef.current = true;
      setPanelSize((prev) => ({
        width:
          resizeDirection.current === 'right' || resizeDirection.current === 'corner'
            ? newWidth
            : prev.width,
        height:
          resizeDirection.current === 'bottom' || resizeDirection.current === 'corner'
            ? newHeight
            : prev.height,
      }));
    },
    [maxHeight, maxWidth, minHeight, minWidth],
  );

  const handleResizeEnd = useCallback(
    (e?: PointerEvent | Event) => {
      if (
        e &&
        'pointerId' in e &&
        activePointerId.current !== null &&
        e.pointerId !== activePointerId.current
      ) {
        return;
      }

      document.removeEventListener('pointermove', handleResizeMove);
      document.removeEventListener('pointerup', handleResizeEnd);
      document.removeEventListener('pointercancel', handleResizeEnd);
      window.removeEventListener('blur', handleResizeEnd);

      restoreBodyInteractionStyles();
      resizeDirection.current = null;
      activePointerId.current = null;
    },
    [handleResizeMove, restoreBodyInteractionStyles],
  );

  const handleResizeStart = useCallback(
    (e: React.PointerEvent<HTMLElement>, direction: 'right' | 'bottom' | 'corner') => {
      e.preventDefault();
      e.stopPropagation();

      const currentElement = e.currentTarget.parentElement;
      if (!currentElement) return;

      startSize.current = {
        width: currentElement.offsetWidth,
        height: currentElement.offsetHeight,
      };
      startPos.current = { x: e.clientX, y: e.clientY };
      resizeDirection.current = direction;
      activePointerId.current = e.pointerId;

      if (e.currentTarget.setPointerCapture) {
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          // Ignore if pointer capture is not available for current environment.
        }
      }

      document.addEventListener('pointermove', handleResizeMove);
      document.addEventListener('pointerup', handleResizeEnd);
      document.addEventListener('pointercancel', handleResizeEnd);
      window.addEventListener('blur', handleResizeEnd);

      const cursor =
        direction === 'right' ? 'ew-resize' : direction === 'bottom' ? 'ns-resize' : 'nwse-resize';
      captureBodyInteractionStyles();
      document.body.style.cursor = cursor;
      document.body.style.userSelect = 'none';
    },
    [captureBodyInteractionStyles, handleResizeEnd, handleResizeMove],
  );

  useEffect(() => {
    return () => {
      handleResizeEnd();
    };
  }, [handleResizeEnd]);

  useEffect(() => {
    if (hasManualResizeRef.current) {
      return;
    }

    setPanelSize((previous) => {
      const nextSize = {
        width,
        height: height || 'auto',
      };

      return previous.width === nextSize.width && previous.height === nextSize.height
        ? previous
        : nextSize;
    });
  }, [height, width]);

  const currentHeight = isCollapsed ? 'auto' : panelSize.height;
  // Prevent panel from expanding beyond its set height when collapsing (if height is not auto)
  const constrainedMaxHeight =
    isCollapsed && panelSize.height !== 'auto' ? panelSize.height : undefined;

  return (
    <div
      className={`bg-panel-bg ${FLOATING_WINDOW_RADIUS_CLASS} border border-border-black flex flex-col shadow-xl overflow-hidden relative @container ${className}`}
      style={{
        width: panelSize.width,
        height: currentHeight,
        maxHeight: constrainedMaxHeight ?? maxHeight,
      }}
    >
      {children}
      {resizable && !isCollapsed && (
        <>
          {showRightResizeHandle ? (
            <button
              type="button"
              data-testid="ui-options-panel-resize-right"
              aria-label={resizeTitle}
              className="group absolute resize-edge-right top-10 bottom-4 z-40 w-2 cursor-ew-resize border-0 bg-transparent p-0"
              onPointerDown={(e) => handleResizeStart(e, 'right')}
            >
              <span className="pointer-events-none absolute resize-edge-line-right top-0 bottom-0 w-px bg-transparent transition-colors group-hover:bg-system-blue/50 group-active:bg-system-blue/70" />
            </button>
          ) : null}
          {/* Bottom Handle */}
          <button
            type="button"
            data-testid="ui-options-panel-resize-bottom"
            aria-label={resizeTitle}
            className="group absolute resize-edge-bottom left-0 z-40 h-1.5 w-full cursor-ns-resize border-0 bg-transparent p-0"
            onPointerDown={(e) => handleResizeStart(e, 'bottom')}
          >
            <span className="pointer-events-none absolute resize-edge-line-bottom left-0 right-0 h-px bg-transparent transition-colors group-hover:bg-system-blue/50 group-active:bg-system-blue/70" />
          </button>
          {/* Corner Handle */}
          <button
            type="button"
            data-testid="ui-options-panel-resize-corner"
            aria-label={resizeTitle}
            className="group absolute resize-edge-bottom resize-edge-right z-50 flex h-4 w-4 cursor-nwse-resize items-center justify-center border-0 bg-transparent p-0"
            onPointerDown={(e) => handleResizeStart(e, 'corner')}
            title={resizeTitle}
          >
            <ResizeCornerIndicator />
          </button>
        </>
      )}
    </div>
  );
};

// ============== Draggable Options Panel Hook ==============
interface UseDraggablePanelReturn {
  panelRef: React.RefObject<HTMLDivElement | null>;
  position: { x: number; y: number } | null;
  isCollapsed: boolean;
  setPosition: (pos: { x: number; y: number } | null) => void;
  toggleCollapsed: () => void;
  handleMouseDown: (e: React.MouseEvent) => void;
  handleMouseMove: (e: MouseEvent) => void;
  handleMouseUp: () => void;
}

export function useDraggablePanel(initialCollapsed: boolean = false): UseDraggablePanelReturn {
  const panelRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const [isCollapsed, setIsCollapsed] = useState(initialCollapsed);
  const dragOffset = useRef({ x: 0, y: 0 });

  const toggleCollapsed = useCallback(() => {
    setIsCollapsed((prev) => !prev);
  }, []);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (panelRef.current) {
      // Direct DOM manipulation for performance (avoids React re-renders during drag)
      const newX = e.clientX - dragOffset.current.x;
      const newY = e.clientY - dragOffset.current.y;

      const rect = panelRef.current.getBoundingClientRect();
      const headerHeight = 36; // Approximate header height to ensure title bar remains visible

      // Clamp position to keep the title bar visible within viewport
      const minX = -rect.width + headerHeight;
      const maxX = window.innerWidth - headerHeight;
      const minY = 0; // Top edge can't go above viewport
      const maxY = window.innerHeight - headerHeight;

      const clampedX = Math.max(minX, Math.min(maxX, newX));
      const clampedY = Math.max(minY, Math.min(maxY, newY));

      panelRef.current.style.left = `${clampedX}px`;
      panelRef.current.style.top = `${clampedY}px`;
    }
  }, []);

  const handleMouseUp = useCallback(() => {
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);

    // Sync final position to React state to persist it
    if (panelRef.current) {
      // We can read the style we just set, or recalculate.
      // Recalculating from the last event would require the event object,
      // but handleMouseUp usually doesn't need coordinates if we trust the DOM.
      // However, we need to save the 'x' and 'y' numbers.
      // Let's parse them from the style or bounding rect?
      // Bounding rect is safest.
      // NOTE: We need the position relative to the viewport/offset parent.
      // Since OptionsPanel uses `fixed` or `absolute` positioning typically...
      // The original logic used `clientX - offset`.
      // We can't easily get `clientX` here if we don't accept the event.
      // But wait, the previous interface had `handleMouseUp: () => void`.
      // Let's change it to accept `MouseEvent` or just read from DOM.

      const left = parseFloat(panelRef.current.style.left || '0');
      const top = parseFloat(panelRef.current.style.top || '0');
      setPosition({ x: left, y: top });
    }
  }, [handleMouseMove]);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (panelRef.current) {
        const rect = panelRef.current.getBoundingClientRect();
        dragOffset.current = {
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
        };

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
      }
    },
    [handleMouseMove, handleMouseUp],
  );

  useEffect(() => {
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [handleMouseMove, handleMouseUp]);

  return {
    panelRef,
    position,
    isCollapsed,
    setPosition,
    toggleCollapsed,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
  };
}

// ============== Complete Options Panel ==============
interface OptionsPanelProps {
  title: string;
  show: boolean;
  onClose?: () => void;
  showDragGrip?: boolean;
  position?: { x: number; y: number } | null;
  defaultPosition?: {
    top?: string;
    right?: string;
    left?: string;
    bottom?: string;
    transform?: string;
  };
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  onMouseDown?: (e: React.MouseEvent) => void;
  panelRef?: React.RefObject<HTMLDivElement | null>;
  children: ReactNode;
  zIndex?: number;
  width?: number | string;
  height?: number | string;
  maxHeight?: number;
  resizable?: boolean;
  additionalControls?: ReactNode;
  resizeTitle?: string;
  panelClassName?: string;
  onMouseEnter?: React.MouseEventHandler<HTMLDivElement>;
  onMouseLeave?: React.MouseEventHandler<HTMLDivElement>;
  onActivate?: () => void;
  expandText?: string;
  collapseText?: string;
  closeText?: string;
}

export const OptionsPanel: React.FC<OptionsPanelProps> = ({
  title,
  show,
  onClose,
  showDragGrip = false,
  position,
  defaultPosition = { top: '16px', right: '16px' },
  isCollapsed,
  onToggleCollapse,
  onMouseDown,
  panelRef,
  children,
  zIndex = 10,
  width,
  height,
  maxHeight,
  resizable,
  additionalControls,
  resizeTitle,
  panelClassName = '',
  onMouseEnter,
  onMouseLeave,
  onActivate,
  expandText,
  collapseText,
  closeText,
}) => {
  const { activateHoverBlock, deactivateHoverBlock } = useOverlayHoverBlock();
  if (!show) return null;

  // When position is set (dragged), use pixel positioning without transform
  // When using defaultPosition, preserve all CSS properties including transform
  const baseStyle = position
    ? { left: position.x, top: position.y, right: 'auto', bottom: 'auto', transform: 'none' }
    : defaultPosition;
  const style = {
    ...(baseStyle as React.CSSProperties),
    ...(typeof zIndex === 'number' ? { zIndex } : {}),
  };

  const stopPanelEventPropagation = (event: React.SyntheticEvent) => {
    event.stopPropagation();
  };

  const handlePanelFocus = (event: React.FocusEvent<HTMLDivElement>) => {
    const relatedTarget = event.relatedTarget;
    if (relatedTarget instanceof Node && event.currentTarget.contains(relatedTarget)) {
      return;
    }
    onActivate?.();
    activateHoverBlock();
  };

  const handlePanelBlur = (event: React.FocusEvent<HTMLDivElement>) => {
    const relatedTarget = event.relatedTarget;
    if (relatedTarget instanceof Node && event.currentTarget.contains(relatedTarget)) {
      return;
    }
    deactivateHoverBlock();
  };

  const handleMouseEnter: React.MouseEventHandler<HTMLDivElement> = (event) => {
    activateHoverBlock();
    onMouseEnter?.(event);
  };

  const handleMouseLeave: React.MouseEventHandler<HTMLDivElement> = (event) => {
    deactivateHoverBlock();
    onMouseLeave?.(event);
  };

  return (
    <div
      ref={panelRef}
      className={`absolute pointer-events-auto ${panelClassName}`.trim()}
      style={style}
      onClick={stopPanelEventPropagation}
      onContextMenu={stopPanelEventPropagation}
      onDoubleClick={stopPanelEventPropagation}
      onKeyDown={stopPanelEventPropagation}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onFocus={handlePanelFocus}
      onBlur={handlePanelBlur}
      onPointerDownCapture={onActivate}
      onPointerDown={stopPanelEventPropagation}
      onWheel={stopPanelEventPropagation}
      role="toolbar"
      aria-label={title}
      tabIndex={-1}
    >
      <OptionsPanelContainer
        width={width}
        height={height}
        maxHeight={maxHeight}
        resizable={resizable}
        isCollapsed={isCollapsed}
        resizeTitle={resizeTitle}
      >
        <OptionsPanelHeader
          title={title}
          isCollapsed={isCollapsed}
          onToggleCollapse={onToggleCollapse}
          onClose={onClose}
          showDragGrip={showDragGrip}
          onMouseDown={onMouseDown}
          additionalControls={additionalControls}
          expandText={expandText}
          collapseText={collapseText}
          closeText={closeText}
        />
        <OptionsPanelContent isCollapsed={isCollapsed}>{children}</OptionsPanelContent>
      </OptionsPanelContainer>
    </div>
  );
};

export { DragGripIcon, ChevronDown, ChevronUp, CloseIcon, ChevronRight };
