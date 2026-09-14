import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as THREE from 'three';
import type { UsdSceneSnapshot } from '@/types';

type SnapshotFallback = (
  snapshot: UsdSceneSnapshot,
  renderInterface: { meshes: Record<string, { _mesh: THREE.Mesh }> },
) => UsdSceneSnapshot;

function createSnapshotFallback(): SnapshotFallback {
  const source = ts.createSourceFile(
    'worker.ts',
    readFileSync(new URL('./usdOffscreenViewer.worker.ts', import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  const declaration = source.statements.find((statement) =>
    ts.isFunctionDeclaration(statement)
      && statement.name?.text === 'buildLiveMeshSceneSnapshotFallback',
  );
  assert.ok(declaration);
  const code = ts.transpileModule(declaration.getText(source), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  // Exercise the worker's production builder without starting a WASM/GL worker.
  return runInNewContext(`${code}\nbuildLiveMeshSceneSnapshotFallback`, {
    THREE,
    isVisibleInHierarchy: (mesh: THREE.Object3D) => mesh.visible,
  }) as SnapshotFallback;
}

test('live scene snapshots preserve large indexed geometry and subsequent mesh ranges', () => {
  const vertexCount = 150_000;
  const positions = Float32Array.from({ length: vertexCount * 3 }, (_, i) => i / 10);
  const indices = Uint32Array.from({ length: vertexCount }, (_, i) => vertexCount - i - 1);
  const normals = new Float32Array(vertexCount * 3).fill(0.5);
  const uvs = new Float32Array(vertexCount * 2).fill(0.25);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  const material = new THREE.MeshStandardMaterial();
  const large = new THREE.Mesh(geometry, material);
  large.position.set(1, 2, 3);
  const tailGeometry = new THREE.BufferGeometry();
  tailGeometry.setAttribute('position', new THREE.Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1], 3));
  const tail = new THREE.Mesh(tailGeometry, material);
  try {
    const snapshot = createSnapshotFallback()({}, {
      meshes: { '/World/large': { _mesh: large }, '/World/tail': { _mesh: tail } },
    });
    const buffers = snapshot.buffers;
    assert.ok(buffers);
    assert.equal(buffers.positions?.length, positions.length + 9);
    assert.equal(buffers.positions?.[positions.length - 1], positions.at(-1));
    assert.equal(buffers.positions?.[positions.length], 1);
    assert.equal(buffers.indices?.[0], vertexCount - 1);
    assert.equal(buffers.indices?.[vertexCount - 1], 0);
    assert.equal(buffers.normals?.[normals.length - 1], 0.5);
    assert.equal(buffers.uvs?.[uvs.length - 1], 0.25);
    assert.equal(buffers.rangesByMeshId?.['/World/tail']?.positions?.offset, positions.length);
    assert.equal(buffers.rangesByMeshId?.['/World/tail']?.indices?.offset, indices.length);
    assert.equal(buffers.transforms?.[12], 1);
    assert.equal(buffers.transforms?.[13], 2);
    assert.equal(buffers.transforms?.[14], 3);
  } finally {
    geometry.dispose();
    tailGeometry.dispose();
    material.dispose();
  }
});
