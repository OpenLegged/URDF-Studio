import { resolveRobotFileData } from '@/core/parsers/importRobotFile';
import { resolveImportedAssetPath } from '@/core/parsers/meshPathUtils';
import { isImageAssetPath } from '@/core/utils/assetFileTypes';
import {
  MJCF_SOURCE_FILE_SCOPE_ATTR,
  resolveMJCFSource,
} from '@/core/parsers/mjcf/mjcfSourceResolver';
import { parseMJCFXmlDocument } from '@/core/parsers/mjcf/mjcfUtils';
import { scheduleFailFastInDev } from '@/core/utils/runtimeDiagnostics';
import { pickPreferredImportFile } from '@/app/hooks/importPreferredFile';
import { extractStandaloneImportAssetReferences } from '../importPackageAssetReferences.ts';
import { buildPreResolvedImportContentSignature } from '../preResolvedImportSignature.ts';
import {
  peekPreResolvedRobotImport,
  primePreResolvedRobotImports,
} from '../preResolvedRobotImportCache.ts';
import { normalizeLibraryPathKey } from '@/shared/utils/pathKeys';
import { isVisibleLibraryEntry } from '@/shared/utils/robotFileSupport';
import { collectRobotAssetPaths } from './criticalDeferredAssets.ts';
import { processWithConcurrency, resolveImportPreparationConcurrency } from './concurrency.ts';
import { pickFastPreparedPreferredFile } from './fastPreferredFile.ts';
import { shouldMirrorTextMeshAssetContent } from './pathClassification.ts';
import type { ArchiveImportEntry, ArchiveImportSession } from '../archiveImport.ts';
import type { RobotFile } from '@/types';
import type {
  CollectedImportPayload,
  PreparedDeferredImportAssetFile,
  PreparedImportBlobFile,
  PreparedImportTextFile,
} from './payload.ts';

export const MAX_EAGER_TEXT_MESH_ASSET_BYTES = 8 * 1024 * 1024;

export function shouldSkipImportPath(path: string): boolean {
  return path.split('/').some((part) => part.startsWith('.'));
}

export function normalizeImportPath(path: string): string {
  return normalizeLibraryPathKey(path);
}

function normalizeResolvedImportAssetPath(
  assetPath: string,
  sourceFilePath?: string | null,
): string {
  return normalizeImportPath(resolveImportedAssetPath(assetPath, sourceFilePath));
}

function isObjImportPath(path: string): boolean {
  return path.toLowerCase().endsWith('.obj');
}

function isDaeImportPath(path: string): boolean {
  return path.toLowerCase().endsWith('.dae');
}

// Extract the external texture file paths a COLLADA (.dae) references from its
// <library_images>. Handles both COLLADA 1.4.x (<init_from>path</init_from>) and 1.5.0
// (<init_from><ref>file://path</ref></init_from>), and ignores image-id references found
// in sampler/surface bindings (those have no file extension).
function parseDaeTextureReferencePaths(daePath: string, content: string): string[] {
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(content, 'text/xml');
  } catch {
    return [];
  }
  if (doc.querySelector('parsererror')) {
    return [];
  }

  const texturePaths = new Set<string>();
  doc.querySelectorAll('library_images image').forEach((imageElement) => {
    const initFrom = imageElement.querySelector('init_from');
    if (!initFrom) {
      return;
    }

    const refElement = initFrom.querySelector('ref');
    const rawValue = (refElement?.textContent ?? initFrom.textContent ?? '').trim();
    if (!rawValue) {
      return;
    }

    const cleanedValue = decodeDaeImageReference(rawValue);
    // Only accept values that look like image files; this skips bare image-id references.
    if (!isImageAssetPath(cleanedValue)) {
      return;
    }

    const resolvedPath = normalizeResolvedImportAssetPath(cleanedValue, daePath);
    if (resolvedPath) {
      texturePaths.add(resolvedPath);
    }
  });

  return [...texturePaths];
}

function decodeDaeImageReference(value: string): string {
  let result = value.trim();
  if (result.toLowerCase().startsWith('file://')) {
    result = result.slice('file://'.length);
  }
  try {
    result = decodeURIComponent(result);
  } catch {
    // Keep the raw value when it is not valid percent-encoding.
  }
  return result;
}

