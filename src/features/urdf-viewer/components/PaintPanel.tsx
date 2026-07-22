import React, { useState } from 'react';
import type { Language } from '@/shared/i18n';
import { translations } from '@/shared/i18n';
import { WORKSPACE_OVERLAY_RIGHT_EDGE_GAP } from '@/shared/components/3d/scene';
import { OptionsPanel } from '@/shared/components/Panel/OptionsPanel';
import { parseThreeColorWithOpacity } from '@/core/utils/color.ts';
import type {
  ToolMode,
  ViewerPaintOperation,
  ViewerPaintSelectionScope,
  ViewerPaintStatus,
} from '../types';

interface PaintPanelProps {
  lang: Language;
  toolMode: ToolMode;
  paintColor: string;
  onPaintColorChange: (color: string) => void;
  paintSelectionScope: ViewerPaintSelectionScope;
  onPaintSelectionScopeChange: (scope: ViewerPaintSelectionScope) => void;
  paintOperation: ViewerPaintOperation;
  onPaintOperationChange: (operation: ViewerPaintOperation) => void;
  paintStatus: ViewerPaintStatus | null;
  supported: boolean;
  onClose: () => void;
  paintPanelRef?: React.RefObject<HTMLDivElement | null>;
  paintPanelPos?: { x: number; y: number } | null;
  onMouseDown?: (e: React.MouseEvent) => void;
  zIndex?: number;
  onActivate?: () => void;
}

