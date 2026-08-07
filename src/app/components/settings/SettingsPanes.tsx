import React from 'react';
import { Code, Monitor, Moon, Move3d, RotateCcw, Settings, Sun, Type } from 'lucide-react';

import {
  Button,
  PanelSegmentedControl,
  PanelSelect,
  Slider,
} from '@/shared/components/ui';
import { translations } from '@/shared/i18n';
import {
  NAVIGATION_SENSITIVITY_MAX,
  NAVIGATION_SENSITIVITY_MIN,
  MAX_CODE_EDITOR_OPACITY,
  MIN_CODE_EDITOR_OPACITY,
  type CodeEditorFontFamily,
  type NavigationSensitivity,
  type ViewOptions,
  type ViewerRenderQuality,
} from '@/store';
import { SettingsAboutPane } from './SettingsAboutPane';
import {
  SettingsCodePreview,
  SettingsRow,
  SettingsSection,
  SettingsStepper,
  ToggleRow,
} from './SettingsComponents';
import {
  CODE_EDITOR_OPACITY_MARKS,
  NAVIGATION_SENSITIVITY_MARKS,
  SETTINGS_ICON_STROKE_WIDTH,
  SETTINGS_INLINE_BUTTON_CLASSNAME,
  SETTINGS_TEXT_ACTION_CLASSNAME,
  formatSensitivityPercent,
  parseSensitivityPercent,
  type SettingsPage,
} from './settingsTypes';

export interface SettingsPaneProps {
  activePage: SettingsPage;
  lang: 'en' | 'zh';
  theme: 'light' | 'dark' | 'system';
  setLang: (lang: 'en' | 'zh') => void;
  setTheme: (theme: 'light' | 'dark' | 'system') => void;
  fontSize: 'small' | 'medium' | 'large';
  setFontSize: (size: 'small' | 'medium' | 'large') => void;
  showImportWarning: boolean;
  setShowImportWarning: (value: boolean) => void;
  aiAutoApplyEdits: boolean;
  setAiAutoApplyEdits: (value: boolean) => void;
  sourceCodeAutoApply: boolean;
  setSourceCodeAutoApply: (value: boolean) => void;
  codeEditorFontFamily: CodeEditorFontFamily;
  setCodeEditorFontFamily: (value: CodeEditorFontFamily) => void;
  codeEditorFontSize: number;
  setCodeEditorFontSize: (value: number) => void;
  codeEditorOpacity: number;
  setCodeEditorOpacity: (value: number) => void;
  resetCodeEditorTypography: () => void;
  showWorldOriginAxes: boolean;
  showMjcfWorldGeometry: boolean;
  showUsageGuide: boolean;
  cameraProjection: 'perspective' | 'orthographic';
  renderQuality: ViewerRenderQuality;
  setViewOption: <K extends keyof ViewOptions>(key: K, value: ViewOptions[K]) => void;
  navigationSensitivity: NavigationSensitivity;
  setNavigationSensitivity: (value: Partial<NavigationSensitivity>) => void;
}

