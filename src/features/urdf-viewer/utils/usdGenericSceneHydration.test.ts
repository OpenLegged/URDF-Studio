import assert from 'node:assert/strict';
import test from 'node:test';
import { Matrix4, Quaternion, Vector3 } from 'three';

import type { UsdSceneMeshDescriptor, UsdSceneSnapshot, UrdfVisual } from '@/types';
import { computeLinkWorldMatrices, createOriginMatrix } from '@/core/robot/kinematics';
import { adaptUsdViewerSnapshotToRobotData } from '@/lib/robot-parser/usd/usdViewerRobotAdapter';
import { hydrateUsdViewerRobotResolutionFromRuntime } from './usdRuntimeRobotHydration';
import { prepareUsdExportCacheFromResolvedSnapshot } from './usdExportBundle';

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
      primDescriptors: paths.map((path) => ({ path, typeName: 'Mesh', collisionEnabled: true })),
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
        meshDescriptors: snapshot.render!.meshDescriptors!.filter((_, index) => index % 2 === 0)
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
