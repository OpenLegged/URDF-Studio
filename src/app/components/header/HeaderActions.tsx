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
import { FEEDBACK_FORM_URL, HeaderOverflowMenu } from './HeaderOverflowMenu';

export { FEEDBACK_FORM_URL } from './HeaderOverflowMenu';

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
  snapshotAvailable?: boolean;
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
      className="h-8 whitespace-nowrap px-2 text-system-blue hover:bg-system-blue-solid hover:text-white"
      title={action.title ?? action.label}
      aria-label={action.title ?? action.label}
    >
      <ActionIcon className="w-4 h-4" />
      {showLabel ? <span className="whitespace-nowrap">{action.label}</span> : null}
    </Button>
  );
}

function SecondaryActionButton({ action, showLabel }: Omit<InlineActionButtonProps, 'show'>) {
  const ActionIcon = action?.icon;

  if (!action || !ActionIcon) {
    return null;
  }

  return (
    <Button
      type="button"
      onClick={action.onClick}
      variant="ghost"
      size="icon"
      className={`h-8 w-8 shrink-0 gap-1.5 p-0 text-ui-control font-medium ${showLabel ? 'sm:w-auto sm:max-w-[160px] sm:px-2.5' : ''}`.trim()}
      title={action.title ?? action.label}
      aria-label={action.title ?? action.label}
    >
      <ActionIcon className="h-4 w-4 shrink-0" />
      {showLabel ? <span className="hidden min-w-0 truncate sm:block">{action.label}</span> : null}
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
      className="h-8 w-8 shrink-0 p-0 !text-text-secondary hover:!text-text-primary"
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
    <IconButton
      type="button"
      onClick={() => setLang(lang === 'en' ? 'zh' : 'en')}
      variant="ghost"
      size="md"
      className="h-8 w-8 shrink-0 p-0 !text-text-secondary hover:!text-text-primary"
      title={label}
      aria-label={label}
    >
      <Languages className="w-4 h-4" />
    </IconButton>
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
      className="h-8 w-8 shrink-0 p-0 !text-text-secondary hover:!text-text-primary"
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
      className="h-8 w-8 shrink-0 p-0 !text-text-secondary hover:!text-text-primary"
      aria-label={label}
    >
      <Settings className="w-4 h-4" strokeWidth={2} />
    </IconButton>
  );
}

function FeedbackButton({ label }: { label: string }) {
  return (
    <a
      href={FEEDBACK_FORM_URL}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md border border-transparent px-2 text-ui-control font-medium text-text-secondary transition-colors duration-200 hover:bg-element-hover hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-system-blue/30"
      title={label}
      aria-label={label}
    >
      <MessageCircleQuestionMark className="h-4 w-4" />
      <span>{label}</span>
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
  snapshotAvailable = true,
  onOpenSettings,
  onPrefetchSettings,
  t,
}: HeaderActionsProps) {
  const {
    isDesktop,
    showQuickActionInline,
    showQuickActionLabel,
    showSnapshotInline,
    showSettingsInline,
    showLanguageInline,
    showThemeInline,
    showSecondaryActionLabel,
    showDesktopOverflow,
  } = responsive;

  return (
    <div className="flex items-center justify-end gap-1 shrink-0 justify-self-stretch w-full">
      <InlineActionButton
        action={quickAction}
        show={showQuickActionInline}
        showLabel={showQuickActionLabel}
      />
      <SnapshotButton
        show={snapshotAvailable && showSnapshotInline}
        onSnapshot={onSnapshot}
        onPrefetchSnapshot={onPrefetchSnapshot}
        label={t.snapshot}
      />
      {isDesktop ? <FeedbackButton label={t.feedback} /> : null}
      <HeaderDivider show={showThemeInline || showDesktopOverflow} />

      {showDesktopOverflow && (
        <HeaderOverflowMenu
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
          showSnapshot={snapshotAvailable && !showSnapshotInline}
          showSettings={!showSettingsInline}
          showLanguage={!showLanguageInline}
          showTheme={!showThemeInline}
          showSecondaryAction={false}
        />
      )}

      {!isDesktop && <HeaderOverflowMenu
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
        showSnapshot={snapshotAvailable}
        showSettings={false}
        showLanguage
        showTheme
        showSecondaryAction={false}
        showFeedback
      />}

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
      <SettingsButton
        show={showSettingsInline}
        onOpenSettings={onOpenSettings}
        onPrefetchSettings={onPrefetchSettings}
        label={t.settings}
      />
      <SecondaryActionButton action={secondaryAction} showLabel={showSecondaryActionLabel} />
    </div>
  );
}