function normalizeHexColor(value: string): string | null {
  const normalized = value.trim().replace(/^#/, '').toLowerCase();
  if (!/^[0-9a-f]{6}(?:[0-9a-f]{2})?$/.test(normalized)) {
    return null;
  }

  return `#${normalized}`;
}

function clampOpacity(value: number): number {
  if (!Number.isFinite(value)) {
    return 1;
  }

  return Math.min(1, Math.max(0, value));
}

function opacityToHex(opacity: number): string {
  return Math.round(clampOpacity(opacity) * 255)
    .toString(16)
    .padStart(2, '0');
}

function getPaintColorPickerValue(value: string): string {
  const parsed = parseThreeColorWithOpacity(value);
  return parsed ? `#${parsed.color.getHexString()}` : '#ff6c0a';
}

function getPaintOpacity(value: string): number {
  const parsed = parseThreeColorWithOpacity(value);
  return clampOpacity(parsed?.opacity ?? 1);
}

function mergePaintColor(nextColor: string, previousColor: string): string {
  const baseColor = normalizeHexColor(nextColor);
  if (!baseColor) {
    return previousColor;
  }

  const opacity = getPaintOpacity(previousColor);
  return opacity >= 0.999 ? baseColor : `${baseColor}${opacityToHex(opacity)}`;
}

function mergePaintOpacity(previousColor: string, opacity: number): string {
  const baseColor = getPaintColorPickerValue(previousColor);
  const nextOpacity = clampOpacity(opacity);
  return nextOpacity >= 0.999 ? baseColor : `${baseColor}${opacityToHex(nextOpacity)}`;
}

export const PaintPanel: React.FC<PaintPanelProps> = ({
  lang,
  toolMode,
  paintColor,
  onPaintColorChange,
  paintSelectionScope,
  onPaintSelectionScopeChange,
  paintOperation,
  onPaintOperationChange,
  paintStatus,
  supported,
  onClose,
  paintPanelRef,
  paintPanelPos,
  onMouseDown,
  zIndex = 50,
  onActivate,
}) => {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [hexInputValue, setHexInputValue] = useState(paintColor);
  const t = translations[lang];
  const paintColorPickerValue = getPaintColorPickerValue(paintColor);
  const paintOpacity = getPaintOpacity(paintColor);
  const colorControlsDisabled = !supported || paintOperation === 'erase';
  const visibleStatus =
    paintStatus && paintStatus.tone !== 'success'
      ? paintStatus
      : supported
        ? null
        : { tone: 'error' as const, message: t.paintUnsupportedRobotOnly };

  React.useEffect(() => {
    setHexInputValue(paintColor);
  }, [paintColor]);

  if (toolMode !== 'paint') {
    return null;
  }

  return (
    <OptionsPanel
      title={t.paintTool}
      show={true}
      isCollapsed={isCollapsed}
      onToggleCollapse={() => setIsCollapsed((previous) => !previous)}
      onClose={onClose}
      defaultPosition={{ right: WORKSPACE_OVERLAY_RIGHT_EDGE_GAP, bottom: '16px' }}
      width="14rem"
      maxHeight={320}
      zIndex={zIndex}
      panelClassName="paint-panel"
      onActivate={onActivate}
      expandText={t.expand}
      collapseText={t.collapse}
      closeText={t.close}
      panelRef={paintPanelRef}
      position={paintPanelPos}
      onMouseDown={onMouseDown}
    >
      <div className="space-y-3 p-[10px]">
        <p className="text-[10px] leading-4 text-text-secondary">{t.paintToolHint}</p>

        <div className="space-y-1.5">
          <label className="block text-[10px] font-semibold uppercase tracking-[0.04em] text-text-tertiary">
            {t.paintColor}
          </label>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={paintColorPickerValue}
              disabled={colorControlsDisabled}
              onChange={(event) => {
                const nextColor = mergePaintColor(event.target.value, paintColor);

                setHexInputValue(nextColor);
                onPaintColorChange(nextColor);
              }}
              className="h-9 w-9 rounded border border-border-black/60 bg-panel-bg p-0.5 disabled:cursor-not-allowed disabled:opacity-50"
            />
            <input
              type="text"
              value={hexInputValue}
              disabled={colorControlsDisabled}
              onChange={(event) => {
                const nextValue = event.target.value;
                setHexInputValue(nextValue);

                const normalized = normalizeHexColor(nextValue);
                if (normalized) {
                  onPaintColorChange(normalized);
                }
              }}
              className="min-w-0 flex-1 rounded border border-border-black/60 bg-element-bg px-2 py-1.5 font-mono text-[11px] text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
              spellCheck={false}
              placeholder="#ff6c0a80"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="block text-[10px] font-semibold uppercase tracking-[0.04em] text-text-tertiary">
            {t.opacity}
          </label>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={Math.round(paintOpacity * 100)}
              disabled={colorControlsDisabled}
              onChange={(event) => {
                const nextColor = mergePaintOpacity(
                  paintColor,
                  Number(event.currentTarget.value) / 100,
                );
                setHexInputValue(nextColor);
                onPaintColorChange(nextColor);
              }}
              className="min-w-0 flex-1 accent-system-blue disabled:cursor-not-allowed disabled:opacity-50"
            />
            <input
              type="number"
              min={0}
              max={1}
              step={0.01}
              value={Number(paintOpacity.toFixed(2))}
              disabled={colorControlsDisabled}
              onChange={(event) => {
                const nextColor = mergePaintOpacity(paintColor, Number(event.currentTarget.value));
                setHexInputValue(nextColor);
                onPaintColorChange(nextColor);
              }}
              className="h-8 w-14 rounded border border-border-black/60 bg-element-bg px-1.5 text-right font-mono text-[11px] tabular-nums text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="block text-[10px] font-semibold uppercase tracking-[0.04em] text-text-tertiary">
            {t.paintSelectionScope}
          </label>
          <div className="grid grid-cols-2 gap-1">
            {(
              [
                { id: 'face', label: t.paintSelectionFace },
                { id: 'island', label: t.paintSelectionIsland },
              ] as const
            ).map((option) => {
              const active = paintSelectionScope === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  disabled={!supported}
                  aria-pressed={active}
                  onClick={() => onPaintSelectionScopeChange(option.id)}
                  className={`rounded border px-2 py-1 text-[10px] font-medium transition ${
                    active
                      ? 'border-system-blue bg-system-blue/15 text-text-primary'
                      : 'border-border-black/60 bg-element-bg text-text-secondary'
                  } disabled:cursor-not-allowed disabled:opacity-50`}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="block text-[10px] font-semibold uppercase tracking-[0.04em] text-text-tertiary">
            {t.paintOperation}
          </label>
          <div className="grid grid-cols-2 gap-1">
            {(
              [
                { id: 'paint', label: t.paintOperationPaint },
                { id: 'erase', label: t.paintOperationErase },
              ] as const
            ).map((option) => {
              const active = paintOperation === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  data-paint-operation={option.id}
                  disabled={!supported}
                  aria-pressed={active}
                  onClick={() => onPaintOperationChange(option.id)}
                  title={option.id === 'erase' ? t.paintEraseHint : undefined}
                  className={`rounded border px-2 py-1 text-[10px] font-medium transition ${
                    active
                      ? option.id === 'erase'
                        ? 'border-danger-border bg-danger-soft text-danger-hover'
                        : 'border-system-blue bg-system-blue/15 text-text-primary'
                      : 'border-border-black/60 bg-element-bg text-text-secondary'
                  } disabled:cursor-not-allowed disabled:opacity-50`}
                >
                  {option.id === 'erase' && active ? t.paintOperationEraseActive : option.label}
                </button>
              );
            })}
          </div>
        </div>

        {visibleStatus && (
          <div
            className={`rounded-md border px-2 py-1.5 text-[10px] leading-4 ${
              visibleStatus.tone === 'error'
                ? 'border-danger-border bg-danger-soft text-danger-hover'
                : 'border-system-blue/20 bg-system-blue/10 text-text-primary'
            }`}
          >
            {visibleStatus.message}
          </div>
        )}
      </div>
    </OptionsPanel>
  );
};
