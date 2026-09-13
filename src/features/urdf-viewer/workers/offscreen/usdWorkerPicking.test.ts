import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { DEFAULT_LINK, GeometryType } from '@/types';
import { createSyntheticUsdViewerRobotResolution } from '../../utils/usdRuntimeMeshMapping.ts';
import { buildUsdWorkerMeshIndex, applyUsdWorkerMeshIndexMetadata } from './usdWorkerMeshIndex.ts';
import { pickUsdWorkerInteractionTarget } from './usdWorkerPicking.ts';

function createScene() {
  const root = new THREE.Group();
  const visual = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  const collision = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  const visualId = '/Robot/base/visuals.proto_mesh_id3';
  const collisionId = '/Robot/base/collisions.proto_mesh_id0';
  root.add(visual, collision);
  root.updateMatrixWorld(true);
  const resolution = createSyntheticUsdViewerRobotResolution({ meshIds: [visualId, collisionId] });
  const link = resolution.robotData.links[resolution.robotData.rootLinkId];
  link.collision = { ...DEFAULT_LINK.collision, type: GeometryType.BOX };
  const index = buildUsdWorkerMeshIndex({
    root,
    resolution,
    renderInterface: {
      meshes: { [visualId]: { _mesh: visual }, [collisionId]: { _mesh: collision } },
    },
  });
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
  camera.position.set(0, 0, 5);
  camera.updateMatrixWorld(true);
  const pick = (priority: Array<'visual' | 'collision'>) =>
    pickUsdWorkerInteractionTarget({
      localX: 50,
      localY: 50,
      camera,
      viewport: { width: 100, height: 100 },
      index,
      resolution,
      interactionLayerPriority: priority,
      pointer: new THREE.Vector2(),
      raycaster: new THREE.Raycaster(),
    });
  const dispose = () => {
    for (const mesh of [visual, collision]) {
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
  };
  return { root, visual, collision, index, pick, dispose };
}

test('index construction preserves authored geometry indices without changing rendering metadata', () => {
  const scene = createScene();
  try {
    assert.equal(scene.index.meshMetaByObject.get(scene.visual)?.objectIndex, 3);
    assert.equal(scene.index.meshMetaByObject.get(scene.collision)?.objectIndex, 0);
    assert.deepEqual(scene.visual.userData, {});
    assert.deepEqual(scene.collision.userData, {});
    applyUsdWorkerMeshIndexMetadata(scene.index);
    assert.equal(scene.visual.userData.usdObjectIndex, 3);
    assert.equal(scene.visual.userData.geometryRole, 'visual');
    assert.equal(scene.collision.userData.usdObjectIndex, 0);
    assert.equal(scene.collision.userData.geometryRole, 'collision');
  } finally {
    scene.dispose();
  }
});

test('the same overlapping geometry follows explicit layer priority and ancestor visibility', () => {
  const scene = createScene();
  try {
    assert.equal(scene.pick(['visual', 'collision'])?.kind, 'geometry');
    const visualFirst = scene.pick(['visual', 'collision']);
    const collisionFirst = scene.pick(['collision', 'visual']);
    assert.equal(visualFirst?.kind === 'geometry' && visualFirst.meta.role, 'visual');
    assert.equal(collisionFirst?.kind === 'geometry' && collisionFirst.meta.role, 'collision');
    scene.root.visible = false;
    assert.equal(scene.pick(['collision', 'visual']), null);
  } finally {
    scene.dispose();
  }
});

test('a collision without a corresponding geometry index cannot steal the visual pick', () => {
  const scene = createScene();
  try {
    const meta = scene.index.meshMetaByObject.get(scene.collision);
    assert.ok(meta);
    meta.objectIndex = undefined;
    const target = scene.pick(['collision', 'visual']);
    assert.equal(target?.kind === 'geometry' && target.meta.role, 'visual');
  } finally {
    scene.dispose();
  }
});
