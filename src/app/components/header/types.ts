import type { ComponentType, Dispatch, MouseEventHandler, ReactNode, SetStateAction } from 'react';
import type { LucideIcon } from 'lucide-react';
import { translations } from '@/shared/i18n';
import type { AppMode, Theme } from '@/types';

export type HeaderTranslations = (typeof translations)['en'];

export type ToolboxItemTone = 'primary' | 'neutral' | 'logo';

export interface ToolboxItem {
  key: string;
  title: string;
  description: string;
  icon: ReactNode;
  onClick: () => void;
  external?: boolean;
  tone?: ToolboxItemTone;
}
export type HeaderMenuKey = 'surface' | 'file' | 'ai' | 'toolbox' | 'view' | 'more' | null;

export type HeaderSurfaceMode = 'model' | 'scene';

export interface HeaderSurfaceModeOptionCopy {
  label: string;
  description: string;
}

export interface HeaderSurfaceModeSelectorCopy {
  ariaLabel: string;
  model: HeaderSurfaceModeOptionCopy;
  scene: HeaderSurfaceModeOptionCopy;
}

export interface HeaderSurfaceModeSelectorConfig {
  current: HeaderSurfaceMode;
  onChange: (mode: HeaderSurfaceMode) => void;
  translations: Record<'en' | 'zh', HeaderSurfaceModeSelectorCopy>;
}

export interface HeaderViewConfig {
  showOptionsPanel: boolean;
  showJointPanel: boolean;
  showStructureGraph: boolean;
}

export interface HeaderViewAvailability {
  jointPanel: boolean;
}

export type HeaderSetViewConfig = Dispatch<SetStateAction<HeaderViewConfig>>;

export interface HeaderAction {
  label: string;
  title?: string;
  icon: LucideIcon | ComponentType<{ className?: string }>;
  onClick: MouseEventHandler<HTMLButtonElement>;
}

export interface HeaderResponsiveLayout {
  showMenuLabels: boolean;
  showSourceInline: boolean;
  showSourceText: boolean;
  showUndoRedoInline: boolean;
  showQuickActionInline: boolean;
  showQuickActionLabel: boolean;
  showSnapshotInline: boolean;
  showSettingsInline: boolean;
  showLanguageInline: boolean;
  showThemeInline: boolean;
  showSecondaryActionInline: boolean;
  showSecondaryActionLabel: boolean;
  showDesktopOverflow: boolean;
}

export interface HeaderOverflowMenuProps {
  className?: string;
  lang: 'en' | 'zh';
  theme: Theme;
  canUndo: boolean;
  canRedo: boolean;
  activeMenu: HeaderMenuKey;
  setActiveMenu: (menu: HeaderMenuKey) => void;
  setLang: (lang: 'en' | 'zh') => void;
  setTheme: (theme: Theme) => void;
  undo: () => void;
  redo: () => void;
  quickAction?: HeaderAction;
  secondaryAction?: HeaderAction;
  onOpenCodeViewer: () => void;
  onPrefetchCodeViewer: () => void;
  onSnapshot: () => void;
  onOpenSettings: () => void;
  t: HeaderTranslations;
  showQuickAction: boolean;
  showSourceCode: boolean;
  showUndoRedo: boolean;
  showSnapshot: boolean;
  showSettings: boolean;
  showLanguage: boolean;
  showTheme: boolean;
  showSecondaryAction?: boolean;
}
