import { normalizeLibraryPathKey, normalizeVirtualUsdPath } from '@/core/utils/pathKeys';

export function isUsdLayerPath(path: string): boolean {
  return /\.usd(?:a|c|z)?$/i.test(normalizeLibraryPathKey(path));
}
export function extractUsdLayerReferencesFromText(layerText: string): string[] {
  if (!layerText) {
    return [];
  }

  const references = new Set<string>();
  const referenceRegex = /@([^@]+)@/g;
  let match: RegExpExecArray | null = null;
  while ((match = referenceRegex.exec(layerText))) {
    const assetPath = String(match[1] || '').trim();
    const packageSeparatorIndex = assetPath.indexOf('[');
    const referencePath = (
      packageSeparatorIndex >= 0 ? assetPath.slice(0, packageSeparatorIndex) : assetPath
    ).trim();
    if (!isUsdLayerPath(referencePath)) {
      continue;
    }
    references.add(referencePath);
  }

  return Array.from(references);
}

export function resolveUsdLayerReferencePath(
  baseUsdPath: string,
  referencedPath: string,
): string | null {
  const normalizedReferencePath = String(referencedPath || '')
    .trim()
    .replace(/\\/g, '/');
  if (!normalizedReferencePath) {
    return null;
  }

  if (/^[a-z]+:\/\//i.test(normalizedReferencePath)) {
    return null;
  }

  if (normalizedReferencePath.startsWith('/')) {
    return normalizeVirtualUsdPath(normalizedReferencePath);
  }

  const baseSegments = normalizeLibraryPathKey(baseUsdPath).split('/').filter(Boolean);
  baseSegments.pop();

  normalizedReferencePath.split('/').forEach((segment) => {
    if (!segment || segment === '.') {
      return;
    }
    if (segment === '..') {
      if (baseSegments.length > 0) {
        baseSegments.pop();
      }
      return;
    }
    baseSegments.push(segment);
  });

  return baseSegments.length > 0 ? `/${baseSegments.join('/')}` : '/';
}
