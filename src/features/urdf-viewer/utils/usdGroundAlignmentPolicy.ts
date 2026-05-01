type UsdGroundAlignmentSource =
  | string
  | {
    name?: string | null;
    content?: string | null;
  }
  | null
  | undefined;

function normalizeUsdGroundAlignmentName(value: string | null | undefined): string {
  return String(value || '').trim().toLowerCase();
}

function hasUsdaHeader(content: string | null | undefined): boolean {
  return String(content || '').trimStart().toLowerCase().startsWith('#usda');
}

function isBinaryUsdLayerName(value: string | null | undefined): boolean {
  const normalizedName = normalizeUsdGroundAlignmentName(value);
  return normalizedName.endsWith('.usdc') || normalizedName.endsWith('.usdz');
}

export function isTextualUsdGroundAlignmentSource(source: UsdGroundAlignmentSource): boolean {
  if (typeof source === 'string') {
    return normalizeUsdGroundAlignmentName(source).endsWith('.usda');
  }

  if (!source) {
    return false;
  }

  const normalizedName = normalizeUsdGroundAlignmentName(source.name);
  if (isBinaryUsdLayerName(normalizedName)) {
    return false;
  }

  if (normalizedName.endsWith('.usda')) {
    return true;
  }

  return hasUsdaHeader(source.content);
}

export function shouldSettleUsdGroundAlignmentAfterInitialLoad(
  source: UsdGroundAlignmentSource,
): boolean {
  return !isTextualUsdGroundAlignmentSource(source);
}
