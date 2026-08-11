import test from 'node:test';
import assert from 'node:assert/strict';

import { getDescriptorLinkPath } from './usdExportPaths.ts';

test('getDescriptorLinkPath preserves authored robot visual ownership', () => {
  assert.equal(
    getDescriptorLinkPath({
      meshId: '/Robot/base_link/visuals.proto_mesh_id0',
      resolvedPrimPath: '/Robot/base_link/visuals/mesh_0',
      sectionName: 'visuals',
      primType: 'mesh',
      ranges: {},
    }),
    '/Robot/base_link',
  );
});

test('getDescriptorLinkPath maps generic scene meshes to their owning prim', () => {
  assert.equal(
    getDescriptorLinkPath({
      meshId: '/World/Room/Table/TableTop',
      resolvedPrimPath: '/World/Room/Table/TableTop',
      sectionName: 'visuals',
      primType: 'mesh',
      ranges: {},
    }),
    '/World/Room/Table',
  );
});
