import React, { useEffect, useRef, useState } from 'react';
import { Check, ClipboardPaste, Copy } from 'lucide-react';
import { translations } from '@/shared/i18n';
import { IconButton } from '@/shared/components/ui';
import type { Language } from '@/store/uiStore';
import type { Vec3Value } from './FormControls';
import {
  PROPERTY_EDITOR_SUBLABEL_CLASS,
  Vec3InlineInput,
} from './FormControls';
import { RotationValueInput } from './RotationValueInput';
import {
  PROPERTY_EDITOR_POSITION_STEP,
  PROPERTY_EDITOR_TRANSFORM_STEPPER_REPEAT_INTERVAL_MS,
} from '../constants';
import { MAX_TRANSFORM_DECIMALS } from '@/core/utils/numberPrecision';
import type { EulerRadiansValue } from '../utils/rotationFormat';

type PositionClipboardState = 'idle' | 'copied' | 'pasted' | 'error';

let positionClipboardCache: Vec3Value | null = null;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function parsePositionClipboardValue(text: string): Vec3Value | null {
  const normalized = text.trim();
  if (!normalized) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(normalized);
    if (Array.isArray(parsed) && parsed.length >= 3) {
      const [x, y, z] = parsed;
      if (isFiniteNumber(x) && isFiniteNumber(y) && isFiniteNumber(z)) {
        return { x, y, z };
      }
    }

    if (typeof parsed === 'object' && parsed !== null) {
      const candidate = parsed as Record<string, unknown>;
      const { x, y, z } = candidate;
      if (isFiniteNumber(x) && isFiniteNumber(y) && isFiniteNumber(z)) {
        return { x, y, z };
      }
    }
  } catch {
    // Also accept a simple "x y z" or "x, y, z" clipboard value below.
  }

  const values = normalized
    .split(/[\s,]+/)
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));
  return values.length === 3 ? { x: values[0], y: values[1], z: values[2] } : null;
}

interface TransformFieldsProps {
  lang: Language;
  positionValue: Vec3Value;
  rotationValue: EulerRadiansValue;
  onPositionChange: (value: Vec3Value) => void;
  onRotationChange: (value: EulerRadiansValue) => void;
  compact?: boolean;
  axisLabelPlacement?: 'stacked' | 'inline';
  rotationQuickStepDegrees?: number;
  rotationQuickStepAxes?: Array<keyof EulerRadiansValue>;
}

export const TransformFields: React.FC<TransformFieldsProps> = ({
  lang,
  positionValue,
  rotationValue,
  onPositionChange,
  onRotationChange,
  compact = true,
  axisLabelPlacement = 'inline',
  rotationQuickStepDegrees,
  rotationQuickStepAxes,
}) => {
  const t = translations[lang];
  const [positionClipboardState, setPositionClipboardState] =
    useState<PositionClipboardState>('idle');
  const positionClipboardTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (positionClipboardTimerRef.current) {
        clearTimeout(positionClipboardTimerRef.current);
      }
    };
  }, []);

  const showPositionClipboardState = (state: PositionClipboardState) => {
    setPositionClipboardState(state);
    if (positionClipboardTimerRef.current) {
      clearTimeout(positionClipboardTimerRef.current);
    }
    positionClipboardTimerRef.current = setTimeout(() => {
      setPositionClipboardState('idle');
      positionClipboardTimerRef.current = null;
    }, 1600);
  };

  const handleCopyPosition = async () => {
    positionClipboardCache = {
      x: positionValue.x,
      y: positionValue.y,
      z: positionValue.z,
    };

    try {
      await navigator.clipboard?.writeText(JSON.stringify(positionClipboardCache));
    } catch {
      // The in-app cache still makes copy/paste work across property panels.
    }
    showPositionClipboardState('copied');
  };

  const handlePastePosition = async () => {
    let nextPosition: Vec3Value | null = null;

    try {
      const clipboardText = await navigator.clipboard?.readText();
      nextPosition = clipboardText ? parsePositionClipboardValue(clipboardText) : null;
    } catch {
      // Clipboard access can be denied; the in-app cache remains available below.
    }

    nextPosition ??= positionClipboardCache;
    if (!nextPosition) {
      showPositionClipboardState('error');
      return;
    }

    onPositionChange({ ...nextPosition });
    showPositionClipboardState('pasted');
  };

  const copyPositionTitle =
    positionClipboardState === 'error'
      ? t.positionClipboardError
      : positionClipboardState === 'copied'
        ? t.positionCopied
        : t.copyPosition;
  const pastePositionTitle =
    positionClipboardState === 'error'
      ? t.positionClipboardError
      : positionClipboardState === 'pasted'
        ? t.positionPasted
        : t.pastePosition;

  return (
    <div className="space-y-2">
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <span className={PROPERTY_EDITOR_SUBLABEL_CLASS}>{t.position}</span>
          <div className="flex items-center gap-0.5">
            <IconButton
              aria-label={copyPositionTitle}
              title={copyPositionTitle}
              size="xs"
              className="h-5 w-5 rounded text-text-tertiary hover:bg-element-hover hover:text-text-primary"
              onClick={() => void handleCopyPosition()}
            >
              {positionClipboardState === 'copied' ? (
                <Check className="h-3 w-3 text-system-blue" />
              ) : (
                <Copy className="h-3 w-3" />
              )}
            </IconButton>
            <IconButton
              aria-label={pastePositionTitle}
              title={pastePositionTitle}
              size="xs"
              className="h-5 w-5 rounded text-text-tertiary hover:bg-element-hover hover:text-text-primary"
              onClick={() => void handlePastePosition()}
            >
              {positionClipboardState === 'pasted' ? (
                <Check className="h-3 w-3 text-system-blue" />
              ) : (
                <ClipboardPaste className="h-3 w-3" />
              )}
            </IconButton>
          </div>
        </div>
        <Vec3InlineInput
          value={positionValue}
          onChange={onPositionChange}
          labels={['X', 'Y', 'Z']}
          compact={compact}
          labelPlacement={axisLabelPlacement}
          step={PROPERTY_EDITOR_POSITION_STEP}
          precision={MAX_TRANSFORM_DECIMALS}
          repeatIntervalMs={PROPERTY_EDITOR_TRANSFORM_STEPPER_REPEAT_INTERVAL_MS}
        />
      </div>
      <RotationValueInput
        value={rotationValue}
        onChange={onRotationChange}
        lang={lang}
        compact={compact}
        label={t.rotation}
        axisLabelPlacement={axisLabelPlacement}
        holdRepeatIntervalMs={PROPERTY_EDITOR_TRANSFORM_STEPPER_REPEAT_INTERVAL_MS}
        showFrameHint={false}
        quickStepDegrees={rotationQuickStepDegrees}
        quickStepAxes={rotationQuickStepAxes}
      />
    </div>
  );
};
