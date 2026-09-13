import {
  buildUsdBindingsAssetPath,
  buildUsdBindingsScriptUrl,
  ensureClassicScriptLoaded,
} from './usdBindingsScriptLoader.ts';
import { logRuntimeFailure } from '@/core/utils/runtimeDiagnostics';
import type {
  LoadUsdStageFn,
  UsdFsHelperInstance,
  UsdModule,
} from '../../../features/urdf-viewer/runtime/viewer/usd-loader.types';
import { USD_BINDINGS_CACHE_KEY } from './usdBindingsAssetPaths.ts';

type LoadVirtualFileFn = (args: {
  USD: UsdModule;
  usdFsHelper: UsdFsHelperInstance;
  messageLog?: HTMLElement | null;
  file: File;
  fullPath: string;
  isRootFile?: boolean;
  onLoadRootUsdPath: (path: string) => Promise<void>;
}) => Promise<void>;

type ApplyMeshVisibilityFiltersFn = (
  renderInterface: unknown,
  showVisualMeshes: boolean,
  showCollisionMeshes: boolean,
  collisionAlwaysOnTop?: boolean,
) => void;

interface UsdModuleFactoryConfig {
  mainScriptUrlOrBlob: string;
  locateFile: (file: string) => string;
  PTHREAD_POOL_LIMIT: number;
  PTHREAD_POOL_SIZE: number;
  PTHREAD_NUM_CORES: number;
  PTHREAD_POOL_PREWARM: boolean;
  print: (...args: unknown[]) => void;
  printErr: (...args: unknown[]) => void;
}

type UsdModuleFactoryFn = (config: UsdModuleFactoryConfig) => Promise<UsdModule>;

interface UsdDriverLifecycle {
  isDeleted?: () => boolean;
  delete?: () => void;
}

export interface UsdWasmRuntime {
  USD: UsdModule;
  usdFsHelper: UsdFsHelperInstance;
  loadVirtualFile: LoadVirtualFileFn;
  loadUsdStage: LoadUsdStageFn;
  applyMeshVisibilityFilters: ApplyMeshVisibilityFiltersFn;
  threadCount: number;
}

export interface UsdWasmRuntimeModules {
  UsdFsHelper: new (
    getUsdModule: () => UsdModule,
    debugFileHandling: boolean,
  ) => UsdFsHelperInstance;
  loadVirtualFile: LoadVirtualFileFn;
  loadUsdStage: LoadUsdStageFn;
  applyMeshVisibilityFilters: ApplyMeshVisibilityFiltersFn;
}

function withCacheKey(resourcePath: string): string {
  return buildUsdBindingsAssetPath(resourcePath, { cacheKey: USD_BINDINGS_CACHE_KEY });
}

function resolveGetUsdModuleFn(): UsdModuleFactoryFn | null {
  const globalUsd = globalThis as Record<string, unknown>;
  const needleGetter = globalUsd['NEEDLE:USD:GET'];
  if (typeof needleGetter === 'function') {
    return needleGetter as UsdModuleFactoryFn;
  }

  const exportedGetter = globalUsd.USD_WASM_MODULE;
  if (typeof exportedGetter === 'function') {
    return exportedGetter as UsdModuleFactoryFn;
  }

  return null;
}

export function resolvePreferredUsdThreadCount(preferredConcurrency?: number): number {
  const fallbackConcurrency = Number(globalThis.navigator?.hardwareConcurrency || 4);
  const resolvedConcurrency = preferredConcurrency ?? fallbackConcurrency;
  // Keep the embedded USD runtime responsive on the main thread. Larger pthread
  // pools improve peak throughput on paper, but in the browser they also raise
  // CPU contention and make orbit/drag noticeably less smooth during imports.
  return Math.max(1, Math.min(4, Math.floor(resolvedConcurrency) || 1));
}