function parseObjMaterialLibraryPaths(meshPath: string, content: string): string[] {
  const materialLibraryPaths = new Set<string>();
  const matches = content.matchAll(/^[ \t]*mtllib[ \t]+(.+)$/gim);

  for (const match of matches) {
    const rawValue = String(match[1] || '').trim();
    if (!rawValue) {
      continue;
    }

    rawValue.split(/\s+/).forEach((materialLibraryPath) => {
      const resolvedPath = normalizeResolvedImportAssetPath(materialLibraryPath, meshPath);
      if (!resolvedPath) {
        return;
      }

      materialLibraryPaths.add(resolvedPath);
    });
  }

  return [...materialLibraryPaths];
}

function parseMtlTexturePath(line: string): string | null {
  const tokens = line.trim().split(/\s+/).slice(1);
  if (tokens.length === 0) {
    return null;
  }

  for (let index = tokens.length - 1; index >= 0; index -= 1) {
    const token = tokens[index]?.trim();
    if (!token || token.startsWith('-')) {
      continue;
    }
    return token;
  }

  return null;
}

function parseMtlTextureReferencePaths(materialPath: string, content: string): string[] {
  const texturePaths = new Set<string>();

  content.split(/\r?\n/).forEach((line) => {
    if (!/^[ \t]*(?:map_|bump|disp|decal|refl)[^\s]*\b/i.test(line)) {
      return;
    }

    const texturePath = parseMtlTexturePath(line);
    if (!texturePath) {
      return;
    }

    const resolvedPath = normalizeResolvedImportAssetPath(texturePath, materialPath);
    if (resolvedPath) {
      texturePaths.add(resolvedPath);
    }
  });

  return [...texturePaths];
}

type DeferredImageAssetIndex = {
  byNormalizedName: Map<string, PreparedDeferredImportAssetFile>;
  byBasename: Map<string, PreparedDeferredImportAssetFile[]>;
};

// Index deferred image assets for texture-sidecar resolution. Unlike resolveMeshAssetUrl,
// this only ever resolves to image files, so an MTL/DAE texture reference can never be
// mismatched to a neighbouring mesh that happens to share its stem (e.g. foo.png -> foo.obj,
// which resolveMeshAssetUrl does on purpose for mesh-format fallbacks).
function indexDeferredImageAssets(
  deferredAssetFiles: readonly PreparedDeferredImportAssetFile[],
): DeferredImageAssetIndex {
  const byNormalizedName = new Map<string, PreparedDeferredImportAssetFile>();
  const byBasename = new Map<string, PreparedDeferredImportAssetFile[]>();

  for (const file of deferredAssetFiles) {
    if (!isImageAssetPath(file.name)) {
      continue;
    }

    const normalizedName = normalizeImportPath(file.name);
    if (!byNormalizedName.has(normalizedName)) {
      byNormalizedName.set(normalizedName, file);
    }

    const basename = normalizedName.split('/').pop() ?? '';
    if (!basename) {
      continue;
    }

    const existing = byBasename.get(basename);
    if (existing) {
      existing.push(file);
    } else {
      byBasename.set(basename, [file]);
    }
  }

  return { byNormalizedName, byBasename };
}

function resolveDeferredTextureAsset(
  texturePath: string,
  index: DeferredImageAssetIndex,
): PreparedDeferredImportAssetFile | null {
  const normalizedTexturePath = normalizeImportPath(texturePath);
  const exactMatch = index.byNormalizedName.get(normalizedTexturePath);
  if (exactMatch) {
    return exactMatch;
  }

  const basename = normalizedTexturePath.split('/').pop() ?? '';
  if (!basename) {
    return null;
  }

  const candidates = index.byBasename.get(basename);
  if (!candidates || candidates.length === 0) {
    return null;
  }
  if (candidates.length === 1) {
    return candidates[0] ?? null;
  }

  // Multiple images share this basename — prefer the candidate whose path shares the most
  // trailing segments with the referenced path (a full relative-path match scores highest).
  // This avoids hydrating an unrelated same-named texture from a different directory.
  let bestMatch = candidates[0] ?? null;
  let bestScore = -1;
  for (const candidate of candidates) {
    const score = countCommonTrailingPathSegments(
      normalizeImportPath(candidate.name),
      normalizedTexturePath,
    );
    if (score > bestScore) {
      bestScore = score;
      bestMatch = candidate;
    }
  }
  return bestMatch;
}

