import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { GeometryType, type RobotFile, type UrdfVisual } from '@/types';
import {
  resolveRobotFileData,
  resolveRobotFileDataAsync,
  type RobotImportResult,
} from '../importRobotFile.ts';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.DOMParser = dom.window.DOMParser as typeof DOMParser;
globalThis.XMLSerializer = dom.window.XMLSerializer as typeof XMLSerializer;

const INLINE_MESH_VERTICES = [
  -0.1, -0.2, -0.5, -0.1, -0.2, 0.5, -0.1, 0.2, -0.5, -0.1, 0.2, 0.5, 0.1, -0.2, -0.5, 0.1, -0.2,
  0.5, 0.1, 0.2, -0.5, 0.1, 0.2, 0.5,
].join(' ');

const EXTERNAL_OBJ = `
v -0.1 -0.2 -0.5
v -0.1 -0.2 0.5
v -0.1 0.2 -0.5
v -0.1 0.2 0.5
v 0.1 -0.2 -0.5
v 0.1 -0.2 0.5
v 0.1 0.2 -0.5
v 0.1 0.2 0.5
f 1 2 4
f 1 4 3
f 5 7 8
f 5 8 6
`;

function createInlineMeshPrimitiveFile(): RobotFile {
  return {
    name: 'robots/physical/inline_primitives.xml',
    format: 'mjcf',
    content: `
      <mujoco model="inline-physical-primitives">
        <compiler fitaabb="true" />
        <asset>
          <mesh
            name="fit_mesh"
            vertex="${INLINE_MESH_VERTICES}"
            scale="2 3 4"
            refpos="1 2 3"
            refquat="0 0 0 1"
          />
        </asset>
        <worldbody>
          <body name="base_link">
            <inertial pos="0.1 0.2 0.3" mass="2" diaginertia="0.01 0.02 0.03" />
            <geom
              name="capsule_visual"
              type="capsule"
              mesh="fit_mesh"
              pos="1 -2 3"
              contype="0"
              conaffinity="0"
            />
            <geom
              name="cylinder_collision"
              type="cylinder"
              mesh="fit_mesh"
              pos="-1 2 -3"
              group="3"
              contype="1"
              conaffinity="1"
            />
          </body>
        </worldbody>
      </mujoco>
    `,
  };
}

function requireReadyGeometry(result: RobotImportResult): {
  visual: UrdfVisual;
  collision: UrdfVisual;
} {
  assert.equal(result.status, 'ready');
  if (result.status !== 'ready') {
    assert.fail('Expected MJCF import result to be ready');
  }

  const link = result.robotData.links.base_link;
  assert.ok(link);
  return { visual: link.visual, collision: link.collision };
}

function assertNumberClose(actual: number, expected: number, tolerance = 1e-6): void {
  assert.ok(Math.abs(actual - expected) <= tolerance, `expected ${expected}, got ${actual}`);
}

function assertOriginClose(
  geometry: UrdfVisual,
  expected: { x: number; y: number; z: number },
): void {
  assertNumberClose(geometry.origin.xyz.x, expected.x);
  assertNumberClose(geometry.origin.xyz.y, expected.y);
  assertNumberClose(geometry.origin.xyz.z, expected.z);
}

