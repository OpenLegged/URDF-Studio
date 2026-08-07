import type { Theme } from '@/types';

export type ResolvedTheme = 'light' | 'dark';

function canUseDocument(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

function getSystemTheme(): ResolvedTheme {
  if (!canUseDocument() || typeof window.matchMedia !== 'function') {
    return 'light';
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function resolveTheme(theme: Theme): ResolvedTheme {
  return theme === 'system' ? getSystemTheme() : theme;
}

export function applyDocumentTheme(theme: Theme | ResolvedTheme): ResolvedTheme {
  const resolvedTheme = theme === 'system' ? getSystemTheme() : theme;

  if (!canUseDocument()) {
    return resolvedTheme;
  }

  const root = document.documentElement;
  const shouldUseDarkClass = resolvedTheme === 'dark';

  root.classList.toggle('dark', shouldUseDarkClass);
  root.dataset.theme = resolvedTheme;

  return resolvedTheme;
}
