import { strict as assert } from 'node:assert';
import test from 'node:test';

import { createImportPathCollisionMap, remapImportedPath } from './libraryImportPathCollisions';

test('import collision paths use shared library key normalization', () => {
  const pathMap = createImportPathCollisionMap(
    ['/robots//demo/../demo/model.urdf?cache=1'],
    [],
  );

  assert.equal(
    remapImportedPath('\\robots\\demo\\model.urdf?cache=2', pathMap),
    'robots/demo/model.urdf',
  );
});

test('import retains a literal question mark in a directory when resolving a top-level collision', () => {
  const files = ['set/a/robot.urdf', 'set/a?view/robot.urdf'];
  const pathMap = createImportPathCollisionMap(files, ['set/old.urdf']);

  assert.deepEqual(files.map((file) => remapImportedPath(file, pathMap)), [
    'set (1)/a/robot.urdf',
    'set (1)/a?view/robot.urdf',
  ]);
});
