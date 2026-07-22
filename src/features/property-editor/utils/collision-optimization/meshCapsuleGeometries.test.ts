import assert from 'node:assert/strict';
import test from 'node:test';

import * as THREE from 'three';

import { GeometryType, type UrdfVisual } from '@/types';

import type { MeshAnalysis } from '../geometryConversion';
import { buildApproximateMeshCapsuleGeometries } from './meshCapsuleGeometries';

const SOURCE_GEOMETRY: UrdfVisual = {
  name: 'mesh_collision',
  type: GeometryType.MESH,
  dimensions: { x: 1, y: 1, z: 1 },
  color: '#ef4444',
  meshPath: 'meshes/body.stl',
  origin: {
    xyz: { x: 0.2, y: -0.3, z: 0.4 },
    rpy: { r: 0.2, p: -0.4, y: 0.3 },
  },
};

const ANALYSIS: MeshAnalysis = {
  bounds: { x: 0.3, y: 0.2, z: 0.8, cx: 0, cy: 0, cz: 0 },
  approximateCapsules: {
    normalizedError: 0.04,
    segments: [
      {
        axis: { x: 0, y: 1, z: 0 },
        center: { x: 0.1, y: 0.2, z: -0.1 },
        radius: 0.08,
        length: 0.42,
        volume: 0.007,
      },
      {
        axis: { x: 1, y: 0, z: 0 },
        center: { x: -0.12, y: 0.05, z: 0.16 },
        radius: 0.06,
        length: 0.3,
        volume: 0.003,
      },
    ],
  },
};

function quaternionFromOrigin(origin: UrdfVisual['origin']): THREE.Quaternion {
  return new THREE.Quaternion().setFromEuler(
    new THREE.Euler(origin.rpy.r, origin.rpy.p, origin.rpy.y, 'ZYX'),
  );
}

test('approximate mesh capsule segments preserve centers, axes, and a small body count', () => {
  const geometries = buildApproximateMeshCapsuleGeometries(SOURCE_GEOMETRY, ANALYSIS);

  assert.equal(geometries.length, 2);
  assert.equal(geometries[0]!.name, 'mesh_collision');
  assert.equal(geometries[1]!.name, undefined);
  assert.equal(geometries[0]!.meshPath, undefined);
  assert.deepEqual(geometries[0]!.dimensions, { x: 0.08, y: 0.42, z: 0.08 });

  const sourceRotation = quaternionFromOrigin(SOURCE_GEOMETRY.origin);
  geometries.forEach((geometry, index) => {
    const fit = ANALYSIS.approximateCapsules!.segments[index]!;
    const expectedCenter = new THREE.Vector3(fit.center.x, fit.center.y, fit.center.z)
      .applyQuaternion(sourceRotation)
      .add(
        new THREE.Vector3(
          SOURCE_GEOMETRY.origin.xyz.x,
          SOURCE_GEOMETRY.origin.xyz.y,
          SOURCE_GEOMETRY.origin.xyz.z,
        ),
      );
    const actualCenter = new THREE.Vector3(
      geometry.origin.xyz.x,
      geometry.origin.xyz.y,
      geometry.origin.xyz.z,
    );
    assert.ok(actualCenter.distanceTo(expectedCenter) < 1e-8);

    const expectedAxis = new THREE.Vector3(fit.axis.x, fit.axis.y, fit.axis.z)
      .normalize()
      .applyQuaternion(sourceRotation);
    const actualAxis = new THREE.Vector3(0, 0, 1).applyQuaternion(
      quaternionFromOrigin(geometry.origin),
    );
    assert.ok(actualAxis.distanceTo(expectedAxis) < 1e-8);
  });
});
