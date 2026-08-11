import { GeometryType, type RobotFile } from '@/types';
import { type RobotImportResult, resolveRobotFileData } from '@/core/parsers';
import { pickPreferredUsdRootFile } from '@/core/parsers/usd/usdFormatUtils';
import { getVisualGeometryEntries } from '@/core/robot';
import { logRuntimeFailure, scheduleFailFastInDev } from '@/core/utils/runtimeDiagnostics';
import { isAssetLibraryOnlyFormat } from '@/shared/utils/robotFileSupport';
import {
  buildStandaloneImportAssetWarning,
  collectStandaloneImportSupportAssetPaths,
} from '@/app/utils/importPackageAssetReferences.ts';

const PACKAGE_REFERENCE_PATTERN = /package:\/\/([^/\s"'<>]+)/g;

function normalizeImportPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\/+/, '');
}

function normalizePackageRootIdentity(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function collectReferencedPackageNames(content: string): string[] {
  const packageNames = new Set<string>();

  for (const match of content.matchAll(PACKAGE_REFERENCE_PATTERN)) {
    const packageName = match[1]?.trim();
    if (packageName) {
      packageNames.add(packageName);
    }
  }

  return [...packageNames];
}

function hasImportedPackageRoot(packageName: string, filePool: RobotFile[]): boolean {
  const normalizedPackageName = packageName.trim().toLowerCase();
  const normalizedPackageIdentity = normalizePackageRootIdentity(packageName);
  if (!normalizedPackageName) return false;

  return filePool.some((file) => {
    const normalizedPath = normalizeImportPath(file.name).toLowerCase();
    if (
      normalizedPath === normalizedPackageName ||
      normalizedPath.startsWith(`${normalizedPackageName}/`) ||
      normalizedPath.includes(`/${normalizedPackageName}/`)
    ) {
      return true;
    }

    if (!normalizedPackageIdentity) {
      return false;
    }

    return normalizedPath
      .split('/')
      .some((segment) => normalizePackageRootIdentity(segment) === normalizedPackageIdentity);
  });
}

export function isUrdfSelfContainedInImportBundle(
  file: RobotFile,
  filePool: RobotFile[] = [],
): boolean {
  if (file.format !== 'urdf') return false;

  const standaloneAssetWarning = buildStandaloneImportAssetWarning(
    file,
    collectStandaloneImportSupportAssetPaths({}, filePool),
  );
  if (standaloneAssetWarning) {
    return false;
  }

  const referencedPackages = collectReferencedPackageNames(file.content);
  if (referencedPackages.length === 0) return true;

  return referencedPackages.every((packageName) => hasImportedPackageRoot(packageName, filePool));
}

function parseMjcfDocument(content: string): Document | null {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(content, 'text/xml');
    return doc.querySelector('parsererror') ? null : doc;
  } catch (error) {
    scheduleFailFastInDev(
      'importPreferredFile:parseMjcfDocument',
      new Error('Failed to parse MJCF candidate document while ranking import preference.', {
        cause: error,
      }),
      'warn',
    );
    return null;
  }
}

type MjcfCandidateStructure = {
  directBodyCount: number;
  actuatorCount: number;
  attachCount: number;
  includeCount: number;
  assetModelCount: number;
  sceneHelperCount: number;
};

type ResolvedRobotRichness = {
  renderableLinkCount: number;
  visualGeometryCount: number;
  collisionGeometryCount: number;
  meshGeometryCount: number;
};

type RankedUrdfCandidate = {
  file: RobotFile;
  selfContained: boolean;
  identityAffinity: number;
  variantPenalty: number;
};

type RobotImportResolver = (file: RobotFile) => RobotImportResult;

function memoizeRobotImportResolver(resolveRobotImport: RobotImportResolver): RobotImportResolver {
  const cache = new WeakMap<RobotFile, RobotImportResult>();

  return (file: RobotFile): RobotImportResult => {
    const cachedResult = cache.get(file);
    if (cachedResult) {
      return cachedResult;
    }

    const resolvedResult = resolveRobotImport(file);
    cache.set(file, resolvedResult);
    return resolvedResult;
  };
}

