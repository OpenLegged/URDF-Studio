import {
  Camera,
  Languages,
  MessageCircleQuestionMark,
  Moon,
  Monitor,
  Settings,
  Sun,
} from 'lucide-react';
import { Button, IconButton } from '@/shared/components/ui';
import type { Theme } from '@/types';
import type {
  HeaderAction,
  HeaderResponsiveLayout,
  HeaderTranslations,
  HeaderMenuKey,
} from './types';
import { HeaderOverflowMenu } from './HeaderOverflowMenu';

export const FEEDBACK_FORM_URL =
  'https://enkeebot.feishu.cn/share/base/form/shrcnok1dXPePgAxuu2qnXiVxYf';

interface HeaderActionsProps {
  responsive: HeaderResponsiveLayout;
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
}

interface InlineActionButtonProps {
  action?: HeaderAction;
  show: boolean;
  showLabel: boolean;
}

function InlineActionButton({ action, show, showLabel }: InlineActionButtonProps) {
  const ActionIcon = action?.icon;

  if (!show || !action || !ActionIcon) {
    return null;
  }

  return (
    <Button
      type="button"
      onClick={action.onClick}
      variant="ghost"
      size="xs"
	      className="hidden h-7 whitespace-nowrap px-2 text-system-blue hover:bg-system-blue-solid hover:text-white sm:flex"
      title={action.title ?? action.label}
      aria-label={action.title ?? action.label}
    >
      <ActionIcon className="w-4 h-4" />
	      {showLabel ? <span className="whitespace-nowrap">{action.label}</span> : null}
    </Button>
  );
}

function SnapshotButton({
  show,
  onSnapshot,
  onPrefetchSnapshot,
  label,
}: {
  show: boolean;
  onSnapshot: () => void;
  onPrefetchSnapshot: () => void;
  label: string;
}) {
  if (!show) {
    return null;
  }

  return (
    <IconButton
      type="button"
      onClick={onSnapshot}
      onPointerEnter={onPrefetchSnapshot}
      onPointerDown={onPrefetchSnapshot}
      onFocus={onPrefetchSnapshot}
      variant="ghost"
      size="md"
      className="hidden h-7 w-7 sm:flex"
      aria-label={label}
    >
      <Camera className="w-4 h-4" />
    </IconButton>
  );
}

function LanguageButton({
  show,
  lang,
  setLang,
  label,
}: {
  show: boolean;
  lang: 'en' | 'zh';
  setLang: (lang: 'en' | 'zh') => void;
  label: string;
}) {
  if (!show) {
    return null;
  }

  return (
    <Button
      type="button"
      onClick={() => setLang(lang === 'en' ? 'zh' : 'en')}
      variant="ghost"
      size="xs"
      className="hidden h-7 px-2 text-text-tertiary hover:text-text-primary sm:flex"
      title={label}
      aria-label={label}
    >
      <Languages className="w-3.5 h-3.5" />
      <span className="text-[10px] font-semibold">{lang === 'en' ? 'EN' : '中'}</span>
    </Button>
  );
}

function resolveNextTheme(theme: Theme): Theme {
  if (theme === 'system') {
    const isSystemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    return isSystemDark ? 'light' : 'dark';
  }

  return theme === 'dark' ? 'light' : 'dark';
}

function ThemeIcon({ theme }: { theme: Theme }) {
  if (theme === 'system') {
    return <Monitor className="w-4 h-4" />;
  }

  return theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />;
}

function ThemeButton({
  show,
  theme,
  setTheme,
  label,
}: {
  show: boolean;
  theme: Theme;
  setTheme: (theme: Theme) => void;
  label: string;
}) {
  if (!show) {
    return null;
  }

  return (
    <IconButton
      type="button"
      onClick={() => setTheme(resolveNextTheme(theme))}
      variant="ghost"
      size="md"
      className="hidden h-7 w-7 sm:flex"
      aria-label={label}
    >
      <ThemeIcon theme={theme} />
    </IconButton>
  );
}

function HeaderDivider({ show }: { show: boolean }) {
  return show ? <div className="w-px h-5 bg-border-black mx-1 hidden sm:block" /> : null;
}

function SettingsButton({
  show,
  onOpenSettings,
  onPrefetchSettings,
  label,
}: {
  show: boolean;
  onOpenSettings: () => void;
  onPrefetchSettings: () => void;
  label: string;
}) {
  if (!show) {
    return null;
  }

  return (
    <IconButton
      type="button"
      onClick={onOpenSettings}
      onPointerEnter={onPrefetchSettings}
      onPointerDown={onPrefetchSettings}
      onFocus={onPrefetchSettings}
      variant="ghost"
      size="md"
      className="hidden h-7 w-7 sm:flex"
      aria-label={label}
    >
      <Settings className="w-4 h-4" />
    </IconButton>
  );
}

