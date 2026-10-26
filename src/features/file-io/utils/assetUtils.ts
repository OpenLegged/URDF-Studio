/**
 * Asset Utilities
 * Utilities for handling mesh and texture assets
 */

import { normalizeMeshPathForExport, resolveMeshAssetUrl } from '@/core/parsers/meshPathUtils';
import { getVisualGeometryEntries } from '@/core/robot';
import type { AssetFile } from '../types';

/**
 * Create blob URLs for imported library files using stable library-relative keys.
 * Ambiguous global aliases like bare filenames are intentionally avoided so
 * different robot packages can safely contain files with the same name.
 */
export function createAssetUrls(assetFiles: AssetFile[]): Record<string, string> {
  const assets: Record<string, string> = {};

  assetFiles.forEach((f) => {
    const url = URL.createObjectURL(f.blob);
    const normalizedPath = f.name.replace(/\\/g, '/').replace(/^\/+/, '');
    assets[normalizedPath] = url;
  });

  return assets;
}

/**
 * Collect referenced mesh files from robot links
 */
export function collectReferencedMeshes(
  links: Record<string, import('@/types').UrdfLink>,
  geometryType: import('@/types').GeometryType,
): Set<string> {
  const referencedFiles = new Set<string>();

  Object.values(links).forEach((link) => {
    getVisualGeometryEntries(link).forEach((entry) => {
      if (entry.geometry.type === geometryType && entry.geometry.meshPath) {
        referencedFiles.add(entry.geometry.meshPath);
      }
    });
    if (link.collision && link.collision.type === geometryType && link.collision.meshPath) {
      referencedFiles.add(link.collision.meshPath);
    }
    (link.collisionBodies || []).forEach((body) => {
      if (body.type === geometryType && body.meshPath) {
        referencedFiles.add(body.meshPath);
      }
    });
  });

  return referencedFiles;
}

/**
 * Fetch mesh blobs from asset URLs
 */
export async function fetchMeshBlobs(
  meshPaths: Set<string>,
  assets: Record<string, string>,
): Promise<Array<{ name: string; blob: Blob }>> {
  const results: Array<{ name: string; blob: Blob }> = [];
  const exportedMeshPaths = new Set<string>();

  const promises = Array.from(meshPaths).map(async (fileName) => {
    const exportPath = normalizeMeshPathForExport(fileName);
    if (!exportPath || exportedMeshPaths.has(exportPath)) {
      return;
    }
    exportedMeshPaths.add(exportPath);

    const blobUrl = resolveMeshAssetUrl(fileName, assets);
    if (blobUrl) {
      try {
        const res = await fetch(blobUrl);
        const blob = await res.blob();
        results.push({ name: exportPath, blob });
      } catch (err) {
        console.error(`Failed to load mesh ${fileName}`, err);
      }
    }
  });

  await Promise.all(promises);
  return results;
}

export { downloadBlob } from '@/shared/utils/downloadBlob';