function countCommonTrailingPathSegments(left: string, right: string): number {
  const leftSegments = left.split('/');
  const rightSegments = right.split('/');
  let count = 0;
  let leftIndex = leftSegments.length - 1;
  let rightIndex = rightSegments.length - 1;
  while (
    leftIndex >= 0 &&
    rightIndex >= 0 &&
    leftSegments[leftIndex] === rightSegments[rightIndex]
  ) {
    count += 1;
    leftIndex -= 1;
    rightIndex -= 1;
  }
  return count;
}

// Collect every text-mesh (OBJ or DAE) whose material/texture sidecars should be hydrated
// during import. Unlike the earlier "preferred file only" logic, this scans the references
// of *every* URDF/SDF definition (not just the preferred one), so multi-robot bundles and
// meshes referenced by non-preferred definitions still get their materials. It deliberately
// does NOT pull in loose meshes that no definition references — the malformed-XML import
// guards rely on this — except for a direct standalone mesh import.
function collectReferencedSidecarMeshPaths(
  robotFiles: readonly RobotFile[],
  preResolvePreferredImport: boolean,
  matchesMeshExtension: (path: string) => boolean,
): Set<string> {
  const meshPaths = new Set<string>();

  for (const robotFile of robotFiles) {
    if (robotFile.format !== 'urdf' && robotFile.format !== 'sdf') {
      continue;
    }

    extractStandaloneImportAssetReferences(robotFile, {
      sourcePath: robotFile.name,
    }).forEach((assetPath) => {
      if (!matchesMeshExtension(assetPath)) {
        return;
      }

      const resolvedPath = normalizeResolvedImportAssetPath(assetPath, robotFile.name);
      if (resolvedPath) {
        meshPaths.add(resolvedPath);
      }
    });
  }

  // Direct standalone mesh import (a bare mesh with no referencing robot definition).
  const visibleRobotFiles = robotFiles.filter(isVisibleLibraryEntry);
  const preferredFile =
    preResolvePreferredImport !== false
      ? pickPreferredImportFile(visibleRobotFiles, [...robotFiles])
      : pickFastPreparedPreferredFile([...visibleRobotFiles], [...robotFiles]);
  if (preferredFile?.format === 'mesh' && matchesMeshExtension(preferredFile.name)) {
    meshPaths.add(normalizeImportPath(preferredFile.name));
  }

  return meshPaths;
}

export function collectAllObjMaterialMeshPaths(
  robotFiles: readonly RobotFile[],
  preResolvePreferredImport: boolean,
): Set<string> {
  return collectReferencedSidecarMeshPaths(robotFiles, preResolvePreferredImport, isObjImportPath);
}

export function collectAllDaeTextureMeshPaths(
  robotFiles: readonly RobotFile[],
  preResolvePreferredImport: boolean,
): Set<string> {
  return collectReferencedSidecarMeshPaths(robotFiles, preResolvePreferredImport, isDaeImportPath);
}

type MjcfScopedCompilerDirectories = {
  meshdir: string;
  hasDirectoryOverride: boolean;
};

function buildMjcfCompilerDirectoryMap(
  robotFiles: readonly RobotFile[],
): Map<string, MjcfScopedCompilerDirectories> {
  const compilerDirectoriesBySource = new Map<string, MjcfScopedCompilerDirectories>();

  robotFiles.forEach((file) => {
    if (file.format !== 'mjcf') {
      return;
    }

    const { doc } = parseMJCFXmlDocument(file.content);
    if (!doc) {
      return;
    }

    let assetdir = '';
    let meshdir: string | null = null;
    let hasDirectoryOverride = false;

    doc.querySelectorAll('compiler').forEach((compilerEl) => {
      const rawAssetdir = compilerEl.getAttribute('assetdir');
      if (rawAssetdir !== null) {
        assetdir = rawAssetdir;
        hasDirectoryOverride = true;
      }

      const rawMeshdir = compilerEl.getAttribute('meshdir');
      if (rawMeshdir !== null) {
        meshdir = rawMeshdir;
        hasDirectoryOverride = true;
      }
    });

    compilerDirectoriesBySource.set(file.name, {
      meshdir: meshdir ?? assetdir,
      hasDirectoryOverride,
    });
  });

  return compilerDirectoriesBySource;
}

function applyMjcfMeshDirectory(filePath: string, directory: string): string {
  const trimmed = filePath.trim();
  if (!trimmed || trimmed.startsWith('/') || trimmed.includes(':')) {
    return trimmed;
  }

  const normalizedDirectory = normalizeImportPath(directory);
  if (!normalizedDirectory) {
    return trimmed;
  }

  return `${normalizedDirectory}/${trimmed}`;
}

