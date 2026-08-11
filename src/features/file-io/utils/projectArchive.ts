import {
  assertCanonicalWorkspace,
  createSourceSemanticRobotHash,
  isComponentSourceFormat,
} from '@/core/robot';
import type { AssemblyState, WorkspaceActivityEntry, WorkspaceHistory } from '@/types';
import type {
  ProjectAssetsManifest,
  ProjectComponentSourceDraftManifest,
  ProjectManifest,
} from './projectExportTypes';
import { assertProjectArchiveEntryPath } from './projectArchivePath.ts';

export { assertProjectArchiveEntryPath } from './projectArchivePath.ts';

const ASSET_FILE_PREFIX = 'assets/files';
const LIBRARY_FILE_PREFIX = 'library/files';

export const PROJECT_VERSION = '3.0' as const;
export const PROJECT_MANIFEST_FILE = 'manifest.json';
export const PROJECT_WORKSPACE_STATE_FILE = 'workspace/state.json';
export const PROJECT_WORKSPACE_HISTORY_FILE = 'history/workspace.json';
export const PROJECT_ASSET_MANIFEST_FILE = 'assets/manifest.json';
export const PROJECT_ALL_FILE_CONTENTS_FILE = 'library/all-file-contents.json';
export const PROJECT_MOTOR_LIBRARY_FILE = 'library/motor-library.json';
export const PROJECT_COMPONENT_SOURCE_DRAFTS_FILE = 'workspace/component-source-drafts.json';
export const PROJECT_COMPONENT_SOURCE_DRAFTS_PREFIX = 'workspace/source-drafts/';
export const PROJECT_USD_PREPARED_EXPORT_CACHES_FILE = 'workspace/usd-prepared-export-caches.json';

export const MAX_PROJECT_HISTORY_ENTRIES = 50;
export const MAX_PROJECT_ACTIVITY_ENTRIES = 200;

/** Keep ArrayLike USD values JSON-roundtrippable instead of serializing typed arrays as objects. */
export function stringifyProjectJson(value: unknown): string {
  return JSON.stringify(
    value,
    (_key, nestedValue: unknown) => {
      if (ArrayBuffer.isView(nestedValue) && !(nestedValue instanceof DataView)) {
        return Array.from(nestedValue as unknown as ArrayLike<number>);
      }
      return nestedValue;
    },
    2,
  );
}

const ROBOT_FILE_FORMATS = new Set([
  'urdf',
  'mjcf',
  'usd',
  'xacro',
  'sdf',
  'mesh',
  'asset',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`Invalid project file: ${label} must be an object`);
  }
}

function assertExactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
  label: string,
): void {
  const allowedKeys = new Set([...required, ...optional]);
  const missing = required.filter((key) => !Object.prototype.hasOwnProperty.call(value, key));
  const unexpected = Object.keys(value).filter((key) => !allowedKeys.has(key));

  if (missing.length > 0 || unexpected.length > 0) {
    const details = [
      missing.length > 0 ? `missing ${missing.join(', ')}` : '',
      unexpected.length > 0 ? `unexpected ${unexpected.join(', ')}` : '',
    ].filter(Boolean).join('; ');
    throw new Error(`Invalid project file: ${label} has invalid fields (${details})`);
  }
}

