import React from 'react';

export interface SnapshotRenderContextValue {
  snapshotRenderActive: boolean;
  /** Synchronous mirror used by the render loop before React commits state. */
  snapshotRenderActiveRef?: React.RefObject<boolean>;
  setSnapshotRenderActive: (active: boolean) => void;
}

interface SnapshotRenderStateProviderProps {
  value: SnapshotRenderContextValue;
  children?: React.ReactNode;
}

const noop = () => {};

const SnapshotRenderContext = React.createContext<SnapshotRenderContextValue>({
  snapshotRenderActive: false,
  setSnapshotRenderActive: noop,
});

export function SnapshotRenderStateProvider({ value, children }: SnapshotRenderStateProviderProps) {
  const contextValue = React.useMemo(
    () => ({
      snapshotRenderActive: value.snapshotRenderActive,
      snapshotRenderActiveRef: value.snapshotRenderActiveRef,
      setSnapshotRenderActive: value.setSnapshotRenderActive,
    }),
    [
      value.setSnapshotRenderActive,
      value.snapshotRenderActive,
      value.snapshotRenderActiveRef,
    ],
  );

  return (
    <SnapshotRenderContext.Provider value={contextValue}>{children}</SnapshotRenderContext.Provider>
  );
}

export function useSnapshotRenderContext() {
  return React.useContext(SnapshotRenderContext);
}

export function useSnapshotRenderActive() {
  return useSnapshotRenderContext().snapshotRenderActive;
}
