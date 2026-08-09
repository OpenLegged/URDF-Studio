import { OBJExporter } from 'three/addons/exporters/OBJExporter.js';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';

import {
  createLoadingManager,
  createMeshLoader,
  buildColladaRootNormalizationHints,
} from '@/core/loaders';
import { collectExplicitlyScaledMeshPaths } from '@/core/loaders/meshScaleHints';
import { normalizeMeshPathForExport } from '@/core/parsers/meshPathUtils';
import { hasGeometryMeshMaterialGroups } from '@/core/robot';
import { applyVisualMeshMaterialGroupsToObject } from '@/core/utils/meshMaterialGroups';
import { type RobotState } from '@/types';
import { disposeObject3D } from '@/shared/utils/three/dispose';
import {
  isMjcfNativeMeshPath,
  buildConvertedMeshExportPath,
  colorToHex,
  MeshFormatKind,
  MeshExporters,
  resolveMeshFormat,
  exportMeshBlob,
  isColorLike,
  getMaterialColor,
  isBufferGeometryLike,
  createBakedVariantMesh,
  extractVisualMeshVariants,
  registerInlineMeshBlobUrls,
  collectReferencedMeshPaths,
  collectReferencedMeshUsage,
  findVisualGeometryByMeshPath,
  containsPlaceholderMesh,
  shouldParseColladaInProcessForMjcfExport,
  loadColladaMeshInProcessForMjcfExport,
  registerNativeMeshPassThroughOverride,
  createMjcfMeshExportError,
  prepareSharedNativeMeshReuse,
  type MjcfVisualMeshVariant,
} from './mjcfMeshExportHelpers';
export type { MjcfVisualMeshVariant } from './mjcfMeshExportHelpers';

export interface PrepareMjcfMeshExportAssetsOptions {
  robot: RobotState;
  assets: Record<string, string>;
  extraMeshFiles?: Map<string, Blob>;
  preferSharedMeshReuse?: boolean;
  meshFormat?: 'auto' | 'obj' | 'stl';
}

export interface PreparedMjcfMeshExportAssets {
  meshPathOverrides: Map<string, string>;
  archiveFiles: Map<string, Blob>;
  convertedSourceMeshPaths: Set<string>;
  visualMeshVariants: Map<string, MjcfVisualMeshVariant[]>;
}

