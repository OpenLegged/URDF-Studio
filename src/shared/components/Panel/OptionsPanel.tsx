/**
 * Shared UI Components for Options Panels
 * Extracted common patterns from Visualizer.tsx and URDFViewer.tsx
 */

import React, { useRef, useState, useCallback, ReactNode } from 'react';

// Drag grip icon SVG path
const DRAG_GRIP_PATH = "M7 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM7 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM7 14a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM13 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM13 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM13 14a2 2 0 1 0 0 4 2 2 0 0 0 0-4z";

// Chevron icons
const ChevronDown = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
  </svg>
);

const ChevronUp = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
  </svg>
);

const CloseIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
  </svg>
);

const DragGripIcon = ({ className = "w-3 h-3" }: { className?: string }) => (
  <svg className={className} fill="currentColor" viewBox="0 0 20 20">
    <path d={DRAG_GRIP_PATH} />
  </svg>
);

// ============== File Icon ==============
const FileIcon = () => (
  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
  </svg>
);

// ============== Model Header Badge ==============
interface ModelHeaderBadgeProps {
  fileName: string;
}

export const ModelHeaderBadge: React.FC<ModelHeaderBadgeProps> = ({ fileName }) => {
  return (
    <div className="px-3 py-2 bg-slate-50 dark:bg-google-dark-bg border-b border-slate-200 dark:border-google-dark-border">
      <div className="flex items-center gap-2">
        <FileIcon />
        <div className="flex-1 min-w-0">
          <div className="text-[9px] text-slate-400 dark:text-slate-500 uppercase tracking-wide mb-0.5">
            Loaded Model
          </div>
          <div className="text-[11px] text-slate-700 dark:text-slate-300 font-medium truncate" title={fileName}>
            {fileName}
          </div>
        </div>
      </div>
    </div>
  );
};

// ============== Checkbox Option ==============
interface CheckboxOptionProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  icon?: ReactNode;
  compact?: boolean;
}

export const CheckboxOption: React.FC<CheckboxOptionProps> = ({
  checked,
  onChange,
  label,
  icon,
  compact = false,
}) => {
  const baseClass = compact
    ? "flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white px-1 py-0.5 rounded hover:bg-slate-50 dark:hover:bg-google-dark-bg select-none"
    : "flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200 hover:text-slate-900 dark:hover:text-white select-none";

  return (
    <label className={baseClass}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="rounded border-slate-300 dark:border-google-dark-border bg-white dark:bg-google-dark-bg text-google-blue"
      />
      {icon}
      {label}
    </label>
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
}) => {
  const displayValue = showPercentage ? `${Math.round(value * 100)}%` : value.toFixed(decimals);

  if (compact) {
    return (
      <div className={`${indent ? 'pl-4' : ''} pr-2 pb-1`}>
        <div className="flex items-center gap-1.5 min-w-0">
          {icon && <span className="text-slate-400 dark:text-slate-500 shrink-0">{icon}</span>}
          <span className="text-[9px] text-slate-400 shrink-0">{label}</span>
          <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={(e) => onChange(parseFloat(e.target.value))}
            className="flex-1 min-w-0 h-1.5 bg-slate-200 dark:bg-google-dark-border rounded-full appearance-none cursor-pointer slider-modern"
            style={{
              background: `linear-gradient(to right, rgb(59, 130, 246) 0%, rgb(59, 130, 246) ${((value - min) / (max - min)) * 100}%, rgb(226, 232, 240) ${((value - min) / (max - min)) * 100}%, rgb(226, 232, 240) 100%)`
            }}
          />
          <span className="text-[10px] font-medium text-slate-600 dark:text-slate-300 w-10 text-right shrink-0 whitespace-nowrap">{displayValue}</span>
        </div>
      </div>
    );
  }

  return (
    <div className={`${indent ? 'pl-6' : ''} pr-2 pb-2`}>
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5">
          {icon && <span className="text-slate-400 dark:text-slate-500">{icon}</span>}
          <span className="text-[10px] text-slate-600 dark:text-slate-400">{label}</span>
        </div>
        <span className="text-[11px] font-semibold text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-google-dark-bg px-2 py-0.5 rounded">{displayValue}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full h-2 bg-slate-200 dark:bg-slate-700 rounded-full appearance-none cursor-pointer slider-modern"
        style={{
          background: `linear-gradient(to right, rgb(59, 130, 246) 0%, rgb(59, 130, 246) ${((value - min) / (max - min)) * 100}%, rgb(226, 232, 240) ${((value - min) / (max - min)) * 100}%, rgb(226, 232, 240) 100%)`
        }}
      />
    </div>
  );
};

// ============== Toggle Button Group ==============
interface ToggleOption<T> {
  value: T;
  label: string;
}

interface ToggleButtonGroupProps<T> {
  options: ToggleOption<T>[];
  value: T;
  onChange: (value: T) => void;
  size?: 'sm' | 'md';
}

