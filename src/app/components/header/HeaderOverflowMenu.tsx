import {
  Camera,
  Code,
  Languages,
  MessageCircleQuestionMark,
  Moon,
  Monitor,
  MoreHorizontal,
  Redo,
  Settings,
  Sun,
  Undo,
} from 'lucide-react';
import { IconButton } from '@/shared/components/ui';
import { HeaderMenuOverlay } from './HeaderMenuOverlay';
import { HeaderMenuItem, HeaderMenuSeparator } from './HeaderMenuItem';
import type { HeaderOverflowMenuProps } from './types';

export const FEEDBACK_FORM_URL =
  'https://enkeebot.feishu.cn/share/base/form/shrcnok1dXPePgAxuu2qnXiVxYf';

export function HeaderOverflowMenu({
  className = '',
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
  showQuickAction,
  showSourceCode,
  showUndoRedo,
  showSnapshot,
  showSettings,
  showLanguage,
  showTheme,
  showSecondaryAction,
  showFeedback = false,
}: HeaderOverflowMenuProps) {
  const QuickActionIcon = quickAction?.icon;
  const SecondaryActionIcon = secondaryAction?.icon;
  const showPrimaryGroup = showQuickAction || showSourceCode || showUndoRedo;
  const showSecondaryGroup =
    showSnapshot || showSettings || showLanguage || showTheme || showSecondaryAction || showFeedback;

  return (
    <div className={`relative shrink-0 ${className}`.trim()}>
      <IconButton
        type="button"
        onClick={() => setActiveMenu(activeMenu === 'more' ? null : 'more')}
        variant="toolbar"
        size="md"
        isActive={activeMenu === 'more'}
        className="relative z-50 h-8 w-8 shrink-0 p-0 !text-text-secondary hover:!text-text-primary"
        title={t.more}
        aria-label={t.more}
        aria-haspopup="menu"
        aria-expanded={activeMenu === 'more'}
      >
        <MoreHorizontal className="w-4 h-4" />
      </IconButton>
      {activeMenu === 'more' && (
        <>
          <HeaderMenuOverlay onClose={() => setActiveMenu(null)} label={t.close} />
          <div
            className="absolute top-full right-0 mt-1 w-auto min-w-[10.5rem] bg-panel-bg dark:bg-panel-bg rounded-lg shadow-md dark:shadow-xl border border-border-black z-50 overflow-hidden py-1"
            role="menu"
            aria-label={t.more}
          >
            {showPrimaryGroup && (
              <>
                {showQuickAction && quickAction && QuickActionIcon && (
                  <HeaderMenuItem
                    icon={QuickActionIcon}
                    onClick={(event) => {
                      quickAction.onClick(event);
                      setActiveMenu(null);
                    }}
                  >
                    {quickAction.label}
                  </HeaderMenuItem>
                )}
                {showSourceCode && (
                  <HeaderMenuItem
                    icon={Code}
                    onClick={() => {
                      onOpenCodeViewer();
                      setActiveMenu(null);
                    }}
                    onPointerEnter={onPrefetchCodeViewer}
                    onPointerDown={onPrefetchCodeViewer}
                    onFocus={onPrefetchCodeViewer}
                  >
                    {t.sourceCode}
                  </HeaderMenuItem>
                )}
                {showUndoRedo && (
                  <>
                    <HeaderMenuItem
                      icon={Undo}
                      onClick={() => {
                        undo();
                        setActiveMenu(null);
                      }}
                      disabled={!canUndo}
                    >
                      {t.undo}
                    </HeaderMenuItem>
                    <HeaderMenuItem
                      icon={Redo}
                      onClick={() => {
                        redo();
                        setActiveMenu(null);
                      }}
                      disabled={!canRedo}
                    >
                      {t.redo}
                    </HeaderMenuItem>
                  </>
                )}
              </>
            )}

            {showPrimaryGroup && showSecondaryGroup && (
              <HeaderMenuSeparator />
            )}

            {showSecondaryGroup && (
              <>
                {showFeedback && (
                  <a
                    href={FEEDBACK_FORM_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    role="menuitem"
                    className="flex items-center gap-2.5 px-3 py-2 text-xs text-text-primary transition-colors hover:bg-element-hover focus:outline-none focus-visible:bg-element-hover focus-visible:ring-2 focus-visible:ring-system-blue/30"
                  >
                    <MessageCircleQuestionMark className="h-4 w-4 text-text-tertiary" />
                    {t.feedback}
                  </a>
                )}
                {showSecondaryAction && secondaryAction && SecondaryActionIcon && (
                  <HeaderMenuItem
                    icon={SecondaryActionIcon}
                    onClick={(event) => {
                      secondaryAction.onClick(event);
                      setActiveMenu(null);
                    }}
                  >
                    {secondaryAction.label}
                  </HeaderMenuItem>
                )}
                {showSnapshot && (
                  <HeaderMenuItem
                    icon={Camera}
                    onPointerEnter={onPrefetchSnapshot}
                    onPointerDown={onPrefetchSnapshot}
                    onFocus={onPrefetchSnapshot}
                    onClick={() => {
                      onSnapshot();
                      setActiveMenu(null);
                    }}
                  >
                    {t.snapshot}
                  </HeaderMenuItem>
                )}
                {showLanguage && (
                  <HeaderMenuItem
                    icon={Languages}
                    onClick={() => {
                      setLang(lang === 'en' ? 'zh' : 'en');
                      setActiveMenu(null);
                    }}
                  >
                    {t.switchLanguage}
                  </HeaderMenuItem>
                )}
                {showTheme && (
                  <HeaderMenuItem
                    icon={theme === 'system' ? Monitor : theme === 'dark' ? Sun : Moon}
                    onClick={() => {
                      if (theme === 'system') {
                        const isSystemDark = window.matchMedia(
                          '(prefers-color-scheme: dark)',
                        ).matches;
                        setTheme(isSystemDark ? 'light' : 'dark');
                      } else {
                        setTheme(theme === 'dark' ? 'light' : 'dark');
                      }
                      setActiveMenu(null);
                    }}
                  >
                    {t.toggleTheme}
                  </HeaderMenuItem>
                )}
                {showSettings && (
                  <HeaderMenuItem
                    icon={Settings}
                    onPointerEnter={onPrefetchSettings}
                    onPointerDown={onPrefetchSettings}
                    onFocus={onPrefetchSettings}
                    onClick={() => {
                      onOpenSettings();
                      setActiveMenu(null);
                    }}
                  >
                    {t.settings}
                  </HeaderMenuItem>
                )}
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
