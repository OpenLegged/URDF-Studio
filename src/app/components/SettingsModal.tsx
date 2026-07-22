/**
 * Settings Modal Component
 * Desktop-first settings surface for interface, editor, view, and about preferences.
 */
import React from 'react';
import {
  Code,
  Eye,
  Info,
  Minus,
  Monitor,
  Moon,
  Move3d,
  RotateCcw,
  Settings,
  Sun,
  Type,
  X,
  Plus,
} from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import { OptionsPanelContainer } from '@/shared/components/Panel';
import {
  FLOATING_WINDOW_HEADER_HEIGHT_CLASS,
  FLOATING_WINDOW_RADIUS_CLASS,
  FLOATING_WINDOW_TITLE_CLASS,
} from '@/shared/components/DraggableWindow';
import {
  Button,
  CompactSwitch,
  IconButton,
  PanelSegmentedControl,
  PanelSelect,
  Slider,
} from '@/shared/components/ui';
import { translations } from '@/shared/i18n';
import {
  useManagedWindowLayer,
  useUIStore,
  NAVIGATION_SENSITIVITY_MIN,
  NAVIGATION_SENSITIVITY_MAX,
  DEFAULT_CODE_EDITOR_OPACITY,
  MIN_CODE_EDITOR_OPACITY,
  MAX_CODE_EDITOR_OPACITY,
  type CodeEditorFontFamily,
  type NavigationSensitivity,
} from '@/store';
import { SettingsAboutPane } from './settings/SettingsAboutPane';

const DEFAULT_SETTINGS_WIDTH = 620;
const DEFAULT_SETTINGS_MIN_WIDTH = 520;
const DEFAULT_SETTINGS_MAX_WIDTH = 760;
const DEFAULT_SETTINGS_MIN_HEIGHT = 380;
const DEFAULT_SETTINGS_MAX_HEIGHT = 600;
const SETTINGS_VIEWPORT_MARGIN = 12;
const SETTINGS_ESTIMATED_HEIGHT = 460;
const DEFAULT_CODE_EDITOR_FONT_FAMILY: CodeEditorFontFamily = 'jetbrains-mono';
const DEFAULT_CODE_EDITOR_FONT_SIZE = 13;
const SETTINGS_ICON_STROKE_WIDTH = 1.65;
const SETTINGS_INLINE_BUTTON_CLASSNAME =
  'h-7 rounded-[6px] border-border-black px-2.5 text-[11px] font-medium shadow-none';
const SETTINGS_TEXT_ACTION_CLASSNAME =
  'h-7 rounded-[6px] px-2.5 text-[11px] font-medium text-text-secondary shadow-none hover:bg-settings-muted hover:text-text-primary active:bg-settings-muted';

const NAVIGATION_SENSITIVITY_MARKS = [
  { value: 0.5, label: '50%' },
  { value: 1, label: '100%' },
  { value: 2, label: '200%' },
];

const formatSensitivityPercent = (value: number) => `${Math.round(value * 100)}%`;

const CODE_EDITOR_OPACITY_MARKS = [
  { value: MIN_CODE_EDITOR_OPACITY, label: formatSensitivityPercent(MIN_CODE_EDITOR_OPACITY) },
  { value: DEFAULT_CODE_EDITOR_OPACITY, label: formatSensitivityPercent(DEFAULT_CODE_EDITOR_OPACITY) },
  { value: MAX_CODE_EDITOR_OPACITY, label: formatSensitivityPercent(MAX_CODE_EDITOR_OPACITY) },
];

const parseSensitivityPercent = (input: string): number | null => {
  const numeric = Number.parseFloat(input.replace(/[^0-9.+-]/g, ''));
  return Number.isFinite(numeric) ? numeric / 100 : null;
};

type SettingsPage = 'general' | 'sourceCode' | 'view' | 'about';

interface SettingsSectionProps {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
}

