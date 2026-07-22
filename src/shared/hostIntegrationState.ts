/**
 * Import-free state shared by Core features and an optional hosting shell.
 * Keep this module free of UI, store, and feature dependencies.
 */

export type AssetDownloadEndpointResolver = (remoteImportOrigin: string) => URL;
export type AiBackendAuthTokenProvider = () => string | null | undefined;
export type AssetDownloadAuthTokenProvider = () => string | null | undefined;

const defaultAssetDownloadEndpointResolver: AssetDownloadEndpointResolver =
  (remoteImportOrigin) => new URL('/api/download-asset', remoteImportOrigin);

let assetDownloadEndpointResolver = defaultAssetDownloadEndpointResolver;
let aiBackendAuthTokenProvider: AiBackendAuthTokenProvider | null = null;
let assetDownloadAuthTokenProvider: AssetDownloadAuthTokenProvider | null = null;

export function setAssetDownloadEndpointResolver(
  resolver: AssetDownloadEndpointResolver | null,
): void {
  assetDownloadEndpointResolver = resolver ?? defaultAssetDownloadEndpointResolver;
}

export function resolveAssetDownloadEndpoint(remoteImportOrigin: string): URL {
  return assetDownloadEndpointResolver(remoteImportOrigin);
}

export function setAiBackendAuthTokenProvider(
  provider: AiBackendAuthTokenProvider | null,
): void {
  aiBackendAuthTokenProvider = provider;
}

export function getAiBackendAuthToken(): string | null | undefined {
  return aiBackendAuthTokenProvider?.();
}

// Service-token (botbase `AuthenticateToken`) bearer for the asset download
// request. Read at call time so the hosting shell (pro) can supply a runtime
// credential without the open-source core ever touching `import.meta.env` —
// see asset_import_from_url.test.ts which forbids VITE_API_TOKEN in the hook.
export function setAssetDownloadAuthTokenProvider(
  provider: AssetDownloadAuthTokenProvider | null,
): void {
  assetDownloadAuthTokenProvider = provider;
}

export function getAssetDownloadAuthToken(): string | null | undefined {
  return assetDownloadAuthTokenProvider?.();
}
