import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { createUsdOffscreenInteractionState } from './usdOffscreenInteractionState.ts';

test('offscreen interaction state owns selection and runtime mesh indexes', () => {
  const state = createUsdOffscreenInteractionState({ restoreHighlight: () => undefined });
  const mesh = new THREE.Mesh();
  const meta = {
    linkPath: '/robot/base',
    meshId: '/robot/base/visuals/body',
    role: 'visual' as const,
  };

  state.setSelection({ type: 'link', id: 'base', subType: 'visual' });
  state.setHoveredSelection({ type: 'link', id: 'base', objectIndex: 0 });
  state.setLastEmittedHover({ type: 'link', id: 'base', objectIndex: 0 });
  state.replaceMeshIndex({
    meshMetaByObject: new Map([[mesh, meta]]),
    meshesByLinkKey: new Map([['/robot/base:visual', [mesh]]]),
    pickMeshes: [mesh],
    helperTargets: [mesh],
  });

  assert.equal(state.selection?.type, 'link');
  assert.equal(state.selection?.id, 'base');
  assert.equal(state.selection?.subType, 'visual');
  assert.equal(state.meshMetaByObject.get(mesh), meta);
  assert.deepEqual(state.meshesByLinkKey.get('/robot/base:visual'), [mesh]);
  assert.deepEqual(state.pickMeshes, [mesh]);
  assert.deepEqual(state.helperTargets, [mesh]);
});

test('stage reset restores highlights and preserves interaction selection', () => {
  const mesh = new THREE.Mesh();
  const snapshot = { marker: 'original-material' };
  const restored: Array<[THREE.Mesh, unknown]> = [];
  const state = createUsdOffscreenInteractionState({
    restoreHighlight: (highlightedMesh, highlightedSnapshot) => {
      restored.push([highlightedMesh, highlightedSnapshot]);
    },
  });

  state.setSelection({ type: 'joint', id: 'shoulder' });
  state.replaceMeshIndex({
    meshMetaByObject: new Map([
      [mesh, { linkPath: '/arm', meshId: '/arm/visual', role: 'visual' }],
    ]),
    meshesByLinkKey: new Map([['/arm:visual', [mesh]]]),
    pickMeshes: [mesh],
    helperTargets: [mesh],
  });
  state.setHighlight(mesh, snapshot);

  state.resetStageResources();

  assert.deepEqual(restored, [[mesh, snapshot]]);
  assert.equal(state.meshMetaByObject.size, 0);
  assert.equal(state.meshesByLinkKey.size, 0);
  assert.deepEqual(state.pickMeshes, []);
  assert.deepEqual(state.helperTargets, []);
  assert.equal(state.getHighlight(mesh), undefined);
  assert.equal(state.selection?.type, 'joint');
  assert.equal(state.selection?.id, 'shoulder');
});

test('full reset clears selection without replacing pointer utilities', () => {
  const state = createUsdOffscreenInteractionState({ restoreHighlight: () => undefined });
  const raycaster = state.raycaster;
  const pointer = state.pointer;

  state.setSelection({ type: 'link', id: 'base' });
  state.setHoveredSelection({ type: 'link', id: 'base' });
  state.setLastEmittedHover({ type: 'link', id: 'base' });
  state.resetAll();

  assert.equal(state.selection, null);
  assert.equal(state.hoveredSelection, null);
  assert.equal(state.lastEmittedHover, null);
  assert.equal(state.raycaster, raycaster);
  assert.equal(state.pointer, pointer);
});
