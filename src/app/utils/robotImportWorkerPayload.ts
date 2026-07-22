import type { ResolveRobotFileDataOptions } from '@/core/parsers/importRobotFile';
import type { RobotFile } from '@/types';
import type { ApplyEditableSourceChangeOptions } from './applyEditableSourceChange';
import type { ParseEditableRobotSourceOptions } from './parseEditableRobotSource';
import type {
  PrepareAssemblyComponentWorkerOptions,
  RobotImportWorkerContextSnapshot,
} from './robotImportWorker';

export interface PreparedRobotImportWorkerDispatch<TOptions> {
  options: TOptions;
  contextCacheKey: string | null;
  contextSnapshot: RobotImportWorkerContextSnapshot | null;
}

const objectIdentityTokens = new WeakMap<object, number>();
let nextObjectIdentityToken = 1;

function normalizeSourceLookupPath(filePath: string): string {
  return filePath.replace(/\\/g, '/').trim().replace(/^\/+/, '').split('?')[0];
}

function hasInlineSourceContent(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function getObjectIdentityToken(value: unknown): number {
  if (!value || (typeof value !== 'object' && typeof value !== 'function')) {
    return 0;
  }

  const objectValue = value as object;
  const cachedToken = objectIdentityTokens.get(objectValue);
  if (cachedToken) {
    return cachedToken;
  }

  const nextToken = nextObjectIdentityToken++;
  objectIdentityTokens.set(objectValue, nextToken);
  return nextToken;
}

function buildContextCacheKey(
  requestKind: 'resolve' | 'parse' | 'prepare',
  file: Pick<RobotFile, 'name' | 'format'>,
  refs: {
    availableFiles?: RobotFile[];
    assets?: Record<string, string>;
    allFileContents?: Record<string, string>;
  },
): string {
  return [
    requestKind,
    file.format,
    file.name,
    `files:${getObjectIdentityToken(refs.availableFiles)}`,
    `assets:${getObjectIdentityToken(refs.assets)}`,
    `text:${getObjectIdentityToken(refs.allFileContents)}`,
  ].join('|');
}

function hasContextSnapshotContent(snapshot: RobotImportWorkerContextSnapshot): boolean {
  if ((snapshot.availableFiles?.length ?? 0) > 0) {
    return true;
  }

  if (snapshot.assets && Object.keys(snapshot.assets).length > 0) {
    return true;
  }

  if (snapshot.allFileContents && Object.keys(snapshot.allFileContents).length > 0) {
    return true;
  }

  return false;
}

function filterAvailableFiles(
  files: RobotFile[] | undefined,
  allowedFormats: ReadonlySet<RobotFile['format']>,
  sourceFile: RobotFile | Pick<RobotFile, 'name' | 'format'>,
): RobotFile[] {
  if (!files || files.length === 0) {
    return [];
  }

  const filtered = files.filter((candidate) => allowedFormats.has(candidate.format));
  const alreadyIncluded = filtered.some(
    (candidate) => candidate.name === sourceFile.name && candidate.format === sourceFile.format,
  );

  if (!alreadyIncluded && allowedFormats.has(sourceFile.format as RobotFile['format'])) {
    const sourceEntry = files.find(
      (candidate) => candidate.name === sourceFile.name && candidate.format === sourceFile.format,
    );
    if (sourceEntry) {
      filtered.push(sourceEntry);
    }
  }

  return filtered;
}

function buildMissingUrdfSourceContextSnapshot(
  file: RobotFile,
  options: ResolveRobotFileDataOptions,
): RobotImportWorkerContextSnapshot | null {
  if (file.format !== 'urdf' || hasInlineSourceContent(file.content)) {
    return null;
  }

  const normalizedTargetPath = normalizeSourceLookupPath(file.name);
  if (!normalizedTargetPath) {
    return null;
  }

  const matchedAvailableFile = (options.availableFiles ?? []).find(
    (candidate) =>
      candidate.format === 'urdf' &&
      hasInlineSourceContent(candidate.content) &&
      normalizeSourceLookupPath(candidate.name) === normalizedTargetPath,
  );

  const matchedTextEntry = Object.entries(options.allFileContents ?? {}).find(
    ([path, content]) =>
      hasInlineSourceContent(content) && normalizeSourceLookupPath(path) === normalizedTargetPath,
  );

  const contextSnapshot: RobotImportWorkerContextSnapshot = {
    ...(matchedAvailableFile ? { availableFiles: [matchedAvailableFile] } : {}),
    ...(matchedTextEntry
      ? { allFileContents: { [matchedTextEntry[0]]: matchedTextEntry[1] } }
      : {}),
  };

  return hasContextSnapshotContent(contextSnapshot) ? contextSnapshot : null;
}

export function buildResolveRobotImportWorkerDispatch(
  file: RobotFile,
  options: ResolveRobotFileDataOptions = {},
): PreparedRobotImportWorkerDispatch<ResolveRobotFileDataOptions> {
  switch (file.format) {
    case 'urdf': {
      const sourceContextSnapshot = buildMissingUrdfSourceContextSnapshot(file, options);
      const contextSnapshot: RobotImportWorkerContextSnapshot = {
        ...(sourceContextSnapshot ?? {}),
        ...(options.assets && Object.keys(options.assets).length > 0
          ? { assets: options.assets }
          : {}),
        ...(options.allFileContents && Object.keys(options.allFileContents).length > 0
          ? { allFileContents: options.allFileContents }
          : {}),
      };
      const hasContext = hasContextSnapshotContent(contextSnapshot);
      return {
        options: {},
        contextCacheKey: hasContext
          ? buildContextCacheKey('resolve', file, {
              availableFiles: contextSnapshot.availableFiles,
              assets: options.assets,
              allFileContents: options.allFileContents,
            })
          : null,
        contextSnapshot: hasContext ? contextSnapshot : null,
      };
    }
    case 'mesh':
    case 'asset':
      return {
        options: {},
        contextCacheKey: null,
        contextSnapshot: null,
      };
    case 'usd':
      return {
        options: options.usdRobotData ? { usdRobotData: options.usdRobotData } : {},
        contextCacheKey: null,
        contextSnapshot: null,
      };
    case 'mjcf': {
      const contextSnapshot = {
        availableFiles: filterAvailableFiles(
          options.availableFiles,
          new Set<RobotFile['format']>(['mjcf']),
          file,
        ),
        allFileContents: options.allFileContents ?? {},
      };
      return {
        options: {},
        contextCacheKey: hasContextSnapshotContent(contextSnapshot)
          ? buildContextCacheKey('resolve', file, {
              availableFiles: options.availableFiles,
              allFileContents: options.allFileContents,
            })
          : null,
        contextSnapshot: hasContextSnapshotContent(contextSnapshot) ? contextSnapshot : null,
      };
    }
    case 'sdf': {
      // Composite Gazebo SDF models pull in sibling packages via
      // `<include><uri>model://child</uri></include>`. Those nested `.sdf`
      // files are robot files in `availableFiles` (not text files in
      // `allFileContents`), so the worker must receive them for the SDF
      // include resolver to find them. See sdfIncludeResolution.ts.
      const contextSnapshot = {
        availableFiles: filterAvailableFiles(
          options.availableFiles,
          new Set<RobotFile['format']>(['sdf']),
          file,
        ),
        allFileContents: options.allFileContents ?? {},
      };
      return {
        options: {},
        contextCacheKey: hasContextSnapshotContent(contextSnapshot)
          ? buildContextCacheKey('resolve', file, {
              availableFiles: options.availableFiles,
              allFileContents: options.allFileContents,
            })
          : null,
        contextSnapshot: hasContextSnapshotContent(contextSnapshot) ? contextSnapshot : null,
      };
    }
    case 'xacro': {
      const contextSnapshot = {
        availableFiles: filterAvailableFiles(
          options.availableFiles,
          new Set<RobotFile['format']>(['urdf', 'xacro']),
          file,
        ),
        allFileContents: options.allFileContents ?? {},
      };
      return {
        options: {},
        contextCacheKey: hasContextSnapshotContent(contextSnapshot)
          ? buildContextCacheKey('resolve', file, {
              availableFiles: options.availableFiles,
              allFileContents: options.allFileContents,
            })
          : null,
        contextSnapshot: hasContextSnapshotContent(contextSnapshot) ? contextSnapshot : null,
      };
    }
    default:
      return {
        options,
        contextCacheKey: null,
        contextSnapshot: null,
      };
  }
}

export function buildResolveRobotImportWorkerOptions(
  file: RobotFile,
  options: ResolveRobotFileDataOptions = {},
): ResolveRobotFileDataOptions {
  const preparedDispatch = buildResolveRobotImportWorkerDispatch(file, options);
  return {
    ...preparedDispatch.contextSnapshot,
    ...preparedDispatch.options,
  };
}

export function buildPrepareAssemblyComponentWorkerDispatch(
  file: RobotFile,
  options: PrepareAssemblyComponentWorkerOptions = {},
): PreparedRobotImportWorkerDispatch<PrepareAssemblyComponentWorkerOptions> {
  const preparedDispatch = buildResolveRobotImportWorkerDispatch(file, options);
  const contextSnapshot: RobotImportWorkerContextSnapshot = {
    ...(preparedDispatch.contextSnapshot ?? {}),
    ...(options.assets && Object.keys(options.assets).length > 0 ? { assets: options.assets } : {}),
  };
  const hasContext = hasContextSnapshotContent(contextSnapshot);

  return {
    options: {
      ...preparedDispatch.options,
      ...(options.assets && Object.keys(options.assets).length > 0
        ? { assets: options.assets }
        : {}),
      ...(options.allFileContents && Object.keys(options.allFileContents).length > 0
        ? { allFileContents: options.allFileContents }
        : {}),
      ...(options.availableFiles?.length ? { availableFiles: options.availableFiles } : {}),
    },
    contextCacheKey: hasContext
      ? buildContextCacheKey('prepare', file, {
          availableFiles: options.availableFiles,
          assets: options.assets,
          allFileContents: options.allFileContents,
        })
      : null,
    contextSnapshot: hasContext ? contextSnapshot : null,
  };
}

export function buildEditableRobotSourceWorkerDispatch(
  options: ParseEditableRobotSourceOptions,
): PreparedRobotImportWorkerDispatch<ParseEditableRobotSourceOptions> {
  if (!options.file) {
    return {
      options: {
        ...options,
        availableFiles: [],
        allFileContents: {},
      },
      contextCacheKey: null,
      contextSnapshot: null,
    };
  }

  switch (options.file.format) {
    case 'urdf':
      return {
        options: {
          ...options,
          availableFiles: [],
          allFileContents: {},
        },
        contextCacheKey: null,
        contextSnapshot: null,
      };
    case 'mjcf': {
      const contextSnapshot = {
        availableFiles: filterAvailableFiles(
          options.availableFiles,
          new Set<RobotFile['format']>(['mjcf']),
          options.file,
        ),
      };
      return {
        options: {
          ...options,
          availableFiles: undefined,
          allFileContents: undefined,
        },
        contextCacheKey: hasContextSnapshotContent(contextSnapshot)
          ? buildContextCacheKey('parse', options.file, {
              availableFiles: options.availableFiles,
            })
          : null,
        contextSnapshot: hasContextSnapshotContent(contextSnapshot) ? contextSnapshot : null,
      };
    }
    case 'sdf': {
      const contextSnapshot = {
        allFileContents: options.allFileContents ?? {},
      };
      return {
        options: {
          ...options,
          availableFiles: undefined,
          allFileContents: undefined,
        },
        contextCacheKey: hasContextSnapshotContent(contextSnapshot)
          ? buildContextCacheKey('parse', options.file, {
              allFileContents: options.allFileContents,
            })
          : null,
        contextSnapshot: hasContextSnapshotContent(contextSnapshot) ? contextSnapshot : null,
      };
    }
    case 'xacro': {
      const contextSnapshot = {
        availableFiles: filterAvailableFiles(
          options.availableFiles,
          new Set<RobotFile['format']>(['urdf', 'xacro']),
          options.file,
        ),
        allFileContents: options.allFileContents ?? {},
      };
      return {
        options: {
          ...options,
          availableFiles: undefined,
          allFileContents: undefined,
        },
        contextCacheKey: hasContextSnapshotContent(contextSnapshot)
          ? buildContextCacheKey('parse', options.file, {
              availableFiles: options.availableFiles,
              allFileContents: options.allFileContents,
            })
          : null,
        contextSnapshot: hasContextSnapshotContent(contextSnapshot) ? contextSnapshot : null,
      };
    }
    default:
      return {
        options: {
          ...options,
          availableFiles: [],
          allFileContents: {},
        },
        contextCacheKey: null,
        contextSnapshot: null,
      };
  }
}

export function buildEditableSourceChangeWorkerDispatch(
  options: ApplyEditableSourceChangeOptions,
): PreparedRobotImportWorkerDispatch<ApplyEditableSourceChangeOptions> {
  return buildEditableRobotSourceWorkerDispatch(
    options,
  ) as PreparedRobotImportWorkerDispatch<ApplyEditableSourceChangeOptions>;
}

export function buildEditableRobotSourceWorkerOptions(
  options: ParseEditableRobotSourceOptions,
): ParseEditableRobotSourceOptions {
  const preparedDispatch = buildEditableRobotSourceWorkerDispatch(options);
  return {
    ...preparedDispatch.options,
    availableFiles:
      preparedDispatch.contextSnapshot?.availableFiles ??
      preparedDispatch.options.availableFiles ??
      [],
    allFileContents:
      preparedDispatch.contextSnapshot?.allFileContents ??
      preparedDispatch.options.allFileContents ??
      {},
  };
}