interface SettingsRowProps {
  label?: string;
  children: React.ReactNode;
  stacked?: boolean;
}

interface ToggleRowProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

interface SettingsNavItem {
  key: SettingsPage;
  icon: React.ReactNode;
  title: string;
}

interface SettingsNavButtonProps {
  item: SettingsNavItem;
  isActive: boolean;
  onSelect: (page: SettingsPage) => void;
}

interface SettingsStepperProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  inputTestId: string;
  decreaseTestId: string;
  increaseTestId: string;
}

interface CodePreviewLineProps {
  number: number;
  children: React.ReactNode;
}

const clamp = (value: number, min: number, max: number) => {
  if (max < min) return min;
  return Math.max(min, Math.min(max, value));
};

const resolveCodeEditorFontFamilyCss = (fontFamily: CodeEditorFontFamily) => {
  switch (fontFamily) {
    case 'fira-code':
      return "'Fira Code', 'JetBrains Mono', 'Consolas', 'Monaco', 'Courier New', monospace";
    case 'system-mono':
      return "ui-monospace, 'SFMono-Regular', 'Consolas', 'Monaco', 'Liberation Mono', 'Courier New', monospace";
    case 'jetbrains-mono':
    default:
      return "'JetBrains Mono', 'Fira Code', 'Consolas', 'Monaco', 'Courier New', monospace";
  }
};

function SettingsSection({ icon, title, children, actions }: SettingsSectionProps) {
  return (
    <section className="overflow-hidden rounded-[10px] border border-border-black bg-settings-card/95">
      <div className="flex min-h-10 items-center justify-between gap-3 border-b border-border-black/70 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[7px] border border-border-black bg-panel-bg text-text-secondary">
            {icon}
          </span>
          <h3 className="truncate text-[11px] font-semibold tracking-[0.06em] text-text-secondary uppercase">
            {title}
          </h3>
        </div>
        {actions ? <div className="shrink-0">{actions}</div> : null}
      </div>
      <div className="divide-y divide-border-black/70">{children}</div>
    </section>
  );
}

function SettingsRow({ label, children, stacked = false }: SettingsRowProps) {
  if (stacked) {
    return (
      <div className="space-y-2 px-3 py-2.5">
        {label ? (
          <div className="text-[11px] font-medium leading-4.5 text-text-secondary">{label}</div>
        ) : null}
        <div>{children}</div>
      </div>
    );
  }

  return (
    <div className="grid min-h-10 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-2">
      {label ? (
        <div className="min-w-0 text-[11px] font-medium leading-4.5 text-text-secondary">
          {label}
        </div>
      ) : null}
      <div className="flex max-w-full items-center justify-end gap-2">{children}</div>
    </div>
  );
}

function ToggleRow({ label, checked, onChange }: ToggleRowProps) {
  return (
    <SettingsRow label={label}>
      <CompactSwitch checked={checked} onChange={onChange} />
    </SettingsRow>
  );
}

function SettingsNavButton({ item, isActive, onSelect }: SettingsNavButtonProps) {
  return (
    <button
      type="button"
      data-settings-page={item.key}
      onClick={() => onSelect(item.key)}
      className={`relative flex w-full items-center gap-2 rounded-[8px] px-2.5 py-2 text-left transition-colors ${
        isActive
          ? 'bg-panel-bg/90 text-text-primary ring-1 ring-border-black/60'
          : 'text-text-secondary hover:bg-panel-bg/75 hover:text-text-primary'
      }`}
    >
      <span
        className={`absolute bottom-1.5 left-1 top-1.5 w-0.5 rounded-full ${
          isActive ? 'bg-settings-accent' : 'bg-transparent'
        }`}
      />
      <span className={`${isActive ? 'text-settings-accent' : 'text-text-tertiary'}`}>
        {item.icon}
      </span>
      <span className="min-w-0 flex-1 text-[11px] font-medium leading-4.5">{item.title}</span>
    </button>
  );
}

