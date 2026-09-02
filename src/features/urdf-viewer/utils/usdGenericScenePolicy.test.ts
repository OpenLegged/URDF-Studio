import assert from 'node:assert/strict';
import test from 'node:test';

import type { UsdSceneSnapshot } from '@/types';
import { shouldAutoFrameUsdGenericSceneSnapshot } from '@/lib/robot-parser/usd/usdGenericScenePolicy';

test('auto-frames generic scene descriptors attached directly to the default prim', () => {
  assert.equal(
    shouldAutoFrameUsdGenericSceneSnapshot({
      stage: { defaultPrimPath: '/World' },
      render: {
        meshDescriptors: [
          {
            meshId: '/World/visuals.proto_mesh_id0',
            sectionName: 'visuals',
            resolvedPrimPath: '/World/Environment/Visuals/id1',
          },
        ],
      },
    } as UsdSceneSnapshot),
    true,
  );
});

test('does not change robot snapshots whose visuals belong to child links', () => {
  assert.equal(
    shouldAutoFrameUsdGenericSceneSnapshot({
      stage: { defaultPrimPath: '/Robot' },
      render: {
        meshDescriptors: [
          {
            meshId: '/Robot/base_link/visuals.proto_mesh_id0',
            sectionName: 'visuals',
            resolvedPrimPath: '/Robot/base_link/visuals/body',
          },
        ],
      },
    } as UsdSceneSnapshot),
    false,
  );
});

test('does not collapse authored robot topology when render descriptor ids are flattened under the default prim', () => {
  assert.equal(
    shouldAutoFrameUsdGenericSceneSnapshot({
      stage: { defaultPrimPath: '/root' },
      robotMetadataSnapshot: {
        linkParentPairs: [
          ['/root/cabinet', null],
          ['/root/door', '/root/cabinet'],
        ],
        jointCatalogEntries: [
          {
            jointPath: '/root/door_hinge',
            parentLinkPath: '/root/cabinet',
            childLinkPath: '/root/door',
            jointType: 'revolute',
          },
        ],
      },
      render: {
        meshDescriptors: [
          {
            meshId: '/root/visuals.proto_mesh_id0',
            sectionName: 'visuals',
            resolvedPrimPath: '/root/cabinet/body_mesh',
          },
        ],
      },
    } as UsdSceneSnapshot),
    false,
  );
});
