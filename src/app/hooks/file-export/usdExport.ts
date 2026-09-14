// 类型导入：jszip 运行时实例在 executeUsdExport 内动态 import 创建，
// 避免把 export-vendor（jszip+jspdf）拉进首屏入口 chunk。
import type JSZip from 'jszip';

import {
  exportRobotToUsdWithWorker,
  getUsdExportWorkerUnsupportedMeshPaths,
  type ExportDialogConfig,
} from '@/features/file-io';
import { convertUsdArchiveFilesToBinaryWithWorker } from '@/app/utils/usdBinaryArchiveWorkerBridge';
import { isUSDCBinary } from '@/core/parsers/usd';
import { translations } from '@/shared/i18n';
import type { RobotFile } from '@/types';

import type { ExportProgressReporter } from './progress';
import type {
  ExportContext,
  ExportExecutionResult,
  ExportTarget,
  HandleExportWithConfigOptions,
} from './types';

type ExportTranslations = typeof translations.en;

const USD_EXPORT_STAGE_PROGRESS_RANGES = {
  links: { start: 0.08, end: 0.34 },
  geometry: { start: 0.34, end: 0.62 },
  scene: { start: 0.62, end: 0.92 },
  assets: { start: 0.92, end: 0.99 },
} as const;

async function readBlobArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') {
    return blob.arrayBuffer();
  }

  if (typeof FileReader !== 'undefined') {
    return new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (reader.result instanceof ArrayBuffer) {
          resolve(reader.result);
          return;
        }
        reject(new Error('Failed to read USD blob as ArrayBuffer.'));
      };
      reader.onerror = () => reject(reader.error ?? new Error('Failed to read USD blob.'));
      reader.readAsArrayBuffer(blob);
    });
  }

  return new Response(blob).arrayBuffer();
}

async function assertConvertedUsdLayersAreBinary(archiveFiles: Map<string, Blob>): Promise<void> {
  const usdLayerEntries = Array.from(archiveFiles.entries()).filter(([filePath]) =>
    /\.usd$/i.test(filePath),
  );

  for (const [filePath, blob] of usdLayerEntries) {
    const headerBytes = await readBlobArrayBuffer(blob.slice(0, 8));
    const magic = String.fromCharCode(...new Uint8Array(headerBytes));
    if (!isUSDCBinary(headerBytes)) {
      throw new Error(
        `USD binary export failed for ${filePath}: converted layer is not USDC (${magic}).`,
      );
    }
  }
}

interface ExecuteUsdExportParams {
  config: ExportDialogConfig;
  target: ExportTarget;
  options: HandleExportWithConfigOptions;
  assets: Record<string, string>;
  requiresResolvedUsdContext: boolean;
  t: ExportTranslations;
  resolveLibraryExportContext: (file: RobotFile) => Promise<ExportContext>;
  resolveExportContext: (target?: ExportTarget) => Promise<ExportContext | null>;
  createProgressReporter: (
    onProgress: HandleExportWithConfigOptions['onProgress'],
    totalSteps: number,
  ) => ExportProgressReporter;
  replaceTemplate: (template: string, replacements: Record<string, string | number>) => string;
  trimProgressFileLabel: (filePath: string | null | undefined) => string;
  generateZipBlobWithProgress: (
    zip: JSZip,
    reportProgress: ExportProgressReporter,
    currentStep: number,
  ) => Promise<Blob>;
  downloadBlob: (blob: Blob, fileName: string) => void;
  markCurrentTargetSaved: () => void;
}

