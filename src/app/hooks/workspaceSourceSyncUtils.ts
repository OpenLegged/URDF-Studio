import { generateURDF } from '@/core/parsers';
import type { RobotImportResult } from '@/core/parsers/importRobotFile';
import { createUsdPlaceholderRobotData } from '@/core/parsers/importRobotFileLightweight';
import { resolveMJCFSource } from '@/core/parsers/mjcf/mjcfSourceResolver';
import { canGenerateUrdf } from '@/core/parsers/urdf/urdfExportSupport';
import { buildExportableAssemblyRobotData } from '@/core/robot/assemblyTransforms';
import { createRobotSemanticSnapshot } from '@/shared/utils/robot/semanticSnapshot';
import type { AssemblyState, RobotData, RobotFile, RobotState } from '@/types';

import { createRobotSourceSnapshot } from './workspace-source-sync/robot_source_snapshot';

export { createRobotSourceSnapshot } from './workspace-source-sync/robot_source_snapshot';

const GENERATED_WORKSPACE_URDF_FOLDER = 'generated';
const GENERATED_WORKSPACE_URDF_SUFFIX = '.generated.urdf';

function sanitizeGeneratedWorkspaceUrdfStem(value: string): string {
  const sanitized = value
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[_./-]+|[_./-]+$/g, '');

  return sanitized || 'workspace';
}

export function isGeneratedWorkspaceUrdfFileName(fileName: string | null | undefined): boolean {
  const normalized = String(fileName || '')
    .trim()
    .replace(/^\/+/, '')
    .replace(/\\/g, '/');

  return (
    normalized.startsWith(`${GENERATED_WORKSPACE_URDF_FOLDER}/`) &&
    normalized.endsWith(GENERATED_WORKSPACE_URDF_SUFFIX)
  );
}

export function buildGeneratedWorkspaceUrdfFileName({
  assemblyName,
  availableFiles,
  preferredFileName,
}: {
  assemblyName: string;
  availableFiles: RobotFile[];
  preferredFileName?: string | null;
}): string {
  if (preferredFileName) {
    return preferredFileName;
  }

  const existingNames = new Set(availableFiles.map((file) => file.name));
  const baseStem = sanitizeGeneratedWorkspaceUrdfStem(assemblyName);
  let suffix = 0;

  while (true) {
    const candidateStem = suffix === 0 ? baseStem : `${baseStem}_${suffix + 1}`;
    const candidate = `${GENERATED_WORKSPACE_URDF_FOLDER}/${candidateStem}${GENERATED_WORKSPACE_URDF_SUFFIX}`;
    if (!existingNames.has(candidate)) {
      return candidate;
    }
    suffix += 1;
  }
}

export function createGeneratedWorkspaceUrdfFile({
  assemblyName,
  mergedRobotData,
  availableFiles,
  preferredFileName,
}: {
  assemblyName: string;
  mergedRobotData: RobotData;
  availableFiles: RobotFile[];
  preferredFileName?: string | null;
}): {
  file: RobotFile;
  robot: RobotState;
  snapshot: string;
} {
  const robot: RobotState = {
    ...mergedRobotData,
    selection: { type: null, id: null },
  };
  const fileName = buildGeneratedWorkspaceUrdfFileName({
    assemblyName,
    availableFiles,
    preferredFileName,
  });
  const file: RobotFile = {
    name: fileName,
    format: 'urdf',
    content: canGenerateUrdf(robot)
      ? generateURDF(robot, {
          includeHardware: 'auto',
          preserveMeshPaths: true,
          preserveNumericPrecision: true,
        })
      : '',
  };

  return {
    file,
    robot,
    snapshot: createRobotSemanticSnapshot(robot),
  };
}

/** Always derive generated source from the canonical workspace, never from a selected file. */
export function resolveWorkspaceGeneratedUrdfRobotData({
  assemblyState,
}: {
  assemblyState: AssemblyState;
}): RobotData {
  return buildExportableAssemblyRobotData(assemblyState);
}

export function createWorkspaceGeneratedRobotSnapshot(assemblyState: AssemblyState): string {
  return createRobotSemanticSnapshot(resolveWorkspaceGeneratedUrdfRobotData({ assemblyState }));
}

export function shouldPromptGenerateWorkspaceUrdfOnStructureSwitch({
  assemblyState,
  baselineSnapshot,
}: {
  assemblyState: AssemblyState;
  baselineSnapshot: string;
}): boolean {
  return createWorkspaceGeneratedRobotSnapshot(assemblyState) !== baselineSnapshot;
}

export function createPreviewRobotStateFromImportResult(
  file: RobotFile,
  resolved: RobotImportResult,
): RobotState | null {
  if (resolved.status === 'ready') {
    return {
      ...resolved.robotData,
      selection: { type: null, id: null },
    };
  }

  if (resolved.status === 'needs_hydration' && file.format === 'usd') {
    return {
      ...createUsdPlaceholderRobotData(file),
      selection: { type: null, id: null },
    };
  }

  return null;
}

export function buildPreviewSceneSourceFromImportResult(
  file: RobotFile,
  {
    availableFiles,
    previewRobot,
    importResult,
  }: {
    availableFiles: RobotFile[];
    previewRobot: RobotState | null;
    importResult: RobotImportResult;
  },
): string | null {
  if (file.format === 'urdf') {
    return file.content;
  }

  if (file.format === 'xacro') {
    if (importResult.status === 'ready') {
      return importResult.resolvedUrdfContent ?? '';
    }

    return importResult.status === 'error' && importResult.reason === 'source_only_fragment'
      ? null
      : '';
  }

  if (file.format === 'mjcf') {
    if (importResult.status !== 'ready') {
      return importResult.status === 'error' && importResult.reason === 'source_only_fragment'
        ? null
        : importResult.status === 'error'
          ? ''
          : null;
    }

    return resolveMJCFSource(file, availableFiles).content;
  }

  if (file.format === 'usd') {
    return '';
  }

  if (file.format === 'sdf') {
    return file.content;
  }

  if (!previewRobot) {
    return importResult.status === 'error' ? '' : null;
  }

  return canGenerateUrdf(previewRobot)
    ? generateURDF(previewRobot, { preserveMeshPaths: true, preserveNumericPrecision: true })
    : null;
}
