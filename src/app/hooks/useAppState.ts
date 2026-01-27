/**
 * App State Hook
 * Provides convenient access to UI state (theme, language, scale)
 */
import { useUIStore } from '@/store';
import { translations } from '@/shared/i18n';

/**
 * Hook for accessing app-wide UI state
 * Theme, language, and UI scale are persisted to localStorage via UIStore
 */
export function useAppState() {
  const theme = useUIStore((state) => state.theme);
  const setTheme = useUIStore((state) => state.setTheme);
  const lang = useUIStore((state) => state.lang);
  const setLang = useUIStore((state) => state.setLang);
  const uiScale = useUIStore((state) => state.uiScale);
  const setUiScale = useUIStore((state) => state.setUiScale);
  const os = useUIStore((state) => state.os);

  // Get translations for current language
  const t = translations[lang];

  return {
    // Theme
    theme,
    setTheme,
    toggleTheme: () => setTheme(theme === 'light' ? 'dark' : 'light'),
    isDarkMode: theme === 'dark',

    // Language
    lang,
    setLang,
    t,
    toggleLang: () => setLang(lang === 'en' ? 'zh' : 'en'),

    // UI Scale
    uiScale,
    setUiScale,
    resetUiScale: () => setUiScale(1.0),

    // OS
    os,
    isMac: os === 'mac',
  };
}

export default useAppState;