export function SettingsPanes(props: SettingsPaneProps) {
  const t = translations[props.lang];

  switch (props.activePage) {
    case 'sourceCode':
      return (
        <div className="space-y-3">
          <SettingsSection
            icon={<Code className="h-4 w-4" strokeWidth={SETTINGS_ICON_STROKE_WIDTH} />}
            title={t.codeEditor}
            actions={
              <Button
                variant="secondary"
                size="sm"
                onClick={props.resetCodeEditorTypography}
                className={SETTINGS_INLINE_BUTTON_CLASSNAME}
                icon={
                  <RotateCcw className="h-3.5 w-3.5" strokeWidth={SETTINGS_ICON_STROKE_WIDTH} />
                }
              >
                {t.resetCodeEditorTypography}
              </Button>
            }
          >
            <ToggleRow
              label={t.sourceCodeAutoApply}
              checked={props.sourceCodeAutoApply}
              onChange={props.setSourceCodeAutoApply}
            />
            <SettingsRow label={t.fontFamily}>
              <div className="w-36">
                <PanelSelect
                  data-testid="settings-code-editor-font-family"
                  options={[
                    { value: 'jetbrains-mono', label: 'JetBrains Mono' },
                    { value: 'fira-code', label: 'Fira Code' },
                    { value: 'system-mono', label: t.systemMonospace },
                  ]}
                  value={props.codeEditorFontFamily}
                  onChange={(event) =>
                    props.setCodeEditorFontFamily(
                      event.currentTarget.value as CodeEditorFontFamily,
                    )
                  }
                />
              </div>
            </SettingsRow>
            <SettingsRow label={t.codeEditorFontSize}>
              <SettingsStepper
                label={t.codeEditorFontSize}
                value={props.codeEditorFontSize}
                min={11}
                max={24}
                onChange={props.setCodeEditorFontSize}
                inputTestId="settings-code-editor-font-size"
                decreaseTestId="settings-code-editor-font-size-decrease"
                increaseTestId="settings-code-editor-font-size-increase"
              />
            </SettingsRow>
            <SettingsRow stacked label={t.opacity}>
              <div data-testid="settings-code-editor-opacity">
                <Slider
                  value={props.codeEditorOpacity}
                  min={MIN_CODE_EDITOR_OPACITY}
                  max={MAX_CODE_EDITOR_OPACITY}
                  step={0.05}
                  marks={CODE_EDITOR_OPACITY_MARKS}
                  formatValue={formatSensitivityPercent}
                  parseValue={parseSensitivityPercent}
                  onChange={props.setCodeEditorOpacity}
                  compactThumb
                />
              </div>
            </SettingsRow>
          </SettingsSection>

          <SettingsSection
            icon={<Type className="h-4 w-4" strokeWidth={SETTINGS_ICON_STROKE_WIDTH} />}
            title={t.preview}
          >
            <SettingsRow stacked label={t.sourceCode}>
              <SettingsCodePreview
                codeEditorFontFamily={props.codeEditorFontFamily}
                codeEditorFontSize={props.codeEditorFontSize}
                codeEditorOpacity={props.codeEditorOpacity}
              />
            </SettingsRow>
          </SettingsSection>
        </div>
      );

    case 'view':
      return (
        <div className="space-y-3">
          <SettingsSection
            icon={<Monitor className="h-4 w-4" strokeWidth={SETTINGS_ICON_STROKE_WIDTH} />}
            title={t.view}
          >
            <SettingsRow stacked label={t.renderQuality}>
              <div data-testid="settings-render-quality">
                <PanelSegmentedControl
                  options={[
                    { value: 'performance', label: t.renderQualityPerformance },
                    { value: 'balanced', label: t.renderQualityBalanced },
                    { value: 'high', label: t.renderQualityHigh },
                    { value: 'ultra', label: t.renderQualityUltra },
                  ]}
                  value={props.renderQuality}
                  onChange={(value) =>
                    props.setViewOption('renderQuality', value as ViewerRenderQuality)
                  }
                  size="xs"
                  stretch
                  className="w-full"
                  ariaLabel={t.renderQuality}
                />
              </div>
            </SettingsRow>
            <ToggleRow
              label={t.showWorldOriginAxes}
              checked={props.showWorldOriginAxes}
              onChange={(checked) => props.setViewOption('showAxes', checked)}
            />
            <ToggleRow
              label={t.showMjcfWorldGeometry}
              checked={props.showMjcfWorldGeometry}
              onChange={(checked) => props.setViewOption('showMjcfWorldLink', checked)}
            />
            <ToggleRow
              label={t.showUsageGuide}
              checked={props.showUsageGuide}
              onChange={(checked) => props.setViewOption('showUsageGuide', checked)}
            />
            <SettingsRow label={t.cameraProjection}>
              <PanelSegmentedControl
                options={[
                  { value: 'perspective', label: t.cameraProjectionPerspective },
                  { value: 'orthographic', label: t.cameraProjectionOrthographic },
                ]}
                value={props.cameraProjection}
                onChange={(value) =>
                  props.setViewOption('cameraProjection', value as 'perspective' | 'orthographic')
                }
                size="xs"
                stretch={false}
                ariaLabel={t.cameraProjection}
              />
            </SettingsRow>
          </SettingsSection>
          <SettingsSection
            icon={<Move3d className="h-4 w-4" strokeWidth={SETTINGS_ICON_STROKE_WIDTH} />}
            title={t.viewerNavigation}
            actions={
              <Button
                variant="ghost"
                size="sm"
                onClick={() => props.setNavigationSensitivity({ zoom: 1, rotate: 1, pan: 1 })}
                disabled={
                  props.navigationSensitivity.zoom === 1 &&
                  props.navigationSensitivity.rotate === 1 &&
                  props.navigationSensitivity.pan === 1
                }
                className={SETTINGS_TEXT_ACTION_CLASSNAME}
                icon={
                  <RotateCcw className="h-3.5 w-3.5" strokeWidth={SETTINGS_ICON_STROKE_WIDTH} />
                }
              >
                {t.resetNavigationSensitivity}
              </Button>
            }
          >
            {(
              [
                {
                  key: 'zoom',
                  label: t.zoomSensitivity,
                  testId: 'settings-zoom-sensitivity',
                  onChange: (value: number) => props.setNavigationSensitivity({ zoom: value }),
                },
                {
                  key: 'rotate',
                  label: t.rotateSensitivity,
                  testId: 'settings-rotate-sensitivity',
                  onChange: (value: number) => props.setNavigationSensitivity({ rotate: value }),
                },
                {
                  key: 'pan',
                  label: t.panSensitivity,
                  testId: 'settings-pan-sensitivity',
                  onChange: (value: number) => props.setNavigationSensitivity({ pan: value }),
                },
              ] satisfies Array<{
                key: keyof NavigationSensitivity;
                label: string;
                testId: string;
                onChange: (value: number) => void;
              }>
            ).map((control) => (
              <SettingsRow key={control.key} stacked label={control.label}>
                <div data-testid={control.testId}>
                  <Slider
                    value={props.navigationSensitivity[control.key]}
                    min={NAVIGATION_SENSITIVITY_MIN}
                    max={NAVIGATION_SENSITIVITY_MAX}
                    step={0.05}
                    marks={NAVIGATION_SENSITIVITY_MARKS}
                    formatValue={formatSensitivityPercent}
                    parseValue={parseSensitivityPercent}
                    onChange={control.onChange}
                  />
                </div>
              </SettingsRow>
            ))}
          </SettingsSection>
        </div>
      );

    case 'about':
      return <SettingsAboutPane t={t} />;

    case 'general':
    default:
      return (
        <div className="space-y-3">
          <SettingsSection
            icon={<Settings className="h-4 w-4" strokeWidth={SETTINGS_ICON_STROKE_WIDTH} />}
            title={t.general}
            actions={
              <Button
                variant="ghost"
                size="sm"
                onClick={() => props.setFontSize('medium')}
                className={SETTINGS_TEXT_ACTION_CLASSNAME}
                icon={
                  <RotateCcw className="h-3.5 w-3.5" strokeWidth={SETTINGS_ICON_STROKE_WIDTH} />
                }
              >
                {t.resetFontSize}
              </Button>
            }
          >
            <SettingsRow label={t.language}>
              <PanelSegmentedControl
                options={[
                  { value: 'en', label: 'English' },
                  { value: 'zh', label: '中文' },
                ]}
                value={props.lang}
                onChange={(value) => props.setLang(value as 'en' | 'zh')}
                size="xs"
                stretch={false}
                ariaLabel={t.language}
              />
            </SettingsRow>
            <SettingsRow label={t.theme}>
              <PanelSegmentedControl
                options={[
                  {
                    value: 'light',
                    label: t.light,
                    icon: (
                      <Sun className="h-3.5 w-3.5" strokeWidth={SETTINGS_ICON_STROKE_WIDTH} />
                    ),
                  },
                  {
                    value: 'dark',
                    label: t.dark,
                    icon: (
                      <Moon className="h-3.5 w-3.5" strokeWidth={SETTINGS_ICON_STROKE_WIDTH} />
                    ),
                  },
                  {
                    value: 'system',
                    label: t.system,
                    icon: (
                      <Monitor className="h-3.5 w-3.5" strokeWidth={SETTINGS_ICON_STROKE_WIDTH} />
                    ),
                  },
                ]}
                value={props.theme}
                onChange={(value) => props.setTheme(value as 'light' | 'dark' | 'system')}
                size="xs"
                stretch={false}
                ariaLabel={t.theme}
              />
            </SettingsRow>
            <SettingsRow label={t.interfaceFontSize}>
              <PanelSegmentedControl
                options={[
                  { value: 'small', label: t.small },
                  { value: 'medium', label: t.medium },
                  { value: 'large', label: t.large },
                ]}
                value={props.fontSize}
                onChange={(value) => props.setFontSize(value as 'small' | 'medium' | 'large')}
                size="xs"
                stretch={false}
                ariaLabel={t.interfaceFontSize}
              />
            </SettingsRow>
            <ToggleRow
              label={t.importWarning}
              checked={props.showImportWarning}
              onChange={props.setShowImportWarning}
            />
            <ToggleRow
              label={t.aiAutoApply}
              checked={props.aiAutoApplyEdits}
              onChange={props.setAiAutoApplyEdits}
            />
          </SettingsSection>
        </div>
      );
  }
}