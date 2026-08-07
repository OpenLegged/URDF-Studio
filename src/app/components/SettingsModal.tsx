/**
 * Settings Modal Component
 * Desktop-first settings surface for interface, editor, view, and about preferences.
 */
import React from 'react';
import { Code, Eye, Info, Settings, X } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import { OptionsPanelContainer } from '@/shared/components/Panel';
import {
  FLOATING_WINDOW_HEADER_HEIGHT_CLASS,
  FLOATING_WINDOW_RADIUS_CLASS,
  FLOATING_WINDOW_TITLE_CLASS,
} from '@/shared/components/DraggableWindow';
import { IconButton } from '@/shared/components/ui';
import { translations } from '@/shared/i18n';
import { useManagedWindowLayer, useUIStore } from '@/store';
import { SettingsNavButton } from './settings/SettingsComponents';
import { SettingsPanes } from './settings/SettingsPanes';
import { useSettingsDrag } from './settings/useSettingsDrag';
import {
  DEFAULT_SETTINGS_MIN_HEIGHT,
  DEFAULT_SETTINGS_MIN_WIDTH,
  DEFAULT_SETTINGS_WIDTH,
  SETTINGS_ESTIMATED_HEIGHT,
  SETTINGS_ICON_STROKE_WIDTH,
  DEFAULT_CODE_EDITOR_FONT_FAMILY,
  DEFAULT_CODE_EDITOR_FONT_SIZE,
  type SettingsNavItem,
  type SettingsPage,
} from './settings/settingsTypes';

