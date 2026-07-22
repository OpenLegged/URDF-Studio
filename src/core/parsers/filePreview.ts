import { parseURDF } from './urdf/parser';
import { generateURDF } from './urdf/urdfGenerator';
import { processXacro } from './xacro/xacroParser';
import { GeometryType, type RobotFile, type RobotState } from '@/types';
import { resolveMJCFSource } from '@/core/parsers/mjcf/mjcfSourceResolver';
import {
  findStandaloneXacroTruthFile,
  isSourceOnlyXacroDocument,
} from '@/core/parsers/importRobotFile';

function buildMeshPreviewState(file: RobotFile): RobotState {
  const meshName =
    file.name
      .split('/')
      .pop()
      ?.replace(/\.[^/.]+$/, '') ?? 'mesh';
  const linkId = 'base_link';

  return {
    name: meshName,
    links: {
      [linkId]: {
        id: linkId,
        name: 'base_link',
        visible: true,
        visual: {
          type: GeometryType.MESH,
          dimensions: { x: 1, y: 1, z: 1 },
          color: '#808080',
          meshPath: file.name,
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collision: {
          type: GeometryType.NONE,
          dimensions: { x: 0, y: 0, z: 0 },
          color: '#ef4444',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        inertial: {
          mass: 1.0,
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          inertia: { ixx: 0.1, ixy: 0, ixz: 0, iyy: 0.1, iyz: 0, izz: 0.1 },
        },
      },
    },
    joints: {},
    rootLinkId: linkId,
    selection: { type: null, id: null },
  };
}

/**
 * Convert a RobotFile to URDF content for preview.
 * Supports urdf, xacro, mjcf, sdf, usd, and mesh formats.
 */
export function computePreviewUrdf(file: RobotFile, availableFiles: RobotFile[]): string | null {
  try {
    if (file.format === 'urdf') {
      return file.content;
    }

    if (file.format === 'xacro') {
      const truthFile = findStandaloneXacroTruthFile(file, availableFiles);
      if (truthFile && parseURDF(truthFile.content)) {
        return truthFile.content;
      }

      const fileMap: Record<string, string> = {};
      availableFiles.forEach((candidate) => {
        fileMap[candidate.name] = candidate.content;
      });
      const pathParts = file.name.split('/');
      pathParts.pop();
      const basePath = pathParts.join('/');
      const urdfFromXacro = processXacro(file.content, {}, fileMap, basePath);
      if (parseURDF(urdfFromXacro)) {
        return urdfFromXacro;
      }

      return isSourceOnlyXacroDocument(urdfFromXacro) ? null : '';
    }

    if (file.format === 'mjcf') {
      return resolveMJCFSource(file, availableFiles).content;
    }

    if (file.format === 'sdf') {
      return file.content;
    }

    if (file.format === 'usd') {
      return '';
    }

    if (file.format === 'mesh') {
      return generateURDF(buildMeshPreviewState(file), { preserveMeshPaths: true });
    }
  } catch (error) {
    console.error('[filePreview] Failed to build preview:', error);
  }

  return null;
}
