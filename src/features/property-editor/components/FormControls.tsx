/**
 * Reusable form controls for the PropertyEditor feature.
 * InputGroup, CollapsibleSection, NumberInput, Vec3Input
 */
import React from 'react';
import { Minus, Plus } from 'lucide-react';
import { PanelSelect, type SelectOption } from '@/shared/components/ui';
import { MAX_PROPERTY_DECIMALS } from '@/core/utils/numberPrecision';
import { CollapsibleSection as SharedCollapsibleSection } from '@/shared/components/Panel/OptionsPanel';
import { usePressAndHoldRepeat } from '@/shared/hooks/usePressAndHoldRepeat';
import {
  PROPERTY_EDITOR_STEPPER_REPEAT_DELAY_MS,
  PROPERTY_EDITOR_STEPPER_REPEAT_INTERVAL_MS,
} from '../constants';
import {
  PROPERTY_EDITOR_COMPACT_NUMBER_FIELD_SHELL_CLASS,
  PROPERTY_EDITOR_FIELD_LABEL_CLASS,
  PROPERTY_EDITOR_INLINE_AXIS_LABEL_CLASS,
  PROPERTY_EDITOR_INLINE_FIELD_LABEL_CLASS,
  PROPERTY_EDITOR_NUMBER_FIELD_SHELL_CLASS,
  PROPERTY_EDITOR_READONLY_VALUE_CLASS,
  PROPERTY_EDITOR_SECTION_HEADER_CLASS,
  PROPERTY_EDITOR_SECTION_TRIGGER_CLASS,
  PROPERTY_EDITOR_STEPPER_BUTTON_CLASS,
  PROPERTY_EDITOR_STEPPER_RAIL_CLASS,
  PROPERTY_EDITOR_SUBLABEL_CLASS,
} from './formControlClasses';
import { useHorizontalNumberScrub } from './useHorizontalNumberScrub';
import {
  type NumberInputDisplayFormatter,
  type NumberInputDisplayParser,
  useInputSelectionBehavior,
  useNumberInputController,
} from '../hooks/useNumberInputController';

export {
  PROPERTY_EDITOR_COMPACT_INPUT_CLASS,
  PROPERTY_EDITOR_FIELD_LABEL_CLASS,
  PROPERTY_EDITOR_HELPER_TEXT_CLASS,
  PROPERTY_EDITOR_INLINE_AXIS_LABEL_CLASS,
  PROPERTY_EDITOR_INLINE_FIELD_LABEL_CLASS,
  PROPERTY_EDITOR_INPUT_CLASS,
  PROPERTY_EDITOR_ICON_SEGMENTED_BUTTON_CLASS,
  PROPERTY_EDITOR_ICON_SEGMENTED_GROUP_CLASS,
  PROPERTY_EDITOR_LINK_CLASS,
  PROPERTY_EDITOR_NUMBER_FIELD_SHELL_CLASS,
  PROPERTY_EDITOR_PANEL_EYEBROW_CLASS,
  PROPERTY_EDITOR_PANEL_TITLE_CLASS,
  PROPERTY_EDITOR_PRIMARY_BUTTON_CLASS,
  PROPERTY_EDITOR_READONLY_VALUE_CLASS,
  PROPERTY_EDITOR_SECONDARY_BUTTON_CLASS,
  PROPERTY_EDITOR_SECTION_HEADER_CLASS,
  PROPERTY_EDITOR_SECTION_TITLE_CLASS,
  PROPERTY_EDITOR_SECTION_TRIGGER_CLASS,
  PROPERTY_EDITOR_STEPPER_BUTTON_CLASS,
  PROPERTY_EDITOR_STEPPER_RAIL_CLASS,
  PROPERTY_EDITOR_SUBLABEL_CLASS,
} from './formControlClasses';
export { IconSegmentedControl, type IconSegmentedOption } from './IconSegmentedControl';

export const InputGroup = ({
  label,
  children,
  className = '',
}: {
  label: string;
  children?: React.ReactNode;
  className?: string;
}) => (
  <div className={`mb-1 ${className}`}>
    <label className={`${PROPERTY_EDITOR_FIELD_LABEL_CLASS} mb-0.5`}>{label}</label>
    {children}
  </div>
);

