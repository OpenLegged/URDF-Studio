/**
 * Asset Utilities
 * Utilities for handling mesh and texture assets
 */

import type { AssetFile } from '../types';
import { isAssetFile } from './formatDetection';

/**
 * Create blob URLs for asset files with multiple path patterns
 * This enables flexible matching of mesh paths in URDF/MJCF files
 */
export function createAssetUrls(assetFiles: AssetFile[]): Record<string, string> {
  const assets: Record<string, string> = {};

  assetFiles.forEach(f => {
    const ext = f.name.split('.').pop()?.toLowerCase();
    if (!isAssetFile(f.name)) return;

    const url = URL.createObjectURL(f.blob);

    // Store with full path for path-based lookup
    assets[f.name] = url;

    // Also store with just filename for simple matching
    const filename = f.name.split('/').pop()!;
    assets[filename] = url;

    // Store with /meshes/filename pattern (common in URDF)
    if (f.name.includes('/meshes/')) {
      const meshPath = '/meshes/' + filename;
      assets[meshPath] = url;
    }

    // Store various path patterns for flexible matching
    const parts = f.name.split('/');
    for (let i = 0; i < parts.length; i++) {
      const subPath = parts.slice(i).join('/');
      if (!assets[subPath]) {
        assets[subPath] = url;
      }
      // Also with leading slash
      if (!assets['/' + subPath]) {
        assets['/' + subPath] = url;
      }
    }
  });

  return assets;
}

/**
 * Collect referenced mesh files from robot links
 */
export function collectReferencedMeshes(
  links: Record<string, import('@/types').UrdfLink>,
  geometryType: import('@/types').GeometryType
): Set<string> {
  const referencedFiles = new Set<string>();

  Object.values(links).forEach((link) => {
    if (link.visual.type === geometryType && link.visual.meshPath) {
      referencedFiles.add(link.visual.meshPath);
    }
    if (link.collision && link.collision.type === geometryType && link.collision.meshPath) {
      referencedFiles.add(link.collision.meshPath);
    }
  });

  return referencedFiles;
}

/**
 * Fetch mesh blobs from asset URLs
 */
export async function fetchMeshBlobs(
  meshPaths: Set<string>,
  assets: Record<string, string>
): Promise<Array<{ name: string; blob: Blob }>> {
  const results: Array<{ name: string; blob: Blob }> = [];

  const promises = Array.from(meshPaths).map(async (fileName) => {
    const blobUrl = assets[fileName];
    if (blobUrl) {
      try {
        const res = await fetch(blobUrl);
        const blob = await res.blob();
        results.push({ name: fileName, blob });
      } catch (err) {
        console.error(`Failed to load mesh ${fileName}`, err);
      }
    }
  });

  await Promise.all(promises);
  return results;
}

/**
 * Trigger file download in browser
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
