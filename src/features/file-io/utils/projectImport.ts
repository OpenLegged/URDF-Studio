import JSZip from 'jszip';

import type { AssetFile } from '../types';
import type {
  AssemblyState,
  ComponentSourceDraft,
  MotorSpec,
  RobotData,
  RobotFile,
  RobotState,
  WorkspaceHistory,
} from '@/types';
import type { Language } from '@/shared/i18n';
import { isAssetLibraryOnlyFormat } from '@/shared/utils/robotFileSupport';
import { createSourceSemanticRobotHash, normalizeComponentRobot } from '@/core/robot';
import { parseMJCF, parseSDF, parseURDF, parseXacro } from '@/core/parsers';
import { rewriteRobotMeshPathsForSource } from '@/core/parsers/meshPathUtils';
import { processMJCFIncludes } from '@/core/parsers/mjcf/mjcfSourceResolver';
import {
  assertProjectArchiveEntryPath,
  assertProjectAssetsManifest,
  assertProjectComponentSourceDraftManifest,
  assertProjectManifest,
  assertProjectWorkspace,
  assertProjectWorkspaceHistory,
  buildLibraryArchivePath,
  PROJECT_MANIFEST_FILE,
} from './projectArchive';
import {
  DEFAULT_PROJECT_ARCHIVE_LIMITS,
  getProjectArchiveEntryUncompressedSize,
  loadProjectArchiveZip,
} from './projectArchiveZip';
import type {
  ProjectAssetsManifest,
  ProjectDerivedCaches,
  ProjectManifest,
} from './projectExportTypes';
import { readUsdPreparedExportCaches } from './projectUsdPreparedExportCaches';

export interface ImportedProjectLibraryFile extends Omit<RobotFile, 'blobUrl'> {
  blobPath?: string | null;
}

export interface ImportedProjectArchiveAssets {
  assetFiles: AssetFile[];
  availableFiles: ImportedProjectLibraryFile[];
  allFileContents: Record<string, string>;
  motorLibrary: Record<string, MotorSpec[]>;
  selectedFileName: string | null;
}

export interface ImportedProjectAssets {
  assetUrls: Record<string, string>;
  availableFiles: RobotFile[];
  allFileContents: Record<string, string>;
  motorLibrary: Record<string, MotorSpec[]>;
  selectedFileName: string | null;
}

export interface ProjectImportWarning {
  code: string;
  message: string;
  path?: string;
}

/** Worker-safe fully validated project data. Blob URLs are created only after this exists. */
export interface ImportedProjectArchiveData {
  manifest: ProjectManifest;
  workspace: AssemblyState;
  workspaceHistory: WorkspaceHistory;
  componentSourceDrafts: Record<string, ComponentSourceDraft>;
  assets: ImportedProjectArchiveAssets;
  derivedCaches: ProjectDerivedCaches;
  warnings: ProjectImportWarning[];
}

