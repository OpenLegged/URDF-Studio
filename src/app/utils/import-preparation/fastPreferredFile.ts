import { isStandaloneXacroEntry } from '@/core/parsers/importRobotFile';
import { pickPreferredUsdRootFile } from '@/core/parsers/usd/usdFormatUtils';
import { isSourceOnlyMJCFDocument } from '@/core/parsers/mjcf/mjcfXml';
import { isAssetLibraryOnlyFormat, isVisibleLibraryEntry } from '@/shared/utils/robotFileSupport';
import { normalizeLibraryPathKey } from '@/core/utils/pathKeys';
import {
  isUrdfSelfContainedInImportBundle,
  pickPreferredImportFile,
  pickPreferredMjcfImportFile,
} from '@/app/hooks/importPreferredFile';
import type { RobotFile } from '@/types';

const FAST_IMPORT_HEAVY_SELECTOR_FILE_POOL_THRESHOLD = 512;

const FAST_IMPORT_VARIANT_PENALTY_BY_TOKEN = new Map<string, number>([
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
  ['collision', 5],
  ['visual', 2],
  ['scene', 9],
  ['demo', 4],
  ['example', 4],
]);

const FAST_IMPORT_HELPER_PENALTY_BY_TOKEN = new Map<string, number>([
  ['scene', 12],
  ['world', 10],
  ['terrain', 8],
  ['floor', 8],
  ['env', 8],
  ['environment', 8],
  ['visualize', 10],
  ['viewer', 10],
  ['launcher', 10],
  ['demo', 4],
  ['example', 4],
  ['playground', 6],
]);

function normalizeImportPath(path: string): string {
  return normalizeLibraryPathKey(path);
}

function getImportPathDepth(path: string): number {
  return normalizeImportPath(path).split('/').filter(Boolean).length;
}

function getImportBaseName(path: string): string {
  const normalized = normalizeImportPath(path);
  const parts = normalized.split('/');
  return parts[parts.length - 1] || normalized;
}

function getImportStem(path: string): string {
  const baseName = getImportBaseName(path);
  const lastDotIndex = baseName.lastIndexOf('.');
  return (lastDotIndex >= 0 ? baseName.slice(0, lastDotIndex) : baseName).toLowerCase();
}

