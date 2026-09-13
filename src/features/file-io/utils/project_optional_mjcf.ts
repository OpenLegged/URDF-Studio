import { GeometryType, type RobotData } from '@/types';
import { getVisualGeometryEntries } from '@/core/robot';
import { canPreserveJointTypesInSource } from '@/core/parsers/sourceJointSupport';
import { canPreserveGeometryInSource } from '@/core/parsers/sourceGeometrySupport';
import { normalizeMeshPathForExport } from '@/core/parsers/meshPathUtils';
import { isMjcfNativeMeshPath } from './mjcfMeshExportHelpers';

/** Native saves never load or convert meshes just to create an optional MJCF. */
export const canGenerateOptionalMjcfOutput = async (
  robot: RobotData,
  packedMeshes: ReadonlyMap<string, Blob>,
): Promise<boolean> => {
  if (!canPreserveJointTypesInSource(robot, 'mjcf')) return false;
  if (!canPreserveGeometryInSource(robot, 'mjcf')) return false;
  if (Object.values(robot.materials ?? {}).some(material => material.texture)) return false;
  const geometrySupported = Object.values(robot.links).every(link => {
    const geometries = [
      ...getVisualGeometryEntries(link).map(entry => entry.geometry),
      link.collision,
      ...(link.collisionBodies ?? []),
    ];
    return geometries.every(geometry => {
      if (geometry.type === GeometryType.HFIELD || geometry.type === GeometryType.SDF) return false;
      if (geometry.submeshName || geometry.submeshCenter) return false;
      if ((geometry.authoredMaterials?.length ?? 0) > 1) return false;
      if (geometry.authoredMaterials?.some(material => material.texture)) return false;
      if (geometry.meshMaterialGroups?.some(group => group.materialIndex > 0)) return false;
      if (geometry.type !== GeometryType.MESH) return true;
      const path = geometry.meshPath;
      if (!path) return Boolean(geometry.mjcfMesh?.vertices?.length);
      if (!isMjcfNativeMeshPath(path)) return false;
      if (/^[a-z][a-z0-9+.-]*:/i.test(normalizeMeshPathForExport(path))) return false;
      return !geometry.mjcfMesh?.file
        || normalizeMeshPathForExport(geometry.mjcfMesh.file) === normalizeMeshPathForExport(path);
    });
  });
  if (!geometrySupported) return false;
  for (const [path, blob] of packedMeshes) {
    if (/\.obj$/i.test(path) && /^\s*mtllib\s/im.test(await blob.text())) return false;
  }
  return true;
};
