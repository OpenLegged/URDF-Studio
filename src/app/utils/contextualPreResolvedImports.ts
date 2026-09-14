import type { ResolveRobotFileDataOptions } from '@/core/parsers/importRobotFile';
import { isStandaloneXacroEntry } from '@/core/parsers/importRobotFileLightweight';
import { resolveRobotFileDataWithWorker } from '@/app/hooks/robotImportWorkerBridge';
import type { RobotFile } from '@/types';
import type { PreResolvedImportEntry } from './importPreparation';
import { buildPreResolvedImportContentSignature } from './preResolvedImportSignature.ts';

interface BuildContextualPreResolvedImportsOptions {
  preferredFileName?: string | null;
}

export function shouldBuildContextualPreResolvedImports(
  options: Pick<ResolveRobotFileDataOptions, 'availableFiles' | 'assets' | 'allFileContents'>,
): boolean {
  const availableFiles = options.availableFiles ?? [];
  const assets = options.assets ?? {};
  const allFileContents = options.allFileContents ?? {};
  return availableFiles.length > 0
    || Object.keys(assets).length > 0
    || Object.keys(allFileContents).length > 0;
}

function compareContextualXacroPathPreference(left: RobotFile, right: RobotFile): number {
  const leftSegments = left.name.split('/').length;
  const rightSegments = right.name.split('/').length;
  if (leftSegments !== rightSegments) {
    return leftSegments - rightSegments;
  }

  const leftBaseName = left.name.split('/').pop() ?? left.name;
  const rightBaseName = right.name.split('/').pop() ?? right.name;
  if (leftBaseName.length !== rightBaseName.length) {
    return leftBaseName.length - rightBaseName.length;
  }

  return left.name.localeCompare(right.name);
}

function pickPreferredContextualXacroFile(robotFiles: readonly RobotFile[]): RobotFile | null {
  const xacroFiles = robotFiles.filter((file) => file.format === 'xacro');
  if (xacroFiles.length === 0) {
    return null;
  }

  const standaloneEntries = xacroFiles.filter((file) => isStandaloneXacroEntry(file));
  const candidates = standaloneEntries.length > 0 ? standaloneEntries : xacroFiles;

  return [...candidates].sort(compareContextualXacroPathPreference)[0] ?? null;
}

function pickPreferredContextualRobotFile(
  robotFiles: readonly RobotFile[],
  preferredFileName?: string | null,
): RobotFile | null {
  if (preferredFileName) {
    const preferredFile =
      robotFiles.find((file) => file.name === preferredFileName && file.format !== 'mesh') ?? null;
    if (preferredFile) {
      return preferredFile;
    }
  }

  return pickPreferredContextualXacroFile(robotFiles);
}

export async function buildContextualPreResolvedImports(
  robotFiles: readonly RobotFile[],
  options: Pick<ResolveRobotFileDataOptions, 'availableFiles' | 'assets' | 'allFileContents'>,
  buildOptions: BuildContextualPreResolvedImportsOptions = {},
): Promise<PreResolvedImportEntry[]> {
  const preferredFile = pickPreferredContextualRobotFile(
    robotFiles,
    buildOptions.preferredFileName,
  );
  if (!preferredFile) {
    return [];
  }

  const result = await resolveRobotFileDataWithWorker(preferredFile, options);

  return [{
    fileName: preferredFile.name,
    format: preferredFile.format,
    contentSignature: buildPreResolvedImportContentSignature(preferredFile.content),
    result,
  }];
}