function tokenizeImportIdentity(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function scoreFastImportVariantPenalty(fileName: string): number {
  const tokens = tokenizeImportIdentity(getImportStem(fileName));
  const tokenSet = new Set(tokens);

  let penalty = 0;
  tokens.forEach((token) => {
    penalty += FAST_IMPORT_VARIANT_PENALTY_BY_TOKEN.get(token) ?? 0;
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

  return penalty;
}

function scoreFastImportHelperPenalty(fileName: string): number {
  return tokenizeImportIdentity(getImportStem(fileName)).reduce(
    (penalty, token) => penalty + (FAST_IMPORT_HELPER_PENALTY_BY_TOKEN.get(token) ?? 0),
    0,
  );
}

function compareFastImportPathPreference(leftName: string, rightName: string): number {
  const depthDiff = getImportPathDepth(leftName) - getImportPathDepth(rightName);
  if (depthDiff !== 0) {
    return depthDiff;
  }

  const leftBase = getImportBaseName(leftName);
  const rightBase = getImportBaseName(rightName);
  if (leftBase.length !== rightBase.length) {
    return leftBase.length - rightBase.length;
  }

  return leftName.localeCompare(rightName);
}

function shouldUseHeuristicOnlyFastSelection(
  robotDefinitionFiles: readonly RobotFile[],
  filePool: readonly RobotFile[],
): boolean {
  return (
    robotDefinitionFiles.length > FAST_IMPORT_HEAVY_SELECTOR_FILE_POOL_THRESHOLD ||
    filePool.length > FAST_IMPORT_HEAVY_SELECTOR_FILE_POOL_THRESHOLD
  );
}

function pickHeuristicFastUrdfFile(urdfFiles: readonly RobotFile[]): RobotFile | null {
  return (
    [...urdfFiles].sort((left, right) => {
      const variantPenaltyDiff =
        scoreFastImportVariantPenalty(left.name) - scoreFastImportVariantPenalty(right.name);
      if (variantPenaltyDiff !== 0) {
        return variantPenaltyDiff;
      }

      return compareFastImportPathPreference(left.name, right.name);
    })[0] ?? null
  );
}

function pickHeuristicFastMjcfFile(mjcfFiles: readonly RobotFile[]): RobotFile | null {
  return (
    [...mjcfFiles].sort((left, right) => {
      const sourceOnlyDiff =
        Number(isSourceOnlyMJCFDocument(left.content)) -
        Number(isSourceOnlyMJCFDocument(right.content));
      if (sourceOnlyDiff !== 0) {
        return sourceOnlyDiff;
      }

      const helperPenaltyDiff =
        scoreFastImportHelperPenalty(left.name) - scoreFastImportHelperPenalty(right.name);
      if (helperPenaltyDiff !== 0) {
        return helperPenaltyDiff;
      }

      return compareFastImportPathPreference(left.name, right.name);
    })[0] ?? null
  );
}

function pickHeuristicFastMixedCandidate(
  preferredUrdf: RobotFile | null,
  preferredMjcf: RobotFile | null,
): RobotFile | null {
  if (!preferredUrdf) {
    return preferredMjcf;
  }

  if (!preferredMjcf) {
    return preferredUrdf;
  }

  const urdfPenalty = scoreFastImportVariantPenalty(preferredUrdf.name);
  const mjcfPenalty = scoreFastImportHelperPenalty(preferredMjcf.name);
  if (urdfPenalty !== mjcfPenalty) {
    return urdfPenalty < mjcfPenalty ? preferredUrdf : preferredMjcf;
  }

  const pathPreference = compareFastImportPathPreference(preferredUrdf.name, preferredMjcf.name);
  if (pathPreference !== 0) {
    return pathPreference < 0 ? preferredUrdf : preferredMjcf;
  }

  // Favor URDF on ties to avoid expensive downstream MJCF source expansion
  // during broad mixed-format corpus imports.
  return preferredUrdf;
}

export function pickFastPreparedPreferredFile(
  files: RobotFile[],
  filePool: RobotFile[] = files,
): RobotFile | null {
  const visibleFiles = files.filter(isVisibleLibraryEntry);
  const robotDefinitionFiles = visibleFiles.filter(
    (file) => !isAssetLibraryOnlyFormat(file.format),
  );
  if (robotDefinitionFiles.length === 0) {
    return visibleFiles.find((file) => file.format === 'mesh') ?? null;
  }

  const urdfFiles = robotDefinitionFiles.filter((file) => file.format === 'urdf');
  const mjcfFiles = robotDefinitionFiles.filter((file) => file.format === 'mjcf');
  const shouldUseHeuristicOnly = shouldUseHeuristicOnlyFastSelection(
    robotDefinitionFiles,
    filePool,
  );

  if (urdfFiles.length > 0 && mjcfFiles.length > 0) {
    if (shouldUseHeuristicOnly) {
      return pickHeuristicFastMixedCandidate(
        pickHeuristicFastUrdfFile(urdfFiles),
        pickHeuristicFastMjcfFile(mjcfFiles),
      );
    }

    return pickPreferredImportFile(robotDefinitionFiles, filePool);
  }

  if (urdfFiles.length > 0) {
    if (shouldUseHeuristicOnly) {
      return pickHeuristicFastUrdfFile(urdfFiles);
    }

    return (
      [...urdfFiles].sort((left, right) => {
        const leftSelfContained = isUrdfSelfContainedInImportBundle(left, filePool);
        const rightSelfContained = isUrdfSelfContainedInImportBundle(right, filePool);
        if (leftSelfContained !== rightSelfContained) {
          return Number(rightSelfContained) - Number(leftSelfContained);
        }

        const variantPenaltyDiff =
          scoreFastImportVariantPenalty(left.name) - scoreFastImportVariantPenalty(right.name);
        if (variantPenaltyDiff !== 0) {
          return variantPenaltyDiff;
        }

        return compareFastImportPathPreference(left.name, right.name);
      })[0] ?? null
    );
  }

  if (mjcfFiles.length > 0) {
    if (shouldUseHeuristicOnly) {
      return pickHeuristicFastMjcfFile(mjcfFiles);
    }

    // Reuse the MJCF structural selector even in fast-open mode so archive helper files
    // such as keyframes.xml do not outrank standalone robot definitions.
    const preferredMjcf = pickPreferredMjcfImportFile(robotDefinitionFiles, filePool);
    if (preferredMjcf) {
      return preferredMjcf;
    }

    return (
      [...mjcfFiles].sort((left, right) => {
        const sourceOnlyDiff =
          Number(isSourceOnlyMJCFDocument(left.content)) -
          Number(isSourceOnlyMJCFDocument(right.content));
        if (sourceOnlyDiff !== 0) {
          return sourceOnlyDiff;
        }

        const helperPenaltyDiff =
          scoreFastImportHelperPenalty(left.name) - scoreFastImportHelperPenalty(right.name);
        if (helperPenaltyDiff !== 0) {
          return helperPenaltyDiff;
        }

        return compareFastImportPathPreference(left.name, right.name);
      })[0] ?? null
    );
  }

  const preferredUsd = pickPreferredUsdRootFile(
    robotDefinitionFiles.filter((file) => file.format === 'usd'),
  );
  if (preferredUsd) {
    return preferredUsd;
  }

  const standaloneXacroFiles = robotDefinitionFiles.filter(
    (file) => file.format === 'xacro' && isStandaloneXacroEntry(file),
  );
  if (standaloneXacroFiles.length > 0) {
    return (
      [...standaloneXacroFiles].sort((left, right) =>
        compareFastImportPathPreference(left.name, right.name),
      )[0] ?? null
    );
  }

  const xacroFiles = robotDefinitionFiles.filter((file) => file.format === 'xacro');
  if (xacroFiles.length > 0) {
    return (
      [...xacroFiles].sort((left, right) =>
        compareFastImportPathPreference(left.name, right.name),
      )[0] ?? null
    );
  }

  const sdfFiles = robotDefinitionFiles.filter((file) => file.format === 'sdf');
  if (sdfFiles.length > 0) {
    return (
      [...sdfFiles].sort((left, right) =>
        compareFastImportPathPreference(left.name, right.name),
      )[0] ?? null
    );
  }

  return robotDefinitionFiles[0] ?? visibleFiles[0] ?? null;
}
