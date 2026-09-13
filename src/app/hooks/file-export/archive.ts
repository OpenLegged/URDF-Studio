import JSZip from 'jszip';
import { generateSkeletonXML } from '@/core/parsers';
import type { RobotState } from '@/types';

export function createArchiveRoot(zip: JSZip, exportName: string): JSZip {
  return zip.folder(exportName) ?? zip;
}

export function getFileBaseName(path: string): string {
  const fileName = path.split('/').pop() ?? path;
  const withoutExt = fileName.replace(/\.[^/.]+$/, '');
  const trimmed = withoutExt.trim();
  return trimmed.length > 0 ? trimmed : 'robot';
}

export function addArchiveFilesToZip(
  zip: JSZip,
  folderName: string,
  archiveFiles?: Map<string, Blob>,
): void {
  if (!archiveFiles || archiveFiles.size === 0) {
    return;
  }

  const targetFolder = zip.folder(folderName);
  archiveFiles.forEach((blob, relativePath) => {
    targetFolder?.file(relativePath, blob);
  });
}

export function addSkeletonToZip(
  robot: RobotState,
  zip: JSZip,
  exportName: string,
  includeMeshes: boolean,
): void {
  zip.file(
    `${exportName}_skeleton.xml`,
    generateSkeletonXML(robot, {
      meshdir: 'meshes/',
      includeMeshes,
      includeActuators: true,
      preserveNumericPrecision: true,
    }),
  );
}