export function ToggleButtonGroup<T extends string>({
  options,
  value,
  onChange,
  size = 'md',
}: ToggleButtonGroupProps<T>) {
  const textSize = size === 'sm' ? 'text-[10px]' : 'text-xs';
  const activeClass = size === 'sm'
    ? 'bg-slate-100 dark:bg-google-dark-bg text-google-blue shadow-sm'
    : 'bg-google-blue text-white shadow-sm';
  const inactiveClass = 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white';

  return (
    <div className="flex gap-1">
      {options.map((option) => (
        <button
          key={option.value}
          onClick={() => onChange(option.value)}
          className={`flex-1 py-1 ${textSize} font-medium rounded-md transition-all ${
            value === option.value ? activeClass : inactiveClass
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

// ============== Section Divider ==============
interface SectionDividerProps {
  title?: string;
  position?: 'top' | 'bottom';
}

export const SectionDivider: React.FC<SectionDividerProps> = ({ title, position = 'bottom' }) => {
  const borderClass = position === 'top'
    ? 'border-t border-slate-200 dark:border-slate-700 pt-2'
    : 'border-b border-slate-200 dark:border-slate-700 pb-2 mb-1';

  return (
    <div className={borderClass}>
      {title && (
        <div className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase mb-1.5 px-1">
          {title}
        </div>
      )}
    </div>
  );
};

// ============== Options Panel Header ==============
interface OptionsPanelHeaderProps {
  title: string;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  onClose?: () => void;
  onMouseDown?: (e: React.MouseEvent) => void;
  expandText?: string;
  collapseText?: string;
  closeText?: string;
}

export const OptionsPanelHeader: React.FC<OptionsPanelHeaderProps> = ({
  title,
  isCollapsed,
  onToggleCollapse,
  onClose,
  onMouseDown,
  expandText = "Expand",
  collapseText = "Collapse",
  closeText = "Close",
}) => {
  return (
    <div
      className="text-[10px] text-slate-500 uppercase font-bold tracking-wider px-3 py-2 cursor-move bg-slate-100 dark:bg-google-dark-bg hover:bg-slate-100 dark:hover:bg-google-dark-bg select-none flex items-center justify-between"
      onMouseDown={onMouseDown}
    >
      <div className="flex items-center gap-2">
        <DragGripIcon />
        {title}
      </div>
      <div className="flex items-center gap-1">
        <button
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onToggleCollapse();
          }}
          className="text-slate-400 hover:text-slate-900 dark:hover:text-white p-1 hover:bg-slate-200 dark:hover:bg-google-dark-border rounded"
          title={isCollapsed ? expandText : collapseText}
        >
          {isCollapsed ? <ChevronDown /> : <ChevronUp />}
        </button>
        {onClose && (
          <button
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            className="text-slate-400 hover:text-red-600 dark:hover:text-red-400 p-1 hover:bg-slate-200 dark:hover:bg-google-dark-border rounded"
            title={closeText}
          >
            <CloseIcon />
          </button>
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
      className={`transition-all duration-200 ease-in-out overflow-hidden ${
        isCollapsed ? 'max-h-0 opacity-0' : 'max-h-125 opacity-100'
      } ${className}`}
    >
      <div className="p-2 flex flex-col gap-2">{children}</div>
    </div>
  );
};

// ============== Options Panel Container ==============
interface OptionsPanelContainerProps {
  children: ReactNode;
  className?: string;
}

export const OptionsPanelContainer: React.FC<OptionsPanelContainerProps> = ({
  children,
  className = '',
}) => {
  return (
    <div
      className={`bg-white dark:bg-google-dark-surface rounded-lg border border-slate-200 dark:border-google-dark-border flex flex-col w-48 shadow-md dark:shadow-xl overflow-hidden ${className}`}
    >
      {children}
    </div>
  );
};

// ============== Draggable Options Panel Hook ==============
interface DraggablePanelState {
  position: { x: number; y: number } | null;
  isCollapsed: boolean;
}

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

export function useDraggablePanel(
  initialCollapsed: boolean = false
): UseDraggablePanelReturn {
  const panelRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const [isCollapsed, setIsCollapsed] = useState(initialCollapsed);
  const isDragging = useRef(false);
  const dragOffset = useRef({ x: 0, y: 0 });

  const toggleCollapsed = useCallback(() => {
    setIsCollapsed((prev) => !prev);
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (panelRef.current) {
      const rect = panelRef.current.getBoundingClientRect();
      dragOffset.current = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      };
      isDragging.current = true;
    }
  }, []);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (isDragging.current) {
      setPosition({
        x: e.clientX - dragOffset.current.x,
        y: e.clientY - dragOffset.current.y,
      });
    }
  }, []);

  const handleMouseUp = useCallback(() => {
    isDragging.current = false;
  }, []);

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
  position?: { x: number; y: number } | null;
  defaultPosition?: { top?: string; right?: string; left?: string; bottom?: string };
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  onMouseDown?: (e: React.MouseEvent) => void;
  panelRef?: React.RefObject<HTMLDivElement | null>;
  children: ReactNode;
  zIndex?: number;
}

export const OptionsPanel: React.FC<OptionsPanelProps> = ({
  title,
  show,
  onClose,
  position,
  defaultPosition = { top: '16px', right: '16px' },
  isCollapsed,
  onToggleCollapse,
  onMouseDown,
  panelRef,
  children,
  zIndex = 10,
}) => {
  if (!show) return null;

  const style = position
    ? { left: position.x, top: position.y, right: 'auto' }
    : defaultPosition;

  return (
    <div
      ref={panelRef}
      className={`absolute z-${zIndex} pointer-events-auto`}
      style={style as React.CSSProperties}
    >
      <OptionsPanelContainer>
        <OptionsPanelHeader
          title={title}
          isCollapsed={isCollapsed}
          onToggleCollapse={onToggleCollapse}
          onClose={onClose}
          onMouseDown={onMouseDown}
        />
        <OptionsPanelContent isCollapsed={isCollapsed}>
          {children}
        </OptionsPanelContent>
      </OptionsPanelContainer>
    </div>
  );
};

export { DragGripIcon, ChevronDown, ChevronUp, CloseIcon };
