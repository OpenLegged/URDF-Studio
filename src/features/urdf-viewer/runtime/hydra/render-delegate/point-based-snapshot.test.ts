import assert from 'node:assert/strict';
import test from 'node:test';
import { BufferGeometry, Float32BufferAttribute, LineSegments, Matrix4, Points } from 'three';

import { collectLivePointBasedSnapshotEntries } from './point-based-snapshot.js';

test('captures non-empty Points and tessellated BasisCurves with local transforms', () => {
  const pointGeometry = new BufferGeometry();
  pointGeometry.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 1, 2, 3], 3));
  const points = new Points(pointGeometry);
  points.matrix.copy(new Matrix4().makeTranslation(4, 5, 6));
  points.userData.usdPrimPath = '/World/Particles';

  const curveGeometry = new BufferGeometry();
  curveGeometry.setAttribute(
    'position',
    new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 1, 0], 3),
  );
  const curves = new LineSegments(curveGeometry);

  const entries = collectLivePointBasedSnapshotEntries({
    '/World/Particles': { _typeId: 'points', _mesh: points },
    '/World/Curves': { _typeId: 'basiscurves', _mesh: curves },
    '/World/Mesh': { _typeId: 'mesh', _mesh: points },
  });

  assert.equal(entries.length, 2);
  assert.equal(entries[0].primType, 'basiscurves');
  assert.deepEqual(Array.from(entries[0].positions), [0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 1, 0]);
  assert.equal(entries[1].primType, 'points');
  assert.deepEqual(Array.from(entries[1].transform).slice(12, 15), [4, 5, 6]);
});
