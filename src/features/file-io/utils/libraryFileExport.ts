import JSZip from 'jszip';
import {
  parseSDF,
  parseURDF,
  generateMujocoXML,
  generateSDF,
  generateSdfModelConfig,
  generateURDF,
} from '@/core/parsers';
import {
  normalizeMeshPathForExport,
  getSourceFileDirectory,
  resolveMeshAssetUrl,
  rewriteUrdfAssetPathsForExport,
} from '@/core/parsers/meshPathUtils';
import { parseCanonicalPhysicalMJCF } from '@/core/parsers/mjcf/mjcfCanonicalPhysicalImport';
import { getVisualGeometryEntries } from '@/core/robot';
import { GeometryType, type RobotFile, type RobotState } from '@/types';
import { downloadBlob } from './assetUtils';
import { prepareMjcfMeshExportAssets } from './mjcfMeshExport';

export type LibraryExportFormat = 'urdf' | 'mjcf' | 'sdf';

export interface ExportLibraryRobotFileOptions {
  file: RobotFile;
  targetFormat: LibraryExportFormat;
  assets: Record<string, string>;
}

export interface ExportLibraryRobotFileResult {
  success: boolean;
  zipFileName?: string;
  missingMeshPaths: string[];
  reason?: 'unsupported-file-format' | 'parse-failed' | 'missing-mesh-assets';
}

async function toRobotState(
  file: RobotFile,
  assets: Record<string, string>,
): Promise<RobotState | null> {
  try {
    switch (file.format) {
      case 'urdf':
        return parseURDF(file.content);
      case 'mjcf':
        return await parseCanonicalPhysicalMJCF(file.content, {
          assets,
          sourceFileDir: getSourceFileDirectory(file.name),
        });
      case 'sdf':
        return parseSDF(file.content, { sourcePath: file.name });
      default:
        return null;
    }
  } catch (error) {
    console.error('[LibraryExport] Failed to parse file', error);
    return null;
  }
}

function getFileBaseName(path: string): string {
  const fileName = path.split('/').pop() ?? path;
  const withoutExt = fileName.replace(/\.[^/.]+$/, '');
  const trimmed = withoutExt.trim();
  return trimmed.length > 0 ? trimmed : 'robot';
}

function createArchiveRoot(zip: JSZip, baseName: string): JSZip {
  return zip.folder(baseName) ?? zip;
}

function collectReferencedMeshes(robot: RobotState): string[] {
  const referenced = new Set<string>();
  Object.values(robot.links).forEach((link) => {
    getVisualGeometryEntries(link).forEach((entry) => {
      if (entry.geometry.type === GeometryType.MESH && entry.geometry.meshPath) {
        referenced.add(entry.geometry.meshPath);
      }
    });
    if (link.collision.type === GeometryType.MESH && link.collision.meshPath) {
      referenced.add(link.collision.meshPath);
    }
    (link.collisionBodies || []).forEach((body) => {
      if (body.type === GeometryType.MESH && body.meshPath) {
        referenced.add(body.meshPath);
      }
    });
  });
  return Array.from(referenced);
}

async function addReferencedMeshesToZip(
  robot: RobotState,
  assets: Record<string, string>,
  zip: JSZip,
  skipMeshPaths?: Set<string>,
): Promise<string[]> {
  const missing = new Set<string>();
  const exportedPaths = new Set<string>();
  const meshFolder = zip.folder('meshes');
  const meshes = collectReferencedMeshes(robot);

  const tasks = meshes.map(async (meshPath) => {
    if (skipMeshPaths?.has(meshPath)) return;

    const exportPath = normalizeMeshPathForExport(meshPath);
    if (!exportPath || exportedPaths.has(exportPath) || skipMeshPaths?.has(exportPath)) return;
    exportedPaths.add(exportPath);

    const blobUrl = resolveMeshAssetUrl(meshPath, assets);
    if (!blobUrl) {
      missing.add(meshPath);
      return;
    }

    try {
      const response = await fetch(blobUrl);
      const blob = await response.blob();
      meshFolder?.file(exportPath, blob);
    } catch (error) {
      console.error(`[LibraryExport] Failed to fetch mesh: ${meshPath}`, error);
      missing.add(meshPath);
    }
  });

  await Promise.all(tasks);
  return Array.from(missing);
}

export async function exportLibraryRobotFile(
  options: ExportLibraryRobotFileOptions,
): Promise<ExportLibraryRobotFileResult> {
  const { file, targetFormat, assets } = options;
  const robotState = await toRobotState(file, assets);

  if (file.format !== 'urdf' && file.format !== 'mjcf' && file.format !== 'sdf') {
    return {
      success: false,
      missingMeshPaths: [],
      reason: 'unsupported-file-format',
    };
  }

  if (!robotState) {
    return {
      success: false,
      missingMeshPaths: [],
      reason: 'parse-failed',
    };
  }

  const baseName = getFileBaseName(file.name);
  const zip = new JSZip();
  const archiveRoot = createArchiveRoot(zip, baseName);
  const mjcfMeshExport =
    targetFormat === 'mjcf' && file.format !== 'mjcf'
      ? await prepareMjcfMeshExportAssets({
          robot: robotState,
          assets,
        })
      : null;

  if (targetFormat === 'urdf') {
    const urdfContent =
      file.format === 'urdf'
        ? rewriteUrdfAssetPathsForExport(file.content, {
            exportRobotName: baseName,
          })
        : generateURDF(robotState, false);
    archiveRoot.file(`${baseName}.urdf`, urdfContent);
  } else if (targetFormat === 'mjcf') {
    const mjcfContent =
      file.format === 'mjcf'
        ? file.content
        : generateMujocoXML(robotState, {
            meshdir: 'meshes/',
            meshPathOverrides: mjcfMeshExport?.meshPathOverrides,
            visualMeshVariants: mjcfMeshExport?.visualMeshVariants,
          });
    archiveRoot.file(`${baseName}.xml`, mjcfContent);
  } else {
    archiveRoot.file('model.sdf', generateSDF(robotState, { packageName: baseName }));
    archiveRoot.file('model.config', generateSdfModelConfig(robotState.name || baseName));
  }

  const missingMeshPaths = await addReferencedMeshesToZip(
    robotState,
    assets,
    archiveRoot,
    mjcfMeshExport?.convertedSourceMeshPaths,
  );
  if (mjcfMeshExport) {
    const meshFolder = archiveRoot.folder('meshes');
    mjcfMeshExport.archiveFiles.forEach((blob, relativePath) => {
      meshFolder?.file(relativePath, blob);
    });
  }

  if (missingMeshPaths.length > 0) {
    return {
      success: false,
      missingMeshPaths,
      reason: 'missing-mesh-assets',
    };
  }

  const blob = await zip.generateAsync({ type: 'blob' });
  const zipFileName = `${baseName}_${targetFormat}.zip`;
  downloadBlob(blob, zipFileName);

  return {
    success: true,
    zipFileName,
    missingMeshPaths,
  };
}
