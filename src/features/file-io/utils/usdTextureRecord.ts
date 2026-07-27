import { resolveTextureExportPath } from '@/core/parsers/meshPathUtils.ts';

export type UsdTextureRecord = {
  sourcePath: string;
  exportPath: string;
};

const isExternalAssetPath = (path: string): boolean => {
  return /^(?:blob:|https?:\/\/|data:)/i.test(path);
};

const hashString = (value: string): string => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

const inferTextureExtension = (texturePath: string): string => {
  const dataUrlMatch = texturePath.match(/^data:image\/([a-z0-9.+-]+);/i);
  if (dataUrlMatch?.[1]) {
    const mimeSubtype = dataUrlMatch[1].toLowerCase();
    if (mimeSubtype === 'jpeg') return 'jpg';
    if (mimeSubtype.includes('svg')) return 'svg';
    if (mimeSubtype.includes('png')) return 'png';
    if (mimeSubtype.includes('webp')) return 'webp';
    if (mimeSubtype.includes('gif')) return 'gif';
    return mimeSubtype.replace(/[^a-z0-9]/g, '') || 'png';
  }

  const pathname = texturePath.split('?')[0]?.split('#')[0] ?? texturePath;
  const extension = pathname.split('.').pop()?.toLowerCase();
  return extension && /^[a-z0-9]+$/.test(extension) ? extension : 'png';
};

export const createUsdTextureRecord = (
  texturePath: string | null | undefined,
  exportPathOverrides?: ReadonlyMap<string, string> | null,
): UsdTextureRecord | null => {
  const sourcePath = String(texturePath || '').trim();
  if (!sourcePath) return null;

  if (!isExternalAssetPath(sourcePath)) {
    const exportPath = resolveTextureExportPath(sourcePath, exportPathOverrides);
    return exportPath ? { sourcePath, exportPath } : null;
  }

  return {
    sourcePath,
    exportPath: `external_${hashString(sourcePath)}.${inferTextureExtension(sourcePath)}`,
  };
};
