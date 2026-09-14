export function normalizeScalarMaterialValue(
  value: unknown,
  options: { clamp01?: boolean; min?: number } = {},
): number | null {
  // Optional OpenUSD inputs are represented as null when they are not
  // authored. Number(null) is 0, which would incorrectly turn an absent
  // opacity into fully transparent in the prepared render cache.
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }

  let nextValue = numeric;
  if (typeof options.min === 'number') {
    nextValue = Math.max(options.min, nextValue);
  }
  if (options.clamp01) {
    nextValue = Math.max(0, Math.min(1, nextValue));
  }

  return nextValue;
}

export function normalizeBooleanMaterialValue(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

export function normalizeColorMaterialValue(value: unknown): [number, number, number] | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as {
    isColor?: unknown;
    r?: unknown;
    g?: unknown;
    b?: unknown;
    length?: unknown;
  };

  if (candidate.isColor === true) {
    const r = Number(candidate.r);
    const g = Number(candidate.g);
    const b = Number(candidate.b);
    if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) {
      return [r, g, b];
    }
  }

  if (typeof candidate.length === 'number') {
    const source = Array.from(value as ArrayLike<number>);
    if (source.length >= 3) {
      const normalized = source.slice(0, 3).map((channel) => Number(channel));
      if (normalized.every((channel) => Number.isFinite(channel))) {
        return normalized as [number, number, number];
      }
    }
  }

  return null;
}

export function normalizeVector2MaterialValue(value: unknown): [number, number] | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as {
    x?: unknown;
    y?: unknown;
    length?: unknown;
  };

  const x = Number(candidate.x);
  const y = Number(candidate.y);
  if (Number.isFinite(x) && Number.isFinite(y)) {
    return [x, y];
  }

  if (typeof candidate.length === 'number') {
    const source = Array.from(value as ArrayLike<number>);
    if (source.length >= 2) {
      const normalized = source.slice(0, 2).map((channel) => Number(channel));
      if (normalized.every((channel) => Number.isFinite(channel))) {
        return normalized as [number, number];
      }
    }
  }

  return null;
}

export function normalizeTextureMaterialPath(value: unknown): string | null {
  if (!value) {
    return null;
  }

  if (typeof value === 'string') {
    const normalized = value.trim();
    return normalized || null;
  }

  if (typeof value !== 'object') {
    return null;
  }

  const candidate = value as {
    name?: unknown;
    userData?: {
      usdSourcePath?: unknown;
    } | null;
  };
  const normalized = String(candidate.userData?.usdSourcePath || candidate.name || '').trim();
  return normalized || null;
}
