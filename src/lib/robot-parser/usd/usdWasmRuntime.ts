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

export function getUsdRuntimeEnvironmentError(
  globalScope: typeof globalThis = globalThis,
): Error | null {
  const scope = globalScope as typeof globalThis & {
    document?: Document;
    isSecureContext?: boolean;
    window?: unknown;
  };
  const hasRuntimeEnvironmentSignals =
    typeof scope.window !== 'undefined' ||
    typeof scope.document !== 'undefined' ||
    typeof scope.isSecureContext === 'boolean' ||
    typeof scope.crossOriginIsolated === 'boolean';

  if (!hasRuntimeEnvironmentSignals) {
    return null;
  }

  if (scope.isSecureContext !== true) {
    return new Error(
      'USD loading requires a secure context. Open the app from `http://localhost:<port>` or `http://127.0.0.1:<port>`, ' +
        'or serve it over HTTPS. Accessing the Vite dev server from a LAN IP address or another non-HTTPS URL is not enough, ' +
        'even when `npm run dev` is sending COOP/COEP headers.',
    );
  }

  if (scope.crossOriginIsolated === true) {
    return null;
  }

  return new Error(
    'USD loading requires a cross-origin isolated page because the bundled USD WASM runtime uses SharedArrayBuffer. ' +
      'Start the app with `npm run dev` or `npm run preview`, open it from `localhost`/`127.0.0.1` (or HTTPS), ' +
      'and make sure the server sends `Cross-Origin-Opener-Policy: same-origin` and ' +
      '`Cross-Origin-Embedder-Policy: require-corp`.',
  );
}

function assertUsdRuntimeEnvironment(): void {
  const environmentError = getUsdRuntimeEnvironmentError();
  if (environmentError) {
    throw environmentError;
  }
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
      assertUsdRuntimeEnvironment();

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
