import {
  DEFAULT_LINK,
  GeometryType,
  type LoadingProgressMode,
  type RobotData,
  type RobotFile,
  type RobotImportRecoveryDiagnostic,
  type RobotState,
} from '@/types';
import { parseURDF } from './urdf/parser';
import { parseMJCF } from './mjcf/mjcfParser';
import { syncMjcfMeshTextMaterialColors } from './mjcf/mjcfMeshTextColorSync';
import { resolveMJCFSource } from './mjcf/mjcfSourceResolver';
import { parseSDF } from './sdf/sdfParser';
import { syncRobotMeshTextMaterialMetadata } from './meshTextMaterialSync';
import { processXacro } from './xacro/xacroParser';
import { rewriteRobotMeshPathsForSource } from './meshPathUtils';
import { syncRobotVisualColorsFromMaterials } from '@/core/robot/materials';
import { isImageAssetPath } from '@/core/utils/assetFileTypes';
import { isSourceOnlyMJCFDocument } from './mjcf/mjcfXml';
import { inspectMJCFImportExternalAssets } from './mjcf/mjcfImportValidation';
import { finalizeImportedRobotData } from './finalizeImportedRobotData';

export interface ResolveRobotFileDataOptions {
  availableFiles?: RobotFile[];
  assets?: Record<string, string>;
  allFileContents?: Record<string, string>;
  usdRobotData?: RobotData | null;
  mjcfExternalAssetValidation?: 'auto' | 'always' | 'never';
}

export interface RobotImportProgress {
  progressPercent: number | null;
  message?: string | null;
  progressMode?: LoadingProgressMode | null;
  phase?: RobotImportProgressPhase | null;
}

export type RobotImportProgressPhase =
  | 'resolving-source'
  | 'checking-assets'
  | 'parsing-source'
  | 'finalizing-import';

export type RobotImportErrorReason = 'parse_failed' | 'unsupported_format' | 'source_only_fragment';

export type RobotImportResult =
  | {
      status: 'ready';
      format: RobotFile['format'];
      robotData: RobotData;
      resolvedUrdfContent: string | null;
      resolvedUrdfSourceFilePath: string | null;
    }
  | {
      status: 'needs_hydration';
      format: 'usd';
    }
  | {
      status: 'error';
      format: RobotFile['format'];
      reason: RobotImportErrorReason;
      message?: string;
    };

type RobotImportProgressReporter = (progress: RobotImportProgress) => void;
const ROBOT_IMPORT_FAILURE_MESSAGE_PREFIX = /^Failed to import [A-Z0-9_+-]+ file "[^"]+"\.\s*/i;

function emitRobotImportProgress(
  reportProgress: RobotImportProgressReporter | undefined,
  progressPercent: number | null,
  message?: string | null,
  options: {
    progressMode?: LoadingProgressMode | null;
    phase?: RobotImportProgressPhase | null;
  } = {},
): void {
  if (!reportProgress) {
    return;
  }

  const normalizedProgressPercent = Number.isFinite(progressPercent ?? NaN)
    ? Math.max(0, Math.min(100, Math.round(progressPercent ?? 0)))
    : null;
  const progressMode =
    options.progressMode ?? (normalizedProgressPercent === null ? 'indeterminate' : 'percent');

  reportProgress({
    progressPercent: normalizedProgressPercent,
    message: message ?? null,
    progressMode,
    phase: options.phase ?? null,
  });
}

function toRobotData(robot: RobotState | RobotData): RobotData {
  return {
    name: robot.name,
    links: robot.links,
    joints: robot.joints,
    rootLinkId: robot.rootLinkId,
    materials: robot.materials,
    closedLoopConstraints: robot.closedLoopConstraints,
    inspectionContext: robot.inspectionContext,
  };
}

