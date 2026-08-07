/**
 * App Providers - Initialization and side effects wrapper
 * Handles theme, language, and other global initializations
 */
import { useEffect, useLayoutEffect, useMemo } from 'react';
import { useUIStore } from '@/store';
import { useSelectionStore } from '@/store/selectionStore';
import { useShallow } from 'zustand/react/shallow';
import { translations } from '@/shared/i18n';
import { EffectiveThemeProvider, useResolvedTheme } from '@/shared/hooks/useEffectiveTheme';
import { OverlayHoverBlockProvider } from '@/shared/hooks/useOverlayHoverBlock';
import { applyDocumentTheme } from '@/shared/utils/theme';

interface ProvidersProps {
  children: React.ReactNode;
}

/**
 * Providers component that handles global initializations
 * - Theme application (dark mode class)
 * - Language-based document title
 */
export function Providers({ children }: ProvidersProps) {
  const { theme, lang } = useUIStore(
    useShallow((state) => ({
      theme: state.theme,
      lang: state.lang,
    })),
  );
  const { beginHoverBlock, endHoverBlock, clearHover } = useSelectionStore(
    useShallow((state) => ({
      beginHoverBlock: state.beginHoverBlock,
      endHoverBlock: state.endHoverBlock,
      clearHover: state.clearHover,
    })),
  );
  const t = translations[lang];
  const effectiveTheme = useResolvedTheme(theme);
  const overlayHoverBlockActions = useMemo(
    () => ({
      beginHoverBlock,
      endHoverBlock,
      clearHover,
    }),
    [beginHoverBlock, clearHover, endHoverBlock],
  );

  useLayoutEffect(() => {
    applyDocumentTheme(effectiveTheme);
  }, [effectiveTheme]);

  // Update document title based on language
  useEffect(() => {
    document.title = t.documentTitle;
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
    document.documentElement.setAttribute('data-lang', lang);
  }, [lang, t]);

  return (
    <EffectiveThemeProvider value={effectiveTheme}>
      <OverlayHoverBlockProvider value={overlayHoverBlockActions}>
        {children}
      </OverlayHoverBlockProvider>
    </EffectiveThemeProvider>
  );
}

export default Providers;
