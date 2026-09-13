/**
 * USD parser/runtime module.
 * Runtime scene parsing/metadata comes from usd-viewer WASM.
 */

export { isUSDA, isUSDCBinary, isUsdLikeFormat } from './usdFormatUtils';
export {
  inferUsdBundleVirtualDirectory,
  isUsdPathWithinBundleDirectory,
  isUsdRuntimeDependencyPath,
  isUsdRuntimeTexturePath,
} from './usdAssetPaths';