export function createUsdPlaceholderRobotData(file: RobotFile): RobotData {
  const robotName =
    file.name
      .split('/')
      .pop()
      ?.replace(/\.[^/.]+$/, '') || 'usd_scene';
  const linkId = 'usd_scene_root';

  return {
    name: robotName,
    links: {
      [linkId]: {
        ...DEFAULT_LINK,
        id: linkId,
        name: 'usd_scene_root',
        visual: {
          ...DEFAULT_LINK.visual,
          type: GeometryType.NONE,
          dimensions: { x: 0, y: 0, z: 0 },
        },
        collision: {
          ...DEFAULT_LINK.collision,
          type: GeometryType.NONE,
          dimensions: { x: 0, y: 0, z: 0 },
        },
        inertial: {
          ...DEFAULT_LINK.inertial,
          mass: 0,
        },
      },
    },
    joints: {},
    rootLinkId: linkId,
  };
}

function createMeshRobotData(file: RobotFile): RobotData {
  const meshName =
    file.name
      .split('/')
      .pop()
      ?.replace(/\.[^/.]+$/, '') ?? 'mesh';
  const linkId = 'base_link';
  const previewColor = isImageAssetPath(file.name) ? '#ffffff' : '#808080';

  return {
    name: meshName,
    links: {
      [linkId]: {
        id: linkId,
        name: 'base_link',
        visible: true,
        visual: {
          type: GeometryType.MESH,
          dimensions: { x: 1, y: 1, z: 1 },
          color: previewColor,
          meshPath: file.name,
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collision: {
          type: GeometryType.NONE,
          dimensions: { x: 0, y: 0, z: 0 },
          color: '#ef4444',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        inertial: {
          mass: 1.0,
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          inertia: { ixx: 0.1, ixy: 0, ixz: 0, iyy: 0.1, iyz: 0, izz: 0.1 },
        },
      },
    },
    joints: {},
    rootLinkId: linkId,
  };
}

interface CreateReadyImportResultOptions {
  sourceFilePath?: string;
  resolvedUrdfContent?: string | null;
  allFileContents?: Record<string, string>;
  assetPaths?: Iterable<string>;
  importAssetPaths?: Iterable<string>;
  recoveryDiagnostics?: RobotImportRecoveryDiagnostic[];
}

function createReadyImportResult(
  file: RobotFile,
  robotData: RobotData,
  options: CreateReadyImportResultOptions = {},
): RobotImportResult {
  const {
    sourceFilePath = file.name,
    resolvedUrdfContent = null,
    allFileContents = {},
    assetPaths = [],
    importAssetPaths = [],
    recoveryDiagnostics = [],
  } = options;
  const rewrittenRobotData = rewriteRobotMeshPathsForSource(robotData, sourceFilePath, {
    candidateAssetPaths: importAssetPaths,
  });
  const meshTextMaterialSyncedRobotData =
    file.format === 'mjcf'
      ? rewrittenRobotData
      : syncRobotMeshTextMaterialMetadata(rewrittenRobotData, {
          allFileContents,
          assetPaths,
        });
  const mjcfMeshColorSyncedRobotData =
    file.format === 'mjcf'
      ? syncMjcfMeshTextMaterialColors(rewrittenRobotData, allFileContents)
      : meshTextMaterialSyncedRobotData;
  const syncedRobotData = syncRobotVisualColorsFromMaterials(mjcfMeshColorSyncedRobotData);
  const finalized = finalizeImportedRobotData(
    syncedRobotData,
    file.format,
    recoveryDiagnostics,
  );
  if (finalized.status === 'error') {
    return createErrorImportResult(
      file,
      finalized.reason,
      buildImportFailureMessage(file, finalized.detail),
    );
  }

  return {
    status: 'ready',
    format: file.format,
    robotData: finalized.robotData,
    resolvedUrdfContent,
    resolvedUrdfSourceFilePath: resolvedUrdfContent ? sourceFilePath : null,
  };
}

function buildImportFailureMessage(file: RobotFile, detail?: string | null): string {
  const baseMessage = `Failed to import ${file.format.toUpperCase()} file "${file.name}".`;
  const trimmedDetail = detail?.trim();
  if (!trimmedDetail) {
    return baseMessage;
  }

  return `${baseMessage} ${trimmedDetail}`;
}

function normalizeImportFailureDetail(error: unknown, fallbackMessage: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }

  if (typeof error === 'string' && error.trim()) {
    return error.trim();
  }

  return fallbackMessage;
}

function buildImportFailureDetail(
  file: RobotFile,
  parsePhase: string,
  detail?: string | null,
): string {
  const context = `Context: file="${file.name}", format="${file.format}", phase: ${parsePhase}.`;
  const trimmedDetail = detail?.trim();
  return trimmedDetail ? `${context} ${trimmedDetail}` : context;
}

function createErrorImportResult(
  file: RobotFile,
  reason: RobotImportErrorReason,
  message?: string,
): RobotImportResult {
  return {
    status: 'error',
    format: file.format,
    reason,
    message,
  };
}

export function describeRobotImportFailure(
  importResult: Exclude<RobotImportResult, { status: 'ready' }>,
): string {
  if (importResult.status === 'needs_hydration') {
    return 'USD scene data is not hydrated yet.';
  }

  const normalizedMessage = importResult.message
    ?.trim()
    .replace(ROBOT_IMPORT_FAILURE_MESSAGE_PREFIX, '');
  if (normalizedMessage) {
    return normalizedMessage;
  }

  if (importResult.reason === 'unsupported_format') {
    return `Unsupported format "${importResult.format}".`;
  }

  if (importResult.reason === 'source_only_fragment') {
    return 'The selected source file is only a fragment and cannot be assembled as a standalone component.';
  }

  return 'Source parsing failed.';
}

function normalizeFilePath(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

function normalizeSourceLookupPath(filePath: string): string {
  return normalizeFilePath(filePath).trim().replace(/^\/+/, '').split('?')[0];
}

function getFileName(filePath: string): string {
  const normalized = normalizeFilePath(filePath);
  const segments = normalized.split('/');
  return segments[segments.length - 1] || normalized;
}

function hasSourceContent(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasTextMeshMaterialInputs(allFileContents: Record<string, string>): boolean {
  for (const assetPath in allFileContents) {
    if (!Object.prototype.hasOwnProperty.call(allFileContents, assetPath)) {
      continue;
    }

    const lowerPath = assetPath.toLowerCase();
    if (lowerPath.endsWith('.dae') || lowerPath.endsWith('.obj')) {
      return true;
    }
  }

  return false;
}

function buildMeshTextMaterialAssetPaths(options: {
  availableFiles: RobotFile[];
  assets: Record<string, string>;
  allFileContents: Record<string, string>;
}): Set<string> {
  const paths = new Set<string>();

  Object.keys(options.allFileContents).forEach((assetPath) => {
    paths.add(assetPath);
  });

  Object.keys(options.assets).forEach((assetPath) => {
    if (isImageAssetPath(assetPath)) {
      paths.add(assetPath);
    }
  });

  options.availableFiles.forEach((file) => {
    if (isImageAssetPath(file.name)) {
      paths.add(file.name);
    }
  });

  return paths;
}

function buildImportAssetPaths(options: {
  availableFiles: RobotFile[];
  assets: Record<string, string>;
  allFileContents: Record<string, string>;
}): Set<string> {
  const paths = new Set<string>();

  options.availableFiles.forEach((file) => {
    paths.add(file.name);
  });

  Object.keys(options.assets).forEach((assetPath) => {
    paths.add(assetPath);
  });

  Object.keys(options.allFileContents).forEach((contentPath) => {
    paths.add(contentPath);
  });

  return paths;
}

function findContextFileContent(
  file: RobotFile,
  options: Pick<ResolveRobotFileDataOptions, 'availableFiles' | 'allFileContents'>,
): { content: string; sourceFilePath: string } | null {
  const normalizedTargetPath = normalizeSourceLookupPath(file.name);
  if (!normalizedTargetPath) {
    return null;
  }

  for (const [path, content] of Object.entries(options.allFileContents ?? {})) {
    if (hasSourceContent(content) && normalizeSourceLookupPath(path) === normalizedTargetPath) {
      return {
        content,
        sourceFilePath: path,
      };
    }
  }

  for (const candidate of options.availableFiles ?? []) {
    if (
      candidate.format === file.format &&
      hasSourceContent(candidate.content) &&
      normalizeSourceLookupPath(candidate.name) === normalizedTargetPath
    ) {
      return {
        content: candidate.content,
        sourceFilePath: candidate.name,
      };
    }
  }

  return null;
}

function resolveUrdfSourceContent(
  file: RobotFile,
  options: Pick<ResolveRobotFileDataOptions, 'availableFiles' | 'allFileContents'>,
): { content: string; sourceFilePath: string | null; fromContext: boolean } {
  if (hasSourceContent(file.content)) {
    return {
      content: file.content,
      sourceFilePath: null,
      fromContext: false,
    };
  }

  const contextMatch = findContextFileContent(file, options);
  if (contextMatch) {
    return {
      content: contextMatch.content,
      sourceFilePath: contextMatch.sourceFilePath,
      fromContext: true,
    };
  }

  return {
    content: file.content,
    sourceFilePath: null,
    fromContext: false,
  };
}

export function isStandaloneXacroEntry(file: RobotFile): boolean {
  const lowerName = getFileName(file.name).toLowerCase();
  return lowerName === 'robot.xacro' || lowerName.endsWith('.urdf.xacro');
}

export function findStandaloneXacroTruthFile(
  file: RobotFile,
  availableFiles: RobotFile[],
): RobotFile | null {
  if (!isStandaloneXacroEntry(file)) {
    return null;
  }

  const normalizedFileName = normalizeFilePath(file.name);
  const pathParts = normalizedFileName.split('/');
  if (pathParts.length < 3) {
    return null;
  }

  const packageDir = pathParts.slice(0, -2).join('/');
  const packageName = pathParts[pathParts.length - 3] || '';
  const urdfDir = `${packageDir}/urdf/`;

  const candidateTruthFiles = availableFiles.filter((candidate) => {
    if (candidate.format !== 'urdf') {
      return false;
    }

    return normalizeFilePath(candidate.name).startsWith(urdfDir);
  });

  if (candidateTruthFiles.length === 0) {
    return null;
  }

  const preferredFileNames = [
    `${packageName}.urdf`,
    `${packageName.replace(/_description$/i, '')}.urdf`,
    `${getFileName(normalizedFileName).replace(/\.xacro$/i, '')}.urdf`,
  ];

  for (const preferredFileName of preferredFileNames) {
    const match = candidateTruthFiles.find(
      (candidate) => getFileName(candidate.name) === preferredFileName,
    );
    if (match) {
      return match;
    }
  }

  return candidateTruthFiles.length === 1 ? candidateTruthFiles[0] : null;
}

function isClosedRobotDocument(content: string): boolean {
  return /<robot\b[^>]*>[\s\S]*<\/robot>/i.test(content) || /<robot\b[^>]*\/>/i.test(content);
}

function isWellFormedXmlDocument(content: string): boolean {
  if (typeof DOMParser === 'undefined') {
    return isClosedRobotDocument(content);
  }

  const document = new DOMParser().parseFromString(content, 'text/xml');
  return document.querySelector('parsererror') === null;
}

export function isSourceOnlyRobotDocument(urdfContent: string): boolean {
  return (
    isClosedRobotDocument(urdfContent) &&
    isWellFormedXmlDocument(urdfContent) &&
    !/<\s*link\b/i.test(urdfContent)
  );
}

export function isSourceOnlyXacroDocument(urdfContent: string): boolean {
  return isSourceOnlyRobotDocument(urdfContent);
}

function shouldValidateMJCFExternalAssets(
  mode: ResolveRobotFileDataOptions['mjcfExternalAssetValidation'],
  resolvedAssetCount: number,
): boolean {
  if (mode === 'always') {
    return true;
  }

  if (mode === 'never') {
    return false;
  }

  return resolvedAssetCount > 0;
}

export function resolveRobotFileData(
  file: RobotFile,
  options: ResolveRobotFileDataOptions = {},
  reportProgress?: RobotImportProgressReporter,
): RobotImportResult {
  const {
    availableFiles = [],
    assets = {},
    allFileContents = {},
    usdRobotData = null,
    mjcfExternalAssetValidation = 'auto',
  } = options;
  const meshTextMaterialAssetPaths = hasTextMeshMaterialInputs(allFileContents)
    ? buildMeshTextMaterialAssetPaths({
        availableFiles,
        assets,
        allFileContents,
      })
    : null;
  const importAssetPaths = buildImportAssetPaths({
    availableFiles,
    assets,
    allFileContents,
  });
  importAssetPaths.add(file.name);
  const createReady = (
    targetFile: RobotFile,
    robotData: RobotData,
    resultOptions: CreateReadyImportResultOptions = {},
  ) =>
    createReadyImportResult(targetFile, robotData, {
      ...resultOptions,
      importAssetPaths,
    });
  let parsePhase = 'starting import';

  try {
    switch (file.format) {
      case 'urdf': {
        parsePhase = 'resolving URDF source';
        emitRobotImportProgress(reportProgress, 15, 'Resolving URDF source', {
          phase: 'resolving-source',
        });
        const resolvedUrdfSource = resolveUrdfSourceContent(file, {
          availableFiles,
          allFileContents,
        });
        parsePhase = 'parsing URDF';
        emitRobotImportProgress(reportProgress, null, 'Parsing URDF', {
          progressMode: 'indeterminate',
          phase: 'parsing-source',
        });
        const parsed = parseURDF(resolvedUrdfSource.content);
        const resolvedUrdfOptions = resolvedUrdfSource.fromContext
          ? {
              sourceFilePath: resolvedUrdfSource.sourceFilePath ?? file.name,
              resolvedUrdfContent: resolvedUrdfSource.content,
              allFileContents,
              ...(meshTextMaterialAssetPaths ? { assetPaths: meshTextMaterialAssetPaths } : {}),
            }
          : {
              allFileContents,
              ...(meshTextMaterialAssetPaths ? { assetPaths: meshTextMaterialAssetPaths } : {}),
            };
        if (!parsed) {
          const isSourceOnlyFragment = isSourceOnlyRobotDocument(resolvedUrdfSource.content);
          return createErrorImportResult(
            file,
            isSourceOnlyFragment ? 'source_only_fragment' : 'parse_failed',
            isSourceOnlyFragment
              ? undefined
              : buildImportFailureMessage(file, buildImportFailureDetail(file, parsePhase)),
          );
        }

        parsePhase = 'finalizing URDF import';
        emitRobotImportProgress(reportProgress, 100, 'Finalizing robot document', {
          phase: 'finalizing-import',
        });
        return createReady(file, toRobotData(parsed), resolvedUrdfOptions);
      }
      case 'mjcf': {
        parsePhase = 'resolving MJCF source';
        emitRobotImportProgress(reportProgress, 10, 'Resolving MJCF source', {
          phase: 'resolving-source',
        });
        const resolved = resolveMJCFSource(file, availableFiles);
        if (resolved.issues.length > 0) {
          return createErrorImportResult(
            file,
            'parse_failed',
            buildImportFailureMessage(
              file,
              buildImportFailureDetail(file, parsePhase, resolved.issues[0]?.detail),
            ),
          );
        }

        if (isSourceOnlyMJCFDocument(resolved.content)) {
          return createErrorImportResult(file, 'source_only_fragment');
        }

        parsePhase = 'checking MJCF external assets';
        emitRobotImportProgress(reportProgress, 45, 'Checking MJCF external assets', {
          phase: 'checking-assets',
        });
        let recoveryDiagnostics: RobotImportRecoveryDiagnostic[] = [];
        if (mjcfExternalAssetValidation !== 'never') {
          const assetValidation = inspectMJCFImportExternalAssets(
            resolved.sourceFile.name,
            resolved.validationContent,
            availableFiles,
            assets,
          );
          const shouldApplyAssetValidation =
            shouldValidateMJCFExternalAssets(
              mjcfExternalAssetValidation,
              assetValidation.resolvedAssetCount,
            );
          const fatalAssetIssues = shouldApplyAssetValidation
            ? assetValidation.issues.filter((issue) =>
                mjcfExternalAssetValidation === 'always'
                || issue.referenceKind === 'include'
                || issue.referenceKind === 'model')
            : [];
          if (fatalAssetIssues.length > 0) {
            return createErrorImportResult(
              file,
              'parse_failed',
              buildImportFailureMessage(
                file,
                buildImportFailureDetail(file, parsePhase, fatalAssetIssues[0]?.detail),
              ),
            );
          }
          if (shouldApplyAssetValidation) {
            recoveryDiagnostics = assetValidation.issues
              .filter((issue) => !fatalAssetIssues.includes(issue))
              .map((issue) => ({
                code: 'missing_render_asset_placeholder',
                severity: 'warning',
                category: issue.referenceKind === 'texture' ? 'material' : 'geometry',
                message: `${issue.detail} A placeholder will be used.`,
                relatedIds: issue.elementName ? [issue.elementName] : undefined,
                source: {
                  tag: issue.referenceKind,
                  name: issue.elementName ?? undefined,
                  attribute: issue.attributeName,
                },
                action: 'downgraded',
              }));
          }
        }

        parsePhase = 'parsing MJCF';
        emitRobotImportProgress(reportProgress, null, 'Parsing MJCF', {
          progressMode: 'indeterminate',
          phase: 'parsing-source',
        });
        const parsed = parseMJCF(resolved.content);
        if (!parsed) {
          return createErrorImportResult(
            file,
            'parse_failed',
            buildImportFailureMessage(file, buildImportFailureDetail(file, parsePhase)),
          );
        }

        parsePhase = 'finalizing MJCF import';
        emitRobotImportProgress(reportProgress, 100, 'Finalizing robot document', {
          phase: 'finalizing-import',
        });
        return createReady(file, toRobotData(parsed), {
          sourceFilePath: resolved.sourceFile.name,
          allFileContents,
          recoveryDiagnostics,
          ...(meshTextMaterialAssetPaths ? { assetPaths: meshTextMaterialAssetPaths } : {}),
        });
      }
      case 'sdf': {
        parsePhase = 'resolving SDF context';
        emitRobotImportProgress(reportProgress, 15, 'Resolving SDF context', {
          phase: 'resolving-source',
        });
        parsePhase = 'parsing SDF';
        emitRobotImportProgress(reportProgress, null, 'Parsing SDF', {
          progressMode: 'indeterminate',
          phase: 'parsing-source',
        });
        const parsed = parseSDF(file.content, {
          allFileContents,
          availableFiles,
          sourcePath: file.name,
        });
        if (!parsed) {
          return createErrorImportResult(
            file,
            'parse_failed',
            buildImportFailureMessage(file, buildImportFailureDetail(file, parsePhase)),
          );
        }

        parsePhase = 'finalizing SDF import';
        emitRobotImportProgress(reportProgress, 100, 'Finalizing robot document', {
          phase: 'finalizing-import',
        });
        return createReady(file, toRobotData(parsed), {
          allFileContents,
          ...(meshTextMaterialAssetPaths ? { assetPaths: meshTextMaterialAssetPaths } : {}),
        });
      }
      case 'usd':
        emitRobotImportProgress(
          reportProgress,
          35,
          usdRobotData ? 'Reusing prepared USD robot data' : 'Preparing USD document',
        );
        emitRobotImportProgress(
          reportProgress,
          100,
          usdRobotData ? 'Handing off prepared USD document' : 'Waiting for USD hydration',
        );
        return usdRobotData
          ? createReady(file, usdRobotData, {
              allFileContents,
              ...(meshTextMaterialAssetPaths ? { assetPaths: meshTextMaterialAssetPaths } : {}),
            })
          : {
              status: 'needs_hydration',
              format: 'usd',
            };
      case 'xacro': {
        parsePhase = 'resolving Xacro support files';
        emitRobotImportProgress(reportProgress, 15, 'Resolving Xacro support files');
        const truthFile = findStandaloneXacroTruthFile(file, availableFiles);
        if (truthFile) {
          parsePhase = 'parsing companion URDF';
          emitRobotImportProgress(reportProgress, 45, 'Checking companion URDF');
          const truthRobot = parseURDF(truthFile.content);
          if (truthRobot) {
            emitRobotImportProgress(reportProgress, 100, 'Finalizing robot document');
            return createReady(file, toRobotData(truthRobot), {
              sourceFilePath: truthFile.name,
              resolvedUrdfContent: truthFile.content,
              allFileContents,
              ...(meshTextMaterialAssetPaths ? { assetPaths: meshTextMaterialAssetPaths } : {}),
            });
          }
        }

        const fileMap: Record<string, string> = {};
        availableFiles.forEach((candidate) => {
          fileMap[candidate.name] = candidate.content;
        });
        Object.entries(allFileContents).forEach(([path, content]) => {
          if (typeof content === 'string') {
            fileMap[path] = content;
          }
        });
        Object.entries(assets).forEach(([path, content]) => {
          if (typeof content === 'string') {
            fileMap[path] = content;
          }
        });
        const pathParts = file.name.split('/');
        pathParts.pop();
        parsePhase = 'expanding Xacro';
        emitRobotImportProgress(reportProgress, 55, 'Expanding Xacro');
        const urdfContent = processXacro(file.content, {}, fileMap, pathParts.join('/'));
        parsePhase = 'parsing generated URDF';
        emitRobotImportProgress(reportProgress, 80, 'Parsing generated URDF');
        const parsed = parseURDF(urdfContent);
        if (parsed) {
          emitRobotImportProgress(reportProgress, 100, 'Finalizing robot document');
          return createReady(file, toRobotData(parsed), {
            resolvedUrdfContent: urdfContent,
            allFileContents,
            ...(meshTextMaterialAssetPaths ? { assetPaths: meshTextMaterialAssetPaths } : {}),
          });
        }

        return createErrorImportResult(
          file,
          isSourceOnlyXacroDocument(urdfContent) ? 'source_only_fragment' : 'parse_failed',
          buildImportFailureMessage(file, buildImportFailureDetail(file, parsePhase)),
        );
      }
      case 'mesh':
        emitRobotImportProgress(reportProgress, 100, 'Preparing mesh preview');
        return createReady(file, createMeshRobotData(file), {
          allFileContents,
          ...(meshTextMaterialAssetPaths ? { assetPaths: meshTextMaterialAssetPaths } : {}),
        });
      case 'asset':
        return createErrorImportResult(
          file,
          'unsupported_format',
          buildImportFailureMessage(file, 'Generic asset files are stored in the library only.'),
        );
      default:
        return createErrorImportResult(
          file,
          'unsupported_format',
          buildImportFailureMessage(file, 'Unsupported robot file format.'),
        );
    }
  } catch (error) {
    console.error(`[importRobotFile] Failed to resolve robot file "${file.name}":`, error);
    const normalizedErrorMessage = normalizeImportFailureDetail(error, 'Unexpected import error.');
    return createErrorImportResult(
      file,
      'parse_failed',
      buildImportFailureMessage(
        file,
        buildImportFailureDetail(file, parsePhase, normalizedErrorMessage),
      ),
    );
  }
}
