import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createRobotCapsuleGeometry,
  createRobotCylinderGeometry,
  createRobotSphereGeometry,
  DEFAULT_ROBOT_PRIMITIVE_GEOMETRY_DETAIL,
} from './primitiveGeometry';

test('creates high-quality curved robot primitives by default', () => {
  const cylinder = createRobotCylinderGeometry();
  const sphere = createRobotSphereGeometry();
  const capsule = createRobotCapsuleGeometry(0.25, 1);

  try {
    assert.equal(
      cylinder.parameters.radialSegments,
      DEFAULT_ROBOT_PRIMITIVE_GEOMETRY_DETAIL.cylinderRadialSegments,
    );
    assert.equal(
      sphere.parameters.widthSegments,
      DEFAULT_ROBOT_PRIMITIVE_GEOMETRY_DETAIL.sphereWidthSegments,
    );
    assert.equal(
      sphere.parameters.heightSegments,
      DEFAULT_ROBOT_PRIMITIVE_GEOMETRY_DETAIL.sphereHeightSegments,
    );
    assert.equal(
      capsule.parameters.capSegments,
      DEFAULT_ROBOT_PRIMITIVE_GEOMETRY_DETAIL.capsuleCapSegments,
    );
    assert.equal(
      capsule.parameters.radialSegments,
      DEFAULT_ROBOT_PRIMITIVE_GEOMETRY_DETAIL.capsuleRadialSegments,
    );
  } finally {
    cylinder.dispose();
    sphere.dispose();
    capsule.dispose();
  }
});

test('creates all curved robot primitives at the requested quality tier', () => {
  const detail = {
    cylinderRadialSegments: 128,
    sphereWidthSegments: 64,
    sphereHeightSegments: 48,
    capsuleCapSegments: 16,
    capsuleRadialSegments: 32,
  };
  const cylinder = createRobotCylinderGeometry(detail);
  const sphere = createRobotSphereGeometry(detail);
  const capsule = createRobotCapsuleGeometry(0.25, 1, detail);

  try {
    assert.equal(cylinder.parameters.radialSegments, 128);
    assert.equal(cylinder.getIndex()?.count, 128 * 4 * 3);
    assert.equal(sphere.parameters.widthSegments, 64);
    assert.equal(sphere.parameters.heightSegments, 48);
    assert.equal(capsule.parameters.capSegments, 16);
    assert.equal(capsule.parameters.radialSegments, 32);
  } finally {
    cylinder.dispose();
    sphere.dispose();
    capsule.dispose();
  }
});