function assertNonEmptyString(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Invalid project file: ${label} must be a non-empty string`);
  }
}

/** Validate the only manifest shape accepted by .usp 3.0. */
export function assertProjectManifest(value: unknown): asserts value is ProjectManifest {
  assertRecord(value, 'manifest');
  assertExactKeys(value, ['version', 'metadata', 'entries'], [], 'manifest');
  if (value.version !== PROJECT_VERSION) {
    throw new Error(
      `Unsupported project version: expected ${PROJECT_VERSION}, received ${String(value.version)}`,
    );
  }

  assertRecord(value.metadata, 'manifest.metadata');
  assertExactKeys(value.metadata, ['name', 'lastModified'], [], 'manifest.metadata');
  assertNonEmptyString(value.metadata.name, 'manifest.metadata.name');
  assertNonEmptyString(value.metadata.lastModified, 'manifest.metadata.lastModified');
  if (!Number.isFinite(Date.parse(value.metadata.lastModified))) {
    throw new Error('Invalid project file: manifest.metadata.lastModified must be an ISO date');
  }

  assertRecord(value.entries, 'manifest.entries');
  const entries = value.entries;
  assertExactKeys(
    entries,
    ['workspace', 'workspaceHistory', 'assets', 'allFileContents', 'motorLibrary'],
    ['componentSourceDrafts', 'usdPreparedExportCaches'],
    'manifest.entries',
  );
  Object.entries(entries).forEach(([key, path]) => {
    assertProjectArchiveEntryPath(path, `manifest.entries.${key}`);
  });
  const requiredEntryPaths = {
    workspace: PROJECT_WORKSPACE_STATE_FILE,
    workspaceHistory: PROJECT_WORKSPACE_HISTORY_FILE,
    assets: PROJECT_ASSET_MANIFEST_FILE,
    allFileContents: PROJECT_ALL_FILE_CONTENTS_FILE,
    motorLibrary: PROJECT_MOTOR_LIBRARY_FILE,
  } as const;
  Object.entries(requiredEntryPaths).forEach(([key, expectedPath]) => {
    if (entries[key] !== expectedPath) {
      throw new Error(
        `Invalid project file: manifest.entries.${key} must equal "${expectedPath}"`,
      );
    }
  });
  if (
    entries.componentSourceDrafts !== undefined
    && entries.componentSourceDrafts !== PROJECT_COMPONENT_SOURCE_DRAFTS_FILE
  ) {
    throw new Error(
      `Invalid project file: manifest.entries.componentSourceDrafts must equal "${PROJECT_COMPONENT_SOURCE_DRAFTS_FILE}"`,
    );
  }
  if (
    entries.usdPreparedExportCaches !== undefined
    && entries.usdPreparedExportCaches !== PROJECT_USD_PREPARED_EXPORT_CACHES_FILE
  ) {
    throw new Error(
      `Invalid project file: manifest.entries.usdPreparedExportCaches must equal "${PROJECT_USD_PREPARED_EXPORT_CACHES_FILE}"`,
    );
  }
}

/** Validate library and packed-asset metadata before any blobs are hydrated. */
export function assertProjectAssetsManifest(
  value: unknown,
): asserts value is ProjectAssetsManifest {
  assertRecord(value, 'asset manifest');
  assertExactKeys(
    value,
    ['availableFiles', 'selectedFileName', 'packedFiles'],
    [],
    'asset manifest',
  );
  if (!Array.isArray(value.availableFiles)) {
    throw new Error('Invalid project file: asset manifest availableFiles must be an array');
  }
  if (!Array.isArray(value.packedFiles)) {
    throw new Error('Invalid project file: asset manifest packedFiles must be an array');
  }
  if (value.availableFiles.length > 10_000 || value.packedFiles.length > 10_000) {
    throw new Error('Invalid project file: asset manifest contains too many entries');
  }

  value.availableFiles.forEach((file, index) => {
    assertRecord(file, `asset manifest availableFiles[${index}]`);
    assertExactKeys(file, ['name', 'format'], [], `asset manifest availableFiles[${index}]`);
    assertProjectArchiveEntryPath(file.name, `asset manifest availableFiles[${index}].name`);
    if (typeof file.format !== 'string' || !ROBOT_FILE_FORMATS.has(file.format)) {
      throw new Error(
        `Invalid project file: asset manifest availableFiles[${index}].format is unsupported`,
      );
    }
  });
  value.packedFiles.forEach((entry, index) => {
    assertRecord(entry, `asset manifest packedFiles[${index}]`);
    assertExactKeys(
      entry,
      ['logicalPath', 'archivePath'],
      [],
      `asset manifest packedFiles[${index}]`,
    );
    assertProjectArchiveEntryPath(
      entry.logicalPath,
      `asset manifest packedFiles[${index}].logicalPath`,
    );
    assertProjectArchiveEntryPath(
      entry.archivePath,
      `asset manifest packedFiles[${index}].archivePath`,
    );
  });

  if (value.selectedFileName !== null) {
    assertProjectArchiveEntryPath(value.selectedFileName, 'asset manifest selectedFileName');
    if (!value.availableFiles.some((file) => file.name === value.selectedFileName)) {
      throw new Error(
        'Invalid project file: asset manifest selectedFileName does not reference an available file',
      );
    }
  }
}

/** Validate draft ownership and semantic freshness before reading any draft content. */
export function assertProjectComponentSourceDraftManifest(
  value: unknown,
  workspace: AssemblyState,
): asserts value is ProjectComponentSourceDraftManifest {
  assertRecord(value, 'component source draft manifest');
  assertExactKeys(value, ['drafts'], [], 'component source draft manifest');
  if (!Array.isArray(value.drafts)) {
    throw new Error('Invalid project file: component source draft manifest drafts must be an array');
  }
  if (value.drafts.length > 10_000) {
    throw new Error('Invalid project file: component source draft manifest has too many drafts');
  }

  const componentIds = new Set<string>();
  const contentPaths = new Set<string>();
  value.drafts.forEach((draft, index) => {
    const label = `component source draft manifest drafts[${index}]`;
    assertRecord(draft, label);
    assertExactKeys(
      draft,
      ['componentId', 'format', 'robotSnapshotHash', 'contentPath'],
      [],
      label,
    );
    assertNonEmptyString(draft.componentId, `${label}.componentId`);
    if (componentIds.has(draft.componentId)) {
      throw new Error(
        `Invalid project file: duplicate component source draft for "${draft.componentId}"`,
      );
    }
    componentIds.add(draft.componentId);

    const component = workspace.components[draft.componentId];
    if (!component) {
      throw new Error(
        `Invalid project file: component source draft references foreign component "${draft.componentId}"`,
      );
    }
    if (!isComponentSourceFormat(draft.format)) {
      throw new Error(`Invalid project file: ${label}.format is unsupported`);
    }
    assertNonEmptyString(draft.robotSnapshotHash, `${label}.robotSnapshotHash`);
    const expectedHash = createSourceSemanticRobotHash(component.robot);
    if (draft.robotSnapshotHash !== expectedHash) {
      throw new Error(
        `Invalid project file: component source draft hash mismatch for "${draft.componentId}"`,
      );
    }

    assertProjectArchiveEntryPath(draft.contentPath, `${label}.contentPath`);
    if (
      !draft.contentPath.startsWith(PROJECT_COMPONENT_SOURCE_DRAFTS_PREFIX)
      || !/^workspace\/source-drafts\/\d{4,8}\.txt$/.test(draft.contentPath)
    ) {
      throw new Error(
        `Invalid project file: ${label}.contentPath must be stored under "${PROJECT_COMPONENT_SOURCE_DRAFTS_PREFIX}"`,
      );
    }
    if (contentPaths.has(draft.contentPath)) {
      throw new Error(
        `Invalid project file: duplicate component source draft content path "${draft.contentPath}"`,
      );
    }
    contentPaths.add(draft.contentPath);
  });
}

function assertWorkspaceActivityEntry(
  value: unknown,
  index: number,
): asserts value is WorkspaceActivityEntry {
  const label = `workspace history activity[${index}]`;
  assertRecord(value, label);
  assertExactKeys(value, ['id', 'timestamp', 'label'], [], label);
  assertNonEmptyString(value.id, `${label}.id`);
  assertNonEmptyString(value.timestamp, `${label}.timestamp`);
  assertNonEmptyString(value.label, `${label}.label`);
  if (!Number.isFinite(Date.parse(value.timestamp))) {
    throw new Error(`Invalid project file: ${label}.timestamp must be an ISO date`);
  }
}

function assertCanonicalWorkspaceAt(value: unknown, label: string): void {
  try {
    assertCanonicalWorkspace(value);
  } catch (error) {
    throw new Error(
      `Invalid project file: ${label} is not a canonical workspace: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

export function assertProjectWorkspace(value: unknown): asserts value is AssemblyState {
  assertCanonicalWorkspaceAt(value, 'workspace');
}

/** Validate a bounded single workspace timeline with no duplicated present snapshot. */
export function assertProjectWorkspaceHistory(
  value: unknown,
): asserts value is WorkspaceHistory {
  assertRecord(value, 'workspace history');
  assertExactKeys(value, ['past', 'future', 'activity'], [], 'workspace history');
  if (!Array.isArray(value.past) || !Array.isArray(value.future) || !Array.isArray(value.activity)) {
    throw new Error('Invalid project file: workspace history fields must be arrays');
  }
  if (
    value.past.length > MAX_PROJECT_HISTORY_ENTRIES
    || value.future.length > MAX_PROJECT_HISTORY_ENTRIES
  ) {
    throw new Error(
      `Invalid project file: workspace history exceeds ${MAX_PROJECT_HISTORY_ENTRIES} entries`,
    );
  }
  if (value.activity.length > MAX_PROJECT_ACTIVITY_ENTRIES) {
    throw new Error(
      `Invalid project file: workspace activity exceeds ${MAX_PROJECT_ACTIVITY_ENTRIES} entries`,
    );
  }

  value.past.forEach((workspace, index) =>
    assertCanonicalWorkspaceAt(workspace, `workspace history past[${index}]`),
  );
  value.future.forEach((workspace, index) =>
    assertCanonicalWorkspaceAt(workspace, `workspace history future[${index}]`),
  );
  value.activity.forEach(assertWorkspaceActivityEntry);
}

export const normalizeArchivePath = (inputPath: string): string => {
  const normalized = inputPath.replace(/\\/g, '/').replace(/^\/+/, '');
  const segments = normalized
    .split('/')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0 && segment !== '.' && segment !== '..');

  return segments.join('/');
};

