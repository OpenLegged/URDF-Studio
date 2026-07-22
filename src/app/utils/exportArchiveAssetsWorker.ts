import { findAssetByPath } from '@/core/loaders';
import {
  buildTextureExportPathOverrides,
  normalizeMeshPathForExport,
  resolveTextureExportPath,
} from '@/core/parsers/meshPathUtils';
import { compressSTLBlob } from '@/core/stl-compressor';

import { collectRobotAssetReferences } from './exportArchiveAssetReferences.ts';
import type {
  ExportArchiveAssetsCompressOptions,
  ExportArchiveAssetsWorkerPayload,
  PrepareExportArchiveAssetsArgs,
  PreparedExportArchiveAssetFile,
  PrepareExportArchiveAssetsProgress,
  PrepareExportArchiveAssetsResult,
  RobotAssetPackagingFailure,
} from './exportArchiveAssetsContract.ts';

export type {
  ExportArchiveAssetsCompressOptions,
  ExportArchiveAssetsWorkerInlineFile,
  ExportArchiveAssetsWorkerPayload,
  ExportArchiveAssetsWorkerRequest,
  ExportArchiveAssetsWorkerResponse,
  PrepareExportArchiveAssetsArgs,
  PrepareExportArchiveAssetsErrorWorkerResponse,
  PreparedExportArchiveAssetFile,
  PrepareExportArchiveAssetsProgress,
  PrepareExportArchiveAssetsProgressWorkerResponse,
  PrepareExportArchiveAssetsResult,
  PrepareExportArchiveAssetsResultWorkerResponse,
  PrepareExportArchiveAssetsWorkerRequest,
} from './exportArchiveAssetsContract.ts';

interface AssetPreparationTask {
  assetType: 'mesh' | 'texture';
  sourcePath: string;
  exportPath: string;
  currentFile: string;
  run: (
    onStage?: (stage: PrepareExportArchiveAssetsProgress['stage']) => void,
  ) => Promise<PreparedExportArchiveAssetFile>;
}

function isExternalAssetPath(path: string): boolean {
  return /^(?:blob:|https?:\/\/|data:)/i.test(path);
}

function normalizeInlineLookupPath(path: string): string {
  return String(path || '')
    .trim()
    .replace(/\\/g, '/');
}

function buildInlineAssetLookupCandidates(
  sourcePath: string,
  normalizePath: (path: string) => string,
  folderName: 'meshes' | 'textures',
): string[] {
  const candidates: string[] = [];
  const seen = new Set<string>();
  const pushCandidate = (value?: string) => {
    const normalizedValue = normalizeInlineLookupPath(value || '');
    if (!normalizedValue || seen.has(normalizedValue)) {
      return;
    }
    seen.add(normalizedValue);
    candidates.push(normalizedValue);
  };

  const normalizedSourcePath = normalizeInlineLookupPath(sourcePath);
  const normalizedExportPath = normalizeInlineLookupPath(normalizePath(sourcePath));
  const filename =
    (normalizedExportPath || normalizedSourcePath).split('/').filter(Boolean).pop() || '';

  pushCandidate(sourcePath);
  pushCandidate(normalizedSourcePath);
  pushCandidate(normalizedExportPath);
  if (normalizedExportPath) {
    pushCandidate(`${folderName}/${normalizedExportPath}`);
    pushCandidate(`/${folderName}/${normalizedExportPath}`);
  }
  if (filename) {
    pushCandidate(filename);
    pushCandidate(`${folderName}/${filename}`);
    pushCandidate(`/${folderName}/${filename}`);
  }

  return candidates;
}

function resolveInlineExportPath(
  sourcePath: string,
  normalizePath: (path: string) => string,
  folderName: 'meshes' | 'textures',
): string {
  const normalizedPath = normalizeInlineLookupPath(normalizePath(sourcePath));
  if (!normalizedPath || isExternalAssetPath(normalizedPath)) {
    return '';
  }

  return normalizedPath.replace(new RegExp(`^${folderName}/`, 'i'), '');
}