export function createMemoizedRobotImportResolver(filePool: RobotFile[]): RobotImportResolver {
  return memoizeRobotImportResolver((file) =>
    resolveRobotFileData(file, { availableFiles: filePool }),
  );
}

function collectMjcfCandidateStructure(content: string): MjcfCandidateStructure {
  const doc = parseMjcfDocument(content);
  const mujocoEl = doc?.querySelector('mujoco');
  const worldbodyEl = mujocoEl?.querySelector(':scope > worldbody');

  return {
    directBodyCount: worldbodyEl?.querySelectorAll(':scope > body').length ?? 0,
    actuatorCount: mujocoEl?.querySelectorAll(':scope > actuator > *').length ?? 0,
    attachCount: mujocoEl?.querySelectorAll('attach[model]').length ?? 0,
    includeCount: mujocoEl?.querySelectorAll(':scope > include[file]').length ?? 0,
    assetModelCount: mujocoEl?.querySelectorAll(':scope > asset > model[file]').length ?? 0,
    sceneHelperCount:
      (worldbodyEl?.querySelectorAll(':scope > geom').length ?? 0) +
      (worldbodyEl?.querySelectorAll(':scope > light').length ?? 0) +
      (worldbodyEl?.querySelectorAll(':scope > camera').length ?? 0),
  };
}

function compareMjcfCandidateStructure(
  left: MjcfCandidateStructure,
  right: MjcfCandidateStructure,
): number {
  if (left.actuatorCount !== right.actuatorCount) {
    return right.actuatorCount - left.actuatorCount;
  }

  if (left.attachCount !== right.attachCount) {
    return right.attachCount - left.attachCount;
  }

  // Prefer standalone robot entrypoints over wrapper scenes before comparing
  // body counts. MJCF scene files often add table/object helpers plus a top-
  // level <include>, which would otherwise outrank the actual robot XML.
  if (left.includeCount !== right.includeCount) {
    return left.includeCount - right.includeCount;
  }

  if (left.assetModelCount !== right.assetModelCount) {
    return left.assetModelCount - right.assetModelCount;
  }

  if (left.sceneHelperCount !== right.sceneHelperCount) {
    return left.sceneHelperCount - right.sceneHelperCount;
  }

  if (left.directBodyCount !== right.directBodyCount) {
    return right.directBodyCount - left.directBodyCount;
  }

  return 0;
}

function summarizeResolvedRobotRichness(
  file: RobotFile,
  resolveRobotImport: RobotImportResolver,
): ResolvedRobotRichness | null {
  const resolved = resolveRobotImport(file);
  if (resolved.status !== 'ready') {
    return null;
  }

  let renderableLinkCount = 0;
  let visualGeometryCount = 0;
  let collisionGeometryCount = 0;
  let meshGeometryCount = 0;

  Object.values(resolved.robotData.links).forEach((link) => {
    let linkHasRenderableGeometry = false;

    getVisualGeometryEntries(link).forEach((entry) => {
      visualGeometryCount += 1;
      linkHasRenderableGeometry = true;
      if (entry.geometry.type === GeometryType.MESH) {
        meshGeometryCount += 1;
      }
    });

    if (link.collision.type !== GeometryType.NONE) {
      collisionGeometryCount += 1;
      linkHasRenderableGeometry = true;
      if (link.collision.type === GeometryType.MESH) {
        meshGeometryCount += 1;
      }
    }

    (link.collisionBodies || []).forEach((body) => {
      if (body.type === GeometryType.NONE) {
        return;
      }

      collisionGeometryCount += 1;
      linkHasRenderableGeometry = true;
      if (body.type === GeometryType.MESH) {
        meshGeometryCount += 1;
      }
    });

    if (linkHasRenderableGeometry) {
      renderableLinkCount += 1;
    }
  });

  return {
    renderableLinkCount,
    visualGeometryCount,
    collisionGeometryCount,
    meshGeometryCount,
  };
}