export const buildAssetArchivePath = (logicalPath: string): string => {
  const normalized = normalizeArchivePath(logicalPath);
  return normalized ? `${ASSET_FILE_PREFIX}/${normalized}` : ASSET_FILE_PREFIX;
};

export const buildLibraryArchivePath = (logicalPath: string): string => {
  const normalized = normalizeArchivePath(logicalPath);
  return normalized ? `${LIBRARY_FILE_PREFIX}/${normalized}` : LIBRARY_FILE_PREFIX;
};

const scoreLogicalPath = (logicalPath: string): number => {
  const normalized = normalizeArchivePath(logicalPath);
  const segments = normalized ? normalized.split('/').length : 0;
  const hasExtension = /\.[a-z0-9]+$/i.test(normalized) ? 1 : 0;
  return segments * 100 + hasExtension * 10 + normalized.length;
};

export const chooseCanonicalLogicalPath = (keys: string[], fallbackName: string): string => {
  const candidates = Array.from(
    new Set(keys.map((key) => normalizeArchivePath(key)).filter(Boolean)),
  );

  if (candidates.length === 0) {
    return normalizeArchivePath(fallbackName) || fallbackName;
  }

  return candidates.sort((left, right) => {
    const scoreDelta = scoreLogicalPath(right) - scoreLogicalPath(left);
    if (scoreDelta !== 0) return scoreDelta;
    return left.localeCompare(right);
  })[0];
};

export const ensureUniqueLogicalPath = (
  logicalPath: string,
  usedPaths: Set<string>,
  fallbackBaseName: string,
): string => {
  const normalized = normalizeArchivePath(logicalPath) || normalizeArchivePath(fallbackBaseName) || 'asset';
  if (!usedPaths.has(normalized)) {
    usedPaths.add(normalized);
    return normalized;
  }

  const lastSlash = normalized.lastIndexOf('/');
  const directory = lastSlash >= 0 ? normalized.slice(0, lastSlash) : '';
  const fileName = lastSlash >= 0 ? normalized.slice(lastSlash + 1) : normalized;
  const dotIndex = fileName.lastIndexOf('.');
  const baseName = dotIndex >= 0 ? fileName.slice(0, dotIndex) : fileName;
  const extension = dotIndex >= 0 ? fileName.slice(dotIndex) : '';

  let suffix = 2;
  let candidate = normalized;
  while (usedPaths.has(candidate)) {
    const nextName = `${baseName}_${suffix}${extension}`;
    candidate = directory ? `${directory}/${nextName}` : nextName;
    suffix += 1;
  }

  usedPaths.add(candidate);
  return candidate;
};
