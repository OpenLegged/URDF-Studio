import type { ViewerRoundtripExportResult } from '../runtime/embed/usd-viewer-api';
import { toVirtualUsdPath } from '@/lib/robot-parser/usd/usdPreloadSources';

type ExportLoadedStageSnapshotResult = ViewerRoundtripExportResult & {
  content?: string | null;
  outputFileName?: string | null;
};

type ExportLoadedStageSnapshot = (
  options?: Record<string, unknown>,
) => Promise<ExportLoadedStageSnapshotResult | { ok: false; error?: string | null }>;

type UsdStageExportHost = {
  exportLoadedStageSnapshot?: ExportLoadedStageSnapshot;
  renderInterface?: {
    exportLoadedStageSnapshot?: ExportLoadedStageSnapshot;
  } | null;
} | null | undefined;

export interface ExportUsdStageSnapshotOptions {
  stageSourcePath?: string | null;
  outputFileName?: string | null;
  flattenStage?: boolean;
  persistToServer?: boolean;
  targetWindow?: UsdStageExportHost;
}

export interface ExportUsdStageSnapshotPayload extends ExportLoadedStageSnapshotResult {
  content: string;
  downloadFileName: string;
}

function normalizeUsdStageSourcePath(stageSourcePath?: string | null): string | undefined {
  const normalizedStagePath = String(stageSourcePath || '').trim().split('?')[0];
  if (!normalizedStagePath) {
    return undefined;
  }

  return normalizedStagePath.startsWith('/')
    ? normalizedStagePath
    : toVirtualUsdPath(normalizedStagePath);
}

function getStageExportHost(targetWindow?: UsdStageExportHost): UsdStageExportHost {
  if (targetWindow !== undefined) {
    return targetWindow;
  }

  if (typeof window !== 'undefined') {
    return window as unknown as UsdStageExportHost;
  }

  return null;
}

export function buildUsdRoundtripDownloadName(
  stageSourcePath?: string | null,
  outputFileName?: string | null,
): string {
  const preferredFileName = String(outputFileName || '').trim();
  if (preferredFileName) {
    return preferredFileName.split('/').pop() || preferredFileName;
  }

  const normalizedStagePath = String(stageSourcePath || '').trim().split('?')[0];
  const stageFileName = normalizedStagePath.split('/').pop() || 'export.usd';
  const extensionMatch = stageFileName.match(/(\.usd[a-z]?)$/i);
  const extension = extensionMatch?.[1] || '.usd';
  const baseName = extensionMatch
    ? stageFileName.slice(0, -extension.length)
    : stageFileName.replace(/\.[^/.]+$/, '') || 'export';

  return `${baseName}.viewer_roundtrip${extension}`;
}

export function getUsdStageExportHandler(targetWindow?: UsdStageExportHost): ExportLoadedStageSnapshot | null {
  const host = getStageExportHost(targetWindow);
  if (!host) return null;

  if (typeof host.exportLoadedStageSnapshot === 'function') {
    return host.exportLoadedStageSnapshot.bind(host);
  }

  if (typeof host.renderInterface?.exportLoadedStageSnapshot === 'function') {
    return host.renderInterface.exportLoadedStageSnapshot.bind(host.renderInterface);
  }

  return null;
}

export async function exportUsdStageSnapshot(
  options: ExportUsdStageSnapshotOptions = {},
): Promise<ExportUsdStageSnapshotPayload> {
  const exportLoadedStageSnapshot = getUsdStageExportHandler(options.targetWindow);
  if (!exportLoadedStageSnapshot) {
    throw new Error('export-unavailable');
  }

  const normalizedStageSourcePath = normalizeUsdStageSourcePath(options.stageSourcePath);

  const exportResult = await exportLoadedStageSnapshot({
    persistToServer: options.persistToServer === true,
    overwrite: true,
    flattenStage: options.flattenStage === true,
    stageSourcePath: normalizedStageSourcePath,
    outputFileName: options.outputFileName || undefined,
  });

  if (!exportResult?.ok) {
    throw new Error(String(exportResult?.error || 'export-failed'));
  }

  const content = typeof exportResult.content === 'string'
    ? exportResult.content
    : String(exportResult.content || '');
  if (!content) {
    throw new Error('empty-export-content');
  }

  return {
    ...exportResult,
    content,
    downloadFileName: buildUsdRoundtripDownloadName(
      normalizedStageSourcePath,
      exportResult.outputFileName,
    ),
  };
}