function resolveMjcfScopedSourceFilePath(element: Element, fallbackSourcePath: string): string {
  let currentElement: Element | null = element;
  while (currentElement) {
    const sourceFilePath = currentElement.getAttribute(MJCF_SOURCE_FILE_SCOPE_ATTR)?.trim();
    if (sourceFilePath) {
      return sourceFilePath;
    }
    currentElement = currentElement.parentElement;
  }

  return fallbackSourcePath;
}

function collectReferencedTextMeshPathsFromResolvedMjcfSource(
  preferredFile: RobotFile,
  robotFiles: readonly RobotFile[],
): Set<string> {
  const resolvedSource = resolveMJCFSource(preferredFile, [...robotFiles]);
  if (resolvedSource.issues.length > 0) {
    return new Set<string>();
  }

  const { doc } = parseMJCFXmlDocument(resolvedSource.validationContent);
  if (!doc) {
    return new Set<string>();
  }

  const compilerDirectoriesBySource = buildMjcfCompilerDirectoryMap(robotFiles);
  let currentAssetdir = '';
  let currentMeshdir: string | null = null;
  const referencedTextMeshPaths = new Set<string>();

  Array.from(doc.querySelectorAll('*')).forEach((element) => {
    const tagName = element.tagName.toLowerCase();
    if (tagName === 'compiler') {
      const rawAssetdir = element.getAttribute('assetdir');
      if (rawAssetdir !== null) {
        currentAssetdir = rawAssetdir;
      }

      const rawMeshdir = element.getAttribute('meshdir');
      if (rawMeshdir !== null) {
        currentMeshdir = rawMeshdir;
      }
      return;
    }

    if (tagName !== 'mesh' || element.parentElement?.tagName.toLowerCase() !== 'asset') {
      return;
    }

    const rawMeshPath = element.getAttribute('file')?.trim();
    if (!rawMeshPath) {
      return;
    }

    const sourceFilePath = resolveMjcfScopedSourceFilePath(element, preferredFile.name);
    const scopedCompilerDirectories = compilerDirectoriesBySource.get(sourceFilePath);
    const compilerMeshdir = scopedCompilerDirectories?.hasDirectoryOverride
      ? scopedCompilerDirectories.meshdir
      : (currentMeshdir ?? currentAssetdir);
    const resolvedPath = normalizeResolvedImportAssetPath(
      applyMjcfMeshDirectory(rawMeshPath, compilerMeshdir),
      sourceFilePath,
    );

    if (resolvedPath && shouldMirrorTextMeshAssetContent(resolvedPath.toLowerCase())) {
      referencedTextMeshPaths.add(resolvedPath);
    }
  });

  return referencedTextMeshPaths;
}

function canParseXmlDocumentStrict(content: string): boolean {
  try {
    const doc = new DOMParser().parseFromString(content, 'text/xml');
    return doc.querySelector('parsererror') === null;
  } catch (error) {
    scheduleFailFastInDev(
      'importPreparation:canParseXmlDocumentStrict',
      new Error('Failed to probe XML document while preparing import dependencies.', {
        cause: error,
      }),
      'error',
    );
    return false;
  }
}

function collectReferencedTextMeshPathsFromResolvedSdfImport(
  preferredFile: RobotFile,
  robotFiles: readonly RobotFile[],
): Set<string> {
  if (!canParseXmlDocumentStrict(preferredFile.content)) {
    return new Set<string>();
  }

  return collectReferencedTextMeshPathsFromResolvedImport(preferredFile, robotFiles);
}

function collectReferencedTextMeshPathsFromResolvedImport(
  preferredFile: RobotFile,
  robotFiles: readonly RobotFile[],
): Set<string> {
  const referencedTextMeshPaths = new Set<string>();
  const importResult =
    peekPreResolvedRobotImport(preferredFile) ??
    resolveRobotFileData(preferredFile, {
      availableFiles: [...robotFiles],
      allFileContents: Object.fromEntries(
        robotFiles
          .filter((file) => typeof file.content === 'string' && file.content.length > 0)
          .map((file) => [file.name, file.content]),
      ),
    });

  if (importResult.status !== 'ready') {
    return referencedTextMeshPaths;
  }

  primePreResolvedRobotImports([
    {
      fileName: preferredFile.name,
      format: preferredFile.format,
      contentSignature: buildPreResolvedImportContentSignature(preferredFile.content),
      result: importResult,
    },
  ]);

  collectRobotAssetPaths(importResult.robotData).forEach((assetPath) => {
    const normalizedPath = normalizeImportPath(assetPath);
    if (normalizedPath && shouldMirrorTextMeshAssetContent(normalizedPath.toLowerCase())) {
      referencedTextMeshPaths.add(normalizedPath);
    }
  });

  return referencedTextMeshPaths;
}

