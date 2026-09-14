import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { syncMjcfTendonVisualizationForRobot } from './visualizationObjectSync';
import { syncMjcfTendonVisualMeshMap } from './mjcfTendonVisualMeshMap';

function createRobotWithMjcfTendon() {
  const robot = new THREE.Group();
  robot.userData.__mjcfTendonsData = [
    {
      name: 'ankle_bar',
      rgba: [1, 0, 0, 1],
      attachmentRefs: ['site_a', 'site_b'],
    },
  ];

  const linkA = new THREE.Group() as THREE.Group & { isURDFLink?: boolean };
  linkA.isURDFLink = true;
  linkA.name = 'link_a';
  linkA.userData.__mjcfSitesData = [{ name: 'site_a', pos: [0, 0, 0], size: [0.005] }];
  robot.add(linkA);

  const linkB = new THREE.Group() as THREE.Group & { isURDFLink?: boolean };
  linkB.isURDFLink = true;
  linkB.name = 'link_b';
  linkB.userData.__mjcfSitesData = [{ name: 'site_b', pos: [0, 0.1, 0], size: [0.005] }];
  robot.add(linkB);
  robot.updateMatrixWorld(true);

  return { robot, linkA, linkB };
}

test('syncMjcfTendonVisualMeshMap merges tendon meshes into the normal visual buckets', () => {
  const { robot } = createRobotWithMjcfTendon();
  const linkAVisualMesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial(),
  );
  const linkMeshMap = new Map<string, THREE.Mesh[]>([['link_a:visual', [linkAVisualMesh]]]);

  const tendonChanged = syncMjcfTendonVisualizationForRobot({
    robot,
    sourceFormat: 'mjcf',
    showMjcfTendons: true,
  });
  assert.equal(tendonChanged, true);

  const firstMapChanged = syncMjcfTendonVisualMeshMap(linkMeshMap, robot);
  const secondMapChanged = syncMjcfTendonVisualMeshMap(linkMeshMap, robot);

  assert.equal(firstMapChanged, true);
  assert.equal(secondMapChanged, false);

  const linkAVisualBucket = linkMeshMap.get('link_a:visual');
  const linkBVisualBucket = linkMeshMap.get('link_b:visual');
  assert.ok(linkAVisualBucket);
  assert.ok(linkBVisualBucket);
  assert.equal(linkAVisualBucket[0], linkAVisualMesh);
  assert.ok(linkAVisualBucket.some((mesh) => mesh.userData?.isMjcfTendon === true));
  assert.ok(linkBVisualBucket.every((mesh) => mesh.userData?.parentLinkName === 'link_b'));
  assert.ok(linkBVisualBucket.every((mesh) => mesh.userData?.isVisualMesh === true));
});

test('syncMjcfTendonVisualMeshMap removes hidden tendon meshes from visual buckets', () => {
  const { robot } = createRobotWithMjcfTendon();
  const linkMeshMap = new Map<string, THREE.Mesh[]>();

  syncMjcfTendonVisualizationForRobot({
    robot,
    sourceFormat: 'mjcf',
    showMjcfTendons: true,
  });
  syncMjcfTendonVisualMeshMap(linkMeshMap, robot);

  const hiddenChanged = syncMjcfTendonVisualizationForRobot({
    robot,
    sourceFormat: 'mjcf',
    showMjcfTendons: false,
  });
  const removedFromMap = syncMjcfTendonVisualMeshMap(linkMeshMap, robot);

  assert.equal(hiddenChanged, true);
  assert.equal(removedFromMap, true);
  assert.equal(linkMeshMap.has('link_a:visual'), false);
  assert.equal(linkMeshMap.has('link_b:visual'), false);
});
