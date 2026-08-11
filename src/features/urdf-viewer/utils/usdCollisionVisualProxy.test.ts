import test from 'node:test';
import assert from 'node:assert/strict';

import { shouldUseUsdCollisionVisualProxy } from '@/lib/robot-parser/usd/usdCollisionVisualProxy';

test('detects collision-only USD snapshots as visual proxy candidates', () => {
  assert.equal(
    shouldUseUsdCollisionVisualProxy({
      robotMetadataSnapshot: {
        meshCountsByLinkPath: {
          '/Robot/base_link': {
            visualMeshCount: 0,
            collisionMeshCount: 1,
            collisionPrimitiveCounts: { box: 1 },
          },
        },
      },
      render: {
        meshDescriptors: [
          {
            meshId: '/Robot/base_link/collisions.proto_box_id0',
            sectionName: 'collisions',
            resolvedPrimPath: '/Robot/base_link/collisions/mesh_0/box',
            primType: 'cube',
          },
        ],
      },
    } as any),
    true,
  );
});

test('does not proxy when visual descriptors are present', () => {
  assert.equal(
    shouldUseUsdCollisionVisualProxy({
      robotMetadataSnapshot: {
        meshCountsByLinkPath: {
          '/Robot/base_link': {
            visualMeshCount: 0,
            collisionMeshCount: 1,
            collisionPrimitiveCounts: { box: 1 },
          },
        },
      },
      render: {
        meshDescriptors: [
          {
            meshId: '/Robot/base_link/visuals.proto_mesh_id0',
            sectionName: 'visuals',
            resolvedPrimPath: '/Robot/base_link/visuals/mesh_0',
            primType: 'mesh',
          },
          {
            meshId: '/Robot/base_link/collisions.proto_box_id0',
            sectionName: 'collisions',
            resolvedPrimPath: '/Robot/base_link/collisions/mesh_0/box',
            primType: 'cube',
          },
        ],
      },
    } as any),
    false,
  );
});

test('does not proxy when metadata already reports visual geometry', () => {
  assert.equal(
    shouldUseUsdCollisionVisualProxy({
      robotMetadataSnapshot: {
        meshCountsByLinkPath: {
          '/Robot/base_link': {
            visualMeshCount: 1,
            collisionMeshCount: 1,
            collisionPrimitiveCounts: { box: 1 },
          },
        },
      },
      render: {
        meshDescriptors: [
          {
            meshId: '/Robot/base_link/collisions.proto_box_id0',
            sectionName: 'collisions',
            resolvedPrimPath: '/Robot/base_link/collisions/mesh_0/box',
            primType: 'cube',
          },
        ],
      },
    } as any),
    false,
  );
});