export async function executeUsdExport({
  config,
  target,
  options,
  assets,
  requiresResolvedUsdContext,
  t,
  resolveLibraryExportContext,
  resolveExportContext,
  createProgressReporter,
  replaceTemplate,
  trimProgressFileLabel,
  generateZipBlobWithProgress,
  downloadBlob,
  markCurrentTargetSaved,
}: ExecuteUsdExportParams): Promise<ExportExecutionResult> {
  if (target.type === 'current' && requiresResolvedUsdContext) {
    throw new Error(t.usdExportUnavailable);
  }
  const shouldConvertUsdLayers = config.usd.fileFormat !== 'usda';
  const reportProgress = createProgressReporter(options.onProgress, shouldConvertUsdLayers ? 4 : 3);
  reportProgress(1, t.exportProgressPreparing, t.exportProgressPreparingDetail, {
    stageProgress: 0.2,
    indeterminate: true,
  });

  const exportContext =
    target.type === 'library-file'
      ? await resolveLibraryExportContext(target.file)
      : await resolveExportContext(target);

  if (!exportContext) {
    if (requiresResolvedUsdContext) {
      throw new Error(t.usdExportUnavailable);
    }
    throw new Error(t.exportFailedParse);
  }

  const unsupportedWorkerMeshPaths = getUsdExportWorkerUnsupportedMeshPaths(exportContext.robot);
  if (unsupportedWorkerMeshPaths.length > 0) {
    throw new Error(
      replaceTemplate(t.usdExportWorkerUnsupportedMeshes, {
        count: unsupportedWorkerMeshPaths.length,
        meshPath: unsupportedWorkerMeshPaths[0],
      }),
    );
  }

  reportProgress(2, t.exportProgressBuildingUsdScene, t.exportProgressUsdScenePreparingDetail, {
    stageProgress: 0.04,
    indeterminate: true,
  });

  const usdExport = await exportRobotToUsdWithWorker({
    robot: exportContext.robot,
    exportName: exportContext.exportName,
    assets,
    extraMeshFiles: exportContext.extraMeshFiles,
    fileFormat: config.usd.fileFormat,
    layoutProfile: 'isaacsim',
    meshCompression: {
      enabled: config.usd.compressMeshes,
      quality: config.usd.meshQuality,
    },
    onProgress: (progress) => {
      const range = USD_EXPORT_STAGE_PROGRESS_RANGES[progress.phase];
      const normalizedPhaseProgress = progress.total > 0 ? progress.completed / progress.total : 1;
      const stageProgress = range.start + (range.end - range.start) * normalizedPhaseProgress;

      let detail = t.exportProgressUsdScenePreparingDetail;
      switch (progress.phase) {
        case 'links':
          detail = replaceTemplate(t.exportProgressUsdSceneDetail, {
            current: progress.completed,
            total: progress.total,
            name: progress.label || t.exportProgressArchiveFallbackFile,
          });
          break;
        case 'geometry':
          detail = replaceTemplate(t.exportProgressUsdSceneGeometryDetail, {
            current: progress.completed,
            total: progress.total,
          });
          break;
        case 'scene':
          detail = replaceTemplate(t.exportProgressUsdSceneSerializingDetail, {
            current: progress.completed,
            total: progress.total,
          });
          break;
        case 'assets':
          detail = replaceTemplate(t.exportProgressUsdSceneAssetsDetail, {
            current: progress.completed,
            total: progress.total,
          });
          break;
        default:
          break;
      }

      reportProgress(2, t.exportProgressBuildingUsdScene, detail, {
        stageProgress,
        indeterminate: false,
      });
    },
  });

  const { default: JSZipRuntime } = await import('jszip');
  const zip = new JSZipRuntime();
  if (shouldConvertUsdLayers) {
    reportProgress(
      3,
      t.exportProgressConvertingUsdLayers,
      t.exportProgressConvertingUsdLayersPreparingDetail,
      {
        stageProgress: 0.04,
        indeterminate: true,
      },
    );

    const binaryArchiveFiles = await convertUsdArchiveFilesToBinaryWithWorker(
      usdExport.archiveFiles,
      {
        onProgress: ({ current, total, filePath }) => {
          reportProgress(
            3,
            t.exportProgressConvertingUsdLayers,
            replaceTemplate(t.exportProgressConvertingUsdLayersDetail, {
              current,
              total,
              file: trimProgressFileLabel(filePath) || t.exportProgressArchiveFallbackFile,
            }),
            {
              stageProgress: total > 0 ? current / total : 1,
              indeterminate: false,
            },
          );
        },
      },
    );
    await assertConvertedUsdLayersAreBinary(binaryArchiveFiles);

    binaryArchiveFiles.forEach((blob, filePath) => {
      zip.file(filePath, blob);
    });
  } else {
    usdExport.archiveFiles.forEach((blob, filePath) => {
      zip.file(filePath, blob);
    });
  }

  const content = await generateZipBlobWithProgress(
    zip,
    reportProgress,
    shouldConvertUsdLayers ? 4 : 3,
  );
  downloadBlob(content, usdExport.archiveFileName);
  markCurrentTargetSaved();

  return {
    partial: false,
    warnings: [],
    issues: [],
  };
}
