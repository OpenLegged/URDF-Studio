/**
 * App Providers - Initialization and side effects wrapper
 * Handles theme, language, and other global initializations
 */
import { useEffect } from 'react';
import { useUIStore } from '@/store';

interface ProvidersProps {
  children: React.ReactNode;
}

/**
 * Providers component that handles global initializations
 * - Theme application (dark mode class)
 * - Language-based document title
 * - UI scale application
 */
export function Providers({ children }: ProvidersProps) {
  const theme = useUIStore((state) => state.theme);
  const lang = useUIStore((state) => state.lang);
  const uiScale = useUIStore((state) => state.uiScale);

  // Apply theme class to document
  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [theme]);

  // Update document title based on language
  useEffect(() => {
    document.title = lang === 'zh'
      ? "URDF Studio - 专业机器人设计与可视化工具"
      : "URDF Studio - Professional Robot Design & Visualization Tool";
  }, [lang]);

  // Apply UI scale
  useEffect(() => {
    document.documentElement.style.fontSize = `${uiScale * 100}%`;
  }, [uiScale]);

  return <>{children}</>;
}

export default Providers;
