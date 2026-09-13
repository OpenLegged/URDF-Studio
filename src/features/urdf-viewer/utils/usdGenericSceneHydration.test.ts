import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';

import type { UsdSceneSnapshot } from '@/types';
import { computeLinkWorldMatrices, createOriginMatrix } from '@/core/robot/kinematics';
import { adaptUsdViewerSnapshotToRobotData } from '@/lib/robot-parser/usd/usdViewerRobotAdapter';
import { hydrateUsdViewerRobotResolutionFromRuntime } from './usdRuntimeRobotHydration';
import { prepareUsdExportCacheFromResolvedSnapshot } from './usdExportBundle';

function createGenericSceneFixture(meshCount: number, mirrored = false) {
  const positions = [0, 0, 0, 0.012, 0, 0, 0, 0.017, 0];
  const worldTransforms = Array.from({ length: meshCount }, (_, index) =>
    new THREE.Matrix4().compose(
      new THREE.Vector3(0.03 * index, -0.02 * index, 0.04 * index),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0.1 * index, 0.2, -0.3, 'ZYX')),
      new THREE.Vector3(mirrored && index % 2 === 1 ? -2 : 2, 3, 4),
    ),
  );
  const snapshot: UsdSceneSnapshot = {
    stageSourcePath: '/cad.usdc',
    stage: { defaultPrimPath: '/World', metersPerUnit: 1, sourceMetersPerUnit: 0.001 },
    robotMetadataSnapshot: { source: 'mesh-only' },
    render: {
      meshDescriptors: worldTransforms.map((_, index) => ({
        meshId: `/World/visuals.proto_mesh_id${index}`,
        resolvedPrimPath: `/World/Instance_${index}/Part`,
        sectionName: 'visuals',
        primType: 'mesh',
        ranges: {
          positions: { offset: 0, count: positions.length, stride: 3 },
          transform: { offset: index * 16, count: 16, stride: 16 },
        },
      })),
    },
    buffers: {
      positions: new Float32Array(positions),
      transforms: worldTransforms.flatMap((matrix) => matrix.elements),
    },
  };
  return { snapshot, positions, worldTransforms };
}

for (const { mirrored, runtimeHasMeshTransforms } of [
  { mirrored: false, runtimeHasMeshTransforms: true },
  { mirrored: false, runtimeHasMeshTransforms: false },
  { mirrored: true, runtimeHasMeshTransforms: true },
  { mirrored: true, runtimeHasMeshTransforms: false },
]) {
  test(`preserves ${mirrored ? 'mirrored' : 'regular'} CAD mesh poses through prepared OBJ hydration with ${runtimeHasMeshTransforms ? 'available' : 'missing'} runtime transforms`, async () => {
    const { snapshot, positions, worldTransforms } = createGenericSceneFixture(12, mirrored);
    const resolution = adaptUsdViewerSnapshotToRobotData(snapshot);
    assert.ok(resolution);

    const runtimeMatrices = new Map(
      Array.from(snapshot.render?.meshDescriptors || []).map((descriptor, index) => {
        const matrix = worldTransforms[index].clone();
        matrix.elements[12] *= 1000;
        matrix.elements[13] *= 1000;
        matrix.elements[14] *= 1000;
        return [descriptor.resolvedPrimPath!, matrix] as const;
      }),
    );
    const hydrated = hydrateUsdViewerRobotResolutionFromRuntime(resolution, snapshot, {
      getPreferredLinkWorldTransform: () => new THREE.Matrix4(),
      getWorldTransformForPrimPath: (primPath) =>
        runtimeHasMeshTransforms ? runtimeMatrices.get(primPath) : null,
    });
    assert.ok(hydrated);

    const prepared = prepareUsdExportCacheFromResolvedSnapshot(snapshot, hydrated);
    const linkWorldMatrices = computeLinkWorldMatrices(prepared.robotData);
    assert.equal(Object.keys(prepared.meshFiles).length, worldTransforms.length);
    assert.equal(Object.keys(prepared.robotData.links).length, worldTransforms.length);

    for (const [meshIndex, expectedWorld] of worldTransforms.entries()) {
      const link = Object.values(prepared.robotData.links).find(
        (candidate) => candidate.visual.meshPath === `World_visual_${meshIndex}.obj`,
      );
      assert.ok(link, `mesh ${meshIndex} should have an exportable visual`);
      const visual = link.visual;
      const actualWorld = linkWorldMatrices[link.id].clone()
        .multiply(createOriginMatrix(visual.origin))
        .scale(new THREE.Vector3(visual.dimensions.x, visual.dimensions.y, visual.dimensions.z));
      const obj = new OBJLoader().parse(await prepared.meshFiles[visual.meshPath!].text());
      const mesh = obj.children.find((child): child is THREE.Mesh => child instanceof THREE.Mesh);
      assert.ok(mesh);
      const exportedPositions = mesh.geometry.getAttribute('position');
      for (let vertex = 0; vertex < 3; vertex += 1) {
        const expected = new THREE.Vector3().fromArray(positions, vertex * 3).applyMatrix4(expectedWorld);
        const actual = new THREE.Vector3().fromBufferAttribute(exportedPositions, vertex).applyMatrix4(actualWorld);
        assert.ok(
          actual.distanceTo(expected) < 1e-7,
          `mesh ${meshIndex}, vertex ${vertex}: expected ${expected.toArray()}, got ${actual.toArray()}`,
        );
      }
      mesh.geometry.dispose();
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      materials.forEach((material) => material.dispose());
    }
  });
}
