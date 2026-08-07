import assert from 'node:assert/strict';
import test from 'node:test';

import type { UsdSceneSnapshot } from '@/types';
import {
  getUsdSourceMetersPerUnit,
  normalizeUsdSceneSnapshotToMeters,
} from './usdStageUnits';

test('normalizes USD geometry, transforms, primitives, joints, and dynamics to meters', () => {
  const snapshot: UsdSceneSnapshot = {
    stage: { defaultPrimPath: '/World', metersPerUnit: 0.001 },
    robotTree: {
      jointCatalogEntries: [{ localPos0: [1000, 0, 0], originXyz: [0, 2000, 0] }],
    },
    physics: {
      linkDynamicsEntries: [{ centerOfMassLocal: [0, 0, 500], diagonalInertia: [1e6, 2e6, 3e6] }],
    },
    render: {
      meshDescriptors: [{ size: 2000, radius: 500, extentSize: [1000, 2000, 3000] }],
    },
    buffers: {
      positions: new Float32Array([0, 1000, -2000]),
      transforms: new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1000, 2000, 3000, 1]),
    },
    robotMetadataSnapshot: {
      jointCatalogEntries: [{ localPos1: [0, 0, 1000] }],
      linkDynamicsEntries: [{ centerOfMassLocal: [1000, 0, 0], diagonalInertia: [1e6, 0, 0] }],
      closedLoopConstraintEntries: [{ anchorWorld: [1000, 2000, 3000] }],
      meshCountsByLinkPath: {
        '/World': {
          collisionPrimitiveGeometries: [{ dimensions: [1000, 2000, 3000], originXyz: [500, 0, 0] }],
        },
      },
    },
  };

  const normalized = normalizeUsdSceneSnapshotToMeters(snapshot);

  assert.ok(normalized);
  assert.equal(normalized.stage?.metersPerUnit, 1);
  assert.equal(getUsdSourceMetersPerUnit(normalized), 0.001);
  assert.deepEqual(Array.from(normalized.buffers?.positions || []), [0, 1, -2]);
  assert.deepEqual(Array.from(normalized.buffers?.transforms || []).slice(12, 15), [1, 2, 3]);
  assert.deepEqual(Array.from(normalized.render?.meshDescriptors?.[0]?.extentSize || []), [1, 2, 3]);
  assert.equal(normalized.render?.meshDescriptors?.[0]?.radius, 0.5);
  assert.deepEqual(normalized.robotTree?.jointCatalogEntries?.[0]?.localPos0, [1, 0, 0]);
  assert.deepEqual(normalized.physics?.linkDynamicsEntries?.[0]?.centerOfMassLocal, [0, 0, 0.5]);
  assert.deepEqual(normalized.physics?.linkDynamicsEntries?.[0]?.diagonalInertia, [1, 2, 3]);
  assert.deepEqual(
    normalized.robotMetadataSnapshot?.closedLoopConstraintEntries?.[0]?.anchorWorld,
    [1, 2, 3],
  );
  assert.deepEqual(
    normalized.robotMetadataSnapshot?.meshCountsByLinkPath?.['/World']
      ?.collisionPrimitiveGeometries?.[0]?.dimensions,
    [1, 2, 3],
  );
  assert.deepEqual(Array.from(snapshot.buffers?.positions || []), [0, 1000, -2000]);
});

test('keeps meter-authored snapshots by identity', () => {
  const snapshot: UsdSceneSnapshot = { stage: { metersPerUnit: 1 } };
  assert.equal(normalizeUsdSceneSnapshotToMeters(snapshot), snapshot);
});
