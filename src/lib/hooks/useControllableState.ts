import { useCallback, useRef, useState } from 'react';

interface UseControllableStateOptions<T> {
  value?: T;
  defaultValue: T;
  onChange?: (nextValue: T) => void;
}

export function useControllableState<T>({
  value,
  defaultValue,
  onChange,
}: UseControllableStateOptions<T>) {
  const [uncontrolledValue, setUncontrolledValue] = useState(defaultValue);
  const isControlled = value !== undefined;
  const currentValue = isControlled ? value : uncontrolledValue;

  // The setter is part of callback chains owned by consumers such as
  // RobotCanvas. Keep its identity stable while still reading the latest
  // controlled value and change handler at call time.
  const currentValueRef = useRef(currentValue);
  const isControlledRef = useRef(isControlled);
  const onChangeRef = useRef(onChange);
  currentValueRef.current = currentValue;
  isControlledRef.current = isControlled;
  onChangeRef.current = onChange;

  const setValue = useCallback(
    (nextValue: T | ((previousValue: T) => T)) => {
      const resolvedValue =
        typeof nextValue === 'function'
          ? (nextValue as (previousValue: T) => T)(currentValueRef.current)
          : nextValue;

      // Mirror React's queued updater semantics for consecutive calls before
      // the next render. A controlled render will reconcile this ref back to
      // the authoritative prop value.
      currentValueRef.current = resolvedValue;

      if (!isControlledRef.current) {
        setUncontrolledValue(resolvedValue);
      }

      onChangeRef.current?.(resolvedValue);
    },
    [],
  );

  return [currentValue, setValue] as const;
}
