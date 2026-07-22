// Compatibility export for existing app-hook consumers. The state lives in
// the import-free host facade so Pro bootstrap never loads app/feature chunks.
export {
  getAssetDownloadAuthToken,
  resolveAssetDownloadEndpoint,
  setAssetDownloadAuthTokenProvider,
  setAssetDownloadEndpointResolver,
  type AssetDownloadAuthTokenProvider,
  type AssetDownloadEndpointResolver,
} from '../../shared/hostIntegrationState';
