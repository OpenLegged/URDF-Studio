import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import type { UsdSceneSnapshot } from '@/types';
import { computeLinkWorldMatrices, createOriginMatrix } from '@/core/robot/kinematics';
import { adaptUsdViewerSnapshotToRobotData } from '@/lib/robot-parser/usd/usdViewerRobotAdapter';
import { hydrateUsdViewerRobotResolutionFromRuntime } from './usdRuntimeRobotHydration';
import { buildUsdExportBundleFromSnapshot, prepareUsdExportCacheFromResolvedSnapshot } from './usdExportBundle';

for (const { reflected, units } of [
  { reflected: false, units: 1 }, { reflected: true, units: 1 },
  { reflected: false, units: 0.01 }, { reflected: true, units: 0.01 },
]) {
  test(`preserves ${reflected ? 'reflected' : 'regular'} sheared USD geometry and normals through prepared OBJ at ${units} meters per unit`, async () => {
    const positions = [0, 0, 0, 0.3, 0.1, 0.05, 0.03, 0.23, 0.02];
    const normal = new THREE.Vector3().fromArray(positions, 3)
      .cross(new THREE.Vector3().fromArray(positions, 6)).normalize();
    const world = new THREE.Matrix4().makeTranslation(0.23, -0.4, 0.19)
      .multiply(new THREE.Matrix4().makeRotationX(0.37))
      .multiply(new THREE.Matrix4().makeScale(reflected ? -2 : 2, 3, 4))
      .multiply(new THREE.Matrix4().makeRotationY(0.63));
    const snapshot: UsdSceneSnapshot = {
      stage: { defaultPrimPath: '/World', metersPerUnit: units },
      robotMetadataSnapshot: { source: 'mesh-only' },
      render: { meshDescriptors: [{
        meshId: '/World/visuals.proto_mesh_id0',
        resolvedPrimPath: '/World/Part', sectionName: 'visuals', primType: 'mesh',
        ranges: {
          positions: { offset: 0, count: 9, stride: 3 },
          normals: { offset: 0, count: 9, stride: 3 },
          transform: { offset: 0, count: 16, stride: 16 },
        },
      }] },
      buffers: { positions, normals: [...normal.toArray(), ...normal.toArray(), ...normal.toArray()], transforms: world.elements },
    };
    const resolution = adaptUsdViewerSnapshotToRobotData(snapshot);
    assert.ok(resolution);
    const hydrated = hydrateUsdViewerRobotResolutionFromRuntime(resolution, snapshot, {
      getPreferredLinkWorldTransform: () => new THREE.Matrix4(),
    });
    assert.ok(hydrated);
    const prepared = prepareUsdExportCacheFromResolvedSnapshot(snapshot, hydrated);
    const links = computeLinkWorldMatrices(prepared.robotData);
    const link = Object.values(prepared.robotData.links).find((entry) => entry.visual.meshPath);
    assert.ok(link?.visual.meshPath);
    const visual = link.visual;
    const actualMatrix = links[link.id].clone().multiply(createOriginMatrix(visual.origin))
      .scale(new THREE.Vector3(visual.dimensions.x, visual.dimensions.y, visual.dimensions.z));
    const obj = new OBJLoader().parse(await prepared.meshFiles[visual.meshPath!].text());
    const mesh = obj.children.find((entry): entry is THREE.Mesh => entry instanceof THREE.Mesh);
    assert.ok(mesh);
    try {
      const vertices = mesh.geometry.getAttribute('position');
      const normals = mesh.geometry.getAttribute('normal');
      for (let vertex = 0; vertex < 3; vertex += 1) {
        const expected = new THREE.Vector3().fromArray(positions, vertex * 3).applyMatrix4(world).multiplyScalar(units);
        const actual = new THREE.Vector3().fromBufferAttribute(vertices, vertex).applyMatrix4(actualMatrix);
        assert.ok(actual.distanceTo(expected) < 5e-6, `vertex ${vertex}: expected ${expected.toArray()}, got ${actual.toArray()}`);
        const expectedNormal = normal.clone().applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(world));
        const actualNormal = new THREE.Vector3().fromBufferAttribute(normals, vertex)
          .applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(actualMatrix));
        assert.ok(actualNormal.distanceTo(expectedNormal) < 5e-6, `normal ${vertex} must use inverse transpose`);
      }
    } finally {
      mesh.geometry.dispose();
      (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach((material) => material.dispose());
    }

    const editedRobot = structuredClone(prepared.robotData);
    editedRobot.links[link.id].visual.origin!.xyz.x += 0.07;
    const exported = buildUsdExportBundleFromSnapshot(snapshot, { resolution: hydrated, currentRobot: editedRobot });
    assert.ok(exported);
    const exportedLink = exported.robot.links[link.id];
    const exportedVisual = exportedLink.visual;
    const exportBlob = exported.meshFiles.get(exportedVisual.meshPath!);
    assert.ok(exportBlob);
    const exportedObj = new OBJLoader().parse(await exportBlob.text());
    const exportedMesh = exportedObj.children.find((entry): entry is THREE.Mesh => entry instanceof THREE.Mesh);
    assert.ok(exportedMesh);
    try {
      const exportMatrix = computeLinkWorldMatrices(exported.robot)[link.id]
        .multiply(createOriginMatrix(exportedVisual.origin))
        .scale(new THREE.Vector3(exportedVisual.dimensions.x, exportedVisual.dimensions.y, exportedVisual.dimensions.z));
      for (let vertex = 0; vertex < 3; vertex += 1) {
        const expected = new THREE.Vector3().fromArray(positions, vertex * 3).applyMatrix4(world).multiplyScalar(units);
        expected.x += 0.07;
        const actual = new THREE.Vector3().fromBufferAttribute(exportedMesh.geometry.getAttribute('position'), vertex)
          .applyMatrix4(exportMatrix);
        assert.ok(actual.distanceTo(expected) < 5e-6, 'affine remainder must not cancel a user origin edit');
      }
    } finally {
      exportedMesh.geometry.dispose();
      (Array.isArray(exportedMesh.material) ? exportedMesh.material : [exportedMesh.material])
        .forEach((material) => material.dispose());
    }
  });
}
