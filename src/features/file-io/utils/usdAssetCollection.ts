import * as THREE from 'three';

import { resolveUsdAssetUrl, type UsdAssetRegistry } from './usdAssetRegistry.ts';
import { type UsdSerializationContext } from './usdSerializationContext.ts';
import { createUsdTextureRecord } from './usdTextureRecord.ts';
import {
  advanceUsdProgress,
  createUsdProgressTracker,
  normalizeUsdProgressLabel,
  type UsdProgressEvent,
  type UsdProgressTracker,
  yieldPeriodically,
} from './usdProgress.ts';
import { type UsdMaterialMetadata } from './usdSceneNodeFactory.ts';

export type UsdAssetCollectionProgress = {
  phase: 'assets';
  completed: number;
  total: number;
  label?: string;
};

type UsdAssetCollectionProgressTracker = UsdProgressTracker<'assets'>;

type CollectUsdExportAssetFilesOptions = {
  sceneRoot: THREE.Object3D;
  context: UsdSerializationContext;
  registry: UsdAssetRegistry;
  onProgress?: (progress: UsdAssetCollectionProgress) => void;
  recordYieldInterval?: number;
  fetchConcurrency?: number;
};

const DEFAULT_RECORD_YIELD_INTERVAL = 4;
const DEFAULT_TEXTURE_FETCH_CONCURRENCY = 6;

export const collectUsdExportAssetFiles = async ({
  sceneRoot,
  context,
  registry,
  onProgress,
  recordYieldInterval = DEFAULT_RECORD_YIELD_INTERVAL,
  fetchConcurrency = DEFAULT_TEXTURE_FETCH_CONCURRENCY,
}: CollectUsdExportAssetFilesOptions): Promise<Map<string, Blob>> => {
  const textureFiles = new Map<string, string>();
  const registerTextureFile = (exportPath: string, sourcePath: string) => {
    const existingSourcePath = textureFiles.get(exportPath);
    if (!existingSourcePath) {
      textureFiles.set(exportPath, sourcePath);
      return;
    }
    if (existingSourcePath === sourcePath) {
      return;
    }

    const existingUrl = resolveUsdAssetUrl(existingSourcePath, registry);
    const nextUrl = resolveUsdAssetUrl(sourcePath, registry);
    if (existingUrl && nextUrl && existingUrl === nextUrl) {
      return;
    }

    throw new Error(
      `Texture export path collision for ${exportPath}: ${existingSourcePath} and ${sourcePath}`,
    );
  };

  context.materialRecords.forEach((record) => {
    const texture = record.appearance.texture;
    if (!texture) return;
    registerTextureFile(texture.exportPath, texture.sourcePath);
  });

  sceneRoot.traverse((object) => {
    const materialMetadata = object.userData?.usdMaterial as UsdMaterialMetadata | undefined;
    if (!materialMetadata?.texture) {
      return;
    }

    const texture = createUsdTextureRecord(
      materialMetadata.texture,
      context.textureExportPathOverrides,
    );
    if (!texture) {
      return;
    }

    registerTextureFile(texture.exportPath, texture.sourcePath);
  });

  const textureEntries = Array.from(textureFiles.entries());
  const archiveFilesByIndex: Array<[string, Blob] | null> = new Array(textureEntries.length).fill(
    null,
  );
  const progressTracker = createUsdProgressTracker(
    'assets',
    textureEntries.length,
    onProgress as ((progress: UsdProgressEvent<'assets'>) => void) | undefined,
  );

  const resolvedConcurrency = Math.max(
    1,
    Math.min(Math.trunc(fetchConcurrency) || 1, textureEntries.length || 1),
  );
  let completedCount = 0;
  let nextIndex = 0;

  const processTextureEntry = async (index: number): Promise<void> => {
    const entry = textureEntries[index];
    if (!entry) {
      return;
    }

    const [exportPath, sourcePath] = entry;
    const label = normalizeUsdProgressLabel(exportPath, 'asset');
    const resolvedUrl = resolveUsdAssetUrl(sourcePath, registry);
    if (!resolvedUrl) {
      throw new Error(`Texture asset not found for: ${sourcePath}`);
    }

    try {
      const response = await fetch(resolvedUrl);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      archiveFilesByIndex[index] = [`assets/${exportPath}`, await response.blob()];
    } catch (error) {
      const reason = error instanceof Error && error.message ? error.message : String(error);
      throw new Error(`Failed to load texture ${sourcePath}: ${reason}`, {
        cause: error,
      });
    }

    advanceUsdProgress(progressTracker, label);
    completedCount += 1;
    await yieldPeriodically(completedCount, recordYieldInterval);
  };

  await Promise.all(
    new Array(resolvedConcurrency).fill(null).map(async () => {
      while (true) {
        const index = nextIndex;
        nextIndex += 1;
        if (index >= textureEntries.length) {
          return;
        }

        await processTextureEntry(index);
      }
    }),
  );

  const archiveFiles = new Map<string, Blob>();
  archiveFilesByIndex.forEach((entry) => {
    if (entry) {
      archiveFiles.set(entry[0], entry[1]);
    }
  });

  return archiveFiles;
};