/** Canonical .usp 3.0 import API. No robot/assembly mirrors are returned. */
export interface ProjectImportResult {
  manifest: ProjectManifest;
  workspace: AssemblyState;
  workspaceHistory: WorkspaceHistory;
  componentSourceDrafts: Record<string, ComponentSourceDraft>;
  assets: ImportedProjectAssets;
  derivedCaches: ProjectDerivedCaches;
  warnings: ProjectImportWarning[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getRequiredArchiveEntry(zip: JSZip, path: string, label: string): JSZip.JSZipObject {
  const entry = zip.file(path);
  if (!entry) {
    throw new Error(`Invalid project file: missing required ${label} at "${path}"`);
  }
  return entry;
}

async function readRequiredArchiveText(
  zip: JSZip,
  path: string,
  label: string,
  allowEmpty = false,
): Promise<string> {
  const content = await getRequiredArchiveEntry(zip, path, label).async('string');
  if (!allowEmpty && content.length === 0) {
    throw new Error(`Invalid project file: required ${label} at "${path}" is empty`);
  }
  return content;
}

async function loadRequiredJson(
  zip: JSZip,
  path: string,
  label: string,
): Promise<unknown> {
  const content = await readRequiredArchiveText(zip, path, label);
  try {
    return JSON.parse(content) as unknown;
  } catch (error) {
    throw new Error(`Invalid project file: failed to parse ${label} at "${path}"`, {
      cause: error,
    });
  }
}

function assertAllFileContents(
  value: unknown,
): asserts value is Record<string, string> {
  if (!isRecord(value)) {
    throw new Error('Invalid project file: all file contents must be an object');
  }
  const entries = Object.entries(value);
  if (entries.length > DEFAULT_PROJECT_ARCHIVE_LIMITS.maxEntries) {
    throw new Error('Invalid project file: all file contents contains too many entries');
  }
  entries.forEach(([path, content]) => {
    assertProjectArchiveEntryPath(path, `all file contents key ${path}`);
    if (typeof content !== 'string') {
      throw new Error(`Invalid project file: all file contents entry "${path}" must be text`);
    }
  });
}

function assertMotorLibrary(
  value: unknown,
): asserts value is Record<string, MotorSpec[]> {
  if (!isRecord(value)) {
    throw new Error('Invalid project file: motor library must be an object');
  }
  if (Object.keys(value).length > DEFAULT_PROJECT_ARCHIVE_LIMITS.maxEntries) {
    throw new Error('Invalid project file: motor library contains too many entries');
  }
  Object.entries(value).forEach(([brand, motors]) => {
    if (!Array.isArray(motors)) {
      throw new Error(`Invalid project file: motor library entry "${brand}" must be an array`);
    }
    motors.forEach((motor, index) => {
      if (!isRecord(motor)) {
        throw new Error(
          `Invalid project file: motor library entry "${brand}"[${index}] must be an object`,
        );
      }
    });
  });
}

async function loadPackedAssetFiles(
  zip: JSZip,
  manifest: ProjectAssetsManifest,
): Promise<AssetFile[]> {
  const assetFiles: AssetFile[] = [];
  const logicalPaths = new Set<string>();
  const archivePaths = new Set<string>();

  for (const entry of manifest.packedFiles) {
    if (!entry.archivePath.startsWith('assets/files/')) {
      throw new Error(
        `Invalid project file: packed asset "${entry.logicalPath}" must be stored under assets/files/`,
      );
    }
    if (logicalPaths.has(entry.logicalPath) || archivePaths.has(entry.archivePath)) {
      throw new Error('Invalid project file: packed asset manifest contains duplicate paths');
    }
    logicalPaths.add(entry.logicalPath);
    archivePaths.add(entry.archivePath);

    const archiveEntry = getRequiredArchiveEntry(
      zip,
      entry.archivePath,
      `packed asset "${entry.logicalPath}"`,
    );
    const entrySize = getProjectArchiveEntryUncompressedSize(archiveEntry);
    if (entrySize > DEFAULT_PROJECT_ARCHIVE_LIMITS.maxSingleEntryBytes) {
      throw new Error(
        `Project archive asset "${entry.logicalPath}" is too large (${entrySize} bytes). Maximum: ${DEFAULT_PROJECT_ARCHIVE_LIMITS.maxSingleEntryBytes} bytes.`,
      );
    }
    assetFiles.push({
      name: entry.logicalPath,
      blob: await archiveEntry.async('blob'),
    });
  }
  return assetFiles;
}

async function loadLibraryFiles(
  zip: JSZip,
  manifest: ProjectAssetsManifest,
  packedAssetPaths: ReadonlySet<string>,
): Promise<ImportedProjectLibraryFile[]> {
  const availableFiles: ImportedProjectLibraryFile[] = [];
  const seenNames = new Set<string>();

  for (const fileInfo of manifest.availableFiles) {
    if (seenNames.has(fileInfo.name)) {
      throw new Error(`Invalid project file: duplicate library file "${fileInfo.name}"`);
    }
    seenNames.add(fileInfo.name);
    let content = '';
    if (!isAssetLibraryOnlyFormat(fileInfo.format)) {
      content = await readRequiredArchiveText(
        zip,
        buildLibraryArchivePath(fileInfo.name),
        `library source file "${fileInfo.name}"`,
        fileInfo.format === 'usd',
      );
    }
    availableFiles.push({
      name: fileInfo.name,
      format: fileInfo.format,
      content,
      blobPath: packedAssetPaths.has(fileInfo.name) ? fileInfo.name : null,
    });
  }
  return availableFiles;
}

function toRobotData(robot: RobotState): RobotData {
  const { selection: _selection, ...robotData } = robot;
  return robotData;
}

function buildDraftSourceContext(
  sourceFile: RobotFile,
  availableFiles: readonly ImportedProjectLibraryFile[],
  allFileContents: Record<string, string>,
): { availableFiles: RobotFile[]; allFileContents: Record<string, string> } {
  const contextFiles = availableFiles.map((file): RobotFile => ({
    name: file.name,
    format: file.format,
    content: file.name === sourceFile.name ? sourceFile.content : file.content,
  }));
  if (!contextFiles.some((file) => file.name === sourceFile.name)) {
    contextFiles.push(sourceFile);
  }
  return {
    availableFiles: contextFiles,
    allFileContents: {
      ...allFileContents,
      [sourceFile.name]: sourceFile.content,
    },
  };
}

function parseComponentSourceDraft(
  sourceFile: RobotFile,
  availableFiles: RobotFile[],
  allFileContents: Record<string, string>,
): RobotData | null {
  const basePath = sourceFile.name.split('/').slice(0, -1).join('/');
  let parsed: RobotState | null = null;
  switch (sourceFile.format) {
    case 'urdf':
      parsed = parseURDF(sourceFile.content);
      break;
    case 'mjcf':
      parsed = parseMJCF(processMJCFIncludes(sourceFile.content, availableFiles, basePath));
      break;
    case 'sdf':
      parsed = parseSDF(sourceFile.content, {
        allFileContents,
        availableFiles,
        sourcePath: sourceFile.name,
      });
      break;
    case 'xacro': {
      const fileMap = Object.fromEntries(
        availableFiles.map((file) => [file.name, file.content]),
      );
      parsed = parseXacro(
        sourceFile.content,
        {},
        { ...allFileContents, ...fileMap, [sourceFile.name]: sourceFile.content },
        basePath,
      );
      break;
    }
    default:
      return null;
  }
  if (!parsed) return null;
  return normalizeComponentRobot(
    toRobotData(rewriteRobotMeshPathsForSource(parsed, sourceFile.name)),
  );
}

async function loadComponentSourceDrafts(
  zip: JSZip,
  manifestPath: string | undefined,
  workspace: AssemblyState,
  availableFiles: readonly ImportedProjectLibraryFile[],
  allFileContents: Record<string, string>,
): Promise<Record<string, ComponentSourceDraft>> {
  if (!manifestPath) return {};

  const manifestValue = await loadRequiredJson(
    zip,
    manifestPath,
    'component source draft manifest',
  );
  assertProjectComponentSourceDraftManifest(manifestValue, workspace);

  const drafts: Record<string, ComponentSourceDraft> = {};
  for (const entry of manifestValue.drafts) {
    if (entry.format === 'usd') {
      throw new Error(
        `Invalid project file: USD component source draft "${entry.componentId}" cannot be validated as editable text`,
      );
    }
    const component = workspace.components[entry.componentId];
    const content = await readRequiredArchiveText(
      zip,
      entry.contentPath,
      `component source draft "${entry.componentId}" content`,
    );
    const sourceFile: RobotFile = {
      name: component.sourceFile ?? `component.${entry.format === 'mjcf' ? 'xml' : entry.format}`,
      format: entry.format,
      content,
    };
    const context = buildDraftSourceContext(sourceFile, availableFiles, allFileContents);
    let parsedRobot: RobotData | null;
    try {
      parsedRobot = parseComponentSourceDraft(
        sourceFile,
        context.availableFiles,
        context.allFileContents,
      );
    } catch (error) {
      throw new Error(
        `Invalid project file: failed to parse component source draft "${entry.componentId}"`,
        { cause: error },
      );
    }
    if (!parsedRobot) {
      throw new Error(
        `Invalid project file: failed to parse component source draft "${entry.componentId}"`,
      );
    }
    if (createSourceSemanticRobotHash(parsedRobot) !== entry.robotSnapshotHash) {
      throw new Error(
        `Invalid project file: component source draft content hash mismatch for "${entry.componentId}"`,
      );
    }
    drafts[entry.componentId] = {
      componentId: entry.componentId,
      format: entry.format,
      content,
      robotSnapshotHash: entry.robotSnapshotHash,
    };
  }
  return drafts;
}

function createPackedProjectAssetUrls(assetFiles: readonly AssetFile[]): Record<string, string> {
  return Object.fromEntries(
    assetFiles.map(({ name, blob }) => [name, URL.createObjectURL(blob)]),
  );
}

function revokeImportedAssetUrls(assetUrls: Record<string, string>): void {
  Array.from(new Set(Object.values(assetUrls))).forEach((url) => {
    if (url.startsWith('blob:')) URL.revokeObjectURL(url);
  });
}

export function hydrateImportedProjectResult(
  archiveData: ImportedProjectArchiveData,
): ProjectImportResult {
  let assetUrls: Record<string, string> = {};
  try {
    assetUrls = createPackedProjectAssetUrls(archiveData.assets.assetFiles);
    return {
      manifest: archiveData.manifest,
      workspace: archiveData.workspace,
      workspaceHistory: archiveData.workspaceHistory,
      componentSourceDrafts: archiveData.componentSourceDrafts,
      assets: {
        assetUrls,
        availableFiles: archiveData.assets.availableFiles.map((file) => {
          const { blobPath, ...rest } = file;
          return {
            ...rest,
            ...(blobPath ? { blobUrl: assetUrls[blobPath] } : {}),
          };
        }),
        allFileContents: archiveData.assets.allFileContents,
        motorLibrary: archiveData.assets.motorLibrary,
        selectedFileName: archiveData.assets.selectedFileName,
      },
      derivedCaches: archiveData.derivedCaches,
      warnings: archiveData.warnings,
    };
  } catch (error) {
    revokeImportedAssetUrls(assetUrls);
    throw error;
  }
}

export async function readImportedProjectArchive(
  file: File | Blob | ArrayBuffer | Uint8Array,
  _lang: Language = 'en',
): Promise<ImportedProjectArchiveData> {
  const zip = await loadProjectArchiveZip(file);

  const manifestValue = await loadRequiredJson(
    zip,
    PROJECT_MANIFEST_FILE,
    '3.0 project manifest',
  );
  assertProjectManifest(manifestValue);
  const manifest = manifestValue;

  const workspaceValue = await loadRequiredJson(
    zip,
    manifest.entries.workspace,
    'workspace state',
  );
  assertProjectWorkspace(workspaceValue);

  const workspaceHistoryValue = await loadRequiredJson(
    zip,
    manifest.entries.workspaceHistory,
    'workspace history',
  );
  assertProjectWorkspaceHistory(workspaceHistoryValue);

  const assetManifestValue = await loadRequiredJson(
    zip,
    manifest.entries.assets,
    'asset manifest',
  );
  assertProjectAssetsManifest(assetManifestValue);
  const assetsManifest = assetManifestValue;

  const allFileContentsValue = await loadRequiredJson(
    zip,
    manifest.entries.allFileContents,
    'all file contents record',
  );
  assertAllFileContents(allFileContentsValue);

  const motorLibraryValue = await loadRequiredJson(
    zip,
    manifest.entries.motorLibrary,
    'motor library',
  );
  assertMotorLibrary(motorLibraryValue);

  const assetFiles = await loadPackedAssetFiles(zip, assetsManifest);
  const packedAssetPaths = new Set(assetFiles.map((assetFile) => assetFile.name));
  const availableFiles = await loadLibraryFiles(zip, assetsManifest, packedAssetPaths);
  const componentSourceDrafts = await loadComponentSourceDrafts(
    zip,
    manifest.entries.componentSourceDrafts,
    workspaceValue,
    availableFiles,
    allFileContentsValue,
  );
  const usdPreparedExportCaches = await readUsdPreparedExportCaches(
    zip,
    manifest.entries.usdPreparedExportCaches ?? null,
  );

  return {
    manifest,
    workspace: workspaceValue,
    workspaceHistory: workspaceHistoryValue,
    componentSourceDrafts,
    assets: {
      assetFiles,
      availableFiles,
      allFileContents: allFileContentsValue,
      motorLibrary: motorLibraryValue,
      selectedFileName: assetsManifest.selectedFileName,
    },
    derivedCaches: { usdPreparedExportCaches },
    warnings: [],
  };
}

export async function importProject(
  file: File | Blob | ArrayBuffer | Uint8Array,
  lang: Language = 'en',
): Promise<ProjectImportResult> {
  return hydrateImportedProjectResult(await readImportedProjectArchive(file, lang));
}
