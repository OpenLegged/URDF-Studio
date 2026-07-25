import React from 'react';

export interface SliderMark {
  value: number;
  label: React.ReactNode;
}

interface SliderProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  onChangeStart?: () => void;
  onChangeEnd?: () => void;
  label?: string;
  labelClassName?: string;
  showValue?: boolean;
  formatValue?: (val: number) => string;
  icon?: React.ReactNode;
  className?: string;
  disabled?: boolean;
  marks?: SliderMark[];
  snapToMarks?: boolean;
  solidThumb?: boolean;
  compactThumb?: boolean;
  parseValue?: (value: string) => number | null;
}

export const Slider: React.FC<SliderProps> = ({
  value,
  min,
  max,
  step = 1,
  onChange,
  onChangeStart,
  onChangeEnd,
  label,
  labelClassName = '',
  showValue = true,
  formatValue,
  icon,
  className = '',
  disabled = false,
  marks,
  snapToMarks = false,
  solidThumb = false,
  compactThumb = false,
  parseValue,
}) => {
  const safeMin = Math.min(min, max);
  const safeMax = Math.max(min, max);
  const thumbWidth = compactThumb ? 16 : 18;
  const halfThumb = thumbWidth / 2;
  const thumbClassName = compactThumb ? 'h-4 w-4' : 'h-[18px] w-[18px]';
  const nativeThumbClassName = compactThumb
    ? '[&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-transparent [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-0 [&::-webkit-slider-thumb]:bg-transparent'
    : '[&::-moz-range-thumb]:h-[18px] [&::-moz-range-thumb]:w-[18px] [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-transparent [&::-webkit-slider-thumb]:h-[18px] [&::-webkit-slider-thumb]:w-[18px] [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-0 [&::-webkit-slider-thumb]:bg-transparent';
  const sliderRef = React.useRef<HTMLDivElement>(null);
  const formatDisplayValue = React.useCallback(
    (nextValue: number) => (formatValue ? formatValue(nextValue) : `${nextValue}`),
    [formatValue],
  );
  const parseDisplayValue = React.useCallback(
    (input: string) => {
      if (parseValue) {
        return parseValue(input);
      }

      const normalized = input
        .trim()
        .replace(/,/g, '')
        .replace(/[^0-9eE+.-]/g, '');
      if (!normalized) {
        return null;
      }

      const numericValue = Number.parseFloat(normalized);
      return Number.isFinite(numericValue) ? numericValue : null;
    },
    [parseValue],
  );
  const clampToRange = React.useCallback(
    (nextValue: number) => {
      if (!Number.isFinite(nextValue)) return safeMin;
      return Math.min(Math.max(nextValue, safeMin), safeMax);
    },
    [safeMin, safeMax],
  );
  const resolvedMarks = React.useMemo(
    () =>
      (marks ?? [])
        .map((mark) => ({
          ...mark,
          value: clampToRange(mark.value),
        }))
        .sort((left, right) => left.value - right.value),
    [clampToRange, marks],
  );
  const snapToStep = React.useCallback(
    (nextValue: number) => {
      const clampedValue = clampToRange(nextValue);

      if (snapToMarks && resolvedMarks.length > 0) {
        let nearestMarkValue = resolvedMarks[0].value;
        let smallestDistance = Math.abs(clampedValue - nearestMarkValue);

        for (let index = 1; index < resolvedMarks.length; index += 1) {
          const distance = Math.abs(clampedValue - resolvedMarks[index].value);
          if (distance < smallestDistance) {
            smallestDistance = distance;
            nearestMarkValue = resolvedMarks[index].value;
          }
        }

        return nearestMarkValue;
      }

      if (!Number.isFinite(step) || step <= 0) {
        return clampedValue;
      }

      const steppedValue = safeMin + Math.round((clampedValue - safeMin) / step) * step;
      const stepDecimals = `${step}`.split('.')[1]?.length ?? 0;
      const precision = Math.min(stepDecimals + 2, 10);

      return clampToRange(Number(steppedValue.toFixed(precision)));
    },
    [clampToRange, resolvedMarks, safeMin, snapToMarks, step],
  );

  const [localValue, setLocalValue] = React.useState(() => clampToRange(value));
  const [isDragging, setIsDragging] = React.useState(false);
  const [isThumbHovered, setIsThumbHovered] = React.useState(false);
  const [isEditingValue, setIsEditingValue] = React.useState(false);
  const [valueInput, setValueInput] = React.useState(() => formatDisplayValue(clampToRange(value)));

  React.useEffect(() => {
    if (!isDragging) {
      setLocalValue(clampToRange(value));
    }
  }, [value, isDragging, clampToRange]);

  React.useEffect(() => {
    if (!isEditingValue) {
      setValueInput(formatDisplayValue(localValue));
    }
  }, [formatDisplayValue, isEditingValue, localValue]);

  const latestValuesRef = React.useRef({
    safeMin,
    safeMax,
    step,
    isDragging,
  });

  React.useEffect(() => {
    latestValuesRef.current = {
      safeMin,
      safeMax,
      step,
      isDragging,
    };
  });

  const stopDragging = React.useCallback(() => {
    setIsDragging(false);
    onChangeEnd?.();
  }, [onChangeEnd]);

  const handleChange = React.useCallback(
    (newValue: number) => {
      const clampedValue = clampToRange(newValue);
      setLocalValue(clampedValue);
      onChange(clampedValue);
    },
    [clampToRange, onChange],
  );

  const updateValueFromClientX = React.useCallback(
    (clientX: number) => {
      const sliderElement = sliderRef.current;
      if (!sliderElement) {
        return;
      }

      const rect = sliderElement.getBoundingClientRect();
      if (rect.width <= 0) {
        return;
      }

      const {
        safeMin: currentMin,
        safeMax: currentMax,
        step: currentStep,
      } = latestValuesRef.current;
      const ratio = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1);
      const rawValue = currentMin + ratio * (currentMax - currentMin);

      // Snap logic moved into a local helper to use latest step/min
      const clampedValue = Math.min(Math.max(rawValue, currentMin), currentMax);
      let snappedValue = clampedValue;
      if (Number.isFinite(currentStep) && currentStep > 0) {
        snappedValue =
          currentMin + Math.round((clampedValue - currentMin) / currentStep) * currentStep;
        const stepDecimals = `${currentStep}`.split('.')[1]?.length ?? 0;
        const precision = Math.min(stepDecimals + 2, 10);
        snappedValue = Number(snappedValue.toFixed(precision));
        snappedValue = Math.min(Math.max(snappedValue, currentMin), currentMax);
      }

      handleChange(snappedValue);
    },
    [handleChange],
  );

  const range = safeMax - safeMin;
  const percentage = range > 0 ? ((localValue - safeMin) / range) * 100 : 0;
  // Visual Clamping: Ensure the slider UI stays within bounds even if value is out of range
  const clampedPercentage = Math.min(Math.max(percentage, 0), 100);
  const updateThumbHover = React.useCallback(
    (clientX: number, clientY: number) => {
      if (disabled) {
        setIsThumbHovered(false);
        return;
      }

      const sliderElement = sliderRef.current;
      if (!sliderElement) {
        setIsThumbHovered(false);
        return;
      }

      const rect = sliderElement.getBoundingClientRect();
      const thumbCenterX = rect.left + (clampedPercentage / 100) * rect.width;
      const thumbCenterY = rect.top + rect.height / 2;
      const withinX = Math.abs(clientX - thumbCenterX) <= halfThumb + (compactThumb ? 7 : 6);
      const withinY = Math.abs(clientY - thumbCenterY) <= 14;

      setIsThumbHovered(withinX && withinY);
    },
    [clampedPercentage, compactThumb, disabled, halfThumb],
  );

  React.useEffect(() => {
    if (!isDragging) return;

    const handlePointerMove = (event: PointerEvent) => {
      updateValueFromClientX(event.clientX);
    };

    const handlePointerUp = () => {
      stopDragging();
    };

    window.addEventListener('pointermove', handlePointerMove, { passive: true });
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
    window.addEventListener('blur', handlePointerUp);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
      window.removeEventListener('blur', handlePointerUp);
    };
  }, [isDragging, stopDragging, updateValueFromClientX]);

  const startDragging = React.useCallback(
    (clientX: number, pointerId?: number) => {
      if (disabled) {
        return;
      }

      setIsDragging((wasDragging) => {
        if (!wasDragging) {
          onChangeStart?.();
        }
        return true;
      });
      updateValueFromClientX(clientX);

      if (pointerId !== undefined && sliderRef.current?.setPointerCapture) {
        try {
          sliderRef.current.setPointerCapture(pointerId);
        } catch {
          // Ignore capture errors
        }
      }
    },
    [disabled, onChangeStart, updateValueFromClientX],
  );

  const handleTrackPointerDown = React.useCallback(
    (clientX: number) => {
      startDragging(clientX);
    },
    [startDragging],
  );

  const commitValueInput = React.useCallback(
    (nextInputValue?: string) => {
      const resolvedInputValue = nextInputValue ?? valueInput;
      const parsedValue = parseDisplayValue(resolvedInputValue);

      if (parsedValue === null) {
        setValueInput(formatDisplayValue(localValue));
        setIsEditingValue(false);
        return;
      }

      const nextValue = snapToStep(parsedValue);
      handleChange(nextValue);
      setValueInput(formatDisplayValue(nextValue));
      setIsEditingValue(false);
    },
    [formatDisplayValue, handleChange, localValue, parseDisplayValue, snapToStep, valueInput],
  );

  const thumbBoxShadow = disabled
    ? 'var(--ui-slider-thumb-shadow)'
    : isDragging
      ? 'var(--ui-slider-thumb-shadow-active)'
      : isThumbHovered
        ? 'var(--ui-slider-thumb-shadow-hover)'
        : 'var(--ui-slider-thumb-shadow)';
  const resolvedThumbBoxShadow = solidThumb
    ? `0 0 0 2px var(--ui-panel-bg), ${thumbBoxShadow}`
    : thumbBoxShadow;
  const valueInputClassName = compactThumb
    ? 'ml-2 h-5 w-12 shrink-0 rounded-md border border-transparent bg-transparent px-1 text-right text-ui-micro font-mono tabular-nums text-text-secondary transition-colors focus:bg-input-bg focus:text-text-primary focus:outline-none focus:ring-2 focus:ring-system-blue/30 focus:border-border-black disabled:cursor-not-allowed disabled:opacity-50'
    : 'ml-3 h-6 w-16 shrink-0 rounded-md border border-border-black bg-input-bg px-1.5 text-right text-ui-caption font-mono tabular-nums text-text-tertiary transition-colors focus:outline-none focus:ring-2 focus:ring-system-blue/30 focus:border-system-blue disabled:cursor-not-allowed disabled:opacity-50';
  return (
    <div className={`w-full ${className} touch-none`}>
      {(label || showValue) && (
        <div className="flex items-center justify-between mb-2">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {icon && <span className="text-text-tertiary">{icon}</span>}
            {label && (
              <span
                className={`min-w-0 truncate text-xs font-medium text-text-primary ${labelClassName}`}
              >
                {label}
              </span>
            )}
          </div>
          {showValue && (
            <input
              data-testid="ui-slider-value-input"
              type="text"
              value={valueInput}
              inputMode="decimal"
              disabled={disabled}
              aria-label={label ? `${label} value` : 'Slider value'}
              className={valueInputClassName}
              onFocus={(event) => {
                setIsEditingValue(true);
                event.currentTarget.select();
              }}
              onChange={(event) => {
                setValueInput(event.currentTarget.value);
              }}
              onBlur={(event) => {
                commitValueInput(event.currentTarget.value);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  event.currentTarget.blur();
                  return;
                }

                if (event.key === 'Escape') {
                  event.preventDefault();
                  setValueInput(formatDisplayValue(localValue));
                  setIsEditingValue(false);
                  event.currentTarget.blur();
                }
              }}
              onPointerDown={(event) => event.stopPropagation()}
            />
          )}
        </div>
      )}

      <div>
        <div
          ref={sliderRef}
          data-testid="ui-slider-track"
          className="group relative flex h-6 select-none items-center"
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            startDragging(event.clientX, event.pointerId);
          }}
          onPointerEnter={(e) => updateThumbHover(e.clientX, e.clientY)}
          onPointerMove={(e) => updateThumbHover(e.clientX, e.clientY)}
          onPointerLeave={() => setIsThumbHovered(false)}
        >
          {/* Track Background */}
          <div className="absolute h-[3px] w-full overflow-hidden rounded-full bg-slider-track">
            {/* Filled Track */}
            <div
              className="h-full bg-slider-accent transition-colors duration-200"
              style={{ width: `${clampedPercentage}%` }}
            />
          </div>
          <input
            data-testid="ui-slider-input"
            type="range"
            min={safeMin}
            max={safeMax}
            step={step}
            value={localValue}
            onInput={(e) => handleChange(parseFloat((e.target as HTMLInputElement).value))}
            onChange={(e) => handleChange(parseFloat((e.target as HTMLInputElement).value))}
            onPointerDown={(e) => {
              e.preventDefault();
            }}
            onPointerUp={stopDragging}
            onPointerCancel={stopDragging}
            disabled={disabled}
            className={`pointer-events-none absolute -top-1.5 z-0 h-8 appearance-none bg-transparent opacity-0 disabled:cursor-not-allowed ${nativeThumbClassName}`}
            style={{
              left: `-${halfThumb}px`,
              width: `calc(100% + ${thumbWidth}px)`,
            }}
          />
          {/* Thumb */}
          <div
            className={`pointer-events-none absolute top-1/2 z-10 ${thumbClassName} -translate-y-1/2 rounded-full transition-[transform,box-shadow] duration-150 ease-out group-focus-within:scale-105 group-focus-within:ring-4 group-focus-within:ring-system-blue/15 ${
              disabled
                ? 'opacity-60'
                : isDragging
                  ? 'scale-110 ring-4 ring-system-blue/15'
                  : isThumbHovered
                    ? compactThumb
                      ? 'scale-[1.08] ring-2 ring-system-blue/10'
                      : 'scale-[1.04]'
                    : 'scale-100'
            }`}
            data-testid="ui-slider-thumb"
            data-hovered={isThumbHovered ? 'true' : 'false'}
            style={{
              left: `calc(${clampedPercentage}% - ${halfThumb}px)`,
              backgroundColor: 'var(--ui-slider-thumb-bg)',
              border: '1px solid var(--ui-slider-thumb-border)',
              boxShadow: resolvedThumbBoxShadow,
            }}
          />
        </div>
        {resolvedMarks.length > 0 && (
          <div className="relative mt-2 h-7 px-0.5" data-testid="ui-slider-marks">
            {resolvedMarks.map((mark, index) => {
              const markPercentage = range > 0 ? ((mark.value - safeMin) / range) * 100 : 0;
              const alignmentClass =
                index === 0
                  ? 'translate-x-0'
                  : index === resolvedMarks.length - 1
                    ? '-translate-x-full'
                    : '-translate-x-1/2';

              return (
                <div
                  key={`${mark.value}-${index}`}
                  className={`absolute top-0 ${alignmentClass} text-center`}
                  style={{ left: `${markPercentage}%` }}
                >
                  <div className="mx-auto h-1.5 w-px rounded-full bg-border-black/70" />
                  <div
                    className={`mt-1 whitespace-nowrap text-ui-micro font-medium ${
                      disabled ? 'text-text-tertiary/60' : 'text-text-tertiary'
                    }`}
                  >
                    {mark.label}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