function findInlineAssetBlob(
  sourcePath: string,
  inlineFiles: ReadonlyMap<string, Blob> | undefined,
  normalizePath: (path: string) => string,
  folderName: 'meshes' | 'textures',
): { blob: Blob; exportPath: string } | null {
  if (!inlineFiles?.size) {
    return null;
  }

  const candidates = buildInlineAssetLookupCandidates(sourcePath, normalizePath, folderName);
  for (const candidate of candidates) {
    const blob = inlineFiles.get(candidate);
    if (!blob) {
      continue;
    }

    const exportPath =
      resolveInlineExportPath(candidate, normalizePath, folderName) ||
      resolveInlineExportPath(sourcePath, normalizePath, folderName);
    if (!exportPath) {
      continue;
    }

    return { blob, exportPath };
  }

  const lowercaseCandidates = new Set(candidates.map((candidate) => candidate.toLowerCase()));
  for (const [key, blob] of inlineFiles.entries()) {
    if (!lowercaseCandidates.has(normalizeInlineLookupPath(key).toLowerCase())) {
      continue;
    }

    const exportPath =
      resolveInlineExportPath(key, normalizePath, folderName) ||
      resolveInlineExportPath(sourcePath, normalizePath, folderName);
    if (!exportPath) {
      continue;
    }

    return { blob, exportPath };
  }

  return null;
}

async function readBlobArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') {
    return await blob.arrayBuffer();
  }

  return await new Response(blob).arrayBuffer();
}

async function fetchAssetBlob(assetUrl: string): Promise<Blob> {
  const response = await fetch(assetUrl);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return await response.blob();
}

function buildFailure(
  assetType: 'mesh' | 'texture',
  sourcePath: string,
  exportPath: string,
  error: unknown,
): RobotAssetPackagingFailure {
  return {
    code: assetType === 'mesh' ? 'mesh_fetch_failed' : 'texture_fetch_failed',
    assetType,
    sourcePath,
    exportPath,
    message: error instanceof Error ? error.message : String(error),
  };
}

async function prepareMeshBlob(
  blob: Blob,
  sourcePath: string,
  exportPath: string,
  compressOptions?: ExportArchiveAssetsCompressOptions,
  onStage?: (stage: PrepareExportArchiveAssetsProgress['stage']) => void,
): Promise<PreparedExportArchiveAssetFile> {
  if (compressOptions?.compressSTL && /\.stl$/i.test(exportPath)) {
    onStage?.('compress');
    const filename = exportPath.split('/').pop() ?? exportPath;
    const result = await compressSTLBlob(blob, filename, {
      quality: compressOptions.stlQuality,
    });
    return {
      assetType: 'mesh',
      folder: 'meshes',
      sourcePath,
      exportPath,
      bytes: await readBlobArrayBuffer(result.blob),
      mimeType: result.blob.type || blob.type,
      compressed: true,
      originalSize: result.originalSize,
      compressedSize: result.compressedSize,
    };
  }

  onStage?.('read');
  return {
    assetType: 'mesh',
    folder: 'meshes',
    sourcePath,
    exportPath,
    bytes: await readBlobArrayBuffer(blob),
    mimeType: blob.type,
  };
}

async function prepareTextureBlob(
  blob: Blob,
  sourcePath: string,
  exportPath: string,
  onStage?: (stage: PrepareExportArchiveAssetsProgress['stage']) => void,
): Promise<PreparedExportArchiveAssetFile> {
  onStage?.('read');
  return {
    assetType: 'texture',
    folder: 'textures',
    sourcePath,
    exportPath,
    bytes: await readBlobArrayBuffer(blob),
    mimeType: blob.type,
  };
}