/**
 * The USD runtime environment is intentionally no longer hard-gated at the app level.
 *
 * The bundled USD WASM is a pthread/shared-memory build, so `SharedArrayBuffer` is still
 * required — but whether the browser actually exposes it is decided by the browser itself
 * (secure context + cross-origin isolation), not by this pre-check. This means browsers that
 * surface `SharedArrayBuffer` for an origin marked trusted via
 * `chrome://flags/#unsafely-treat-insecure-origin-as-secure` now work too. Any real failure
 * surfaces from the WASM boot layer instead of an artificial refusal here.
 */
export function getUsdRuntimeEnvironmentError(
  globalScope: typeof globalThis = globalThis,
): Error | null {
  void globalScope;
  return null;
}

let hasWarnedUsdRuntimeEnvironment = false;

/**
 * Emits a single actionable warning when the current scope looks like it cannot provide
 * `SharedArrayBuffer` (i.e. it is not a secure context and/or not cross-origin isolated).
 *
 * The guard fires at most once per module instance, and only when the scope signals
 * non-capability. In Node (where `isSecureContext` and `crossOriginIsolated` are both
 * `undefined`) this stays silent. Loading is still attempted afterwards; the WASM layer
 * owns the actual error if `SharedArrayBuffer` ends up unavailable.
 */
export function warnUsdRuntimeEnvironment(globalScope: typeof globalThis = globalThis): void {
  const scope = globalScope as typeof globalThis & {
    isSecureContext?: boolean;
    crossOriginIsolated?: boolean;
  };

  if (hasWarnedUsdRuntimeEnvironment) {
    return;
  }

  const isNonCapableScope =
    (typeof scope.isSecureContext === 'boolean' && scope.isSecureContext !== true) ||
    (typeof scope.crossOriginIsolated === 'boolean' && scope.crossOriginIsolated !== true);

  if (!isNonCapableScope) {
    return;
  }

  hasWarnedUsdRuntimeEnvironment = true;

  console.warn(
    '[usd-wasm] This page is not a fully capable USD WASM environment ' +
      `(isSecureContext=${String(scope.isSecureContext)}, crossOriginIsolated=${String(
        scope.crossOriginIsolated,
      )}). ` +
      'The USD WASM runtime needs SharedArrayBuffer, which browsers only expose on secure, ' +
      'cross-origin isolated pages. Loading will still be attempted, but it may fail. To fix: ' +
      'open the app from http://localhost:<port>; run `URDF_STUDIO_DEV_HTTPS=true npm run dev` ' +
      'for LAN HTTPS; or mark this origin as trusted under ' +
      'chrome://flags/#unsafely-treat-insecure-origin-as-secure and reload.',
  );
}

let getUsdModuleFnPromise: Promise<UsdModuleFactoryFn> | null = null;
let usdRuntimePromise: Promise<UsdWasmRuntime> | null = null;

async function loadEmHdBindingsGetUsdModuleFn(): Promise<UsdModuleFactoryFn> {
  const existingGetter = resolveGetUsdModuleFn();
  if (existingGetter) {
    return existingGetter;
  }

  if (!getUsdModuleFnPromise) {
    getUsdModuleFnPromise = ensureClassicScriptLoaded(
      buildUsdBindingsScriptUrl(USD_BINDINGS_CACHE_KEY),
    )
      .then(() => {
        const loadedGetter = resolveGetUsdModuleFn();
        if (!loadedGetter) {
          throw new TypeError('USD WASM loader is unavailable after loading emHdBindings.js');
        }
        return loadedGetter;
      })
      .catch((error) => {
        getUsdModuleFnPromise = null;
        throw error;
      });
  }

  return getUsdModuleFnPromise;
}

