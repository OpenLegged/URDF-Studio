/**
 * URL language helpers for the per-language static pages emitted by
 * scripts/generate/seo_prerender.mjs.
 */
import type { Language } from '@/shared/i18n';

/** Returns the language encoded in a URL path, or null when the path carries no signal. */
export function getLanguageFromPath(pathname: string): Language | null {
  if (/^\/zh(\/|$)/.test(pathname)) return 'zh';
  if (/^\/en(\/|$)/.test(pathname)) return 'en';
  return null;
}

/** Reads the URL language signal in the browser; null on the server or when absent. */
export function getInitialLanguageFromUrl(): Language | null {
  if (typeof window === 'undefined') return null;
  return getLanguageFromPath(window.location.pathname);
}

/** Keeps SEO-only language paths from remaining visible in the interactive app. */
export function hideSeoLanguagePathFromUserUrl(): void {
  if (typeof window === 'undefined' || typeof window.history?.replaceState !== 'function') {
    return;
  }

  if (getLanguageFromPath(window.location.pathname) === null) {
    return;
  }

  const nextUrl = `/${window.location.search}${window.location.hash}`;
  window.history.replaceState(window.history.state, '', nextUrl);
}
