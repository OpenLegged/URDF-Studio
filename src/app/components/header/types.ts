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
export type HeaderMenuKey = 'surface' | 'file' | 'ai' | 'toolbox' | 'view' | 'more' | null;

/**
 * Presentation state for a host-provided alternate workspace.
 *
 * Core deliberately does not assign product meaning to either value. Hosts
 * map their own domain modes onto the primary and alternate surfaces.
 */
export type HeaderSurfaceMode = 'primary' | 'alternate';

export interface HeaderSurfaceModeOptionCopy {
  label: string;
  description: string;
}

export interface HeaderSurfaceModeSelectorCopy {
  ariaLabel: string;
  primary: HeaderSurfaceModeOptionCopy;
  alternate: HeaderSurfaceModeOptionCopy;
}

export interface HeaderSurfaceModeSelectorConfig {
  current: HeaderSurfaceMode;
  onChange: (mode: HeaderSurfaceMode) => void;
  translations: Record<'en' | 'zh', HeaderSurfaceModeSelectorCopy>;
}

export interface HeaderContextFileMenuItem {
  key: string;
  label: string;
  icon?: ComponentType<{ className?: string }>;
  onSelect: () => void;
  disabled?: boolean;
  separatorBefore?: boolean;
}

/**
 * Host-owned file actions for an alternate workspace surface.
 *
 * Core owns only the header presentation. The host remains responsible for
 * file workflows, dialogs, validation, and user-facing copy.
 */
export interface HeaderContextFileMenuConfig {
  label: string;
  items: readonly HeaderContextFileMenuItem[];
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
