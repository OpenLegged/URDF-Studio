import { parseMJCF, parseSDF, parseURDF, parseXacro } from '@/core/parsers';
import { processMJCFIncludes } from '@/core/parsers/mjcf/mjcfSourceResolver';
import { failFastInDev } from '@/core/utils/runtimeDiagnostics';
import type { RobotFile, RobotState } from '@/types';

export interface ParseEditableRobotSourceOptions {
  file: Pick<RobotFile, 'format' | 'name'> | null | undefined;
  content: string;
  availableFiles?: RobotFile[];
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
      case 'mjcf':
        return parseMJCF(processMJCFIncludes(content, availableFiles, basePath));
      case 'xacro':
        return parseXacro(
          content,
          {},
          buildXacroFileMap(file, content, availableFiles, allFileContents),
          basePath,
        );
      case 'sdf':
        return parseSDF(content, {
          allFileContents,
          availableFiles,
          sourcePath: file.name,
        });
      case 'urdf':
        return parseURDF(content);
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
