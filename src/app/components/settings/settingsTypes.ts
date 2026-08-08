import React from 'react';

import {
  DEFAULT_CODE_EDITOR_OPACITY,
  MIN_CODE_EDITOR_OPACITY,
  MAX_CODE_EDITOR_OPACITY,
  type CodeEditorFontFamily,
} from '@/store';

export const DEFAULT_SETTINGS_WIDTH = 620;
export const DEFAULT_SETTINGS_MIN_WIDTH = 520;
export const DEFAULT_SETTINGS_MAX_WIDTH = 760;
export const DEFAULT_SETTINGS_MIN_HEIGHT = 380;
export const DEFAULT_SETTINGS_MAX_HEIGHT = 600;
export const SETTINGS_VIEWPORT_MARGIN = 12;
export const SETTINGS_ESTIMATED_HEIGHT = 460;
export const DEFAULT_CODE_EDITOR_FONT_FAMILY: CodeEditorFontFamily = 'jetbrains-mono';
export const DEFAULT_CODE_EDITOR_FONT_SIZE = 13;
export const SETTINGS_ICON_STROKE_WIDTH = 1.65;
export const SETTINGS_INLINE_BUTTON_CLASSNAME =
  'h-7 rounded-[6px] border-border-black px-2.5 text-[11px] font-medium shadow-none';
export const SETTINGS_TEXT_ACTION_CLASSNAME =
  'h-7 rounded-[6px] px-2.5 text-[11px] font-medium text-text-secondary shadow-none hover:bg-settings-muted hover:text-text-primary active:bg-settings-muted';

export const NAVIGATION_SENSITIVITY_MARKS = [
  { value: 0.5, label: '50%' },
  { value: 1, label: '100%' },
  { value: 2, label: '200%' },
];

export const formatSensitivityPercent = (value: number) => `${Math.round(value * 100)}%`;

export const CODE_EDITOR_OPACITY_MARKS = [
  { value: MIN_CODE_EDITOR_OPACITY, label: formatSensitivityPercent(MIN_CODE_EDITOR_OPACITY) },
  {
    value: DEFAULT_CODE_EDITOR_OPACITY,
    label: formatSensitivityPercent(DEFAULT_CODE_EDITOR_OPACITY),
  },
  { value: MAX_CODE_EDITOR_OPACITY, label: formatSensitivityPercent(MAX_CODE_EDITOR_OPACITY) },
];

export const parseSensitivityPercent = (input: string): number | null => {
  const numeric = Number.parseFloat(input.replace(/[^0-9.+-]/g, ''));
  return Number.isFinite(numeric) ? numeric / 100 : null;
};

export type SettingsPage = 'general' | 'sourceCode' | 'view' | 'about';

export interface SettingsSectionProps {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
}

export interface SettingsRowProps {
  label?: string;
  children: React.ReactNode;
  stacked?: boolean;
}

export interface ToggleRowProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

export interface SettingsNavItem {
  key: SettingsPage;
  icon: React.ReactNode;
  title: string;
}

export interface SettingsNavButtonProps {
  item: SettingsNavItem;
  isActive: boolean;
  onSelect: (page: SettingsPage) => void;
}

export interface SettingsStepperProps {
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

export interface CodePreviewLineProps {
  number: number;
  children: React.ReactNode;
}

export const clamp = (value: number, min: number, max: number) => {
  if (max < min) return min;
  return Math.max(min, Math.min(max, value));
};

export const resolveCodeEditorFontFamilyCss = (fontFamily: CodeEditorFontFamily) => {
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
