/**
 * USD runtime and articulated Three.js scene construction.
 *
 * The 13 USD parsing/adapter files were moved here from
 * `features/urdf-viewer/utils/` so the package owns the WASM loader and the
 * RobotSceneSnapshot -> RobotData adapter. Features now import these from lib
 * (feature -> lib is allowed by dependency_boundaries), and 3 stale ALLOWLIST
 * entries were removed as a net shrink.
 *
 * `loadUsdRobotRuntime(content, filename, options)` resolves the USD package in
 * a lazy worker, transfers its baked geometry pools, and constructs the same
 * articulated Three.js runtime shape as the package root entry.
 */

export {
  ensureUsdWasmRuntime,
  getUsdRuntimeEnvironmentError,
  prewarmUsdWasmRuntimeInBackground,
  disposeUsdDriver,
  resolvePreferredUsdThreadCount,
} from './usdWasmRuntime';
export type { UsdWasmRuntime } from './usdWasmRuntime';

export { adaptUsdViewerSnapshotToRobotData } from './usdViewerRobotAdapter';
export type { ViewerRobotDataResolution } from './viewerRobotData';

export { setUsdBindingsBaseUrl, USD_BINDINGS_CACHE_KEY } from './usdBindingsAssetPaths';

import { setUsdBindingsBaseUrl } from './usdBindingsAssetPaths';

/**
 * Configure the USD WASM bindings directory. Call once before `ensureUsdWasmRuntime`
 * so the ~20MB emHdBindings assets resolve against the consumer's served path
 * (e.g. Motion Studio copies `dist/wasm/` to `public/usd/bindings/` and calls
 * `configureUsdRuntime({ wasmBaseUrl: '/usd/bindings' })`).
 */
export function configureUsdRuntime(options: { wasmBaseUrl?: string }): void {
  setUsdBindingsBaseUrl(options.wasmBaseUrl ?? null);
}

export { loadUsdRobotRuntime, buildUsdRobotRuntimeFromScene } from './loadUsdRobotRuntime';
export type { LoadUsdRobotRuntimeOptions, UsdRobotRuntime } from './loadUsdRobotRuntime';

export { parseUsdScene, disposeParseUsdWorker } from './parseUsd';
export type { ParsedUsdScene, ParseUsdSceneOptions, UsdRuntimeLoadProgress } from './parseUsd';