function ensureUsdWasmRuntimeWithLoader(
  loadModules: () => Promise<UsdWasmRuntimeModules>,
): Promise<UsdWasmRuntime> {
  if (!usdRuntimePromise) {
    usdRuntimePromise = (async () => {
      warnUsdRuntimeEnvironment();

      const [getUsdModuleFn, modules] = await Promise.all([
        loadEmHdBindingsGetUsdModuleFn(),
        loadModules(),
      ]);

      const threadCount = resolvePreferredUsdThreadCount();
      const USD = await getUsdModuleFn({
        mainScriptUrlOrBlob: withCacheKey('emHdBindings.js'),
        locateFile: (file: string) => withCacheKey(String(file || '')),
        PTHREAD_POOL_LIMIT: threadCount,
        PTHREAD_POOL_SIZE: threadCount,
        PTHREAD_NUM_CORES: threadCount,
        PTHREAD_POOL_PREWARM: true,
        print: () => {},
        printErr: (...args: unknown[]) => {
          const message = args.map((entry) => String(entry ?? '')).join(' ');
          if (!message) return;
          if (message.includes("Selected hydra renderer doesn't support prim type")) return;
          if (message.includes('Unsupported interpolation type')) return;
          if (message.includes('pluginFactory') && message.includes('Failed verification')) return;
          console.error(...args);
        },
      });

      return {
        USD,
        usdFsHelper: new modules.UsdFsHelper(() => USD, false),
        loadVirtualFile: modules.loadVirtualFile,
        loadUsdStage: modules.loadUsdStage,
        applyMeshVisibilityFilters: modules.applyMeshVisibilityFilters,
        threadCount,
      };
    })().catch((error) => {
      usdRuntimePromise = null;
      throw error;
    });
  }

  return usdRuntimePromise;
}

export async function ensureUsdWasmRuntime(): Promise<UsdWasmRuntime> {
  return ensureUsdWasmRuntimeWithLoader(async () => {
    const [usdFsModule, usdLoaderModule, uploadWorkflowModule, visibilityModule] =
      await Promise.all([
        import('../../../features/urdf-viewer/runtime/viewer/usd-fs.js') as Promise<
          Pick<UsdWasmRuntimeModules, 'UsdFsHelper'>
        >,
        import('../../../features/urdf-viewer/runtime/viewer/usd-loader-runtime.ts'),
        import('../../../features/urdf-viewer/runtime/viewer/upload-workflow.js') as Promise<
          Pick<UsdWasmRuntimeModules, 'loadVirtualFile'>
        >,
        import('../../../features/urdf-viewer/runtime/viewer/visibility.js') as Promise<
          Pick<UsdWasmRuntimeModules, 'applyMeshVisibilityFilters'>
        >,
      ]);
    return {
      UsdFsHelper: usdFsModule.UsdFsHelper,
      loadVirtualFile: uploadWorkflowModule.loadVirtualFile,
      loadUsdStage: usdLoaderModule.loadUsdStage,
      applyMeshVisibilityFilters: visibilityModule.applyMeshVisibilityFilters,
    };
  });
}

/** Worker entrypoint with statically bundled support modules for portable URLs. */
export function ensureUsdWasmRuntimeFromModules(
  modules: UsdWasmRuntimeModules,
): Promise<UsdWasmRuntime> {
  return ensureUsdWasmRuntimeWithLoader(async () => modules);
}

export function prewarmUsdWasmRuntimeInBackground(
  loadRuntime: () => Promise<UsdWasmRuntime> = ensureUsdWasmRuntime,
): void {
  void loadRuntime().catch((error) => {
    logRuntimeFailure('prewarmUsdWasmRuntimeInBackground', error, 'warn');
  });
}

function hasUsdDriverLifecycle(driver: unknown): driver is UsdDriverLifecycle {
  return (typeof driver === 'object' && driver !== null) || typeof driver === 'function';
}

export function disposeUsdDriver(runtime: Pick<UsdWasmRuntime, 'USD'>, driver: unknown): void {
  if (!driver) return;

  const driverLifecycle = hasUsdDriverLifecycle(driver) ? driver : null;

  try {
    if (typeof driverLifecycle?.isDeleted === 'function' && driverLifecycle.isDeleted()) {
      return;
    }
  } catch {
    // Ignore deleted-state probe failures and try direct disposal.
  }

  try {
    if (typeof driverLifecycle?.delete === 'function') {
      driverLifecycle.delete();
    }
  } catch (error) {
    console.error('Failed to dispose USD driver.', error);
  }

  try {
    runtime.USD.flushPendingDeletes?.();
  } catch {
    // Flush is best-effort.
  }
}