export const InlineInputGroup = ({
  label,
  children,
  className = '',
  labelWidthClassName = 'w-12',
  align = 'center',
}: {
  label?: string;
  children?: React.ReactNode;
  className?: string;
  labelWidthClassName?: string;
  align?: 'start' | 'center';
}) => (
  <div className={`mb-1 ${className}`}>
    <div
      className={`flex min-w-0 flex-nowrap gap-2 ${align === 'start' ? 'items-start' : 'items-center'}`}
    >
      {label ? (
        <label
          className={`${PROPERTY_EDITOR_INLINE_FIELD_LABEL_CLASS} ${labelWidthClassName}`}
          style={{ width: 'fit-content' }}
        >
          {label}
        </label>
      ) : (
        <div className={`${PROPERTY_EDITOR_INLINE_FIELD_LABEL_CLASS} ${labelWidthClassName}`} />
      )}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  </div>
);

export const ReadonlyValueField = ({
  children,
  className = '',
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={`${PROPERTY_EDITOR_READONLY_VALUE_CLASS} ${className}`} {...props}>
    {children}
  </div>
);

interface PropertyEditorSelectProps extends Omit<
  React.ComponentProps<typeof PanelSelect>,
  'options' | 'variant'
> {
  options: readonly SelectOption[];
}

export function PropertyEditorSelect({
  options,
  className = '',
  ...props
}: PropertyEditorSelectProps) {
  return <PanelSelect options={options} variant="property" className={className} {...props} />;
}

export const ReadonlyStatField = ({
  label,
  value,
  align = 'start',
  valueTestId,
}: {
  label: string;
  value: string;
  align?: 'start' | 'center';
  valueTestId?: string;
}) => (
  <div className="grid min-w-0 gap-0.5">
    <div className={`${PROPERTY_EDITOR_SUBLABEL_CLASS} ${align === 'center' ? 'text-center' : ''}`}>
      {label}
    </div>
    <ReadonlyValueField
      className={`min-w-0 w-full overflow-hidden ${align === 'center' ? 'justify-center text-center' : ''}`}
      data-testid={valueTestId}
      title={value}
    >
      <span className="block min-w-0 truncate">{value}</span>
    </ReadonlyValueField>
  </div>
);

export const ReadonlyVectorStatRow = ({
  axisLabels = ['X', 'Y', 'Z'],
  label,
  values,
}: {
  axisLabels?: [string, string, string];
  label: string;
  values: [string, string, string];
}) => (
  <div className="grid min-w-0 w-full grid-cols-[28px_repeat(3,minmax(0,1fr))] items-center gap-x-1.5 gap-y-0.5">
    <div className="flex h-[22px] items-center text-[8px] font-semibold leading-4 text-text-tertiary">
      {label}
    </div>
    {axisLabels.map((axisLabel, index) => (
      <ReadonlyValueField key={axisLabel} className="justify-center text-center">
        {values[index]}
      </ReadonlyValueField>
    ))}
  </div>
);

export const ReadonlyVectorStatHeader = ({
  axisLabels = ['X', 'Y', 'Z'],
}: {
  axisLabels?: [string, string, string];
}) => (
  <div className="grid min-w-0 w-full grid-cols-[28px_repeat(3,minmax(0,1fr))] items-center gap-x-1.5 gap-y-0.5">
    <div aria-hidden="true" />
    {axisLabels.map((axisLabel) => (
      <span key={axisLabel} className={`${PROPERTY_EDITOR_INLINE_AXIS_LABEL_CLASS} text-center`}>
        {axisLabel}
      </span>
    ))}
  </div>
);

export const CollapsibleSection = ({
  title,
  children,
  defaultOpen = true,
  className = '',
  storageKey,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  className?: string;
  storageKey?: string;
}) => {
  return (
    <SharedCollapsibleSection
      title={title}
      defaultOpen={defaultOpen}
      storageKey={storageKey}
      className={`rounded-md border border-border-black overflow-hidden ${className}`}
      useDividerStyle={false}
      triggerClassName={PROPERTY_EDITOR_SECTION_TRIGGER_CLASS}
      iconClassName="opacity-60"
      contentInnerClassName="border-t border-border-black bg-panel-bg px-1.5 py-1"
      expandedMaxHeightClassName="max-h-[1200px]"
    >
      {children}
    </SharedCollapsibleSection>
  );
};

export const StaticSection = ({
  title,
  children,
  className = '',
  contentClassName = 'border-t border-border-black bg-panel-bg p-1.5',
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
  contentClassName?: string;
}) => (
  <div className={`overflow-hidden rounded-md border border-border-black ${className}`}>
    <div className={PROPERTY_EDITOR_SECTION_HEADER_CLASS}>{title}</div>
    <div className={contentClassName}>{children}</div>
  </div>
);

const usePressAndHoldStepper = (
  onStep: (direction: 1 | -1) => void,
  repeatIntervalMs: number = PROPERTY_EDITOR_STEPPER_REPEAT_INTERVAL_MS,
) => {
  const { repeatButtonProps: stepperButtonProps } = usePressAndHoldRepeat(onStep, {
    repeatDelayMs: PROPERTY_EDITOR_STEPPER_REPEAT_DELAY_MS,
    repeatIntervalMs,
  });

  return { stepperButtonProps };
};

export const NumberInput = ({
  value,
  onChange,
  label,
  suffix,
  step = 0.1,
  compact = false,
  precision = MAX_PROPERTY_DECIMALS,
  commitPrecision,
  trimTrailingZeros = true,
  minimumIntegerDigits,
  formatDisplayValue,
  parseDisplayValue,
  min,
  max,
  commitOnBlurOnly = false,
  repeatIntervalMs,
  showStepper = true,
}: {
  value: number;
  onChange: (val: number) => void;
  label?: string;
  suffix?: string;
  step?: number;
  compact?: boolean;
  precision?: number;
  commitPrecision?: number;
  trimTrailingZeros?: boolean;
  minimumIntegerDigits?: number;
  formatDisplayValue?: NumberInputDisplayFormatter;
  parseDisplayValue?: NumberInputDisplayParser;
  min?: number;
  max?: number;
  commitOnBlurOnly?: boolean;
  repeatIntervalMs?: number;
  showStepper?: boolean;
}) => {
  const {
    inputRef,
    handleInputFocus,
    handleInputPointerDown,
    clearPointerFocusIntent,
    collapseInputSelection,
  } = useInputSelectionBehavior();
  const {
    applyStep,
    applyStepDelta,
    handleBlur,
    handleFocus,
    handleChange,
    handleKeyDown,
    localValue,
  } = useNumberInputController({
    value,
    onChange,
    step,
    precision,
    commitPrecision,
    trimTrailingZeros,
    minimumIntegerDigits,
    formatDisplayValue,
    parseDisplayValue,
    min,
    max,
    commitOnBlurOnly,
    inputRef,
    collapseInputSelection,
  });

  const { isScrubbing, scrubInputProps } = useHorizontalNumberScrub({
    applyStepDelta,
    collapseInputSelection,
    onPointerDown: handleInputPointerDown,
    onPointerEnd: clearPointerFocusIntent,
  });

  const { stepperButtonProps } = usePressAndHoldStepper(applyStep, repeatIntervalMs);

  return (
    <div className="flex flex-col">
      {label && <span className={`${PROPERTY_EDITOR_SUBLABEL_CLASS} mb-0.5`}>{label}</span>}
      <div
        className={
          compact
            ? PROPERTY_EDITOR_COMPACT_NUMBER_FIELD_SHELL_CLASS
            : PROPERTY_EDITOR_NUMBER_FIELD_SHELL_CLASS
        }
      >
        <input
          ref={inputRef}
          type="text"
          inputMode="decimal"
          value={localValue}
          onChange={handleChange}
          onBlur={() => {
            clearPointerFocusIntent();
            handleBlur();
          }}
          onFocus={(e) => {
            handleFocus();
            handleInputFocus(e);
          }}
          onKeyDown={handleKeyDown}
          {...scrubInputProps}
          className={`min-w-0 flex-1 bg-transparent leading-4 text-text-primary tabular-nums outline-none ${
            isScrubbing ? 'cursor-ew-resize' : 'cursor-text hover:cursor-ew-resize'
          } ${compact ? 'px-1.5 text-[10px]' : 'px-1.5 text-[10px]'}`}
        />
        {suffix ? (
          <span className="shrink-0 border-l border-border-black/60 px-1 text-[8px] font-medium uppercase tracking-[0.06em] text-text-tertiary">
            {suffix}
          </span>
        ) : null}
        {showStepper ? (
          <div className={PROPERTY_EDITOR_STEPPER_RAIL_CLASS}>
            <button
              {...stepperButtonProps(1, label ? `Increase ${label}` : 'Increase value')}
              className={PROPERTY_EDITOR_STEPPER_BUTTON_CLASS}
            >
              <Plus className="h-[7px] w-[7px]" />
            </button>
            <button
              {...stepperButtonProps(-1, label ? `Decrease ${label}` : 'Decrease value')}
              className={`${PROPERTY_EDITOR_STEPPER_BUTTON_CLASS} border-t border-border-black/60`}
            >
              <Minus className="h-[7px] w-[7px]" />
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
};

export interface Vec3Value {
  x?: number;
  y?: number;
  z?: number;
  r?: number;
  p?: number;
}

export const InlineNumberInput = ({
  value,
  onChange,
  label,
  step = 0.1,
  compact = false,
  precision = MAX_PROPERTY_DECIMALS,
  commitPrecision,
  trimTrailingZeros = true,
  minimumIntegerDigits,
  formatDisplayValue,
  parseDisplayValue,
  min,
  max,
  repeatIntervalMs,
  showStepper = true,
}: {
  value: number;
  onChange: (val: number) => void;
  label: string;
  step?: number;
  compact?: boolean;
  precision?: number;
  commitPrecision?: number;
  trimTrailingZeros?: boolean;
  minimumIntegerDigits?: number;
  formatDisplayValue?: NumberInputDisplayFormatter;
  parseDisplayValue?: NumberInputDisplayParser;
  min?: number;
  max?: number;
  repeatIntervalMs?: number;
  showStepper?: boolean;
}) => {
  const {
    inputRef,
    handleInputFocus,
    handleInputPointerDown,
    clearPointerFocusIntent,
    collapseInputSelection,
  } = useInputSelectionBehavior();
  const {
    applyStep,
    applyStepDelta,
    handleBlur,
    handleFocus,
    handleChange,
    handleKeyDown,
    localValue,
  } = useNumberInputController({
    value,
    onChange,
    step,
    precision,
    commitPrecision,
    trimTrailingZeros,
    minimumIntegerDigits,
    formatDisplayValue,
    parseDisplayValue,
    min,
    max,
    inputRef,
    collapseInputSelection,
  });

  const { isScrubbing, scrubInputProps } = useHorizontalNumberScrub({
    applyStepDelta,
    collapseInputSelection,
    onPointerDown: handleInputPointerDown,
    onPointerEnd: clearPointerFocusIntent,
  });

  const { stepperButtonProps } = usePressAndHoldStepper(applyStep, repeatIntervalMs);

  return (
    <div className="min-w-0">
      <div
        className={
          compact
            ? PROPERTY_EDITOR_COMPACT_NUMBER_FIELD_SHELL_CLASS
            : PROPERTY_EDITOR_NUMBER_FIELD_SHELL_CLASS
        }
      >
        <input
          ref={inputRef}
          type="text"
          inputMode="decimal"
          value={localValue}
          onChange={handleChange}
          onBlur={() => {
            clearPointerFocusIntent();
            handleBlur();
          }}
          onFocus={(e) => {
            handleFocus();
            handleInputFocus(e);
          }}
          onKeyDown={handleKeyDown}
          {...scrubInputProps}
          aria-label={label}
          className={`min-w-0 flex-1 bg-transparent leading-4 text-text-primary tabular-nums outline-none ${
            isScrubbing ? 'cursor-ew-resize' : 'cursor-text hover:cursor-ew-resize'
          } ${compact ? 'px-1.5 text-[10px]' : 'px-1.5 text-[10px]'}`}
        />
        {showStepper ? (
          <div className={PROPERTY_EDITOR_STEPPER_RAIL_CLASS}>
            <button
              {...stepperButtonProps(1, `Increase ${label}`)}
              className={PROPERTY_EDITOR_STEPPER_BUTTON_CLASS}
            >
              <Plus className="h-[7px] w-[7px]" />
            </button>
            <button
              {...stepperButtonProps(-1, `Decrease ${label}`)}
              className={`${PROPERTY_EDITOR_STEPPER_BUTTON_CLASS} border-t border-border-black/60`}
            >
              <Minus className="h-[7px] w-[7px]" />
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
};

export const AxisNumberGridInput = <T extends string>({
  value,
  onChange,
  labels,
  keys,
  compact = false,
  labelPlacement = 'stacked',
  step,
  precision = MAX_PROPERTY_DECIMALS,
  commitPrecision,
  trimTrailingZeros = true,
  minimumIntegerDigits,
  formatDisplayValue,
  parseDisplayValue,
  repeatIntervalMs,
}: {
  value: Partial<Record<T, number>>;
  onChange: (v: Partial<Record<T, number>>) => void;
  labels: string[];
  keys: readonly T[];
  compact?: boolean;
  labelPlacement?: 'stacked' | 'inline';
  step?: number;
  precision?: number;
  commitPrecision?: number;
  trimTrailingZeros?: boolean;
  minimumIntegerDigits?: number;
  formatDisplayValue?: NumberInputDisplayFormatter;
  parseDisplayValue?: NumberInputDisplayParser;
  repeatIntervalMs?: number;
}) => {
  if (labelPlacement === 'inline') {
    return (
      <div
        className="grid min-w-0 gap-1.5"
        style={{ gridTemplateColumns: `repeat(${keys.length}, minmax(0, 1fr))` }}
      >
        {keys.map((key, index) => (
          <div key={String(key)} className="flex min-w-0 items-center gap-1.5">
            <span
              className={`${PROPERTY_EDITOR_INLINE_AXIS_LABEL_CLASS} min-w-0 shrink truncate text-right`}
              title={labels[index] ?? String(key)}
            >
              {labels[index] ?? String(key)}
            </span>
            <div className="min-w-0 flex-1">
              <InlineNumberInput
                label={labels[index] ?? String(key)}
                value={value[key] ?? 0}
                onChange={(nextValue) => onChange({ ...value, [key]: nextValue })}
                compact={compact}
                step={step}
                precision={precision}
                commitPrecision={commitPrecision}
                trimTrailingZeros={trimTrailingZeros}
                minimumIntegerDigits={minimumIntegerDigits}
                formatDisplayValue={formatDisplayValue}
                parseDisplayValue={parseDisplayValue}
                repeatIntervalMs={repeatIntervalMs}
              />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-0.5">
      <div
        className="grid gap-1"
        style={{ gridTemplateColumns: `repeat(${keys.length}, minmax(0, 1fr))` }}
      >
        {labels.map((label) => (
          <span key={label} className={`${PROPERTY_EDITOR_INLINE_AXIS_LABEL_CLASS} text-center`}>
            {label}
          </span>
        ))}
      </div>
      <div
        className="grid gap-1.5"
        style={{ gridTemplateColumns: `repeat(${keys.length}, minmax(0, 1fr))` }}
      >
        {keys.map((key, index) => (
          <InlineNumberInput
            key={String(key)}
            label={labels[index] ?? String(key)}
            value={value[key] ?? 0}
            onChange={(nextValue) => onChange({ ...value, [key]: nextValue })}
            compact={compact}
            step={step}
            precision={precision}
            commitPrecision={commitPrecision}
            trimTrailingZeros={trimTrailingZeros}
            minimumIntegerDigits={minimumIntegerDigits}
            formatDisplayValue={formatDisplayValue}
            parseDisplayValue={parseDisplayValue}
            repeatIntervalMs={repeatIntervalMs}
          />
        ))}
      </div>
    </div>
  );
};

export const Vec3Input = ({
  value,
  onChange,
  labels,
  keys = ['x', 'y', 'z'],
  compact = false,
  step,
  precision = MAX_PROPERTY_DECIMALS,
  commitPrecision,
}: {
  value: Vec3Value;
  onChange: (v: Vec3Value) => void;
  labels: string[];
  keys?: string[];
  compact?: boolean;
  step?: number;
  precision?: number;
  commitPrecision?: number;
}) => (
  <div className="grid grid-cols-3 gap-1.5">
    <NumberInput
      label={labels[0]}
      value={(value as Record<string, number>)[keys[0]] ?? 0}
      onChange={(v: number) => onChange({ ...value, [keys[0]]: v })}
      compact={compact}
      step={step}
      precision={precision}
      commitPrecision={commitPrecision}
    />
    <NumberInput
      label={labels[1]}
      value={(value as Record<string, number>)[keys[1]] ?? 0}
      onChange={(v: number) => onChange({ ...value, [keys[1]]: v })}
      compact={compact}
      step={step}
      precision={precision}
      commitPrecision={commitPrecision}
    />
    <NumberInput
      label={labels[2]}
      value={(value as Record<string, number>)[keys[2]] ?? 0}
      onChange={(v: number) => onChange({ ...value, [keys[2]]: v })}
      compact={compact}
      step={step}
      precision={precision}
      commitPrecision={commitPrecision}
    />
  </div>
);

export const Vec3InlineInput = ({
  value,
  onChange,
  labels,
  keys = ['x', 'y', 'z'],
  compact = false,
  labelPlacement = 'inline',
  step,
  precision = MAX_PROPERTY_DECIMALS,
  commitPrecision,
  repeatIntervalMs,
}: {
  value: Vec3Value;
  onChange: (v: Vec3Value) => void;
  labels: string[];
  keys?: readonly string[];
  compact?: boolean;
  labelPlacement?: 'stacked' | 'inline';
  step?: number;
  precision?: number;
  commitPrecision?: number;
  repeatIntervalMs?: number;
}) => (
  <AxisNumberGridInput
    value={value as Record<string, number>}
    onChange={(nextValue) => onChange(nextValue as Vec3Value)}
    labels={labels}
    keys={keys}
    compact={compact}
    labelPlacement={labelPlacement}
    step={step}
    precision={precision}
    commitPrecision={commitPrecision}
    repeatIntervalMs={repeatIntervalMs}
  />
);