test('async canonical MJCF import fits inline mesh-backed capsules and cylinders', async () => {
  const result = await resolveRobotFileDataAsync(createInlineMeshPrimitiveFile(), {
    mjcfExternalAssetValidation: 'never',
  });
  const { visual, collision } = requireReadyGeometry(result);

  assert.equal(visual.type, GeometryType.CAPSULE);
  assertNumberClose(visual.dimensions.x, 0.6);
  assertNumberClose(visual.dimensions.y, 2.8);
  assertNumberClose(visual.dimensions.z, 0);
  assertOriginClose(visual, { x: 3, y: 4, z: -9 });
  assert.equal(visual.meshPath, undefined);
  assert.equal(visual.assetRef, undefined);
  assert.equal(visual.mjcfMesh, undefined);

  assert.equal(collision.type, GeometryType.CYLINDER);
  assertNumberClose(collision.dimensions.x, 0.6);
  assertNumberClose(collision.dimensions.y, 4);
  assertNumberClose(collision.dimensions.z, 0);
  assertOriginClose(collision, { x: 1, y: 8, z: -15 });
  assert.equal(collision.meshPath, undefined);
  assert.equal(collision.assetRef, undefined);
  assert.equal(collision.mjcfMesh, undefined);
  assert.equal(result.status, 'ready');
  if (result.status === 'ready') {
    assert.deepEqual(result.robotData.links.base_link?.inertial, {
      mass: 2,
      origin: {
        xyz: { x: 0.1, y: 0.2, z: 0.3 },
        rpy: { r: 0, p: 0, y: 0 },
      },
      inertia: { ixx: 0.01, ixy: 0, ixz: 0, iyy: 0.02, iyz: 0, izz: 0.03 },
    });
  }
});

test('synchronous MJCF import keeps unresolved mesh-backed primitives as mesh fallbacks', () => {
  const result = resolveRobotFileData(createInlineMeshPrimitiveFile(), {
    mjcfExternalAssetValidation: 'never',
  });
  const { visual, collision } = requireReadyGeometry(result);

  assert.equal(visual.type, GeometryType.MESH);
  assert.equal(collision.type, GeometryType.MESH);
  assert.deepEqual(visual.dimensions, { x: 2, y: 3, z: 4 });
  assert.deepEqual(collision.dimensions, { x: 2, y: 3, z: 4 });
});

test('async canonical MJCF import fits external mesh assets from the source directory', async () => {
  const result = await resolveRobotFileDataAsync(
    {
      name: 'robots/physical/model.xml',
      format: 'mjcf',
      content: `
        <mujoco model="external-physical-primitive">
          <compiler fitaabb="true" />
          <asset><mesh name="fit_mesh" file="fit.obj" /></asset>
          <worldbody>
            <body name="base_link">
              <geom type="capsule" mesh="fit_mesh" group="3" />
            </body>
          </worldbody>
        </mujoco>
      `,
    },
    {
      assets: {
        'robots/physical/fit.obj': `data:text/plain,${encodeURIComponent(EXTERNAL_OBJ)}`,
      },
      mjcfExternalAssetValidation: 'never',
    },
  );
  const { collision } = requireReadyGeometry(result);

  assert.equal(collision.type, GeometryType.CAPSULE);
  assertNumberClose(collision.dimensions.x, 0.2);
  assertNumberClose(collision.dimensions.y, 0.6);
  assertOriginClose(collision, { x: 0, y: 0, z: 0 });
  assert.equal(collision.meshPath, undefined);
  assert.equal(collision.mjcfMesh, undefined);
});

test('async canonical MJCF import reports a physical fallback when fitting cannot load a mesh', async () => {
  const result = await resolveRobotFileDataAsync(
    {
      name: 'robots/physical/missing.xml',
      format: 'mjcf',
      content: `
        <mujoco model="missing-physical-primitive">
          <asset><mesh name="fit_mesh" file="missing.obj" /></asset>
          <worldbody>
            <body name="base_link">
              <geom type="capsule" mesh="fit_mesh" group="3" />
            </body>
          </worldbody>
        </mujoco>
      `,
    },
    { mjcfExternalAssetValidation: 'never' },
  );
  const { collision } = requireReadyGeometry(result);

  assert.equal(collision.type, GeometryType.MESH);
  assert.equal(result.status, 'ready');
  if (result.status === 'ready') {
    assert.ok(
      result.robotData.inspectionContext?.recovery?.diagnostics.some(
        (diagnostic) => diagnostic.code === 'mjcf_mesh_primitive_fit_unresolved',
      ),
    );
  }
});
