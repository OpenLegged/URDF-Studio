import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { Matrix4, Quaternion, Vector3 } from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';

import type { UsdSceneMeshDescriptor, UsdSceneSnapshot, UrdfVisual } from '@/types';
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

function createShelfSnapshot(): UsdSceneSnapshot {
  const paths = ['/root/body/top/mesh', '/root/body/left/mesh', '/root/body/right/mesh'];
  const transforms = [
    new Matrix4().compose(new Vector3(0, 0, 0.925), new Quaternion(), new Vector3(39.37, 39.37, 39.37)),
    new Matrix4().compose(new Vector3(-0.24, 0.34, 0.5), new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), -Math.PI / 2), new Vector3(39.37, 39.37, 39.37)),
    new Matrix4().compose(new Vector3(0.28, -0.34, 0.075), new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.3), new Vector3(2, 3, 4)),
  ];
  const descriptors: UsdSceneMeshDescriptor[] = paths.map((path, index) => ({
    meshId: `/root/visuals.proto_mesh_id${index}`,
    resolvedPrimPath: path,
    sectionName: 'visuals',
    primType: 'mesh',
    renderReady: true,
    materialId: '/Looks/Paint',
    ranges: {
      positions: { offset: 0, count: 9, stride: 3 },
      indices: { offset: 0, count: 3, stride: 1 },
      transform: { offset: index * 16, count: 16, stride: 16 },
    },
  }));
  return {
    stageSourcePath: '/shelf.usd',
    stage: {
      defaultPrimPath: '/root', metersPerUnit: 1,
      primDescriptors: paths.map((path) => ({
        path, parentPath: path.slice(0, path.lastIndexOf('/')), name: 'mesh',
        typeName: 'Mesh', collisionEnabled: true, active: true, loaded: true,
        defined: true, instance: false, instanceProxy: false, prototype: false,
        hasPayload: false, hasAuthoredReferences: false, transformable: true,
        hasAuthoredXformOps: true, resetsXformStack: false,
      })),
    },
    robotMetadataSnapshot: { source: 'mesh-only' },
    render: {
      // Native physics bindings and live Hydra descriptors refer to the same Prims.
      meshDescriptors: descriptors.flatMap((descriptor) => [descriptor, {
        ...descriptor, meshId: descriptor.resolvedPrimPath, materialId: '/Looks/PhysicsMaterial',
      }]),
      materials: [{ materialId: '/Looks/Paint', color: [0, 0.5, 0.5, 1] }],
    },
    buffers: {
      positions: new Float32Array([0, 0, 0, 0.01, 0, 0, 0, 0.01, 0]),
      indices: new Uint32Array([0, 1, 2]),
      transforms: Float32Array.from(transforms.flatMap((matrix) => matrix.elements)),
    },
  };
}

function assertGeometryMatrix(geometry: UrdfVisual, linkWorld: Matrix4, expected: Matrix4): void {
  const actual = linkWorld.clone().multiply(createOriginMatrix(geometry.origin))
    .scale(new Vector3(geometry.dimensions.x, geometry.dimensions.y, geometry.dimensions.z));
  actual.elements.forEach((value, index) => {
    assert.ok(Math.abs(value - expected.elements[index]) < 1e-5,
      `${geometry.meshPath} matrix[${index}]: ${value} != ${expected.elements[index]}`);
  });
}

for (const initialMode of ['native', 'flattened'] as const) {
  test(`preserves every generic CAD visual and collision pose after ${initialMode} metadata hydration`, async () => {
    const snapshot = createShelfSnapshot();
    const initialSnapshot = initialMode === 'native' ? {
      ...snapshot,
      render: {
        ...snapshot.render,
        meshDescriptors: Array.from(snapshot.render!.meshDescriptors!).filter((_, index) => index % 2 === 0)
          .map((descriptor) => ({ ...descriptor, meshId: descriptor.resolvedPrimPath })),
      },
    } : snapshot;
    const resolution = adaptUsdViewerSnapshotToRobotData(initialSnapshot);
    assert.ok(resolution);
    const originalRobot = structuredClone(resolution.robotData);
    const hydrated = hydrateUsdViewerRobotResolutionFromRuntime(resolution, snapshot, {});
    assert.ok(hydrated);
    const cache = prepareUsdExportCacheFromResolvedSnapshot(snapshot, hydrated);
    const robot = cache.robotData;
    const worlds = computeLinkWorldMatrices(robot);
    const visuals = Object.values(robot.links).filter((link) => link.visual.meshPath);
    const collisions = Object.values(robot.links).flatMap((link) =>
      [link.collision, ...(link.collisionBodies ?? [])].filter((geometry) => geometry.meshPath)
        .map((geometry) => ({ geometry, linkId: link.id })));
    assert.equal(visuals.length, 3, 'one visual per authored Prim');
    assert.equal(collisions.length, 3, 'one collision per authored Prim');
    for (let index = 0; index < 3; index += 1) {
      const expected = new Matrix4().fromArray(Array.from(snapshot.buffers!.transforms!).slice(index * 16, index * 16 + 16));
      const visualLink = visuals.find((link) => link.visual.meshPath?.endsWith(`_visual_${index}.obj`));
      const collision = collisions.find(({ geometry }) => geometry.meshPath?.endsWith(`_collision_${index}.obj`));
      assert.ok(visualLink);
      assert.ok(collision);
      assertGeometryMatrix(visualLink.visual, worlds[visualLink.id], expected);
      assertGeometryMatrix(collision.geometry, worlds[collision.linkId], expected);
      const obj = await cache.meshFiles[visualLink.visual.meshPath!].text();
      assert.match(obj, /^v 0 0 0(?: |$)/m, 'pose is not also baked into OBJ vertices');
    }
    assert.deepEqual(resolution.robotData, originalRobot, 'hydration must not mutate its input');
  });
}
