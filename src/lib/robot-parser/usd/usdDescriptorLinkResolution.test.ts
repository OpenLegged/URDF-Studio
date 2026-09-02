import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveUsdDescriptorTargetLinkPath } from './usdDescriptorLinkResolution.ts';

test('uses the deepest authored link ancestor when Hydra flattens descriptor ids', () => {
  assert.equal(
    resolveUsdDescriptorTargetLinkPath({
      descriptor: {
        meshId: '/root/visuals.proto_mesh_id5',
        sectionName: 'visuals',
        resolvedPrimPath: '/root/cabinet/door/panel_mesh',
        primType: 'Mesh',
      },
      knownLinkPaths: ['/root/cabinet', '/root/cabinet/door'],
    }),
    '/root/cabinet/door',
  );
});
