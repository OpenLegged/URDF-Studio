/**
 * Number input controller — number-input state machine (format/parse/commit/
 * revert/step/blur) extracted from FormControls so it is independently
 * testable and reusable. No UI rendering.
 *
 * Boundary: feature hook (property-editor). Imports React +
 * `@/core/utils/numberPrecision`.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  MAX_PROPERTY_DECIMALS,
  formatNumberWithMaxDecimals,
  roundToMaxDecimals,
} from '@/core/utils/numberPrecision';

export const useInputSelectionBehavior = () => {
  const inputRef = useRef<HTMLInputElement>(null);
  const pointerFocusIntentRef = useRef(false);

  const clearPointerFocusIntent = useCallback(() => {
    pointerFocusIntentRef.current = false;
  }, []);

  const handleInputPointerDown = useCallback(() => {
    pointerFocusIntentRef.current = true;
  }, []);

  const handleInputFocus = useCallback(
    (event: React.FocusEvent<HTMLInputElement>) => {
      if (!pointerFocusIntentRef.current) {
        event.target.select();
      }
      clearPointerFocusIntent();
    },
    [clearPointerFocusIntent],
  );

  const collapseInputSelection = useCallback(() => {
    clearPointerFocusIntent();
    const input = inputRef.current;
    if (!input || document.activeElement !== input) {
      return;
    }

    const caretPosition = input.value.length;
    input.setSelectionRange(caretPosition, caretPosition);
  }, [clearPointerFocusIntent]);

  return {
    inputRef,
    handleInputFocus,
    handleInputPointerDown,
    clearPointerFocusIntent,
    collapseInputSelection,
  };
};

const clampNumberToBounds = (value: number, min?: number, max?: number): number => {
  let nextValue = value;

  if (min !== undefined) {
    nextValue = Math.max(min, nextValue);
  }

  if (max !== undefined) {
    nextValue = Math.min(max, nextValue);
  }

  return nextValue;
};

const areNumberInputValuesEqual = (left: number, right: number, precision: number): boolean =>
  roundToMaxDecimals(left, precision) === roundToMaxDecimals(right, precision);

export type NumberInputDisplayFormatter = (value: number) => string;
export type NumberInputDisplayParser = (value: string) => number | null;

export interface UseNumberInputControllerArgs {
  value: number;
  onChange: (val: number) => void;
  step: number;
  precision: number;
  commitPrecision?: number;
  trimTrailingZeros: boolean;
  minimumIntegerDigits?: number;
  formatDisplayValue?: NumberInputDisplayFormatter;
  parseDisplayValue?: NumberInputDisplayParser;
  min?: number;
  max?: number;
  commitOnBlurOnly?: boolean;
  inputRef: React.RefObject<HTMLInputElement | null>;
  collapseInputSelection: () => void;
}

export const useNumberInputController = ({
  value,
  onChange,
  step,
  precision,
  commitPrecision = precision,
  trimTrailingZeros,
  minimumIntegerDigits = 1,
  formatDisplayValue,
  parseDisplayValue,
  min,
  max,
  commitOnBlurOnly = false,
  inputRef,
  collapseInputSelection,
}: UseNumberInputControllerArgs) => {
  const [isFocused, setIsFocused] = useState(false);

  const formatValue = useCallback(
    (nextValue: number, activeFocus = isFocused) => {
      if (!Number.isFinite(nextValue)) {
        return '';
      }

      if (formatDisplayValue) {
        return formatDisplayValue(nextValue ?? 0);
      }

      const activePrecision = activeFocus ? MAX_PROPERTY_DECIMALS : precision;

      const roundedValue = roundToMaxDecimals(nextValue ?? 0, activePrecision);

      if (trimTrailingZeros) {
        return formatNumberWithMaxDecimals(roundedValue, activePrecision) || '0';
      }

      const fixedValue = roundedValue.toFixed(activePrecision);
      const isNegative = fixedValue.startsWith('-');
      const unsignedValue = isNegative ? fixedValue.slice(1) : fixedValue;
      const [integerPart, decimalPart] = unsignedValue.split('.');
      const paddedIntegerPart = integerPart.padStart(minimumIntegerDigits, '0');
      return `${isNegative ? '-' : ''}${paddedIntegerPart}${decimalPart !== undefined ? `.${decimalPart}` : ''}`;
    },
    [formatDisplayValue, minimumIntegerDigits, precision, trimTrailingZeros, isFocused],
  );
  const parseValue = useCallback(
    (nextDraftValue: string) => {
      const parsedValue = parseDisplayValue
        ? parseDisplayValue(nextDraftValue)
        : Number.parseFloat(nextDraftValue);

      return Number.isFinite(parsedValue) ? parsedValue : null;
    },
    [parseDisplayValue],
  );
  const [localValue, setLocalValue] = useState<string>(() => formatValue(value ?? 0, false));
  const valueRef = useRef<number>(value ?? 0);
  const latestCommittedValueRef = useRef<number>(value ?? 0);
  const draftValueRef = useRef<string>(formatValue(value ?? 0, false));
  const pendingLocalCommitRef = useRef<{
    previousValue: number;
    normalizedValue: number;
  } | null>(null);

  useEffect(() => {
    const boundedValue = clampNumberToBounds(value ?? 0, min, max);
    const formattedValue = formatValue(boundedValue, isFocused);
    const pendingLocalCommit = pendingLocalCommitRef.current;

    if (pendingLocalCommit) {
      if (
        areNumberInputValuesEqual(
          boundedValue,
          pendingLocalCommit.normalizedValue,
          commitPrecision,
        )
      ) {
        pendingLocalCommitRef.current = null;
      } else if (
        areNumberInputValuesEqual(
          boundedValue,
          pendingLocalCommit.previousValue,
          commitPrecision,
        )
      ) {
        return;
      } else {
        pendingLocalCommitRef.current = null;
      }
    }

    valueRef.current = boundedValue;
    latestCommittedValueRef.current = boundedValue;

    if (document.activeElement !== inputRef.current) {
      draftValueRef.current = formattedValue;
      setLocalValue(formattedValue);
    }
  }, [commitPrecision, formatValue, inputRef, max, min, value, isFocused]);

  const commitValue = useCallback(
    (nextValue: number, options?: { preserveDraftDisplay?: boolean }) => {
      const previousValue = valueRef.current;
      const roundedInput = roundToMaxDecimals(nextValue, commitPrecision);
      const normalizedValue = roundToMaxDecimals(
        clampNumberToBounds(roundedInput, min, max),
        commitPrecision,
      );
      const formattedValue = formatValue(normalizedValue);

      latestCommittedValueRef.current = normalizedValue;
      draftValueRef.current = formattedValue;

      if (!areNumberInputValuesEqual(normalizedValue, previousValue, commitPrecision)) {
        valueRef.current = normalizedValue;
        pendingLocalCommitRef.current = {
          previousValue,
          normalizedValue,
        };
        onChange(normalizedValue);
      }

      if (!options?.preserveDraftDisplay) {
        setLocalValue(formattedValue);
      }

      return {
        formattedValue,
        normalizedValue,
        wasClamped: normalizedValue !== roundedInput,
      };
    },
    [commitPrecision, formatValue, max, min, onChange],
  );

  const revertToCommittedValue = useCallback(
    (activeFocus = isFocused) => {
      const formattedValue = formatValue(valueRef.current, activeFocus);
      draftValueRef.current = formattedValue;
      setLocalValue(formattedValue);
    },
    [formatValue, isFocused],
  );

  const handleFocus = useCallback(() => {
    setIsFocused(true);
    const formattedValue = formatValue(valueRef.current, true);
    draftValueRef.current = formattedValue;
    setLocalValue(formattedValue);
  }, [formatValue]);

  const handleBlur = useCallback(() => {
    setIsFocused(false);

    if (
      draftValueRef.current === formatValue(valueRef.current, true) ||
      draftValueRef.current === formatValue(valueRef.current, false)
    ) {
      revertToCommittedValue(false);
      return;
    }

    const parsed = parseValue(draftValueRef.current);
    if (parsed !== null) {
      commitValue(parsed);
      return;
    }

    revertToCommittedValue(false);
  }, [commitValue, parseValue, revertToCommittedValue, formatValue]);

  const applyStepDelta = useCallback(
    (stepCount: number) => {
      if (stepCount === 0) {
        return;
      }

      collapseInputSelection();
      const parsed = parseValue(draftValueRef.current);
      const baseValue =
        parsed !== null ? clampNumberToBounds(parsed, min, max) : latestCommittedValueRef.current;
      commitValue(baseValue + stepCount * step);
    },
    [collapseInputSelection, commitValue, max, min, parseValue, step],
  );
  const applyStep = useCallback(
    (direction: 1 | -1) => applyStepDelta(direction),
    [applyStepDelta],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        (e.target as HTMLInputElement).blur();
        return;
      }

      if (e.key === 'ArrowUp') {
        e.preventDefault();
        applyStep(1);
        return;
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        applyStep(-1);
      }
    },
    [applyStep],
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const nextDraftValue = e.target.value;
      draftValueRef.current = nextDraftValue;
      setLocalValue(nextDraftValue);

      const parsed = parseValue(nextDraftValue);
      if (parsed === null) {
        return;
      }

      if (commitOnBlurOnly) {
        return;
      }

      const { formattedValue, wasClamped } = commitValue(parsed, {
        preserveDraftDisplay: true,
      });

      if (wasClamped) {
        draftValueRef.current = formattedValue;
        setLocalValue(formattedValue);
      }
    },
    [commitOnBlurOnly, commitValue, parseValue],
  );

  return {
    applyStep,
    applyStepDelta,
    handleBlur,
    handleFocus,
    handleChange,
    handleKeyDown,
    localValue,
  };
};