function SettingsStepper({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  inputTestId,
  decreaseTestId,
  increaseTestId,
}: SettingsStepperProps) {
  const adjustValue = React.useCallback(
    (delta: number) => {
      onChange(value + delta);
    },
    [onChange, value],
  );

  const handleInputChange = React.useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const nextValue = Number(event.currentTarget.value);
      if (Number.isNaN(nextValue)) {
        return;
      }
      onChange(nextValue);
    },
    [onChange],
  );

  return (
    <div className="inline-flex h-7 items-center overflow-hidden rounded-[6px] border border-border-black bg-panel-bg shadow-sm">
      <IconButton
        type="button"
        data-testid={decreaseTestId}
        aria-label={`${label} -${step}`}
        variant="ghost"
        size="md"
        className="h-full w-7 rounded-none hover:bg-settings-muted"
        onClick={() => adjustValue(-step)}
        disabled={value <= min}
      >
        <Minus className="h-3.5 w-3.5" strokeWidth={SETTINGS_ICON_STROKE_WIDTH} />
      </IconButton>
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        data-testid={inputTestId}
        onChange={handleInputChange}
        className="h-full w-12 border-x border-border-black/70 bg-transparent px-0 text-center text-[12px] font-medium text-text-primary outline-none focus:ring-2 focus:ring-system-blue/30"
      />
      <IconButton
        type="button"
        data-testid={increaseTestId}
        aria-label={`${label} +${step}`}
        variant="ghost"
        size="md"
        className="h-full w-7 rounded-none hover:bg-settings-muted"
        onClick={() => adjustValue(step)}
        disabled={value >= max}
      >
        <Plus className="h-3.5 w-3.5" strokeWidth={SETTINGS_ICON_STROKE_WIDTH} />
      </IconButton>
    </div>
  );
}

function CodePreviewLine({ number, children }: CodePreviewLineProps) {
  return (
    <div className="grid grid-cols-[18px_minmax(0,1fr)] items-start gap-2.5">
      <span className="select-none text-right text-[11px] text-text-tertiary/80">{number}</span>
      <span>{children}</span>
    </div>
  );
}

function SettingsCodePreview({
  codeEditorFontFamily,
  codeEditorFontSize,
  codeEditorOpacity,
}: {
  codeEditorFontFamily: CodeEditorFontFamily;
  codeEditorFontSize: number;
  codeEditorOpacity: number;
}) {
  return (
    <div
      className="source-code-editor-window overflow-hidden rounded-[10px] border border-border-black"
      style={
        {
          '--source-code-editor-opacity-percent': formatSensitivityPercent(codeEditorOpacity),
        } as React.CSSProperties
      }
    >
      <div className="source-code-editor-chrome flex items-center justify-between border-b border-border-black px-2.5 py-1.5">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-text-tertiary/70" />
          <span className="text-[10px] font-medium text-text-secondary">preview.urdf</span>
        </div>
        <span className="text-[10px] text-text-tertiary">XML</span>
      </div>
      <pre
        className="source-code-editor-panel overflow-x-auto p-2.5 text-text-secondary"
        style={{
          fontFamily: resolveCodeEditorFontFamilyCss(codeEditorFontFamily),
          fontSize: `${codeEditorFontSize}px`,
          lineHeight: 1.6,
        }}
      >
        <code>
          <CodePreviewLine number={1}>
            <span className="text-code-tag">&lt;joint</span>{' '}
            <span className="text-code-attr">name</span>
            <span className="text-text-secondary">=</span>
            <span className="text-code-value">&quot;hip_joint&quot;</span>{' '}
            <span className="text-code-attr">type</span>
            <span className="text-text-secondary">=</span>
            <span className="text-code-value">&quot;revolute&quot;</span>
            <span className="text-code-tag">&gt;</span>
          </CodePreviewLine>
          <CodePreviewLine number={2}>
            <span className="text-code-tag">&lt;origin</span>{' '}
            <span className="text-code-attr">xyz</span>
            <span className="text-text-secondary">=</span>
            <span className="text-code-value">&quot;0 0 0&quot;</span>{' '}
            <span className="text-code-attr">rpy</span>
            <span className="text-text-secondary">=</span>
            <span className="text-code-value">&quot;0 0 0&quot;</span>{' '}
            <span className="text-code-tag">/&gt;</span>
          </CodePreviewLine>
          <CodePreviewLine number={3}>
            <span className="text-code-tag">&lt;limit</span>{' '}
            <span className="text-code-attr">effort</span>
            <span className="text-text-secondary">=</span>
            <span className="text-code-value">&quot;42&quot;</span>{' '}
            <span className="text-code-attr">velocity</span>
            <span className="text-text-secondary">=</span>
            <span className="text-code-value">&quot;8.0&quot;</span>{' '}
            <span className="text-code-tag">/&gt;</span>
          </CodePreviewLine>
          <CodePreviewLine number={4}>
            <span className="text-code-tag">&lt;/joint&gt;</span>
          </CodePreviewLine>
        </code>
      </pre>
    </div>
  );
}