function FeedbackButton({ label }: { label: string }) {
  return (
    <a
      href={FEEDBACK_FORM_URL}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-transparent text-text-secondary transition-all duration-200 hover:bg-element-hover hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-system-blue/30"
      title={label}
      aria-label={label}
    >
      <MessageCircleQuestionMark className="h-4 w-4" />
    </a>
  );
}

export function HeaderActions({
  responsive,
  lang,
  theme,
  canUndo,
  canRedo,
  activeMenu,
  setActiveMenu,
  setLang,
  setTheme,
  undo,
  redo,
  quickAction,
  secondaryAction,
  onOpenCodeViewer,
  onPrefetchCodeViewer,
  onSnapshot,
  onPrefetchSnapshot,
  onOpenSettings,
  onPrefetchSettings,
  t,
}: HeaderActionsProps) {
  const {
    showQuickActionInline,
    showQuickActionLabel,
    showSnapshotInline,
    showSettingsInline,
    showLanguageInline,
    showThemeInline,
    showSecondaryActionInline,
    showSecondaryActionLabel,
    showDesktopOverflow,
  } = responsive;

  return (
    <div className="flex items-center justify-end gap-0.5 shrink-0 justify-self-stretch w-full">
      <InlineActionButton
        action={quickAction}
        show={showQuickActionInline}
        showLabel={showQuickActionLabel}
      />
      <SnapshotButton
        show={showSnapshotInline}
        onSnapshot={onSnapshot}
        onPrefetchSnapshot={onPrefetchSnapshot}
        label={t.snapshot}
      />
      <LanguageButton
        show={showLanguageInline}
        lang={lang}
        setLang={setLang}
        label={t.switchLanguage}
      />
      <ThemeButton
        show={showThemeInline}
        theme={theme}
        setTheme={setTheme}
        label={t.toggleTheme}
      />
      <FeedbackButton label={t.feedback} />
      <HeaderDivider show={showThemeInline || showDesktopOverflow} />

      {showDesktopOverflow && (
        <HeaderOverflowMenu
          className="hidden sm:block"
          lang={lang}
          theme={theme}
          canUndo={canUndo}
          canRedo={canRedo}
          activeMenu={activeMenu}
          setActiveMenu={setActiveMenu}
          setLang={setLang}
          setTheme={setTheme}
          undo={undo}
          redo={redo}
          quickAction={quickAction}
          secondaryAction={secondaryAction}
          onOpenCodeViewer={onOpenCodeViewer}
          onPrefetchCodeViewer={onPrefetchCodeViewer}
          onSnapshot={onSnapshot}
          onPrefetchSnapshot={onPrefetchSnapshot}
          onOpenSettings={onOpenSettings}
          onPrefetchSettings={onPrefetchSettings}
          t={t}
          showQuickAction={Boolean(quickAction) && !showQuickActionInline}
          showSourceCode={!responsive.showSourceInline}
          showUndoRedo={!responsive.showUndoRedoInline}
          showSnapshot={!showSnapshotInline}
          showSettings={!showSettingsInline}
          showLanguage={!showLanguageInline}
          showTheme={!showThemeInline}
          showSecondaryAction={Boolean(secondaryAction) && !showSecondaryActionInline}
        />
      )}

      <InlineActionButton
        action={secondaryAction}
        show={showSecondaryActionInline}
        showLabel={showSecondaryActionLabel}
      />

      <SettingsButton
        show={showSettingsInline}
        onOpenSettings={onOpenSettings}
        onPrefetchSettings={onPrefetchSettings}
        label={t.settings}
      />

      <HeaderOverflowMenu
        className="sm:hidden"
        lang={lang}
        theme={theme}
        canUndo={canUndo}
        canRedo={canRedo}
        activeMenu={activeMenu}
        setActiveMenu={setActiveMenu}
        setLang={setLang}
        setTheme={setTheme}
        undo={undo}
        redo={redo}
        quickAction={quickAction}
        secondaryAction={secondaryAction}
        onOpenCodeViewer={onOpenCodeViewer}
        onPrefetchCodeViewer={onPrefetchCodeViewer}
        onSnapshot={onSnapshot}
        onPrefetchSnapshot={onPrefetchSnapshot}
        onOpenSettings={onOpenSettings}
        onPrefetchSettings={onPrefetchSettings}
        t={t}
        showQuickAction={Boolean(quickAction)}
        showSourceCode
        showUndoRedo
        showSnapshot
        showSettings
        showLanguage
        showTheme
        showSecondaryAction={Boolean(secondaryAction)}
      />
    </div>
  );
}
