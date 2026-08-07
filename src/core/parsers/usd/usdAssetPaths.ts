import { getAssetFileExtension } from '@/core/utils/assetFileTypes';
import {
  normalizeLibraryPathKey,
  normalizeVirtualDirectoryPath,
  normalizeVirtualUsdPath,
} from '@/core/utils/pathKeys';

const USD_RUNTIME_TEXTURE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'exr', 'tga']);

export function isUsdRuntimeTexturePath(path: string): boolean {
  return USD_RUNTIME_TEXTURE_EXTENSIONS.has(getAssetFileExtension(path));
}

export function inferUsdBundleVirtualDirectory(sourcePath: string): string {
  const normalizedSourcePath = normalizeLibraryPathKey(sourcePath);
  if (!normalizedSourcePath) {
    return '/';
  }

  const segments = normalizedSourcePath.split('/').filter(Boolean);
  if (segments.length === 0) {
    return '/';
  }

  const usdSegmentIndex = segments.findIndex((segment) => segment.toLowerCase() === 'usd');
  if (usdSegmentIndex > 0) {
    return normalizeVirtualDirectoryPath(segments.slice(0, usdSegmentIndex).join('/'));
  }
  if (usdSegmentIndex === 0 || segments.length === 1) {
    return '/';
  }

  return normalizeVirtualDirectoryPath(segments.slice(0, -1).join('/'));
}

export function isUsdPathWithinBundleDirectory(
  path: string,
  bundleDirectory: string,
): boolean {
  const virtualPath = normalizeVirtualUsdPath(path);
  const normalizedBundleDirectory = normalizeVirtualDirectoryPath(bundleDirectory);

  if (normalizedBundleDirectory === '/') {
    return true;
  }
  return virtualPath.startsWith(normalizedBundleDirectory);
}
