/**
 * Narrow, stable hooks for hosting shells. The implementation lives in the
 * shared leaf layer so features never depend back on this app-level facade.
 */
export {
  getAiBackendAuthToken,
  getAssetDownloadAuthToken,
  resolveAssetDownloadEndpoint,
  setAiBackendAuthTokenProvider,
  setAssetDownloadAuthTokenProvider,
  setAssetDownloadEndpointResolver,
  type AiBackendAuthTokenProvider,
  type AssetDownloadAuthTokenProvider,
  type AssetDownloadEndpointResolver,
} from './shared/hostIntegrationState';