export function collectReferencedTextMeshPathsForPreferredImport(
  robotFiles: readonly RobotFile[],
  preResolvePreferredImport: boolean,
): Set<string> {
  const visibleRobotFiles = robotFiles.filter(isVisibleLibraryEntry);
  const preferredFile =
    preResolvePreferredImport !== false
      ? pickPreferredImportFile(visibleRobotFiles, [...robotFiles])
      : pickFastPreparedPreferredFile([...visibleRobotFiles], [...robotFiles]);
  if (!preferredFile || (preferredFile.format !== 'mjcf' && preferredFile.format !== 'sdf')) {
    return new Set<string>();
  }

  const referencedTextMeshPaths = new Set<string>();

  if (preferredFile.format === 'mjcf') {
    try {
      const resolvedTextMeshPaths = collectReferencedTextMeshPathsFromResolvedMjcfSource(
        preferredFile,
        robotFiles,
      );
      resolvedTextMeshPaths.forEach((path) => referencedTextMeshPaths.add(path));
    } catch (error) {
      scheduleFailFastInDev(
        'importPreparation:collectReferencedTextMeshPathsForPreferredImport',
        new Error(
          `Failed to scan resolved MJCF source "${preferredFile.name}" while collecting text-mesh dependencies.`,
          { cause: error },
        ),
        'error',
      );
    }

    return referencedTextMeshPaths;
  }

  try {
    const resolvedTextMeshPaths = collectReferencedTextMeshPathsFromResolvedSdfImport(
      preferredFile,
      robotFiles,
    );
    resolvedTextMeshPaths.forEach((path) => referencedTextMeshPaths.add(path));
  } catch (error) {
    scheduleFailFastInDev(
      'importPreparation:collectReferencedTextMeshPathsForPreferredImport',
      new Error(
        `Failed to resolve import "${preferredFile.name}" while collecting text-mesh dependencies.`,
        { cause: error },
      ),
      'error',
    );
  }

  return referencedTextMeshPaths;
}
export function collectReferencedObjMaterialPaths(
  textFiles: readonly PreparedImportTextFile[],
): Set<string> {
  const materialPaths = new Set<string>();

  textFiles.forEach((file) => {
    if (!file.path.toLowerCase().endsWith('.obj')) {
      return;
    }

    parseObjMaterialLibraryPaths(file.path, file.content).forEach((materialPath) => {
      if (materialPath.toLowerCase().endsWith('.mtl')) {
        materialPaths.add(materialPath);
      }
    });
  });

  return materialPaths;
}

export function appendPreparedImportTextFileIfMissing(
  target: PreparedImportTextFile[],
  nextFile: PreparedImportTextFile,
): void {
  const normalizedNextPath = normalizeImportPath(nextFile.path);
  if (target.some((file) => normalizeImportPath(file.path) === normalizedNextPath)) {
    return;
  }

  target.push(nextFile);
}

export function appendPreparedImportTextFilesIfMissing(
  target: PreparedImportTextFile[],
  nextFiles: readonly PreparedImportTextFile[],
): void {
  nextFiles.forEach((file) => appendPreparedImportTextFileIfMissing(target, file));
}

export function appendPreparedImportBlobFileIfMissing(
  target: PreparedImportBlobFile[],
  nextFile: PreparedImportBlobFile,
): void {
  const normalizedNextPath = normalizeImportPath(nextFile.name);
  if (target.some((file) => normalizeImportPath(file.name) === normalizedNextPath)) {
    return;
  }

  target.push(nextFile);
}

