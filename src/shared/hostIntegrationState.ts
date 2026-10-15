/**
 * Import-free state shared by Core features and an optional hosting shell.
 * Keep this module free of UI, store, and feature dependencies.
 */

export type AssetDownloadEndpointResolver = (remoteImportOrigin: string) => URL;
export type AiBackendAuthTokenProvider = () => string | null | undefined;
export type AssetDownloadAuthTokenProvider = (
  requestUrl: URL,
) => string | null | undefined | Promise<string | null | undefined>;

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

// The hosting shell owns credentials and their destination policy. Providers
// may await session restoration and inspect the actual request URL; Core never
// reads deployment configuration or forwards this bearer to signed file URLs.
export function setAssetDownloadAuthTokenProvider(
  provider: AssetDownloadAuthTokenProvider | null,
): void {
  assetDownloadAuthTokenProvider = provider;
}

export async function getAssetDownloadAuthToken(
  requestUrl: URL,
): Promise<string | null | undefined> {
  return assetDownloadAuthTokenProvider?.(requestUrl);
}