export function SettingsModal() {
  const {
    isSettingsOpen,
    settingsPos,
    closeSettings,
    setSettingsPos,
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
    setViewOption,
    fontSize,
    setFontSize,
    sourceCodeAutoApply,
    setSourceCodeAutoApply,
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
      settingsPos: state.settingsPos,
      closeSettings: state.closeSettings,
      setSettingsPos: state.setSettingsPos,
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
      setViewOption: state.setViewOption,
      fontSize: state.fontSize,
      setFontSize: state.setFontSize,
      sourceCodeAutoApply: state.sourceCodeAutoApply,
      setSourceCodeAutoApply: state.setSourceCodeAutoApply,
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
  const panelRef = React.useRef<HTMLDivElement>(null);
  const dragMoveHandlerRef = React.useRef<((event: MouseEvent) => void) | null>(null);
  const dragEndHandlerRef = React.useRef<(() => void) | null>(null);
  const dragPreviousUserSelectRef = React.useRef('');
  const dragPreviousCursorRef = React.useRef('');

  const maxPanelWidth =
    typeof window !== 'undefined'
      ? Math.max(
          DEFAULT_SETTINGS_MIN_WIDTH,
          Math.min(DEFAULT_SETTINGS_MAX_WIDTH, window.innerWidth - SETTINGS_VIEWPORT_MARGIN * 2),
        )
      : DEFAULT_SETTINGS_MAX_WIDTH;

  const maxPanelHeight =
    typeof window !== 'undefined'
      ? Math.max(
          DEFAULT_SETTINGS_MIN_HEIGHT,
          Math.min(DEFAULT_SETTINGS_MAX_HEIGHT, window.innerHeight - SETTINGS_VIEWPORT_MARGIN * 2),
        )
      : DEFAULT_SETTINGS_MAX_HEIGHT;

  const clampSettingsPosition = React.useCallback((x: number, y: number) => {
    if (typeof window === 'undefined') {
      return { x, y };
    }

    const rect = panelRef.current?.getBoundingClientRect();
    const width = rect?.width ?? DEFAULT_SETTINGS_WIDTH;
    const height = rect?.height ?? SETTINGS_ESTIMATED_HEIGHT;

    return {
      x: clamp(x, SETTINGS_VIEWPORT_MARGIN, window.innerWidth - width - SETTINGS_VIEWPORT_MARGIN),
      y: clamp(y, SETTINGS_VIEWPORT_MARGIN, window.innerHeight - height - SETTINGS_VIEWPORT_MARGIN),
    };
  }, []);

  const clearDragListeners = React.useCallback(() => {
    const moveHandler = dragMoveHandlerRef.current;
    const endHandler = dragEndHandlerRef.current;

    if (moveHandler) {
      document.removeEventListener('mousemove', moveHandler);
      dragMoveHandlerRef.current = null;
    }

    if (endHandler) {
      document.removeEventListener('mouseup', endHandler);
      window.removeEventListener('blur', endHandler);
      dragEndHandlerRef.current = null;
    }

    document.body.style.userSelect = dragPreviousUserSelectRef.current;
    document.body.style.cursor = dragPreviousCursorRef.current;
  }, []);

  React.useEffect(() => {
    if (!isSettingsOpen || typeof window === 'undefined' || !panelRef.current) {
      return undefined;
    }

    const syncPosition = () => {
      const currentPos = useUIStore.getState().settingsPos;
      const nextPos = clampSettingsPosition(currentPos.x, currentPos.y);

      if (nextPos.x !== currentPos.x || nextPos.y !== currentPos.y) {
        setSettingsPos(nextPos);
      }
    };

    syncPosition();
    window.addEventListener('resize', syncPosition);

    if (typeof ResizeObserver === 'undefined') {
      return () => {
        window.removeEventListener('resize', syncPosition);
      };
    }

    const observer = new ResizeObserver(() => {
      syncPosition();
    });

    observer.observe(panelRef.current);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', syncPosition);
    };
  }, [clampSettingsPosition, isSettingsOpen, setSettingsPos]);

  React.useEffect(() => {
    if (isSettingsOpen) {
      return undefined;
    }

    clearDragListeners();
    return undefined;
  }, [clearDragListeners, isSettingsOpen]);

  React.useEffect(
    () => () => {
      clearDragListeners();
    },
    [clearDragListeners],
  );

  const handleDragStart = (event: React.MouseEvent) => {
    event.preventDefault();
    clearDragListeners();
    const startX = event.clientX;
    const startY = event.clientY;
    const initialX = settingsPos.x;
    const initialY = settingsPos.y;
    dragPreviousUserSelectRef.current = document.body.style.userSelect;
    dragPreviousCursorRef.current = document.body.style.cursor;
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'move';

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      const nextPosition = clampSettingsPosition(initialX + dx, initialY + dy);
      setSettingsPos(nextPosition);
    };

    const handleMouseUp = () => {
      clearDragListeners();
    };

    dragMoveHandlerRef.current = handleMouseMove;
    dragEndHandlerRef.current = handleMouseUp;
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('blur', handleMouseUp);
  };

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

  const codeEditorFontFamilyOptions = React.useMemo(
    () => [
      { value: 'jetbrains-mono', label: 'JetBrains Mono' },
      { value: 'fira-code', label: 'Fira Code' },
      { value: 'system-mono', label: t.systemMonospace },
    ],
    [t.systemMonospace],
  );

  const resetCodeEditorTypography = React.useCallback(() => {
    setCodeEditorFontFamily(DEFAULT_CODE_EDITOR_FONT_FAMILY);
    setCodeEditorFontSize(DEFAULT_CODE_EDITOR_FONT_SIZE);
  }, [setCodeEditorFontFamily, setCodeEditorFontSize]);

  const detailPane = (() => {
    switch (activePage) {
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
                  onClick={resetCodeEditorTypography}
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
                checked={sourceCodeAutoApply}
                onChange={setSourceCodeAutoApply}
              />
              <SettingsRow label={t.fontFamily}>
                <div className="w-36">
                  <PanelSelect
                    data-testid="settings-code-editor-font-family"
                    options={codeEditorFontFamilyOptions}
                    value={codeEditorFontFamily}
                    onChange={(event) =>
                      setCodeEditorFontFamily(event.currentTarget.value as CodeEditorFontFamily)
                    }
                  />
                </div>
              </SettingsRow>
              <SettingsRow label={t.codeEditorFontSize}>
                <SettingsStepper
                  label={t.codeEditorFontSize}
                  value={codeEditorFontSize}
                  min={11}
                  max={24}
                  onChange={setCodeEditorFontSize}
                  inputTestId="settings-code-editor-font-size"
                  decreaseTestId="settings-code-editor-font-size-decrease"
                  increaseTestId="settings-code-editor-font-size-increase"
                />
              </SettingsRow>
              <SettingsRow stacked label={t.opacity}>
                <div data-testid="settings-code-editor-opacity">
                  <Slider
                    value={codeEditorOpacity}
                    min={MIN_CODE_EDITOR_OPACITY}
                    max={MAX_CODE_EDITOR_OPACITY}
                    step={0.05}
                    marks={CODE_EDITOR_OPACITY_MARKS}
                    formatValue={formatSensitivityPercent}
                    parseValue={parseSensitivityPercent}
                    onChange={setCodeEditorOpacity}
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
                  codeEditorFontFamily={codeEditorFontFamily}
                  codeEditorFontSize={codeEditorFontSize}
                  codeEditorOpacity={codeEditorOpacity}
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
              <ToggleRow
                label={t.showWorldOriginAxes}
                checked={showWorldOriginAxes}
                onChange={(checked) => setViewOption('showAxes', checked)}
              />
              <ToggleRow
                label={t.showMjcfWorldGeometry}
                checked={showMjcfWorldGeometry}
                onChange={(checked) => setViewOption('showMjcfWorldLink', checked)}
              />
              <ToggleRow
                label={t.showUsageGuide}
                checked={showUsageGuide}
                onChange={(checked) => setViewOption('showUsageGuide', checked)}
              />
              <SettingsRow label={t.cameraProjection}>
                <PanelSegmentedControl
                  options={[
                    { value: 'perspective', label: t.cameraProjectionPerspective },
                    { value: 'orthographic', label: t.cameraProjectionOrthographic },
                  ]}
                  value={cameraProjection}
	                  onChange={(value) =>
	                    setViewOption('cameraProjection', value as 'perspective' | 'orthographic')
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
                  onClick={() =>
                    setNavigationSensitivity({ zoom: 1, rotate: 1, pan: 1 })
                  }
                  disabled={
                    navigationSensitivity.zoom === 1 &&
                    navigationSensitivity.rotate === 1 &&
                    navigationSensitivity.pan === 1
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
                    onChange: (value: number) => setNavigationSensitivity({ zoom: value }),
                  },
                  {
                    key: 'rotate',
                    label: t.rotateSensitivity,
                    testId: 'settings-rotate-sensitivity',
                    onChange: (value: number) => setNavigationSensitivity({ rotate: value }),
                  },
                  {
                    key: 'pan',
                    label: t.panSensitivity,
                    testId: 'settings-pan-sensitivity',
                    onChange: (value: number) => setNavigationSensitivity({ pan: value }),
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
                      value={navigationSensitivity[control.key]}
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
                  onClick={() => setFontSize('medium')}
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
	                  value={lang}
	                  onChange={(value) => setLang(value as 'en' | 'zh')}
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
	                  value={theme}
	                  onChange={(value) => setTheme(value as 'light' | 'dark' | 'system')}
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
	                  value={fontSize}
	                  onChange={(value) => setFontSize(value as 'small' | 'medium' | 'large')}
	                  size="xs"
	                  stretch={false}
	                  ariaLabel={t.interfaceFontSize}
	                />
              </SettingsRow>
              <ToggleRow
                label={t.importWarning}
                checked={showImportWarning}
                onChange={setShowImportWarning}
              />
            </SettingsSection>
          </div>
        );
    }
  })();

  if (!isSettingsOpen) {
    return null;
  }

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
            onMouseDown={handleDragStart}
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
                {detailPane}
              </div>
            </section>
          </div>
        </div>
      </OptionsPanelContainer>
    </div>
  );
}

export default SettingsModal;
