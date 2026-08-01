import type { RobotImportResult } from '@/core/parsers/importRobotFile';
import { resolveImportedAssetPath, resolveMeshAssetUrl } from '@/core/parsers/meshPathUtils';
import { validateMJCFImportExternalAssets } from '@/core/parsers/mjcf/mjcfImportValidation';
import { resolveMJCFSource } from '@/core/parsers/mjcf/mjcfSourceResolver';
import {
  inferUsdBundleVirtualDirectory,
  isUsdPathWithinBundleDirectory,
  isUsdRuntimeTexturePath,
} from '@/core/parsers/usd';
import { normalizeLibraryPathKey } from '@/core/utils/pathKeys';
import { GeometryType, type RobotData, type RobotFile, type UrdfLink } from '@/types';

import { extractStandaloneImportAssetReferences } from '../importPackageAssetReferences.ts';

function normalizeImportPath(path: string): string {
  return normalizeLibraryPathKey(path);
}

function normalizeResolvedImportAssetPath(
  assetPath: string,
  sourceFilePath?: string | null,
): string {
  return normalizeImportPath(resolveImportedAssetPath(assetPath, sourceFilePath));
}

function addResolvedDeferredAssetName(
  assetPath: string,
  deferredAssetLookup: Record<string, string>,
  target: Set<string>,
): void {
  const resolvedAssetName = resolveMeshAssetUrl(assetPath, deferredAssetLookup);
  if (resolvedAssetName) {
    target.add(resolvedAssetName);
  }
}

function collectGeometryAssetPaths(
  target: Set<string>,
  geometry?: UrdfLink['visual'] | UrdfLink['collision'] | null,
): void {
  if (!geometry) {
    return;
  }

  if (geometry.type === GeometryType.MESH && geometry.meshPath) {
    target.add(geometry.meshPath);
  }

  if (geometry.mjcfMesh?.file) {
    target.add(geometry.mjcfMesh.file);
  }

  if (geometry.mjcfHfield?.file) {
    target.add(geometry.mjcfHfield.file);
  }

  (geometry.authoredMaterials ?? []).forEach((material) => {
    if (material.texture) {
      target.add(material.texture);
    }
  });
}

export function collectRobotAssetPaths(robotData: RobotData): Set<string> {
  const assetPaths = new Set<string>();

  Object.values(robotData.links).forEach((link) => {
    collectGeometryAssetPaths(assetPaths, link.visual);
    collectGeometryAssetPaths(assetPaths, link.collision);
    (link.visualBodies ?? []).forEach((body) => collectGeometryAssetPaths(assetPaths, body));
    (link.collisionBodies ?? []).forEach((body) => collectGeometryAssetPaths(assetPaths, body));
  });

  Object.values(robotData.materials ?? {}).forEach((material) => {
    if (material.texture) {
      assetPaths.add(material.texture);
    }
  });

  return assetPaths;
}

function collectSourceDerivedDeferredAssetNames(
  preferredFile: RobotFile | null,
  availableRobotFiles: readonly RobotFile[],
  allFileContents: Record<string, string>,
  deferredAssetLookup: Record<string, string>,
  target: Set<string>,
): void {
  if (!preferredFile) {
    return;
  }

  if (preferredFile.format === 'mjcf') {
    const resolvedSource = resolveMJCFSource(preferredFile, [...availableRobotFiles]);
    if (resolvedSource.issues.length > 0) {
      return;
    }

    validateMJCFImportExternalAssets(
      resolvedSource.sourceFile.name,
      resolvedSource.content,
      [...availableRobotFiles],
      {},
    ).forEach((issue) => {
      addResolvedDeferredAssetName(issue.resolvedPath, deferredAssetLookup, target);
    });

    return;
  }

  extractStandaloneImportAssetReferences(preferredFile, {
    allFileContents,
    sourcePath: preferredFile.name,
  }).forEach((assetPath) => {
    addResolvedDeferredAssetName(assetPath, deferredAssetLookup, target);
  });
}

function inferPreferredFileAssetRoot(file: RobotFile | null): string | null {
  if (!file) {
    return null;
  }

  const normalizedName = normalizeImportPath(file.name);
  if (!normalizedName) {
    return null;
  }

  const pathParts = normalizedName.split('/').filter(Boolean);
  if (pathParts.length <= 1) {
    return pathParts[0] ?? null;
  }

  const assetRootMarkerIndex = pathParts.findIndex((segment) => {
    const lowerSegment = segment.toLowerCase();
    return lowerSegment === 'urdf' || lowerSegment === 'xacro' || lowerSegment === 'mjcf';
  });

  if (assetRootMarkerIndex > 0) {
    return pathParts.slice(0, assetRootMarkerIndex).join('/');
  }

  return pathParts.slice(0, -1).join('/');
}

export function determineCriticalDeferredAssetNames(
  preferredFile: RobotFile | null,
  preferredImportResult: RobotImportResult | null,
  deferredAssetFiles: readonly { name: string }[],
  availableRobotFiles: readonly RobotFile[],
  allFileContents: Record<string, string>,
): Set<string> {
  if (deferredAssetFiles.length === 0) {
    return new Set<string>();
  }

  const assetLookup = Object.fromEntries(deferredAssetFiles.map((file) => [file.name, file.name]));
  const criticalAssetNames = new Set<string>();

  if (preferredFile?.format === 'mesh') {
    addResolvedDeferredAssetName(preferredFile.name, assetLookup, criticalAssetNames);
  }

  if (preferredImportResult?.status === 'ready') {
    collectRobotAssetPaths(preferredImportResult.robotData).forEach((assetPath) => {
      addResolvedDeferredAssetName(assetPath, assetLookup, criticalAssetNames);
    });
  }

  collectSourceDerivedDeferredAssetNames(
    preferredFile,
    availableRobotFiles,
    allFileContents,
    assetLookup,
    criticalAssetNames,
  );

  if (criticalAssetNames.size > 0) {
    return criticalAssetNames;
  }

  if (preferredFile?.format === 'usd') {
    const bundleDirectory = inferUsdBundleVirtualDirectory(preferredFile.name);
    deferredAssetFiles.forEach((file) => {
      if (
        isUsdRuntimeTexturePath(file.name)
        && isUsdPathWithinBundleDirectory(file.name, bundleDirectory)
      ) {
        criticalAssetNames.add(file.name);
      }
    });
    return criticalAssetNames;
  }

  const preferredFileAssetRoot = inferPreferredFileAssetRoot(preferredFile);
  if (!preferredFileAssetRoot) {
    return criticalAssetNames;
  }

  deferredAssetFiles.forEach((file) => {
    if (
      file.name === preferredFileAssetRoot ||
      file.name.startsWith(`${preferredFileAssetRoot}/`)
    ) {
      criticalAssetNames.add(file.name);
    }
  });

  return criticalAssetNames;
}
