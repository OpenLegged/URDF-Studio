import { Mesh, Vector3 } from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { readMjcfExportAsset } from '@/core/loaders/mjcfExportAssets';
import { mjcfCollisionGeometries, mjcfPrimitiveVolume, needsMjcfInertiaInference } from '@/core/parsers/mjcf/mjcfMassInference';
import { normalizeMjcfMeshScale } from '@/core/parsers/mjcf/mjcfGeneratorUtils';
import { disposeObject3D } from '@/shared/utils/three/dispose';
import type { UrdfVisual } from '@/types';
import type { PrepareMjcfMeshExportAssetsOptions, PreparedMjcfMeshExportAssets } from './mjcfMeshExport';

async function meshVolume(
  geometry: UrdfVisual, options: PrepareMjcfMeshExportAssetsOptions, meshes: PreparedMjcfMeshExportAssets,
): Promise<number> {
  const points: Vector3[] = [];
  const push = (values: ArrayLike<number>) => {
    for (let i = 0; i + 2 < values.length; i += 3) points.push(new Vector3(values[i], values[i + 1], values[i + 2]));
  };
  if (geometry.mjcfMesh?.vertices?.length) push(geometry.mjcfMesh.vertices);
  else {
    const path = geometry.mjcfMesh?.file || geometry.meshPath || '';
    const converted = meshes.meshPathOverrides.get(path) ?? path;
    const blob = meshes.archiveFiles.get(converted)
      ?? await readMjcfExportAsset(path, options.extraMeshFiles ?? new Map(), options.assets);
    if (/\.obj$/i.test(converted)) {
      const object = new OBJLoader().parse(await blob.text());
      try {
        object.updateMatrixWorld(true);
        object.traverse((child) => {
          if (!(child instanceof Mesh)) return;
          const position = child.geometry.getAttribute('position');
          for (let i = 0; i < position.count; i++) points.push(new Vector3().fromBufferAttribute(position, i).applyMatrix4(child.matrixWorld));
        });
      } finally { disposeObject3D(object); }
    } else if (/\.stl$/i.test(converted)) {
      const mesh = new STLLoader().parse(await blob.arrayBuffer());
      try { push(mesh.getAttribute('position').array); } finally { mesh.dispose(); }
    } else if (/\.msh$/i.test(converted)) {
      const data = new DataView(await blob.arrayBuffer());
      const count = data.getInt32(0, true);
      if (count < 4 || 16 + count * 12 > data.byteLength) throw new Error(`Invalid MJCF mesh: ${path}`);
      for (let i = 0; i < count; i++) points.push(new Vector3(...[0, 4, 8].map((offset) => data.getFloat32(16 + i * 12 + offset, true))));
    } else throw new Error(`Cannot measure collision mesh volume: ${path}`);
  }
  const { scale } = normalizeMjcfMeshScale(geometry.mjcfMesh, geometry.dimensions);
  const factor = new Vector3(...scale);
  points.forEach((point) => point.multiply(factor));
  if (points.length < 4 || points.some((point) => ![point.x, point.y, point.z].every(Number.isFinite))) {
    throw new Error('Collision mesh has no finite three-dimensional volume.');
  }
  // Matches MuJoCo's default convex mesh inertia. Only volume is needed here;
  // MuJoCo still calculates centers, rotations and inertia from the exported geoms.
  const hull = new ConvexGeometry(points);
  try {
    const position = hull.getAttribute('position');
    let volume = 0;
    for (let i = 0; i < position.count; i += 3) {
      const a = new Vector3().fromBufferAttribute(position, i).sub(points[0]);
      const b = new Vector3().fromBufferAttribute(position, i + 1).sub(points[0]);
      const c = new Vector3().fromBufferAttribute(position, i + 2).sub(points[0]);
      volume += a.dot(b.cross(c)) / 6;
    }
    return Math.abs(volume);
  } finally { hull.dispose(); }
}

/** Measure collisions only for links with known mass but missing inertia. */
export async function prepareMjcfCollisionVolumes(
  options: PrepareMjcfMeshExportAssetsOptions, meshes: PreparedMjcfMeshExportAssets,
): Promise<Map<string, number[]>> {
  const result = new Map<string, number[]>();
  for (const [id, link] of Object.entries(options.robot.links)) {
    if (!needsMjcfInertiaInference(link) || !(link.inertial && link.inertial.mass > 0)) continue;
    const volumes = [];
    for (const geometry of mjcfCollisionGeometries(link)) {
      volumes.push(mjcfPrimitiveVolume(geometry) ?? await meshVolume(geometry, options, meshes));
    }
    result.set(id, volumes);
  }
  return result;
}
