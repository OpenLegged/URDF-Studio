import type {
  UsdClosedLoopConstraintEntry,
  UsdJointCatalogEntry,
  UsdLinkDynamicsEntry,
  UsdMeshCountsEntry,
  UsdSceneMeshDescriptor,
  UsdSceneSnapshot,
} from '@/types';

const METERS_PER_UNIT_EPSILON = 1e-12;

function finitePositive(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > METERS_PER_UNIT_EPSILON ? numeric : null;
}

export function getUsdStageMetersPerUnit(snapshot: UsdSceneSnapshot | null | undefined): number {
  return finitePositive(snapshot?.stage?.metersPerUnit) ?? 1;
}

export function getUsdSourceMetersPerUnit(snapshot: UsdSceneSnapshot | null | undefined): number {
  return finitePositive(snapshot?.stage?.sourceMetersPerUnit) ?? getUsdStageMetersPerUnit(snapshot);
}

function scaleArrayLike(
  value: ArrayLike<number> | null | undefined,
  scale: number,
): ArrayLike<number> | null | undefined {
  if (!value || typeof value.length !== 'number') {
    return value;
  }
  return Array.from(value, (entry) => Number(entry) * scale);
}

function scaleJointEntry(entry: UsdJointCatalogEntry, scale: number): UsdJointCatalogEntry {
  return {
    ...entry,
    localPos0: scaleArrayLike(entry.localPos0, scale),
    localPos1: scaleArrayLike(entry.localPos1, scale),
    localPivotInLink: scaleArrayLike(entry.localPivotInLink, scale),
    originXyz: scaleArrayLike(entry.originXyz, scale),
  };
}

function scaleDynamicsEntry(
  entry: UsdLinkDynamicsEntry,
  scale: number,
): UsdLinkDynamicsEntry {
  return {
    ...entry,
    centerOfMassLocal: scaleArrayLike(entry.centerOfMassLocal, scale),
    diagonalInertia: scaleArrayLike(entry.diagonalInertia, scale * scale),
  };
}

function scaleClosedLoopEntry(
  entry: UsdClosedLoopConstraintEntry,
  scale: number,
): UsdClosedLoopConstraintEntry {
  return {
    ...entry,
    anchorWorld: scaleArrayLike(entry.anchorWorld, scale),
    anchorLocalA: scaleArrayLike(entry.anchorLocalA, scale),
    anchorLocalB: scaleArrayLike(entry.anchorLocalB, scale),
  };
}

function scaleMeshCounts(entry: UsdMeshCountsEntry, scale: number): UsdMeshCountsEntry {
  return {
    ...entry,
    collisionPrimitiveGeometries: entry.collisionPrimitiveGeometries?.map((geometry) => ({
      ...geometry,
      dimensions: scaleArrayLike(geometry.dimensions, scale),
      originXyz: scaleArrayLike(geometry.originXyz, scale),
    })),
  };
}

function scaleDescriptor(
  descriptor: UsdSceneMeshDescriptor,
  scale: number,
): UsdSceneMeshDescriptor {
  const scaleOptional = (value: number | null | undefined) =>
    value == null ? value : Number(value) * scale;
  return {
    ...descriptor,
    size: scaleOptional(descriptor.size),
    radius: scaleOptional(descriptor.radius),
    height: scaleOptional(descriptor.height),
    extentSize: scaleArrayLike(descriptor.extentSize, scale),
  };
}

function scalePositionPool(
  positions: ArrayLike<number> | null | undefined,
  scale: number,
): ArrayLike<number> | null | undefined {
  if (!positions || typeof positions.length !== 'number') {
    return positions;
  }
  return Float32Array.from(positions, (value) => Number(value) * scale);
}

function scaleTransformPool(
  transforms: ArrayLike<number> | null | undefined,
  scale: number,
): ArrayLike<number> | null | undefined {
  if (!transforms || typeof transforms.length !== 'number') {
    return transforms;
  }
  const normalized = Float32Array.from(transforms, Number);
  for (let offset = 0; offset + 15 < normalized.length; offset += 16) {
    normalized[offset + 12] *= scale;
    normalized[offset + 13] *= scale;
    normalized[offset + 14] *= scale;
  }
  return normalized;
}

/** Convert every distance-bearing part of a USD scene snapshot to meters exactly once. */
export function normalizeUsdSceneSnapshotToMeters(
  snapshot: UsdSceneSnapshot | null | undefined,
): UsdSceneSnapshot | null {
  if (!snapshot) {
    return null;
  }

  const metersPerUnit = getUsdStageMetersPerUnit(snapshot);
  if (Math.abs(metersPerUnit - 1) <= METERS_PER_UNIT_EPSILON) {
    return snapshot;
  }

  const metadata = snapshot.robotMetadataSnapshot;
  const meshCountsByLinkPath = metadata?.meshCountsByLinkPath
    ? Object.fromEntries(
        Object.entries(metadata.meshCountsByLinkPath).map(([path, entry]) => [
          path,
          scaleMeshCounts(entry, metersPerUnit),
        ]),
      )
    : undefined;

  return {
    ...snapshot,
    stage: {
      ...(snapshot.stage || {}),
      metersPerUnit: 1,
      sourceMetersPerUnit: metersPerUnit,
    },
    robotTree: snapshot.robotTree
      ? {
          ...snapshot.robotTree,
          jointCatalogEntries: Array.from(snapshot.robotTree.jointCatalogEntries || [], (entry) =>
            scaleJointEntry(entry, metersPerUnit),
          ),
        }
      : snapshot.robotTree,
    physics: snapshot.physics
      ? {
          ...snapshot.physics,
          linkDynamicsEntries: Array.from(snapshot.physics.linkDynamicsEntries || [], (entry) =>
            scaleDynamicsEntry(entry, metersPerUnit),
          ),
        }
      : snapshot.physics,
    render: snapshot.render
      ? {
          ...snapshot.render,
          meshDescriptors: Array.from(snapshot.render.meshDescriptors || [], (descriptor) =>
            scaleDescriptor(descriptor, metersPerUnit),
          ),
        }
      : snapshot.render,
    buffers: snapshot.buffers
      ? {
          ...snapshot.buffers,
          positions: scalePositionPool(snapshot.buffers.positions, metersPerUnit),
          transforms: scaleTransformPool(snapshot.buffers.transforms, metersPerUnit),
        }
      : snapshot.buffers,
    robotMetadataSnapshot: metadata
      ? {
          ...metadata,
          jointCatalogEntries: Array.from(metadata.jointCatalogEntries || [], (entry) =>
            scaleJointEntry(entry, metersPerUnit),
          ),
          linkDynamicsEntries: Array.from(metadata.linkDynamicsEntries || [], (entry) =>
            scaleDynamicsEntry(entry, metersPerUnit),
          ),
          closedLoopConstraintEntries: Array.from(
            metadata.closedLoopConstraintEntries || [],
            (entry) => scaleClosedLoopEntry(entry, metersPerUnit),
          ),
          ...(meshCountsByLinkPath ? { meshCountsByLinkPath } : {}),
        }
      : metadata,
  };
}
