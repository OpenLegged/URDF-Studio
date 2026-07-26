import React, { useEffect, useRef, useState } from 'react';
import { Check, ClipboardPaste, Copy } from 'lucide-react';
import { IconButton } from '@/shared/components/ui';
import type { Vec3Value } from './FormControls';

type Vec3ClipboardState = 'idle' | 'copied' | 'pasted' | 'error';

const vec3ClipboardCache = new Map<string, { x: number; y: number; z: number }>();

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function parseVec3ClipboardValue(text: string): { x: number; y: number; z: number } | null {
  const normalized = text.trim();
  if (!normalized) return null;

  try {
    const parsed: unknown = JSON.parse(normalized);
    const candidate = Array.isArray(parsed)
      ? { x: parsed[0], y: parsed[1], z: parsed[2] }
      : parsed;
    if (
      candidate &&
      typeof candidate === 'object' &&
      isFiniteNumber((candidate as Record<string, unknown>).x) &&
      isFiniteNumber((candidate as Record<string, unknown>).y) &&
      isFiniteNumber((candidate as Record<string, unknown>).z)
    ) {
      return {
        x: (candidate as Record<string, number>).x,
        y: (candidate as Record<string, number>).y,
        z: (candidate as Record<string, number>).z,
      };
    }
  } catch {
    // Also accept a simple "x y z" or "x, y, z" clipboard value below.
  }

  const values = normalized
    .split(/[\s,]+/)
    .map(Number)
    .filter((value) => Number.isFinite(value));
  return values.length === 3 ? { x: values[0], y: values[1], z: values[2] } : null;
}

interface Vec3ClipboardActionsProps {
  cacheKey: string;
  value: Vec3Value;
  onChange: (value: Vec3Value) => void;
  copyTitle: string;
  pasteTitle: string;
  copiedTitle: string;
  pastedTitle: string;
  errorTitle: string;
}

export const Vec3ClipboardActions: React.FC<Vec3ClipboardActionsProps> = ({
  cacheKey,
  value,
  onChange,
  copyTitle,
  pasteTitle,
  copiedTitle,
  pastedTitle,
  errorTitle,
}) => {
  const [state, setState] = useState<Vec3ClipboardState>('idle');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const showState = (nextState: Vec3ClipboardState) => {
    setState(nextState);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setState('idle');
      timerRef.current = null;
    }, 1600);
  };

  const handleCopy = async () => {
    const nextValue = { x: value.x ?? 0, y: value.y ?? 0, z: value.z ?? 0 };
    vec3ClipboardCache.set(cacheKey, nextValue);
    try {
      await navigator.clipboard?.writeText(JSON.stringify(nextValue));
    } catch {
      // The in-app cache still makes copy/paste work when browser clipboard access is denied.
    }
    showState('copied');
  };

  const handlePaste = async () => {
    let nextValue: { x: number; y: number; z: number } | null = null;
    try {
      const clipboardText = await navigator.clipboard?.readText();
      nextValue = clipboardText ? parseVec3ClipboardValue(clipboardText) : null;
    } catch {
      // Clipboard access can be denied; the in-app cache remains available below.
    }
    nextValue ??= vec3ClipboardCache.get(cacheKey) ?? null;
    if (!nextValue) {
      showState('error');
      return;
    }
    onChange(nextValue);
    showState('pasted');
  };

  return (
    <div className="flex items-center gap-0.5">
      <IconButton
        aria-label={state === 'error' ? errorTitle : state === 'copied' ? copiedTitle : copyTitle}
        title={state === 'error' ? errorTitle : state === 'copied' ? copiedTitle : copyTitle}
        size="xs"
        className="h-5 w-5 rounded text-text-tertiary hover:bg-element-hover hover:text-text-primary"
        onClick={() => void handleCopy()}
      >
        {state === 'copied' ? <Check className="h-3 w-3 text-system-blue" /> : <Copy className="h-3 w-3" />}
      </IconButton>
      <IconButton
        aria-label={state === 'error' ? errorTitle : state === 'pasted' ? pastedTitle : pasteTitle}
        title={state === 'error' ? errorTitle : state === 'pasted' ? pastedTitle : pasteTitle}
        size="xs"
        className="h-5 w-5 rounded text-text-tertiary hover:bg-element-hover hover:text-text-primary"
        onClick={() => void handlePaste()}
      >
        {state === 'pasted' ? (
          <Check className="h-3 w-3 text-system-blue" />
        ) : (
          <ClipboardPaste className="h-3 w-3" />
        )}
      </IconButton>
    </div>
  );
};
