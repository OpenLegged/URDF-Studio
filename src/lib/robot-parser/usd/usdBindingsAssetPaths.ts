const DEFAULT_PUBLIC_BASE_URL = '/';

type ImportMetaEnvLike = ImportMeta & {
  env?: {
    BASE_URL?: string;
  };
};

export const USD_BINDINGS_CACHE_KEY = '20260318a';

let configuredWasmBaseUrl: string | null = null;

/**
 * Override the WASM asset base URL at runtime. Used by the package's
 * `configureUsdRuntime({ wasmBaseUrl })` so consumers can point at their own
 * served copy of the ~20MB emHdBindings assets without relying on Vite's
 * `import.meta.env.BASE_URL`.
 */
export function setUsdBindingsBaseUrl(url: string | null): void {
  configuredWasmBaseUrl = url;
}

function resolvePublicBaseUrl(baseUrl?: string): string {
  const envBaseUrl = (import.meta as ImportMetaEnvLike).env?.BASE_URL;
  const candidate = typeof baseUrl === 'string' ? baseUrl : envBaseUrl;
  return String(candidate || DEFAULT_PUBLIC_BASE_URL).trim();
}

function normalizePublicBasePath(baseUrl?: string): string {
  const configuredBaseUrl = resolvePublicBaseUrl(baseUrl);

  if (!configuredBaseUrl || configuredBaseUrl === '/') {
    return '';
  }

  return `/${configuredBaseUrl.replace(/^\/+|\/+$/g, '')}`;
}

function resolveBindingsDirectory(baseUrl?: string): string {
  if (configuredWasmBaseUrl !== null) {
    const directory = configuredWasmBaseUrl.trim().replace(/\/+$/g, '');
    return directory || '/';
  }

  return `${normalizePublicBasePath(baseUrl)}/usd/bindings`;
}

function normalizeUsdBindingsResourcePath(resourcePath: string): string {
  const normalizedPath = String(resourcePath || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+/, '');

  if (!normalizedPath) {
    throw new Error('USD bindings resource path is required.');
  }

  if (normalizedPath.startsWith('usd/bindings/')) {
    return normalizedPath.slice('usd/bindings/'.length);
  }

  return normalizedPath;
}

export function appendCacheKey(resourcePath: string, cacheKey: string): string {
  return resourcePath.includes('?')
    ? `${resourcePath}&v=${cacheKey}`
    : `${resourcePath}?v=${cacheKey}`;
}

export function buildUsdBindingsAssetPath(
  resourcePath: string,
  options: {
    baseUrl?: string;
    cacheKey?: string;
  } = {},
): string {
  const normalizedResourcePath = normalizeUsdBindingsResourcePath(resourcePath);
  const bindingsDirectory = resolveBindingsDirectory(options.baseUrl);
  const publicPath = `${bindingsDirectory === '/' ? '' : bindingsDirectory}/${normalizedResourcePath}`;

  return options.cacheKey ? appendCacheKey(publicPath, options.cacheKey) : publicPath;
}

export function buildUsdBindingsScriptUrl(
  cacheKey = USD_BINDINGS_CACHE_KEY,
  options: {
    baseUrl?: string;
  } = {},
): string {
  return buildUsdBindingsAssetPath('emHdBindings.js', {
    ...options,
    cacheKey,
  });
}
