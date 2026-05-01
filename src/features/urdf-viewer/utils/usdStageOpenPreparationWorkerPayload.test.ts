import assert from 'node:assert/strict';
import test from 'node:test';

import { buildUsdStageOpenPreparationWorkerDispatch } from './usdStageOpenPreparationWorkerPayload.ts';

test('buildUsdStageOpenPreparationWorkerDispatch keeps USD layer candidates for worker-side reference filtering', () => {
  const dispatch = buildUsdStageOpenPreparationWorkerDispatch(
    {
      name: 'robots/go2/root.usda',
      content: '#usda 1.0\n',
      blobUrl: 'blob:root',
    },
    [
      {
        name: 'robots/go2/root.usda',
        content: '#usda 1.0\n',
        blobUrl: 'blob:root',
        format: 'usd',
      },
      {
        name: 'robots/go2/configuration/base.usda',
        content: '#usda 1.0\n',
        blobUrl: 'blob:base',
        format: 'usd',
      },
      {
        name: 'shared/common_layers/materials.usda',
        content: '#usda 1.0\n',
        blobUrl: 'blob:shared-materials',
        format: 'usd',
      },
      {
        name: 'robots/go2/meshes/base.obj',
        content: 'o base',
        blobUrl: 'blob:mesh',
        format: 'mesh',
      },
      {
        name: 'robots/go2/notes.txt',
        content: 'not usd',
        blobUrl: 'blob:notes',
        format: 'asset',
      },
    ],
    {
      'robots/go2/configuration/base.usda': 'blob:base',
      'shared/common_layers/materials.usda': 'blob:shared-materials',
      'robots/go2/textures/body.png': 'blob:texture',
    },
  );

  assert.deepEqual(
    (dispatch.contextSnapshot?.availableFiles ?? []).map((file) => file.name),
    [
      'robots/go2/configuration/base.usda',
      'shared/common_layers/materials.usda',
    ],
  );
  assert.deepEqual(dispatch.contextSnapshot?.assets, {
    'robots/go2/configuration/base.usda': 'blob:base',
    'shared/common_layers/materials.usda': 'blob:shared-materials',
  });
});
