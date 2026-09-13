import { Matrix4, Vector3 } from 'three';
import { computeLinkWorldMatrices, createOriginMatrix } from '@/core/robot/kinematics';
import { getCollisionGeometryEntries, getVisualGeometryEntries } from '@/core/robot';
import { getUsdStageMetersPerUnit } from '@/lib/robot-parser/usd/usdStageUnits';
import type { RobotState } from '@/types';
import { getDescriptorRanges, readRangeValues } from './objBufferReaders';
import type { ExportDescriptor, UsdExportSnapshot } from './internalTypes';

function hasShear(matrix: Matrix4): boolean {
  const axes = [0, 1, 2].map((index) => new Vector3().setFromMatrixColumn(matrix, index).normalize());
  return Math.abs(axes[0].dot(axes[1])) > 1e-7
    || Math.abs(axes[0].dot(axes[2])) > 1e-7
    || Math.abs(axes[1].dot(axes[2])) > 1e-7;
}

/** Bake only the affine remainder that canonical origin/scale cannot express. */
export function preserveUsdAffineGeometry(
  snapshot: UsdExportSnapshot,
  robot: RobotState,
  descriptors: Map<string, ExportDescriptor>,
): void {
  const sourceTransforms = new Map<string, Matrix4>();
  for (const [meshPath, entry] of descriptors) {
    const range = getDescriptorRanges(entry.descriptor, snapshot.buffers)?.transform;
    const values = readRangeValues(snapshot.buffers?.transforms, range);
    if (values.length < 16) continue;
    const matrix = new Matrix4().fromArray(Array.from({ length: 16 }, (_, index) => values[index]));
    if (!matrix.elements.every(Number.isFinite) || !hasShear(matrix)) continue;
    const units = getUsdStageMetersPerUnit(snapshot);
    matrix.premultiply(new Matrix4().makeScale(units, units, units));
    sourceTransforms.set(meshPath, matrix);
  }
  if (sourceTransforms.size === 0) return;

  const linkTransforms = computeLinkWorldMatrices(robot);
  for (const link of Object.values(robot.links)) {
    const world = linkTransforms[link.id];
    if (!world) continue;
    const entries = [...getVisualGeometryEntries(link), ...getCollisionGeometryEntries(link)];
    for (const { geometry } of entries) {
      if (!geometry.meshPath) continue;
      const source = sourceTransforms.get(geometry.meshPath);
      const descriptor = descriptors.get(geometry.meshPath);
      if (!source || !descriptor) continue;
      const rendered = world.clone().multiply(createOriginMatrix(geometry.origin))
        .scale(new Vector3(geometry.dimensions.x, geometry.dimensions.y, geometry.dimensions.z));
      if (Math.abs(rendered.determinant()) < 1e-18) continue;
      descriptor.geometryTransform = rendered.invert().multiply(source).elements;
    }
  }
}
