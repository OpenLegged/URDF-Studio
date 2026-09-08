import { generateMujocoXML, type MujocoExportOptions } from '@/core/parsers/mjcf/mjcfGenerator';
import {
  buildTextureExportPathOverrides,
  normalizeMeshPathForExport,
  resolveTextureExportPath,
} from '@/core/parsers/meshPathUtils';
import { collectGeometryTexturePaths, getVisualGeometryEntries } from '@/core/robot';
import type { RobotState } from '@/types';
import { prepareMjcfCollisionVolumes } from './mjcfCollisionVolumes';
import { mjcfCollisionGeometries, needsMjcfInertiaInference } from '@/core/parsers/mjcf/mjcfMassInference';
import { prepareMjcfTextureBlob, readMjcfExportAsset } from '@/core/loaders/mjcfExportAssets';
import {
  prepareMjcfMeshExportAssets,
  type PrepareMjcfMeshExportAssetsOptions,
  type PreparedMjcfMeshExportAssets,
} from './mjcfMeshExport';

export interface PrepareMjcfExportOptions extends PrepareMjcfMeshExportAssetsOptions {
  mujoco?: MujocoExportOptions;
  onMeshesPrepared?: () => void;
}

export interface PreparedMjcfExport {
  xml: string;
  meshes: PreparedMjcfMeshExportAssets;
  estimatedLinkNames: string[];
}

/** Shared model conversion; callers retain download, scene composition and source-overlay ownership. */
export async function prepareMjcfExport(
  options: PrepareMjcfExportOptions,
  prepareMeshes = prepareMjcfMeshExportAssets,
): Promise<PreparedMjcfExport> {
  const meshes = await prepareMeshes(options);
  const collisionVolumes = options.mujoco?.massMode === 'recompute' ? undefined
    : await prepareMjcfCollisionVolumes(options, meshes);
  options.onMeshesPrepared?.();
  return {
    xml: generateMujocoXML(options.robot, {
      ...options.mujoco,
      collisionVolumes,
      meshPathOverrides: meshes.meshPathOverrides,
      visualMeshVariants: meshes.visualMeshVariants,
    }),
    meshes,
    estimatedLinkNames: Object.values(options.robot.links)
      .filter((link) => mjcfCollisionGeometries(link).length > 0
        && (options.mujoco?.massMode === 'recompute' || needsMjcfInertiaInference(link)))
      .map((link) => link.name),
  };
}

/** Package the shared converter's dependencies with explicit mesh/texture directories. */
export async function collectMjcfExportFiles(
  prepared: PreparedMjcfExport,
  { robot, sourceFiles, assets = {} }: {
    robot: RobotState;
    sourceFiles: Map<string, Blob>;
    assets?: Record<string, string>;
  },
): Promise<Map<string, Blob | string>> {
  const files = new Map<string, Blob | string>([['model.xml', prepared.xml]]);
  for (const [path, blob] of prepared.meshes.archiveFiles) files.set(`meshes/${path}`, blob);
  const geometries = Object.values(robot.links).flatMap((link) => [
    ...getVisualGeometryEntries(link).map((entry) => entry.geometry),
    link.collision,
    ...(link.collisionBodies ?? []),
  ]);
  for (const path of new Set(geometries.flatMap((geometry) => geometry?.meshPath ? [geometry.meshPath] : []))) {
    if (prepared.meshes.convertedSourceMeshPaths.has(path)) continue;
    const target = prepared.meshes.meshPathOverrides.get(path) ?? normalizeMeshPathForExport(path);
    if (!files.has(`meshes/${target}`)) files.set(`meshes/${target}`, await readMjcfExportAsset(path, sourceFiles, assets));
  }
  const texturePaths = [
    ...geometries.flatMap((geometry) => geometry ? collectGeometryTexturePaths(geometry) : []),
    ...Object.values(robot.materials ?? {}).flatMap((material) => material.texture ? [material.texture] : []),
  ];
  const overrides = buildTextureExportPathOverrides(texturePaths);
  for (const path of new Set(texturePaths)) {
    const target = resolveTextureExportPath(path, overrides);
    files.set(`textures/${target}`, await prepareMjcfTextureBlob(target, await readMjcfExportAsset(path, sourceFiles, assets)));
  }
  return files;
}
