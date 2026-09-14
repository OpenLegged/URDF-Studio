import { DEFAULT_LINK, GeometryType, type RobotData, type RobotFile } from '@/types';

import { isSourceOnlyXacroFragmentDocument } from './xacro/xacroParser';
import { getRobotImportFileName, normalizeRobotImportFilePath } from './robotImportSourcePaths';

export function createUsdPlaceholderRobotData(file: RobotFile): RobotData {
  const robotName =
    file.name
      .split('/')
      .pop()
      ?.replace(/\.[^/.]+$/, '') || 'usd_scene';
  const linkId = 'usd_scene_root';

  return {
    name: robotName,
    links: {
      [linkId]: {
        ...DEFAULT_LINK,
        id: linkId,
        name: 'usd_scene_root',
        visual: {
          ...DEFAULT_LINK.visual,
          type: GeometryType.NONE,
          dimensions: { x: 0, y: 0, z: 0 },
        },
        collision: {
          ...DEFAULT_LINK.collision,
          type: GeometryType.NONE,
          dimensions: { x: 0, y: 0, z: 0 },
        },
        inertial: {
          ...DEFAULT_LINK.inertial,
          mass: 0,
        },
      },
    },
    joints: {},
    rootLinkId: linkId,
  };
}

export function isStandaloneXacroEntry(file: RobotFile): boolean {
  const lowerName = getRobotImportFileName(file.name).toLowerCase();
  return lowerName === 'robot.xacro' || lowerName.endsWith('.urdf.xacro');
}

export function findStandaloneXacroTruthFile(
  file: RobotFile,
  availableFiles: RobotFile[],
): RobotFile | null {
  if (!isStandaloneXacroEntry(file)) {
    return null;
  }

  const normalizedFileName = normalizeRobotImportFilePath(file.name);
  const pathParts = normalizedFileName.split('/');
  if (pathParts.length < 3) {
    return null;
  }

  const packageDir = pathParts.slice(0, -2).join('/');
  const packageName = pathParts[pathParts.length - 3] || '';
  const urdfDir = `${packageDir}/urdf/`;
  const candidateTruthFiles = availableFiles.filter(
    (candidate) =>
      candidate.format === 'urdf' &&
      normalizeRobotImportFilePath(candidate.name).startsWith(urdfDir),
  );

  if (candidateTruthFiles.length === 0) {
    return null;
  }

  const preferredFileNames = [
    `${packageName}.urdf`,
    `${packageName.replace(/_description$/i, '')}.urdf`,
    `${getRobotImportFileName(normalizedFileName).replace(/\.xacro$/i, '')}.urdf`,
  ];

  for (const preferredFileName of preferredFileNames) {
    const match = candidateTruthFiles.find(
      (candidate) => getRobotImportFileName(candidate.name) === preferredFileName,
    );
    if (match) {
      return match;
    }
  }

  return candidateTruthFiles.length === 1 ? candidateTruthFiles[0] : null;
}

function isClosedRobotDocument(content: string): boolean {
  return /<robot\b[^>]*>[\s\S]*<\/robot>/i.test(content) || /<robot\b[^>]*\/>/i.test(content);
}

function isWellFormedXmlDocument(content: string): boolean {
  if (typeof DOMParser === 'undefined') {
    return isClosedRobotDocument(content);
  }

  const document = new DOMParser().parseFromString(content, 'text/xml');
  return document.querySelector('parsererror') === null;
}

export function isSourceOnlyRobotDocument(urdfContent: string): boolean {
  return (
    isClosedRobotDocument(urdfContent) &&
    isWellFormedXmlDocument(urdfContent) &&
    !/<\s*link\b/i.test(urdfContent)
  );
}

export function isSourceOnlyXacroDocument(urdfContent: string): boolean {
  return isSourceOnlyRobotDocument(urdfContent) || isSourceOnlyXacroFragmentDocument(urdfContent);
}
