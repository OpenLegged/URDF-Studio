import * as THREE from 'three';
import { OBJExporter } from 'three/addons/exporters/OBJExporter.js';
import { createLoadingManager, createMeshLoader, buildColladaRootNormalizationHints, buildAssetIndex, findAssetByIndex, type AssetIndex } from '@/core/loaders';
import { collectExplicitlyScaledMeshPaths } from '@/core/loaders/meshScaleHints';
import { normalizeMeshPathForExport } from '@/core/parsers/meshPathUtils';
import {
  applyMeshScale, applyRuntimeMeshAssetTransform, createPrimitiveMesh, extractSubmesh,
} from '@/core/parsers/urdf/loader/buildRuntimeRobotFromStateHelpers';
import { getVisualGeometryEntries, hasGeometryMeshMaterialGroups } from '@/core/robot';
import { applyVisualMeshMaterialGroupsToObject } from '@/core/utils/meshMaterialGroups';
import { disposeObject3D } from '@/shared/utils/three/dispose';
import { GeometryType, type RobotState, type UrdfVisual, type UrdfVisualMaterial } from '@/types';
import {
  buildConvertedVisualVariantPath, containsPlaceholderMesh, createBakedVariantMesh,
  colorToHex, getMaterialColor, exportObjBlob, registerInlineMeshBlobUrls,
} from './mjcfMeshExportHelpers';

interface PrepareUrdfPaintExportOptions {
  robot: RobotState;
  assets: Record<string, string>;
  extraMeshFiles?: Map<string, Blob>;
  sourceFileDir?: string;
}

function createExportedPaintMaterial(
  descriptor: UrdfVisualMaterial,
  material: THREE.Material,
  assetPaths: AssetIndex,
  sourceFileDir: string,
): UrdfVisualMaterial {
  return {
    ...descriptor,
    texture: descriptor.texture
      ? findAssetByIndex(descriptor.texture, assetPaths, sourceFileDir) ?? descriptor.texture : undefined,
    // URDF encodes opacity in rgba, including for texture-only materials.
    color: descriptor.color ?? (descriptor.texture ? '#ffffff' : colorToHex(getMaterialColor(material))),
    opacity: descriptor.opacity ?? descriptor.colorRgba?.[3] ?? material.opacity,
  };
}

/** Standard URDF has one material per visual. Bake painted face partitions into
 * separate OBJ visuals (with UVs), leaving the canonical workspace untouched. */
