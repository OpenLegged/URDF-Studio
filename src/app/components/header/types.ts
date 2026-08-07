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
  onPrefetch?: () => void;
  external?: boolean;
  tone?: ToolboxItemTone;
}
export type HeaderMenuKey = 'file' | 'ai' | 'toolbox' | 'view' | 'more' | null;

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
  onPrefetchSnapshot: () => void;
  onOpenSettings: () => void;
  onPrefetchSettings: () => void;
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