// Resolve effective mesh format: 'auto' picks STL (binary, smallest) for
// meshes without UVs, and OBJ (preserves UVs) for textured meshes.
export async function prepareMjcfMeshExportAssets(
  options: PrepareMjcfMeshExportAssetsOptions,
): Promise<PreparedMjcfMeshExportAssets> {
  const { robot, assets, extraMeshFiles, preferSharedMeshReuse = true } = options;
  const meshPathOverrides = new Map<string, string>();
  const archiveFiles = new Map<string, Blob>();
  const convertedSourceMeshPaths = new Set<string>();
  const visualMeshVariants = new Map<string, MjcfVisualMeshVariant[]>();
  const usedArchivePaths = new Set<string>();
  const referencedMeshPaths = collectReferencedMeshPaths(robot);
  const referencedMeshUsage = collectReferencedMeshUsage(robot);
  const { resolvedAssets, tempObjectUrls } = registerInlineMeshBlobUrls(assets, extraMeshFiles);
  const colladaRootNormalizationHints = buildColladaRootNormalizationHints(robot.links);
  const explicitScaleMeshPaths = collectExplicitlyScaledMeshPaths(robot);
  const loadingManager = createLoadingManager(resolvedAssets);
  const loadMesh = createMeshLoader(resolvedAssets, loadingManager, '', {
    colladaRootNormalizationHints,
    explicitScaleMeshPaths,
  });
  const objExporter = new OBJExporter();
  const exporters: MeshExporters = {
    obj: objExporter,
    stl: new STLExporter(),
  };
  const meshFormat: MeshFormatKind = options.meshFormat ?? 'auto';

  try {
    if (preferSharedMeshReuse) {
      await prepareSharedNativeMeshReuse(
        referencedMeshPaths,
        extraMeshFiles,
        meshPathOverrides,
        convertedSourceMeshPaths,
      );
    }

    for (const meshPath of referencedMeshPaths) {
      const normalizedSourcePath = normalizeMeshPathForExport(meshPath);
      const sourceUsage =
        referencedMeshUsage.get(meshPath) ||
        (normalizedSourcePath ? referencedMeshUsage.get(normalizedSourcePath) : undefined);

      if (isMjcfNativeMeshPath(meshPath) && !sourceUsage?.hasVisualMultiMaterialUsage) {
        if (normalizedSourcePath && normalizedSourcePath !== meshPath) {
          registerNativeMeshPassThroughOverride(meshPath, normalizedSourcePath, meshPathOverrides);
        }
        continue;
      }

      try {
        const meshObject = shouldParseColladaInProcessForMjcfExport(meshPath)
          ? await loadColladaMeshInProcessForMjcfExport(
              meshPath,
              resolvedAssets,
              loadingManager,
              explicitScaleMeshPaths,
            )
          : await new Promise<any>((resolve, reject) => {
              loadMesh(meshPath, loadingManager, (result, err) => {
                if (err) {
                  reject(err);
                  return;
                }

                resolve(result);
              });
            });

        if (containsPlaceholderMesh(meshObject)) {
          disposeObject3D(meshObject, true);
          throw new Error(
            `[MJCF export] Required mesh "${meshPath}" resolved to a placeholder asset.`,
          );
        }

        const meshGroupGeometry = findVisualGeometryByMeshPath(robot, meshPath);
        if (meshGroupGeometry && hasGeometryMeshMaterialGroups(meshGroupGeometry)) {
          applyVisualMeshMaterialGroupsToObject(meshObject, meshGroupGeometry, {
            manager: loadingManager,
          });
        }

        const extractedVariantFiles = extractVisualMeshVariants({
          meshObject,
          sourceMeshPath: meshPath,
          usedArchivePaths,
          exporters,
          meshFormat,
        });
        const hasSplitVisualVariants = extractedVariantFiles.length > 1;
        const shouldPreferVisualVariants =
          hasSplitVisualVariants &&
          Boolean(sourceUsage?.hasVisualMultiMaterialUsage) &&
          !sourceUsage?.hasNonVisualUsage;
        const needsFullMeshExport = !shouldPreferVisualVariants;

        if (needsFullMeshExport) {
          const fullExtension = resolveMeshFormat(meshFormat, meshObject);
          const exportPath = buildConvertedMeshExportPath(
            meshPath,
            usedArchivePaths,
            fullExtension,
          );
          if (!exportPath) {
            disposeObject3D(meshObject, true);
            throw new Error(`[MJCF export] Could not derive a mesh export path for "${meshPath}".`);
          }

          const meshBlob = exportMeshBlob(exporters, fullExtension, meshObject);
          if (!meshBlob) {
            disposeObject3D(meshObject, true);
            throw new Error(`[MJCF export] Mesh export for "${meshPath}" produced no mesh data.`);
          }
          archiveFiles.set(exportPath, meshBlob);
          meshPathOverrides.set(meshPath, exportPath);
          convertedSourceMeshPaths.add(meshPath);

          if (normalizedSourcePath && normalizedSourcePath !== meshPath) {
            meshPathOverrides.set(normalizedSourcePath, exportPath);
            convertedSourceMeshPaths.add(normalizedSourcePath);
          }
        } else {
          convertedSourceMeshPaths.add(meshPath);
          if (normalizedSourcePath && normalizedSourcePath !== meshPath) {
            convertedSourceMeshPaths.add(normalizedSourcePath);
          }
        }

        if (extractedVariantFiles.length > 1) {
          const variants = extractedVariantFiles.map(({ blob, ...variant }) => {
            archiveFiles.set(variant.meshPath, blob);
            return variant;
          });

          visualMeshVariants.set(meshPath, variants);
          if (normalizedSourcePath && normalizedSourcePath !== meshPath) {
            visualMeshVariants.set(normalizedSourcePath, variants);
          }
        }

        disposeObject3D(meshObject, true);
      } catch (error) {
        throw createMjcfMeshExportError(meshPath, error);
      }
    }
  } finally {
    tempObjectUrls.forEach((objectUrl) => URL.revokeObjectURL(objectUrl));
  }

  return {
    meshPathOverrides,
    archiveFiles,
    convertedSourceMeshPaths,
    visualMeshVariants,
  };
}

export const __mjcfMeshExportInternals = {
  isBufferGeometryLike,
  isColorLike,
  getMaterialColor,
  colorToHex,
  createBakedVariantMesh,
};