function compareResolvedRobotRichness(
  left: ResolvedRobotRichness | null,
  right: ResolvedRobotRichness | null,
): number {
  const leftRenderableLinkCount = left?.renderableLinkCount ?? -1;
  const rightRenderableLinkCount = right?.renderableLinkCount ?? -1;
  if (leftRenderableLinkCount !== rightRenderableLinkCount) {
    return rightRenderableLinkCount - leftRenderableLinkCount;
  }

  const leftVisualGeometryCount = left?.visualGeometryCount ?? -1;
  const rightVisualGeometryCount = right?.visualGeometryCount ?? -1;
  if (leftVisualGeometryCount !== rightVisualGeometryCount) {
    return rightVisualGeometryCount - leftVisualGeometryCount;
  }

  const leftMeshGeometryCount = left?.meshGeometryCount ?? -1;
  const rightMeshGeometryCount = right?.meshGeometryCount ?? -1;
  if (leftMeshGeometryCount !== rightMeshGeometryCount) {
    return rightMeshGeometryCount - leftMeshGeometryCount;
  }

  const leftCollisionGeometryCount = left?.collisionGeometryCount ?? -1;
  const rightCollisionGeometryCount = right?.collisionGeometryCount ?? -1;
  return rightCollisionGeometryCount - leftCollisionGeometryCount;
}

function compareImportFileNamePreference(leftName: string, rightName: string): number {
  const leftBase = leftName.split('/').pop() ?? leftName;
  const rightBase = rightName.split('/').pop() ?? rightName;

  if (leftBase.length !== rightBase.length) {
    return leftBase.length - rightBase.length;
  }

  return leftName.localeCompare(rightName);
}

const URDF_VARIANT_PENALTY_BY_TOKEN = new Map<string, number>([
  ['with', 2],
  ['hand', 8],
  ['gripper', 8],
  ['ftp', 10],
  ['dfq', 10],
  ['dual', 8],
  ['arm', 4],
  ['mode', 7],
  ['lock', 6],
  ['waist', 4],
  ['sensor', 3],
  ['camera', 3],
  ['comp', 5],
  ['debug', 6],
  ['test', 6],
]);

