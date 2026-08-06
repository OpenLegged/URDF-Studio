/**
 * Handoff Protocol — shared between BOT World (sender) and receivers (URDF Studio, Motion Studio, BotLab).
 * Must stay in sync across all projects:
 *   BOT-World/src/shared/utils/popupHandoffProtocol.ts
 *   URDF-Studio/src/shared/utils/popupHandoffProtocol.ts
 *   MotionStudioUI-BluePrint/src/shared/utils/popupHandoffProtocol.ts
 *   botlab/src/shared/utils/popupHandoffProtocol.ts
 *
 * Protocol v2: assetId-based direct download (no ZIP, no popup, no IndexedDB).
 * BOT-World passes assetId + origin via URL params; receiver downloads files directly from BOT-World API.
 */

// ---------------------------------------------------------------------------
//  Origin whitelist — shared across all apps
// ---------------------------------------------------------------------------

/**
 * Origin patterns allowed for handoff communication.
 * Loaded from VITE_HANDOFF_ORIGINS env (comma-separated, supports `*` wildcard).
 * Falls back to production domains (*.enkeebot.com / *.enkeebot.cn) when env is unset.
 */
const handoffOriginsEnv = (import.meta as ImportMeta & { env?: { VITE_HANDOFF_ORIGINS?: string } })
  .env?.VITE_HANDOFF_ORIGINS;

export const ALLOWED_HANDOFF_ORIGINS: ReadonlyArray<string> = (
  handoffOriginsEnv || 'https://*.enkeebot.com,https://*.enkeebot.cn'
)
  .split(',')
  .map((s: string) => s.trim())
  .filter(Boolean);

/**
 * Extract a normalized origin from an input string.
 * Accepts full URLs (https://example.com/path) and bare origins (https://example.com);
 * pathname, search, hash and userinfo are stripped by the URL parser.
 * Returns null if the input is not a parseable http(s) URL.
 */
export function normalizeHandoffOrigin(input: string): string | null {
  try {
    const url = new URL(input);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null;
    }
    const isDefaultPort =
      (url.protocol === 'https:' && url.port === '443') ||
      (url.protocol === 'http:' && url.port === '80');
    const port = isDefaultPort || !url.port ? '' : `:${url.port}`;
    return `${url.protocol}//${url.hostname}${port}`;
  } catch {
    return null;
  }
}

/**
 * Check whether an origin matches any allowed pattern (with `*` wildcard support).
 * `*` matches any sequence of characters, so multi-level subdomains are accepted
 * (e.g. `*.enkeebot.com` matches `a.b.enkeebot.com`).
 */
export function isAllowedHandoffOrigin(originInput: string): boolean {
  const origin = normalizeHandoffOrigin(originInput);
  if (!origin) {
    return false;
  }

  return ALLOWED_HANDOFF_ORIGINS.some((pattern) => {
    if (!pattern.includes('*')) return pattern === origin;
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp('^' + escaped.replace(/\*/g, '.*') + '$', 'i');
    return regex.test(origin);
  });
}

// ---------------------------------------------------------------------------
//  Asset import via URL params
// ---------------------------------------------------------------------------

export const IMPORT_QUERY_PARAM = 'import';
export const FROM_QUERY_PARAM = 'from';
/** Optional intent param: BOT-World tells the receiver which format to convert to.
 *  Receivers that don't recognise this param should ignore it gracefully. */
export const CONVERT_TO_QUERY_PARAM = 'convertTo';
export const IMPORT_PROTOCOL_VERSION = 2;

export interface AssetImportParams {
  assetId: string;
  fromOrigin: string;
  /** Optional: BOT-World suggests the receiver convert the asset to this format. */
  convertTo?: string;
}

/** Read asset import parameters from a full URL string. Returns null if absent. */
export function readImportParamsFromUrl(url: string): AssetImportParams | null {
  const resolvedUrl = new URL(url, 'http://localhost');
  const assetId = resolvedUrl.searchParams.get(IMPORT_QUERY_PARAM)?.trim() ?? '';
  const fromOrigin = resolvedUrl.searchParams.get(FROM_QUERY_PARAM)?.trim() ?? '';
  if (!assetId || !fromOrigin) return null;
  const convertTo = resolvedUrl.searchParams.get(CONVERT_TO_QUERY_PARAM)?.trim() || undefined;
  return { assetId, fromOrigin, ...(convertTo ? { convertTo } : {}) };
}

/** Remove asset import query parameters from a URL string, returning the cleaned URL. */
export function stripImportParamsFromUrl(url: string): string {
  const resolvedUrl = new URL(url);
  resolvedUrl.searchParams.delete(IMPORT_QUERY_PARAM);
  resolvedUrl.searchParams.delete(FROM_QUERY_PARAM);
  resolvedUrl.searchParams.delete(CONVERT_TO_QUERY_PARAM);
  resolvedUrl.searchParams.delete('jwt');
  return resolvedUrl.toString();
}

// ---------------------------------------------------------------------------
//  BroadcastChannel — existing-tab detection for import delegation
// ---------------------------------------------------------------------------

export const HANDOFF_BROADCAST_CHANNEL = 'botworld-handoff';

export type HandoffBroadcastMessage =
  | { type: 'import-request'; assetId: string; fromOrigin: string; convertTo?: string }
  | { type: 'import-accepted'; assetId: string }
  | { type: 'plugin-launch-request'; toolKey: string }
  | { type: 'plugin-launch-accepted'; toolKey: string };

/** How long a new tab waits for an existing tab to claim the import (ms). */
export const HANDOFF_BROADCAST_TIMEOUT_MS = 1000;

// ---------------------------------------------------------------------------
//  Plugin activation via URL params (unchanged from v1)
// ---------------------------------------------------------------------------

export const PLUGIN_QUERY_PARAM = 'plugin';

/** Read the plugin key from a full URL string. Returns null if absent. */
export function readPluginKeyFromUrl(url: string): string | null {
  const resolvedUrl = new URL(url, 'http://localhost');
  const pluginKey = resolvedUrl.searchParams.get(PLUGIN_QUERY_PARAM)?.trim() ?? '';
  return pluginKey.length > 0 ? pluginKey : null;
}

/** Remove the plugin query parameter from a URL string, returning the cleaned URL. */
export function stripPluginParamFromUrl(url: string): string {
  const resolvedUrl = new URL(url);
  resolvedUrl.searchParams.delete(PLUGIN_QUERY_PARAM);
  return resolvedUrl.toString();
}
