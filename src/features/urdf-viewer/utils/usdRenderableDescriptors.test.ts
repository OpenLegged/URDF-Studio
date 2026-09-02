import test from 'node:test';
import assert from 'node:assert/strict';

import { selectUsdRenderableMeshDescriptors } from '@/lib/robot-parser/usd/usdRenderableDescriptors';

test('keeps the authored render binding and drops a duplicate PhysicsMaterial descriptor', () => {
  const rendered = {
    meshId: '/Robot/visuals.proto_mesh_id0',
    resolvedPrimPath: '/Robot/cabinet/P_9',
    primType: 'mesh',
    materialId: '/Robot/materials/walnut',
  };
  const physics = {
    meshId: '/Robot/cabinet/P_9',
    resolvedPrimPath: '/Robot/cabinet/P_9',
    primType: 'mesh',
    materialId: '/Robot/PhysicsMaterial',
  };

  const selected = selectUsdRenderableMeshDescriptors({
    render: {
      meshDescriptors: [rendered, physics],
      materials: [
        {
          materialId: '/Robot/materials/walnut',
          name: 'walnut',
          mapPath: 'textures/walnut.jpg',
        },
        {
          materialId: '/Robot/PhysicsMaterial',
          name: 'PhysicsMaterial',
          color: [0.5, 0.5, 0.5],
        },
      ],
    },
  });

  assert.deepEqual(selected, [rendered]);
});

test('retains a lone PhysicsMaterial descriptor for collision-only compatibility', () => {
  const physics = {
    meshId: '/Robot/collision',
    resolvedPrimPath: '/Robot/collision',
    primType: 'mesh',
    materialId: '/Robot/PhysicsMaterial',
  };

  assert.deepEqual(selectUsdRenderableMeshDescriptors({
    render: {
      meshDescriptors: [physics],
      materials: [{
        materialId: '/Robot/PhysicsMaterial',
        name: 'PhysicsMaterial',
      }],
    },
  }), [physics]);
});