function tokenizeImportIdentity(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function scoreUrdfVariantPenalty(fileName: string): number {
  const tokens = tokenizeImportIdentity(getImportFileStem(fileName));
  const tokenSet = new Set(tokens);

  let penalty = 0;
  tokens.forEach((token) => {
    penalty += URDF_VARIANT_PENALTY_BY_TOKEN.get(token) ?? 0;
  });

  if (tokenSet.has('with') && (tokenSet.has('hand') || tokenSet.has('gripper'))) {
    penalty += 6;
  }

  if (tokenSet.has('dual') && tokenSet.has('arm')) {
    penalty += 6;
  }

  if (tokenSet.has('lock') && tokenSet.has('waist')) {
    penalty += 4;
  }

  if (tokenSet.has('ftp') || tokenSet.has('dfq')) {
    penalty += 8;
  }

  return penalty;
}

function getImportFileStem(fileName: string): string {
  const baseName = fileName.split('/').pop() ?? fileName;
  const lastDotIndex = baseName.lastIndexOf('.');
  return (lastDotIndex >= 0 ? baseName.slice(0, lastDotIndex) : baseName).toLowerCase();
}

function scoreUrdfIdentityAffinity(file: RobotFile, filePool: RobotFile[]): number {
  const packageTokens = new Set(
    filePool
      .filter((entry) => entry.format === 'urdf' || entry.format === 'xacro')
      .flatMap((entry) => collectReferencedPackageNames(entry.content))
      .flatMap((packageName) => tokenizeImportIdentity(packageName)),
  );

  if (packageTokens.size === 0) {
    return 0;
  }

  const fileTokens = new Set(tokenizeImportIdentity(getImportFileStem(file.name)));
  let score = 0;
  fileTokens.forEach((token) => {
    if (packageTokens.has(token)) {
      score += 1;
    }
  });

  return score;
}

function isDerivedVariantUrdfForMjcf(urdfFile: RobotFile, mjcfFile: RobotFile): boolean {
  const urdfStem = getImportFileStem(urdfFile.name);
  const mjcfStem = getImportFileStem(mjcfFile.name);

  if (!urdfStem || !mjcfStem || urdfStem === mjcfStem) {
    return false;
  }

  return urdfStem.startsWith(`${mjcfStem}_`) || urdfStem.startsWith(`${mjcfStem}-`);
}

function hasDofQualifiedImportStem(file: RobotFile): boolean {
  return tokenizeImportIdentity(getImportFileStem(file.name)).some((token) => /^\d+dof$/.test(token));
}

function isAccessoryVariantForDofQualifiedBaseFile(
  variantFile: RobotFile,
  baseFile: RobotFile,
): boolean {
  if (!hasDofQualifiedImportStem(baseFile)) {
    return false;
  }

  const variantStem = getImportFileStem(variantFile.name);
  const baseStem = getImportFileStem(baseFile.name);
  if (
    !variantStem ||
    !baseStem ||
    (!variantStem.startsWith(`${baseStem}_`) && !variantStem.startsWith(`${baseStem}-`))
  ) {
    return false;
  }

  return scoreUrdfVariantPenalty(variantFile.name) > scoreUrdfVariantPenalty(baseFile.name);
}

function compareRankedUrdfCandidates(
  left: RankedUrdfCandidate,
  right: RankedUrdfCandidate,
): number {
  if (left.selfContained !== right.selfContained) {
    return Number(right.selfContained) - Number(left.selfContained);
  }

  if (left.variantPenalty !== right.variantPenalty) {
    return left.variantPenalty - right.variantPenalty;
  }

  if (left.identityAffinity !== right.identityAffinity) {
    return right.identityAffinity - left.identityAffinity;
  }

  return compareImportFileNamePreference(left.file.name, right.file.name);
}

function createRankedUrdfCandidateTierKey(candidate: RankedUrdfCandidate): string {
  return `${Number(candidate.selfContained)}:${candidate.variantPenalty}:${candidate.identityAffinity}`;
}

function createImportCandidateResolutionError(
  candidate: RobotFile,
  context: string,
  cause: unknown,
): Error {
  return new Error(`${context} "${candidate.name}" while ranking import candidates.`, { cause });
}

function resolveBestReadyUrdfCandidateFromTier(
  tierCandidates: RankedUrdfCandidate[],
  resolveRobotImport: RobotImportResolver,
): RobotFile | null {
  let bestFile: RobotFile | null = null;
  let bestRichness: ResolvedRobotRichness | null = null;

  for (const candidate of tierCandidates) {
    try {
      const richness = summarizeResolvedRobotRichness(candidate.file, resolveRobotImport);
      if (!richness) {
        continue;
      }

      if (!bestFile) {
        bestFile = candidate.file;
        bestRichness = richness;
        continue;
      }

      const richnessComparison = compareResolvedRobotRichness(richness, bestRichness);
      if (richnessComparison > 0) {
        continue;
      }

      if (
        richnessComparison < 0 ||
        compareImportFileNamePreference(candidate.file.name, bestFile.name) < 0
      ) {
        bestFile = candidate.file;
        bestRichness = richness;
      }
    } catch (error) {
      const resolutionError = createImportCandidateResolutionError(
        candidate.file,
        'Failed to evaluate URDF import candidate',
        error,
      );
      logRuntimeFailure(
        'importPreferredFile:resolveBestReadyUrdfCandidateFromTier',
        resolutionError,
        'error',
      );
      throw resolutionError;
    }
  }

  return bestFile;
}

function pickPreferredUrdfImportFile(
  files: RobotFile[],
  filePool: RobotFile[] = files,
  resolveRobotImport: RobotImportResolver = createMemoizedRobotImportResolver(filePool),
): RobotFile | null {
  const cachedResolveRobotImport = memoizeRobotImportResolver(resolveRobotImport);
  const urdfFiles = files.filter((file) => file.format === 'urdf');
  if (urdfFiles.length === 0) {
    return null;
  }

  const rankedCandidates: RankedUrdfCandidate[] = urdfFiles.map((file) => ({
    file,
    selfContained: isUrdfSelfContainedInImportBundle(file, filePool),
    identityAffinity: scoreUrdfIdentityAffinity(file, filePool),
    variantPenalty: scoreUrdfVariantPenalty(file.name),
  }));

  rankedCandidates.sort(compareRankedUrdfCandidates);

  let currentTierKey: string | null = null;
  let currentTierCandidates: RankedUrdfCandidate[] = [];

  const flushCurrentTier = (): RobotFile | null => {
    if (currentTierCandidates.length === 0) {
      return null;
    }

    const bestCandidate = resolveBestReadyUrdfCandidateFromTier(
      currentTierCandidates,
      cachedResolveRobotImport,
    );
    currentTierCandidates = [];
    return bestCandidate;
  };

  for (const candidate of rankedCandidates) {
    const nextTierKey = createRankedUrdfCandidateTierKey(candidate);
    if (currentTierKey !== null && nextTierKey !== currentTierKey) {
      const bestTierCandidate = flushCurrentTier();
      if (bestTierCandidate) {
        return bestTierCandidate;
      }
    }

    currentTierKey = nextTierKey;
    currentTierCandidates.push(candidate);
  }

  const trailingTierCandidate = flushCurrentTier();
  if (trailingTierCandidate) {
    return trailingTierCandidate;
  }

  return rankedCandidates[0]?.file ?? urdfFiles[0] ?? null;
}

function isMateriallyRicherRobotCandidate(
  candidate: ResolvedRobotRichness | null,
  baseline: ResolvedRobotRichness | null,
): boolean {
  if (!candidate || !baseline) {
    return false;
  }

  if (
    candidate.renderableLinkCount > baseline.renderableLinkCount &&
    candidate.visualGeometryCount > baseline.visualGeometryCount
  ) {
    return true;
  }

  if (
    candidate.meshGeometryCount > baseline.meshGeometryCount &&
    candidate.renderableLinkCount >= baseline.renderableLinkCount
  ) {
    return true;
  }

  if (candidate.visualGeometryCount >= baseline.visualGeometryCount + 3) {
    return true;
  }

  return false;
}

const SUBSTANTIAL_MJCF_SCENE_DIRECT_BODY_COUNT = 8;
const SUBSTANTIAL_MJCF_SCENE_HELPER_COUNT = 8;
const SUBSTANTIAL_MJCF_SCENE_VISUAL_GEOMETRY_DELTA = 8;

type RankedMjcfCandidate = {
  file: RobotFile;
  structure: MjcfCandidateStructure;
};

type ReadyMjcfCandidate = RankedMjcfCandidate & {
  richness: ResolvedRobotRichness;
};

type MjcfCandidateSelectionOptions = {
  files: RobotFile[];
  resolveRobotImport: RobotImportResolver;
  mode: 'robot-definition' | 'scene';
};

function hasSubstantialMjcfSceneStructure(structure: MjcfCandidateStructure): boolean {
  return (
    structure.includeCount > 0 &&
    (structure.directBodyCount >= SUBSTANTIAL_MJCF_SCENE_DIRECT_BODY_COUNT ||
      structure.sceneHelperCount >= SUBSTANTIAL_MJCF_SCENE_HELPER_COUNT)
  );
}

function isMateriallyRicherMjcfSceneCandidate(
  candidate: ReadyMjcfCandidate,
  baseline: ReadyMjcfCandidate,
): boolean {
  if (!hasSubstantialMjcfSceneStructure(candidate.structure)) {
    return false;
  }

  if (
    candidate.richness.visualGeometryCount >=
    baseline.richness.visualGeometryCount + SUBSTANTIAL_MJCF_SCENE_VISUAL_GEOMETRY_DELTA
  ) {
    return true;
  }

  return (
    candidate.richness.renderableLinkCount >=
      baseline.richness.renderableLinkCount + SUBSTANTIAL_MJCF_SCENE_DIRECT_BODY_COUNT &&
    candidate.richness.visualGeometryCount > baseline.richness.visualGeometryCount
  );
}

function compareReadyMjcfSceneRichness(
  left: ReadyMjcfCandidate,
  right: ReadyMjcfCandidate,
): number {
  if (left.richness.visualGeometryCount !== right.richness.visualGeometryCount) {
    return right.richness.visualGeometryCount - left.richness.visualGeometryCount;
  }

  if (left.richness.renderableLinkCount !== right.richness.renderableLinkCount) {
    return right.richness.renderableLinkCount - left.richness.renderableLinkCount;
  }

  if (left.richness.meshGeometryCount !== right.richness.meshGeometryCount) {
    return right.richness.meshGeometryCount - left.richness.meshGeometryCount;
  }

  return left.file.name.localeCompare(right.file.name);
}

function hasComparableRobotGeometry(
  candidate: ResolvedRobotRichness | null,
  baseline: ResolvedRobotRichness | null,
): boolean {
  if (!candidate || !baseline) {
    return false;
  }

  return (
    candidate.visualGeometryCount >= baseline.visualGeometryCount &&
    candidate.meshGeometryCount >= baseline.meshGeometryCount &&
    candidate.collisionGeometryCount >= baseline.collisionGeometryCount
  );
}

function shouldEvaluateMjcfCandidateAfterReadyCandidate(candidate: RankedMjcfCandidate): boolean {
  return hasSubstantialMjcfSceneStructure(candidate.structure);
}

function pickPreferredMjcfCandidate({
  files,
  resolveRobotImport,
  mode,
}: MjcfCandidateSelectionOptions): RobotFile | null {
  const cachedResolveRobotImport = memoizeRobotImportResolver(resolveRobotImport);
  const mjcfFiles = files.filter((file) => file.format === 'mjcf');
  if (mjcfFiles.length === 0) return null;

  const rankedCandidates: RankedMjcfCandidate[] = mjcfFiles.map((candidate) => ({
    file: candidate,
    structure: collectMjcfCandidateStructure(candidate.content),
  }));

  rankedCandidates.sort((left, right) => {
    const structureComparison = compareMjcfCandidateStructure(left.structure, right.structure);
    if (structureComparison !== 0) {
      return structureComparison;
    }

    const leftBase = left.file.name.split('/').pop() ?? left.file.name;
    const rightBase = right.file.name.split('/').pop() ?? right.file.name;
    if (leftBase.length !== rightBase.length) {
      return leftBase.length - rightBase.length;
    }

    return leftBase.localeCompare(rightBase);
  });

  let firstReadyCandidate: ReadyMjcfCandidate | null = null;
  const readyCandidates: ReadyMjcfCandidate[] = [];

  for (const candidate of rankedCandidates) {
    if (firstReadyCandidate && !shouldEvaluateMjcfCandidateAfterReadyCandidate(candidate)) {
      continue;
    }

    try {
      const richness = summarizeResolvedRobotRichness(candidate.file, cachedResolveRobotImport);
      if (richness) {
        const readyCandidate = {
          ...candidate,
          richness,
        };
        firstReadyCandidate ??= readyCandidate;
        readyCandidates.push(readyCandidate);
        if (mode === 'robot-definition') {
          break;
        }
      }
    } catch (error) {
      if (firstReadyCandidate) {
        continue;
      }

      const resolutionError = createImportCandidateResolutionError(
        candidate.file,
        'Failed to evaluate MJCF import candidate',
        error,
      );
      logRuntimeFailure(
        'importPreferredFile:pickPreferredMjcfImportFile',
        resolutionError,
        'error',
      );
      throw resolutionError;
    }
  }

  if (!firstReadyCandidate) {
    return null;
  }

  if (mode === 'robot-definition') {
    return firstReadyCandidate.file;
  }

  const substantialSceneCandidate = readyCandidates
    .filter((candidate) => isMateriallyRicherMjcfSceneCandidate(candidate, firstReadyCandidate))
    .sort(compareReadyMjcfSceneRichness)[0];

  return substantialSceneCandidate?.file ?? firstReadyCandidate.file;
}

export function pickPreferredMjcfImportFile(
  files: RobotFile[],
  filePool: RobotFile[] = files,
  resolveRobotImport: RobotImportResolver = createMemoizedRobotImportResolver(filePool),
): RobotFile | null {
  return pickPreferredMjcfCandidate({
    files,
    resolveRobotImport,
    mode: 'scene',
  });
}

export function pickPreferredImportFile(
  files: RobotFile[],
  filePool: RobotFile[] = files,
  resolveRobotImport: RobotImportResolver = createMemoizedRobotImportResolver(filePool),
): RobotFile | null {
  const cachedResolveRobotImport = memoizeRobotImportResolver(resolveRobotImport);
  const robotDefinitionFiles = files.filter((file) => !isAssetLibraryOnlyFormat(file.format));
  const preferredUrdf = pickPreferredUrdfImportFile(
    robotDefinitionFiles,
    filePool,
    cachedResolveRobotImport,
  );
  // When URDF and MJCF coexist, compare robot definitions across formats. A
  // richer MJCF environment wrapper may still be the best entrypoint for a
  // pure MJCF folder, but it should not replace the source robot model merely
  // because it adds terrain or obstacle geometry around that model.
  const preferredMjcf = pickPreferredMjcfCandidate({
    files: robotDefinitionFiles,
    resolveRobotImport: cachedResolveRobotImport,
    mode: preferredUrdf ? 'robot-definition' : 'scene',
  });
  const preferredUrdfIsSelfContained = preferredUrdf
    ? isUrdfSelfContainedInImportBundle(preferredUrdf, filePool)
    : false;

  const preferredUrdfRichness =
    preferredUrdf && preferredMjcf && preferredUrdfIsSelfContained
      ? summarizeResolvedRobotRichness(preferredUrdf, cachedResolveRobotImport)
      : null;
  const preferredMjcfRichness =
    preferredUrdf && preferredMjcf && preferredUrdfIsSelfContained
      ? summarizeResolvedRobotRichness(preferredMjcf, cachedResolveRobotImport)
      : null;
  const preferredMjcfIsAccessoryVariantOfDofBase =
    preferredUrdf !== null &&
    preferredMjcf !== null &&
    isAccessoryVariantForDofQualifiedBaseFile(preferredMjcf, preferredUrdf);

  const shouldPreferMjcfOverUrdf =
    preferredUrdf !== null &&
    preferredMjcf !== null &&
    (!preferredUrdfIsSelfContained ||
      (!preferredMjcfIsAccessoryVariantOfDofBase &&
        isMateriallyRicherRobotCandidate(preferredMjcfRichness, preferredUrdfRichness)) ||
      (preferredUrdfRichness !== null &&
        preferredMjcfRichness !== null &&
        isDerivedVariantUrdfForMjcf(preferredUrdf, preferredMjcf) &&
        hasComparableRobotGeometry(preferredMjcfRichness, preferredUrdfRichness)));

  if (shouldPreferMjcfOverUrdf && preferredMjcf) {
    return preferredMjcf;
  }

  if (preferredUrdf) {
    return preferredUrdf;
  }

  if (preferredMjcf) {
    return preferredMjcf;
  }

  const preferredUsd = pickPreferredUsdRootFile(robotDefinitionFiles);
  if (preferredUsd) {
    return preferredUsd;
  }

  return robotDefinitionFiles[0] || files[0] || null;
}
