import assert from 'node:assert/strict';
import test from 'node:test';

import type { ExportDescriptor } from './internalTypes';
import { buildObjBlobFromDescriptor } from './objGeometrySerializer';

function createDescriptor(primType: string, positionCount: number): ExportDescriptor {
  return {
    descriptor: {
      meshId: `/World/${primType}`,
      primType,
      ranges: { positions: { offset: 0, count: positionCount, stride: 3 } },
    },
    meshId: `/World/${primType}`,
    linkPath: '/World',
    linkId: 'World',
    role: 'visual',
    exportPath: `${primType}.obj`,
    ordinal: 0,
  };
}

test('serializes UsdGeomPoints as OBJ point elements', async () => {
  const result = buildObjBlobFromDescriptor(createDescriptor('points', 6), {
    positions: new Float32Array([0, 0, 0, 1, 2, 3]),
  });

  assert.ok(result);
  assert.match(await result.blob.text(), /\np 1 2\n$/);
});

test('serializes tessellated BasisCurves as OBJ line segments', async () => {
  const result = buildObjBlobFromDescriptor(createDescriptor('basiscurves', 12), {
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 1, 0]),
  });

  assert.ok(result);
  const text = await result.blob.text();
  assert.match(text, /\nl 1 2\n/);
  assert.match(text, /\nl 3 4\n$/);
  assert.doesNotMatch(text, /\nf /);
});