export async function appendObjMaterialSidecarsFromLooseFiles(
  payload: CollectedImportPayload,
  looseTextMeshFilesByPath: ReadonlyMap<string, File>,
  auxiliaryTextFiles: readonly { path: string; file: File }[],
  targetObjPaths: ReadonlySet<string>,
): Promise<void> {
  if (
    targetObjPaths.size === 0 ||
    looseTextMeshFilesByPath.size === 0 ||
    auxiliaryTextFiles.length === 0
  ) {
    return;
  }

  const materialFilesByPath = new Map(
    auxiliaryTextFiles.map((file) => [normalizeImportPath(file.path), file] as const),
  );
  // Resolve targets from an ungated map (not the 8 MiB-capped mirrored list) so a large OBJ
  // still gets its MTL sidecar.
  const targetedObjFiles: Array<{ path: string; file: File }> = [];
  for (const objPath of targetObjPaths) {
    const file = looseTextMeshFilesByPath.get(objPath);
    if (file) {
      targetedObjFiles.push({ path: objPath, file });
    }
  }
  if (targetedObjFiles.length === 0) {
    return;
  }

  const materialSidecars: Array<{ path: string; file: File }> = [];
  const queuedMaterialPaths = new Set<string>();

  await processWithConcurrency(
    targetedObjFiles,
    resolveImportPreparationConcurrency(),
    async ({ path, file }) => {
      const content = await file.text();
      parseObjMaterialLibraryPaths(path, content).forEach((materialPath) => {
        if (queuedMaterialPaths.has(materialPath)) {
          return;
        }

        const materialFile = materialFilesByPath.get(materialPath);
        if (!materialFile) {
          return;
        }

        queuedMaterialPaths.add(materialPath);
        materialSidecars.push(materialFile);
      });
    },
  );

  if (materialSidecars.length === 0) {
    return;
  }

  await processWithConcurrency(
    materialSidecars,
    resolveImportPreparationConcurrency(),
    async ({ path, file }) => {
      const content = await file.text();
      appendPreparedImportTextFileIfMissing(payload.textFiles, { path, content });
      appendPreparedImportBlobFileIfMissing(payload.assetFiles, { name: path, blob: file });
      // The textures an MTL references are images, which loose imports already keep eagerly
      // (every isRobotImportAssetPath blob is pushed to assetFiles), so no extra hydration
      // is needed here — only archive imports (deferred assets) need explicit texture pickup.
    },
  );
}

type ArchiveSidecarContext = {
  archiveSession: ArchiveImportSession;
  auxiliaryTextEntries: readonly ArchiveImportEntry[];
  concurrency: number;
};

async function appendObjMaterialSidecarsFromArchiveEntries(
  payload: CollectedImportPayload,
  context: ArchiveSidecarContext,
  targetObjPaths: ReadonlySet<string>,
): Promise<void> {
  const { archiveSession, auxiliaryTextEntries, concurrency } = context;
  if (targetObjPaths.size === 0 || auxiliaryTextEntries.length === 0) {
    return;
  }

  const materialEntriesByPath = new Map(
    auxiliaryTextEntries.map((entry) => [normalizeImportPath(entry.path), entry] as const),
  );
  const deferredImageAssetIndex = indexDeferredImageAssets(payload.deferredAssetFiles);
  const deferredAssetFilesBySourcePath = new Map(
    payload.deferredAssetFiles.map((file) => [normalizeImportPath(file.sourcePath), file] as const),
  );
  // Scan all archive entries, not the 8 MiB-capped mirrored list, so large referenced OBJs
  // still get their MTL sidecars hydrated. targetObjPaths already limits this to OBJs a
  // robot definition actually references.
  const targetedObjEntries = archiveSession.entries.filter(
    (entry) => isObjImportPath(entry.path) && targetObjPaths.has(normalizeImportPath(entry.path)),
  );
  if (targetedObjEntries.length === 0) {
    return;
  }

  const extractedObjEntries = await archiveSession.extractEntries(
    targetedObjEntries.map((entry) => entry.path),
  );
  const materialPaths = new Set<string>();

  await processWithConcurrency(extractedObjEntries, concurrency, async ({ path, file }) => {
    const content = await file.text();
    parseObjMaterialLibraryPaths(path, content).forEach((materialPath) => {
      if (materialEntriesByPath.has(materialPath)) {
        materialPaths.add(materialPath);
      }
    });
  });

  if (materialPaths.size === 0) {
    return;
  }

  const materialEntries = [...materialPaths]
    .sort((left, right) => left.localeCompare(right))
    .map((materialPath) => materialEntriesByPath.get(materialPath))
    .filter((entry): entry is ArchiveImportEntry => Boolean(entry));
  if (materialEntries.length === 0) {
    return;
  }

  const extractedMaterialEntries = await archiveSession.extractEntries(
    materialEntries.map((entry) => entry.path),
  );
  const textureSourcePaths = new Set<string>();

  await processWithConcurrency(extractedMaterialEntries, concurrency, async ({ path, file }) => {
    const content = await file.text();
    appendPreparedImportTextFileIfMissing(payload.textFiles, {
      path,
      content,
    });
    appendPreparedImportBlobFileIfMissing(payload.assetFiles, {
      name: path,
      blob: file,
    });

    parseMtlTextureReferencePaths(path, content).forEach((texturePath) => {
      const assetFile = resolveDeferredTextureAsset(texturePath, deferredImageAssetIndex);
      if (assetFile) {
        textureSourcePaths.add(assetFile.sourcePath);
      }
    });
  });

  if (textureSourcePaths.size === 0) {
    return;
  }

  const extractedTextureEntries = await archiveSession.extractEntries([...textureSourcePaths]);
  await processWithConcurrency(extractedTextureEntries, concurrency, async ({ path, file }) => {
    const assetFile = deferredAssetFilesBySourcePath.get(normalizeImportPath(path));
    appendPreparedImportBlobFileIfMissing(payload.assetFiles, {
      name: assetFile?.name ?? path,
      blob: file,
    });
  });
}

