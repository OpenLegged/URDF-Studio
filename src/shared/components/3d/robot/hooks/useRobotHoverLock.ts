import { useCallback, useEffect, useState } from 'react';

interface RobotHoverLockOptions {
  enabled: boolean;
  externalFrozen?: boolean;
  onFrozenChange?: (frozen: boolean) => void;
}

/** Each renderer owns its lock; an optional host port coordinates Studio viewers. */
export function useRobotHoverLock({
  enabled,
  externalFrozen = false,
  onFrozenChange,
}: RobotHoverLockOptions) {
  const [localFrozen, setLocalFrozen] = useState(false);
  const setFrozen = useCallback((frozen: boolean) => {
    setLocalFrozen(frozen);
    onFrozenChange?.(frozen);
  }, [onFrozenChange]);

  useEffect(() => {
    if (!enabled) setFrozen(false);
    return () => onFrozenChange?.(false);
  }, [enabled, onFrozenChange, setFrozen]);

  return { frozen: externalFrozen || localFrozen, setFrozen };
}
