interface DisposableRenderInterface {
  dispose?: () => void;
}

export interface UsdWorkerStageBindings<TRenderInterface extends DisposableRenderInterface> {
  driver?: unknown;
  renderInterface?: TRenderInterface;
  usdStage?: unknown;
}

interface StageResources<TRenderInterface> {
  driver: unknown;
  renderInterface: TRenderInterface | null;
  usdStage: unknown;
}

/**
 * Owns stage generations and committed WASM handles. A load may overwrite the
 * runtime's globals before resolving; resources are captured at creation so a
 * stale completion never takes ownership of a newer load's transient globals. Scene/GL resources have a separate owner.
 */
export function createUsdWorkerStageSession<TRenderInterface extends DisposableRenderInterface>(
  bindings: UsdWorkerStageBindings<TRenderInterface>,
  disposeDriver: (driver: unknown) => void,
) {
  let generation = 0;
  let disposed = false;
  let committed: StageResources<TRenderInterface> = {
    driver: null,
    renderInterface: null,
    usdStage: undefined,
  };

  const disposedRenderInterfaces = new WeakSet<TRenderInterface>();
  const disposeRenderInterface = (renderInterface: TRenderInterface | null | undefined) => {
    if (!renderInterface || disposedRenderInterfaces.has(renderInterface)) return;
    disposedRenderInterfaces.add(renderInterface);
    renderInterface.dispose?.();
  };
  const capture = (): StageResources<TRenderInterface> => ({
    driver: bindings.driver ?? null,
    renderInterface: bindings.renderInterface ?? null,
    usdStage: bindings.usdStage,
  });
  const restoreCommitted = () => {
    bindings.driver = committed.driver || undefined;
    bindings.renderInterface = committed.renderInterface ?? undefined;
    bindings.usdStage = committed.usdStage;
  };
  const discard = (resources: StageResources<TRenderInterface>) => {
    if (resources.driver && resources.driver !== committed.driver) {
      disposeDriver(resources.driver);
    }
    if (resources.renderInterface && resources.renderInterface !== committed.renderInterface) {
      disposeRenderInterface(resources.renderInterface);
    }
    // A newer load may own these globals before it commits. Restore only fields
    // still pointing to this discarded load's explicitly captured resources.
    if (bindings.driver === resources.driver) bindings.driver = committed.driver || undefined;
    if (bindings.renderInterface === resources.renderInterface)
      bindings.renderInterface = committed.renderInterface ?? undefined;
    if (bindings.usdStage === resources.usdStage) bindings.usdStage = committed.usdStage;
  };
  const isActive = (loadGeneration: number) => !disposed && loadGeneration === generation;
  const releaseStage = () => {
    if (committed.driver) {
      disposeDriver(committed.driver);
    }
    disposeRenderInterface(committed.renderInterface ?? bindings.renderInterface);
    committed = { driver: null, renderInterface: null, usdStage: undefined };
    restoreCommitted();
  };

  return {
    get generation() {
      return generation;
    },
    get disposed() {
      return disposed;
    },
    get driver() {
      return committed.driver;
    },
    isActive,
    beginLoad() {
      const loadGeneration = ++generation;
      let resources: StageResources<TRenderInterface> | null = null;
      return {
        generation: loadGeneration,
        isActive: () => isActive(loadGeneration),
        /** Called synchronously when this load creates its render interface. */
        captureResources(): void {
          resources = capture();
        },
        adopt(driver: unknown): boolean {
          resources = {
            ...(resources ?? (isActive(loadGeneration)
              ? capture()
              : { driver: null, renderInterface: null, usdStage: undefined })),
            driver: driver ?? resources?.driver ?? null,
          };
          if (!isActive(loadGeneration)) {
            discard(resources);
            return false;
          }
          // A missing load-result driver remains a caller-visible load failure.
          if (driver) {
            committed = { ...resources, driver, usdStage: bindings.usdStage };
            bindings.driver = driver;
          }
          return true;
        },
        /** Returns true when a stale failure was contained without touching the current stage. */
        discardIfStale(): boolean {
          if (isActive(loadGeneration)) {
            return false;
          }
          if (resources) discard(resources);
          return true;
        },
      };
    },
    invalidate() {
      generation += 1;
    },
    releaseStage,
    dispose() {
      disposed = true;
      generation += 1;
      releaseStage();
    },
  };
}