export function SettingsModal() {
  const {
    isSettingsOpen,
    closeSettings,
    lang,
    setLang,
    theme,
    setTheme,
    showImportWarning,
    setShowImportWarning,
    showWorldOriginAxes,
    showMjcfWorldGeometry,
    showUsageGuide,
    cameraProjection,
    renderQuality,
    setViewOption,
    fontSize,
    setFontSize,
    sourceCodeAutoApply,
    setSourceCodeAutoApply,
    aiAutoApplyEdits,
    setAiAutoApplyEdits,
    codeEditorFontFamily,
    setCodeEditorFontFamily,
    codeEditorFontSize,
    setCodeEditorFontSize,
    codeEditorOpacity,
    setCodeEditorOpacity,
    navigationSensitivity,
    setNavigationSensitivity,
  } = useUIStore(
    useShallow((state) => ({
      isSettingsOpen: state.isSettingsOpen,
      closeSettings: state.closeSettings,
      lang: state.lang,
      setLang: state.setLang,
      theme: state.theme,
      setTheme: state.setTheme,
      showImportWarning: state.showImportWarning,
      setShowImportWarning: state.setShowImportWarning,
      showWorldOriginAxes: state.viewOptions.showAxes,
      showMjcfWorldGeometry: state.viewOptions.showMjcfWorldLink,
      showUsageGuide: state.viewOptions.showUsageGuide,
      cameraProjection: state.viewOptions.cameraProjection,
      renderQuality: state.viewOptions.renderQuality,
      setViewOption: state.setViewOption,
      fontSize: state.fontSize,
      setFontSize: state.setFontSize,
      sourceCodeAutoApply: state.sourceCodeAutoApply,
      setSourceCodeAutoApply: state.setSourceCodeAutoApply,
      aiAutoApplyEdits: state.aiAutoApplyEdits,
      setAiAutoApplyEdits: state.setAiAutoApplyEdits,
      codeEditorFontFamily: state.codeEditorFontFamily,
      setCodeEditorFontFamily: state.setCodeEditorFontFamily,
      codeEditorFontSize: state.codeEditorFontSize,
      setCodeEditorFontSize: state.setCodeEditorFontSize,
      codeEditorOpacity: state.codeEditorOpacity,
      setCodeEditorOpacity: state.setCodeEditorOpacity,
      navigationSensitivity: state.navigationSensitivity,
      setNavigationSensitivity: state.setNavigationSensitivity,
    })),
  );

  const settingsWindowLayer = useManagedWindowLayer('settings');
  const [activePage, setActivePage] = React.useState<SettingsPage>('general');
  const t = translations[lang];
  const { maxPanelWidth, maxPanelHeight, onDragStart, panelRef } = useSettingsDrag();

  const settingsPages = React.useMemo<SettingsNavItem[]>(
    () => [
      {
        key: 'general',
        icon: <Settings className="h-4 w-4" strokeWidth={SETTINGS_ICON_STROKE_WIDTH} />,
        title: t.general,
      },
      {
        key: 'sourceCode',
        icon: <Code className="h-4 w-4" strokeWidth={SETTINGS_ICON_STROKE_WIDTH} />,
        title: t.codeEditor,
      },
      {
        key: 'view',
        icon: <Eye className="h-4 w-4" strokeWidth={SETTINGS_ICON_STROKE_WIDTH} />,
        title: t.view,
      },
      {
        key: 'about',
        icon: <Info className="h-4 w-4" strokeWidth={SETTINGS_ICON_STROKE_WIDTH} />,
        title: t.about,
      },
    ],
    [t.about, t.codeEditor, t.general, t.view],
  );

  const resetCodeEditorTypography = React.useCallback(() => {
    setCodeEditorFontFamily(DEFAULT_CODE_EDITOR_FONT_FAMILY);
    setCodeEditorFontSize(DEFAULT_CODE_EDITOR_FONT_SIZE);
  }, [setCodeEditorFontFamily, setCodeEditorFontSize]);

  if (!isSettingsOpen) {
    return null;
  }

  const settingsPos = useUIStore.getState().settingsPos;

  return (
    <div
      ref={panelRef}
      style={{ left: settingsPos.x, top: settingsPos.y, zIndex: settingsWindowLayer.zIndex }}
      className="pointer-events-auto fixed"
      role="toolbar"
      aria-label={t.settings}
      tabIndex={-1}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
      onPointerDownCapture={settingsWindowLayer.onActivate}
      onFocusCapture={settingsWindowLayer.onActivate}
      onPointerDown={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
    >
      <OptionsPanelContainer
        width={DEFAULT_SETTINGS_WIDTH}
        height={SETTINGS_ESTIMATED_HEIGHT}
        minWidth={DEFAULT_SETTINGS_MIN_WIDTH}
        maxWidth={maxPanelWidth}
        minHeight={DEFAULT_SETTINGS_MIN_HEIGHT}
        maxHeight={maxPanelHeight}
        resizable
        resizeTitle={t.resize}
        className={`overflow-hidden ${FLOATING_WINDOW_RADIUS_CLASS} bg-settings-shell shadow-[0_18px_48px_rgba(15,23,42,0.08),0_8px_18px_rgba(15,23,42,0.06),0_1px_3px_rgba(15,23,42,0.04)] dark:shadow-[0_20px_52px_rgba(0,0,0,0.42),0_10px_28px_rgba(0,0,0,0.34)]`}
      >
        <div className="flex h-full min-h-0 flex-col bg-settings-shell">
          <div
            data-testid="settings-drag-handle"
            role="toolbar"
            aria-label={`${t.settings} window controls`}
            tabIndex={-1}
            onMouseDown={onDragStart}
            className={`flex ${FLOATING_WINDOW_HEADER_HEIGHT_CLASS} shrink-0 select-none items-center justify-between gap-3 border-b border-border-black bg-panel-bg/95 px-3.5`}
          >
            <div className="flex min-w-0 items-center gap-2.5">
              <div className="rounded-[7px] border border-border-black bg-settings-card p-1.25 text-text-secondary">
                <Settings className="h-3.5 w-3.5" strokeWidth={SETTINGS_ICON_STROKE_WIDTH} />
              </div>
              <div className="flex min-w-0 items-baseline">
                <h2 className={`truncate tracking-[-0.01em] ${FLOATING_WINDOW_TITLE_CLASS}`}>
                  {t.settings}
                </h2>
              </div>
            </div>
            <IconButton
              onMouseDown={(event) => event.stopPropagation()}
              onClick={closeSettings}
              size="sm"
              variant="close"
              aria-label={t.close}
              className="h-6.5 w-6.5 rounded-[6px] p-0"
            >
              <X className="h-3.5 w-3.5" strokeWidth={SETTINGS_ICON_STROKE_WIDTH} />
            </IconButton>
          </div>

          <div className="grid min-h-0 flex-1 grid-cols-[108px_minmax(0,1fr)] gap-2.5 p-2.5">
            <aside className="min-h-0 py-0.5">
              <div className="space-y-1">
                {settingsPages.map((page) => (
                  <SettingsNavButton
                    key={page.key}
                    item={page}
                    isActive={activePage === page.key}
                    onSelect={setActivePage}
                  />
                ))}
              </div>
            </aside>

            <section
              data-testid="settings-detail-pane"
              className="flex min-h-0 flex-col overflow-hidden rounded-[12px] border border-border-black bg-panel-bg"
            >
              <div
                data-testid="settings-detail-scroll"
                className="custom-scrollbar min-h-0 flex-1 overflow-y-auto overflow-x-hidden bg-panel-bg p-3 [scrollbar-gutter:stable]"
              >
                <SettingsPanes
                  activePage={activePage}
                  lang={lang}
                  setLang={setLang}
                  theme={theme}
                  setTheme={setTheme}
                  fontSize={fontSize}
                  setFontSize={setFontSize}
                  showImportWarning={showImportWarning}
                  setShowImportWarning={setShowImportWarning}
                  aiAutoApplyEdits={aiAutoApplyEdits}
                  setAiAutoApplyEdits={setAiAutoApplyEdits}
                  sourceCodeAutoApply={sourceCodeAutoApply}
                  setSourceCodeAutoApply={setSourceCodeAutoApply}
                  codeEditorFontFamily={codeEditorFontFamily}
                  setCodeEditorFontFamily={setCodeEditorFontFamily}
                  codeEditorFontSize={codeEditorFontSize}
                  setCodeEditorFontSize={setCodeEditorFontSize}
                  codeEditorOpacity={codeEditorOpacity}
                  setCodeEditorOpacity={setCodeEditorOpacity}
                  resetCodeEditorTypography={resetCodeEditorTypography}
                  showWorldOriginAxes={showWorldOriginAxes}
                  showMjcfWorldGeometry={showMjcfWorldGeometry}
                  showUsageGuide={showUsageGuide}
                  cameraProjection={cameraProjection}
                  renderQuality={renderQuality}
                  setViewOption={setViewOption}
                  navigationSensitivity={navigationSensitivity}
                  setNavigationSensitivity={setNavigationSensitivity}
                />
              </div>
            </section>
          </div>
        </div>
      </OptionsPanelContainer>
    </div>
  );
}

export default SettingsModal;