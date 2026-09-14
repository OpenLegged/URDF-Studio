// 类型导入：避免把 jszip 拉进首屏入口 chunk。运行时实例由调用方
// （useFileExport 的 createZip() 动态 import）创建后传入。
import type JSZip from 'jszip';
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
