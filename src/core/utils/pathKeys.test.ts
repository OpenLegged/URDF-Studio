import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeLibraryPathKey,
  normalizeVirtualDirectoryPath,
  normalizeVirtualUsdPath,
} from './pathKeys';

test('normalizes library path keys across Windows separators, queries, and traversal segments', () => {
  assert.equal(
    normalizeLibraryPathKey(' /robots//demo/../demo/usd/go2.usd?cache=1 '),
    'robots/demo/usd/go2.usd',
  );
  assert.equal(normalizeLibraryPathKey('\\pkg\\meshes\\base.stl'), 'pkg/meshes/base.stl');
  assert.equal(
    normalizeLibraryPathKey(' C:\\robots\\..\\assets\\arm.usd?revision=2 '),
    'C:/assets/arm.usd',
  );
});

test('normalizes virtual USD paths and directories with their required slash semantics', () => {
  assert.equal(
    normalizeVirtualUsdPath('unitree_model\\Go2//usd/./go2.usd?v=2026'),
    '/unitree_model/Go2/usd/go2.usd',
  );
  assert.equal(normalizeVirtualUsdPath('/unitree_model/Go2/usd/go2.usd'), '/unitree_model/Go2/usd/go2.usd');
  assert.equal(normalizeVirtualUsdPath(''), '/');
  assert.equal(normalizeVirtualUsdPath('textures/../textures/paint.png?cache=1'), '/textures/paint.png');
  assert.equal(normalizeVirtualDirectoryPath('unitree_model/Go2/usd/go2.usd'), '/unitree_model/Go2/usd/go2.usd/');
  assert.equal(normalizeVirtualDirectoryPath('/unitree_model/Go2/usd'), '/unitree_model/Go2/usd/');
  assert.equal(normalizeVirtualDirectoryPath('/'), '/');
  assert.equal(normalizeVirtualDirectoryPath('/models/./go2'), '/models/go2/');
  assert.equal(normalizeVirtualDirectoryPath(''), '/');
});