export async function prepareExportArchiveAssets({
  robot,
  assets,
  compressOptions,
  extraMeshFiles,
  skipMeshPaths,
  onProgress,
}: PrepareExportArchiveAssetsArgs): Promise<PrepareExportArchiveAssetsResult> {
  const { meshPaths, texturePaths } = collectRobotAssetReferences(robot);
  const texturePathOverrides = buildTextureExportPathOverrides(texturePaths);

  const tasks: AssetPreparationTask[] = [];
  const exportedMeshPaths = new Set<string>();
  const exportedTexturePaths = new Set<string>();
  const failedAssets: RobotAssetPackagingFailure[] = [];

  meshPaths.forEach((meshPath) => {
    const inlineMesh = findInlineAssetBlob(
      meshPath,
      extraMeshFiles,
      normalizeMeshPathForExport,
      'meshes',
    );
    const exportPath = inlineMesh?.exportPath || normalizeMeshPathForExport(meshPath);
    if (skipMeshPaths?.has(meshPath) || (exportPath && skipMeshPaths?.has(exportPath))) {
      return;
    }

    if (!exportPath || exportedMeshPaths.has(exportPath)) {
      return;
    }
    exportedMeshPaths.add(exportPath);

    if (inlineMesh) {
      tasks.push({
        assetType: 'mesh',
        sourcePath: meshPath,
        exportPath,
        currentFile: exportPath,
        run: (onStage) =>
          prepareMeshBlob(inlineMesh.blob, meshPath, exportPath, compressOptions, onStage),
      });
      return;
    }

    const assetUrl = findAssetByPath(meshPath, assets);
    if (!assetUrl) {
      failedAssets.push({
        code: 'mesh_asset_missing',
        assetType: 'mesh',
        sourcePath: meshPath,
        exportPath,
        message: `Mesh asset not found: ${meshPath}`,
      });
      return;
    }

    tasks.push({
      assetType: 'mesh',
      sourcePath: meshPath,
      exportPath,
      currentFile: exportPath,
      run: async (onStage) => {
        onStage?.('read');
        const blob = await fetchAssetBlob(assetUrl);
        return await prepareMeshBlob(blob, meshPath, exportPath, compressOptions, onStage);
      },
    });
  });

  texturePaths.forEach((texturePath) => {
    const inlineTexture = findInlineAssetBlob(
      texturePath,
      extraMeshFiles,
      (path) => resolveTextureExportPath(path, texturePathOverrides),
      'textures',
    );
    const exportPath =
      inlineTexture?.exportPath || resolveTextureExportPath(texturePath, texturePathOverrides);
    if (!exportPath || isExternalAssetPath(exportPath) || exportedTexturePaths.has(exportPath)) {
      return;
    }
    exportedTexturePaths.add(exportPath);

    if (inlineTexture) {
      tasks.push({
        assetType: 'texture',
        sourcePath: texturePath,
        exportPath,
        currentFile: exportPath,
        run: (onStage) => prepareTextureBlob(inlineTexture.blob, texturePath, exportPath, onStage),
      });
      return;
    }

    const assetUrl = findAssetByPath(texturePath, assets);
    if (!assetUrl) {
      failedAssets.push({
        code: 'texture_asset_missing',
        assetType: 'texture',
        sourcePath: texturePath,
        exportPath,
        message: `Texture asset not found: ${texturePath}`,
      });
      return;
    }

    tasks.push({
      assetType: 'texture',
      sourcePath: texturePath,
      exportPath,
      currentFile: exportPath,
      run: async (onStage) => {
        onStage?.('read');
        const blob = await fetchAssetBlob(assetUrl);
        return await prepareTextureBlob(blob, texturePath, exportPath, onStage);
      },
    });
  });

  const total = tasks.length;
  if (total === 0) {
    return {
      totalTasks: 0,
      completedTasks: 0,
      failedAssets,
      files: [],
    };
  }

  onProgress?.({
    completed: 0,
    total,
    currentFile: '',
  });

  let completed = 0;
  const files: PreparedExportArchiveAssetFile[] = [];
  const reportTaskStage = (
    task: AssetPreparationTask,
    stage: PrepareExportArchiveAssetsProgress['stage'],
  ) => {
    onProgress?.({
      completed,
      total,
      currentFile: task.currentFile,
      assetType: task.assetType,
      stage,
    });
  };
  await Promise.all(
    tasks.map(async (task) => {
      try {
        files.push(await task.run((stage) => reportTaskStage(task, stage)));
      } catch (error) {
        failedAssets.push(buildFailure(task.assetType, task.sourcePath, task.exportPath, error));
      } finally {
        completed += 1;
        onProgress?.({
          completed,
          total,
          currentFile: task.currentFile,
          assetType: task.assetType,
          stage: 'complete',
        });
      }
    }),
  );

  return {
    totalTasks: total,
    completedTasks: completed,
    failedAssets,
    files,
  };
}

export function serializePrepareExportArchiveAssetsArgsForWorker(
  args: PrepareExportArchiveAssetsArgs,
): ExportArchiveAssetsWorkerPayload {
  return {
    robot: args.robot,
    assets: args.assets,
    compressOptions: args.compressOptions,
    extraMeshFiles: Array.from(args.extraMeshFiles?.entries() ?? []).map(([path, blob]) => ({
      path,
      blob,
    })),
    skipMeshPaths: Array.from(args.skipMeshPaths ?? []),
  };
}

export function hydratePrepareExportArchiveAssetsArgsFromWorker(
  payload: ExportArchiveAssetsWorkerPayload,
  onProgress?: (progress: PrepareExportArchiveAssetsProgress) => void,
): PrepareExportArchiveAssetsArgs {
  return {
    robot: payload.robot,
    assets: payload.assets,
    compressOptions: payload.compressOptions,
    extraMeshFiles: new Map(payload.extraMeshFiles.map((file) => [file.path, file.blob])),
    skipMeshPaths: new Set(payload.skipMeshPaths),
    onProgress,
  };
}

export function collectPreparedExportArchiveAssetTransferables(
  result: PrepareExportArchiveAssetsResult,
): ArrayBuffer[] {
  return Array.from(new Set(result.files.map((file) => file.bytes)));
}
