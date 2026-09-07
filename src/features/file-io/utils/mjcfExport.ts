import { generateMujocoXML, type MujocoExportOptions } from '@/core/parsers/mjcf/mjcfGenerator';
import {
  buildTextureExportPathOverrides,
  normalizeMeshPathForExport,
  resolveImportedAssetPath,
  resolveTextureExportPath,
} from '@/core/parsers/meshPathUtils';
import { collectGeometryTexturePaths, getVisualGeometryEntries } from '@/core/robot';
import type { RobotState } from '@/types';
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
}

/** Shared model conversion; callers retain download, scene composition and source-overlay ownership. */
export async function prepareMjcfExport(
  options: PrepareMjcfExportOptions,
  prepareMeshes = prepareMjcfMeshExportAssets,
): Promise<PreparedMjcfExport> {
  const meshes = await prepareMeshes(options);
  options.onMeshesPrepared?.();
  return {
    xml: generateMujocoXML(options.robot, {
      ...options.mujoco,
      meshPathOverrides: meshes.meshPathOverrides,
      visualMeshVariants: meshes.visualMeshVariants,
    }),
    meshes,
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
  const candidates = [...sourceFiles.keys(), ...Object.keys(assets)];
  const readAsset = async (path: string): Promise<Blob> => {
    const resolved = sourceFiles.has(path) || assets[path]
      ? path
      : resolveImportedAssetPath(path, undefined, { candidateAssetPaths: candidates });
    const file = sourceFiles.get(resolved || path);
    if (file) return file;
    const url = assets[resolved || path];
    if (!url) throw new Error(`MJCF export asset is unavailable: ${path}`);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`MJCF export asset failed to load: ${path} (${response.status})`);
    return response.blob();
  };
  for (const path of new Set(geometries.flatMap((geometry) => geometry?.meshPath ? [geometry.meshPath] : []))) {
    if (prepared.meshes.convertedSourceMeshPaths.has(path)) continue;
    const target = prepared.meshes.meshPathOverrides.get(path) ?? normalizeMeshPathForExport(path);
    if (!files.has(`meshes/${target}`)) files.set(`meshes/${target}`, await readAsset(path));
  }
  const texturePaths = [
    ...geometries.flatMap((geometry) => geometry ? collectGeometryTexturePaths(geometry) : []),
    ...Object.values(robot.materials ?? {}).flatMap((material) => material.texture ? [material.texture] : []),
  ];
  const overrides = buildTextureExportPathOverrides(texturePaths);
  for (const path of new Set(texturePaths)) {
    files.set(`textures/${resolveTextureExportPath(path, overrides)}`, await readAsset(path));
  }
  return files;
}
