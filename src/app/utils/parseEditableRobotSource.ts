import { parseMJCF, parseSDF, parseURDF, parseXacro } from '@/core/parsers';
import { finalizeImportedRobotData } from '@/core/parsers/finalizeImportedRobotData';
import { resolveMJCFSource } from '@/core/parsers/mjcf/mjcfSourceResolver';
import { createMJCFSourceResolutionRecoveryDiagnostics } from '@/core/parsers/recoveryDiagnostics';
import { parseCanonicalPhysicalMJCF } from '@/core/parsers/mjcf/mjcfCanonicalPhysicalImport';
import { failFastInDev } from '@/core/utils/runtimeDiagnostics';
import type { RobotFile, RobotImportRecoveryDiagnostic, RobotState } from '@/types';

export interface ParseEditableRobotSourceOptions {
  file: Pick<RobotFile, 'format' | 'name'> | null | undefined;
  content: string;
  availableFiles?: RobotFile[];
  assets?: Record<string, string>;
  allFileContents?: Record<string, string>;
}

function buildXacroFileMap(
  file: Pick<RobotFile, 'format' | 'name'>,
  content: string,
  availableFiles: RobotFile[],
  allFileContents: Record<string, string> = {},
): Record<string, string> {
  const fileMap: Record<string, string> = {};

  availableFiles.forEach((candidate) => {
    fileMap[candidate.name] = candidate.name === file.name ? content : candidate.content;
  });

  Object.entries(allFileContents).forEach(([path, fileContent]) => {
    if (typeof fileContent !== 'string') {
      return;
    }

    fileMap[path] = path === file.name ? content : fileContent;
  });

  return fileMap;
}

function finalizeEditableRobotState(
  state: RobotState | null,
  format: RobotFile['format'],
  recoveryDiagnostics: RobotImportRecoveryDiagnostic[] = [],
): RobotState | null {
  if (!state) {
    return null;
  }

  const { selection, ...robotData } = state;
  const finalized = finalizeImportedRobotData(robotData, format, recoveryDiagnostics);
  if (finalized.status === 'error') {
    return null;
  }

  const selectedId = selection.id;
  const selectionStillExists =
    (selection.type === 'link' && selectedId !== null && finalized.robotData.links[selectedId]) ||
    (selection.type === 'joint' && selectedId !== null && finalized.robotData.joints[selectedId]);

  return {
    ...finalized.robotData,
    selection: selectionStillExists
      ? selection
      : { type: 'link', id: finalized.robotData.rootLinkId },
  };
}

export function parseEditableRobotSource({
  file,
  content,
  availableFiles = [],
  allFileContents = {},
}: ParseEditableRobotSourceOptions): RobotState | null {
  if (!file) {
    return null;
  }

  const basePath = file.name.split('/').slice(0, -1).join('/');

  try {
    switch (file.format) {
      case 'mjcf': {
        const sourceFile: RobotFile = { ...file, content, format: 'mjcf' };
        const sourceFiles = availableFiles.some((candidate) => candidate.name === file.name)
          ? availableFiles.map((candidate) =>
              candidate.name === file.name ? sourceFile : candidate,
            )
          : [...availableFiles, sourceFile];
        const resolved = resolveMJCFSource(sourceFile, sourceFiles);
        return finalizeEditableRobotState(
          parseMJCF(resolved.content),
          file.format,
          createMJCFSourceResolutionRecoveryDiagnostics(resolved.issues),
        );
      }
      case 'xacro':
        return finalizeEditableRobotState(
          parseXacro(
            content,
            {},
            buildXacroFileMap(file, content, availableFiles, allFileContents),
            basePath,
          ),
          file.format,
        );
      case 'sdf':
        return finalizeEditableRobotState(
          parseSDF(content, {
            allFileContents,
            availableFiles,
            sourcePath: file.name,
          }),
          file.format,
        );
      case 'urdf':
        return finalizeEditableRobotState(parseURDF(content), file.format);
      default:
        return null;
    }
  } catch (error) {
    throw failFastInDev(
      'parseEditableRobotSource',
      new Error(`Failed to parse editable source for "${file.name}" (${file.format}).`, {
        cause: error,
      }),
    );
  }
}

export async function parseEditableRobotSourceAsync(
  options: ParseEditableRobotSourceOptions,
): Promise<RobotState | null> {
  const { file, content, availableFiles = [], assets = {} } = options;
  if (!file || file.format !== 'mjcf') {
    return parseEditableRobotSource(options);
  }

  try {
    const sourceFile: RobotFile = { ...file, content, format: 'mjcf' };
    const sourceFiles = availableFiles.some((candidate) => candidate.name === file.name)
      ? availableFiles.map((candidate) => (candidate.name === file.name ? sourceFile : candidate))
      : [...availableFiles, sourceFile];
    const resolved = resolveMJCFSource(sourceFile, sourceFiles);
    const parsed = await parseCanonicalPhysicalMJCF(resolved.content, {
      assets,
      sourceFileDir: resolved.basePath,
    });
    return finalizeEditableRobotState(
      parsed,
      file.format,
      createMJCFSourceResolutionRecoveryDiagnostics(resolved.issues),
    );
  } catch (error) {
    throw failFastInDev(
      'parseEditableRobotSourceAsync',
      new Error(`Failed to parse editable source for "${file.name}" (${file.format}).`, {
        cause: error,
      }),
    );
  }
}