// Collect the external textures a DAE references (archive import). Archive assets are
// deferred, so a DAE's textures would otherwise be dropped unless independently critical.
async function appendDaeTextureSidecarsFromArchiveEntries(
  payload: CollectedImportPayload,
  context: ArchiveSidecarContext,
  targetDaePaths: ReadonlySet<string>,
): Promise<void> {
  const { archiveSession, concurrency } = context;
  if (targetDaePaths.size === 0) {
    return;
  }

  // Scan all archive entries (not the 8 MiB-capped mirrored list) so large referenced DAEs
  // still get their external textures hydrated.
  const targetedDaeEntries = archiveSession.entries.filter(
    (entry) => isDaeImportPath(entry.path) && targetDaePaths.has(normalizeImportPath(entry.path)),
  );
  if (targetedDaeEntries.length === 0) {
    return;
  }

  const deferredImageAssetIndex = indexDeferredImageAssets(payload.deferredAssetFiles);
  const deferredAssetFilesBySourcePath = new Map(
    payload.deferredAssetFiles.map((file) => [normalizeImportPath(file.sourcePath), file] as const),
  );

  const extractedDaeEntries = await archiveSession.extractEntries(
    targetedDaeEntries.map((entry) => entry.path),
  );
  const textureSourcePaths = new Set<string>();

  await processWithConcurrency(extractedDaeEntries, concurrency, async ({ path, file }) => {
    const content = await file.text();
    parseDaeTextureReferencePaths(path, content).forEach((texturePath) => {
      const assetFile = resolveDeferredTextureAsset(texturePath, deferredImageAssetIndex);
      if (assetFile) {
        textureSourcePaths.add(assetFile.sourcePath);
      }
    });
  });

  if (textureSourcePaths.size === 0) {
    return;
  }

  const extractedTextureEntries = await archiveSession.extractEntries([...textureSourcePaths]);
  await processWithConcurrency(extractedTextureEntries, concurrency, async ({ path, file }) => {
    const assetFile = deferredAssetFilesBySourcePath.get(normalizeImportPath(path));
    appendPreparedImportBlobFileIfMissing(payload.assetFiles, {
      name: assetFile?.name ?? path,
      blob: file,
    });
  });
}

interface AppendArchiveSidecarsOptions {
  payload: CollectedImportPayload;
  archiveSession: ArchiveImportSession;
  auxiliaryTextEntries: readonly ArchiveImportEntry[];
  concurrency: number;
  objMaterialMeshPaths: ReadonlySet<string>;
  daeTextureMeshPaths: ReadonlySet<string>;
}

export async function appendArchiveSidecars({
  payload,
  archiveSession,
  auxiliaryTextEntries,
  concurrency,
  objMaterialMeshPaths,
  daeTextureMeshPaths,
}: AppendArchiveSidecarsOptions): Promise<void> {
  const context: ArchiveSidecarContext = {
    archiveSession,
    auxiliaryTextEntries,
    concurrency,
  };
  await appendObjMaterialSidecarsFromArchiveEntries(payload, context, objMaterialMeshPaths);
  await appendDaeTextureSidecarsFromArchiveEntries(payload, context, daeTextureMeshPaths);
}