export async function prepareUrdfPaintExport({
  robot, assets, extraMeshFiles, sourceFileDir = '',
}: PrepareUrdfPaintExportOptions): Promise<{ robot: RobotState; extraMeshFiles?: Map<string, Blob> }> {
  if (!Object.values(robot.links).some(link =>
    getVisualGeometryEntries(link).some(entry => hasGeometryMeshMaterialGroups(entry.geometry)))) {
    return { robot, extraMeshFiles };
  }

  const files = new Map(extraMeshFiles);
  const usedPaths = new Set([...Object.keys(assets), ...files.keys()]
    .map(normalizeMeshPathForExport).filter((value): value is string => Boolean(value)));
  const { resolvedAssets, tempObjectUrls } = registerInlineMeshBlobUrls(assets, extraMeshFiles);
  const assetPaths = buildAssetIndex(Object.fromEntries(Object.keys(resolvedAssets).map(path => [path, path])));
  const manager = createLoadingManager(resolvedAssets, sourceFileDir);
  const loadMesh = createMeshLoader(resolvedAssets, manager, sourceFileDir, {
    colladaRootNormalizationHints: buildColladaRootNormalizationHints(robot.links),
    explicitScaleMeshPaths: collectExplicitlyScaledMeshPaths(robot),
  });
  const exporter = new OBJExporter();
  const links = { ...robot.links };

  async function splitVisual(geometry: UrdfVisual, path: string): Promise<UrdfVisual[]> {
    // Export only needs topology/UVs. Material descriptors below carry textures
    // to the archive packager; do not start asynchronous image loads here.
    const topologyGeometry: UrdfVisual = {
      ...geometry,
      authoredMaterials: geometry.authoredMaterials?.map(material => ({ ...material, texture: undefined })),
    };
    let loaded: THREE.Object3D | null = null;
    const root = new THREE.Group();
    try {
      if (geometry.type === GeometryType.MESH && geometry.meshPath) {
        loaded = await new Promise<THREE.Object3D>((resolve, reject) => {
          loadMesh(geometry.meshPath!, manager, (object, error) => {
            if (error || !object) reject(error ?? new Error(`Missing mesh: ${geometry.meshPath}`));
            else resolve(object);
          });
        });
      } else {
        loaded = createPrimitiveMesh({ ...topologyGeometry, authoredMaterials: undefined }, false);
      }
      if (!loaded || containsPlaceholderMesh(loaded)) {
        throw new Error(`[URDF export] Cannot resolve painted geometry "${geometry.meshPath ?? geometry.type}".`);
      }
      const meshObject = geometry.submeshName
        ? extractSubmesh(loaded, geometry.submeshName, Boolean(geometry.submeshCenter))
        : loaded;
      if (!meshObject) throw new Error(`[URDF export] Missing painted submesh "${geometry.submeshName}".`);
      applyVisualMeshMaterialGroupsToObject(meshObject, topologyGeometry);
      root.add(applyRuntimeMeshAssetTransform(meshObject, geometry));
      applyMeshScale(root, geometry);
      root.updateMatrixWorld(true);
      const visuals: UrdfVisual[] = [];
      root.traverse(child => {
        const mesh = child as THREE.Mesh;
        if (!mesh.isMesh) return;
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        const indexes = Array.isArray(mesh.material)
          ? [...new Set(mesh.geometry.groups.map(group => group.materialIndex ?? 0))] : [0];
        for (const index of indexes) {
          const descriptor = geometry.authoredMaterials?.[index];
          if (!descriptor || !materials[index]) {
            throw new Error(`[URDF export] Missing paint material slot ${index}.`);
          }
          const baked = createBakedVariantMesh(mesh, materials[index], Array.isArray(mesh.material) ? index : undefined);
          if (!baked) throw new Error(`[URDF export] Empty paint material slot ${index}.`);
          try {
            // A mirrored transform is baked into vertices, so its winding must
            // be baked too instead of relying on the renderer's negative scale.
            if (mesh.matrixWorld.determinant() < 0) {
              const indices = baked.geometry.index
                ? Array.from(baked.geometry.index.array)
                : Array.from({ length: baked.geometry.getAttribute('position').count }, (_, i) => i);
              for (let i = 0; i < indices.length; i += 3) {
                [indices[i + 1], indices[i + 2]] = [indices[i + 2], indices[i + 1]];
              }
              baked.geometry.setIndex(indices);
            }
            const meshPath = buildConvertedVisualVariantPath({
              meshPath: path, materialName: `slot_${index}`, variantIndex: visuals.length,
              usedPaths, extension: '.obj',
            });
            const blob = exportObjBlob(exporter, baked);
            if (!blob) throw new Error(`[URDF export] Empty painted mesh "${meshPath}".`);
            files.set(meshPath, blob);
            visuals.push({
              ...geometry, type: GeometryType.MESH, meshPath,
              name: `${geometry.name || 'visual'}_paint_${visuals.length}`,
              dimensions: { x: 1, y: 1, z: 1 },
              color: descriptor.color ?? geometry.color,
              authoredMaterials: [createExportedPaintMaterial(descriptor, materials[index], assetPaths, sourceFileDir)],
              materialSource: 'inline',
              meshMaterialGroups: undefined, usdMeshDescriptors: undefined,
              submeshName: undefined, submeshCenter: undefined,
              assetRef: undefined, mjcfMesh: undefined, mjcfHfield: undefined,
            });
          } finally {
            disposeObject3D(baked, true);
          }
        }
      });
      if (!visuals.length) throw new Error('[URDF export] Painted geometry produced no visual meshes.');
      return visuals;
    } catch (cause) {
      throw new Error(`[URDF export] Failed to export painted geometry "${geometry.meshPath ?? geometry.type}".`, { cause });
    } finally {
      if (loaded && !root.getObjectById(loaded.id)) root.add(loaded);
      disposeObject3D(root, true);
    }
  }

  try {
    for (const [linkId, link] of Object.entries(robot.links)) {
      const entries = getVisualGeometryEntries(link);
      if (!entries.some(entry => hasGeometryMeshMaterialGroups(entry.geometry))) continue;
      const visuals: UrdfVisual[] = [];
      for (const entry of entries) {
        visuals.push(...(hasGeometryMeshMaterialGroups(entry.geometry)
          ? await splitVisual(entry.geometry, `painted/${encodeURIComponent(linkId)}_${entry.objectIndex}.obj`)
          : [entry.geometry]));
      }
      links[linkId] = { ...link, visual: visuals[0], visualBodies: visuals.slice(1) };
    }
    return { robot: { ...robot, links }, extraMeshFiles: files };
  } finally {
    tempObjectUrls.forEach(url => URL.revokeObjectURL(url));
  }
}
