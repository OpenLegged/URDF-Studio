import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { JSDOM } from 'jsdom';

import { parseMJCF } from '@/core/parsers/mjcf/mjcfParser';
import {
  URDFCollider,
  URDFVisual,
  buildRuntimeRobotFromState,
} from '@/core/parsers/urdf/loader';
import { GeometryType, type UrdfLink } from '@/types';
import { disposeObject3D } from '@/shared/utils/three/dispose';
import { applyGeometryPatchInPlace } from './robotLoaderGeometryPatch';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.DOMParser = dom.window.DOMParser as typeof DOMParser;
globalThis.Document = dom.window.Document as typeof Document;
globalThis.Element = dom.window.Element as typeof Element;

type GeometryCategory = 'visual' | 'collision';
type CapsuleRuntime = Awaited<ReturnType<typeof buildRuntimeRobotFromState>>;

async function createCapsuleRuntime(category: GeometryCategory, shape: string) {
  const classification = category === 'visual'
    ? 'contype="0" conaffinity="0" group="1"'
    : 'contype="1" conaffinity="1" group="3"';
  const state = parseMJCF(`
    <mujoco model="capsule_patch">
      <worldbody><body name="base">
        <inertial pos="0 0 0" mass="1" diaginertia="1 1 1" />
        <geom name="capsule" type="capsule" ${classification} ${shape} />
      </body></worldbody>
    </mujoco>
  `);
  const link = state.links.base;
  assert.ok(link);
  assert.equal(link[category].type, GeometryType.CAPSULE);
  const runtime = await buildRuntimeRobotFromState({
    robotName: state.name,
    links: state.links,
    joints: state.joints,
    manager: new THREE.LoadingManager(),
    loadMeshCb: (_path, _manager, done) => done(null),
  });
  return { runtime, link };
}

function getGeometryGroup(runtime: CapsuleRuntime, category: GeometryCategory) {
  const group = runtime.links.base.children.find((child) => category === 'visual'
    ? child instanceof URDFVisual
    : child instanceof URDFCollider);
  assert.ok(group, `expected ${category} group`);
  return group;
}

function assertCapsuleBounds(
  runtime: CapsuleRuntime,
  category: GeometryCategory,
  radius: number,
  bodyLength: number,
) {
  const group = getGeometryGroup(runtime, category);
  const size = new THREE.Box3().setFromObject(group).getSize(new THREE.Vector3());
  const expected = [radius * 2, radius * 2, bodyLength + radius * 2];
  size.toArray().forEach((actual, axis) => {
    assert.ok(Math.abs(actual - expected[axis]) < 1e-6,
      `${category} bounds axis ${axis}: expected ${expected[axis]}, got ${actual}`);
  });
}

function applyCapsulePatch(
  runtime: CapsuleRuntime,
  category: GeometryCategory,
  previousLinkData: UrdfLink,
  linkData: UrdfLink,
) {
  let invalidations = 0;
  assert.equal(applyGeometryPatchInPlace({
    robotModel: runtime,
    patch: {
      linkName: 'base',
      previousLinkData,
      linkData,
      visualChanged: category === 'visual',
      visualBodiesChanged: false,
      collisionChanged: category === 'collision',
      collisionBodiesChanged: false,
      inertialChanged: false,
      visibilityChanged: false,
    },
    assets: {},
    showVisual: true,
    showCollision: true,
    linkMeshMapRef: { current: new Map<string, THREE.Mesh[]>() },
    invalidate: () => { invalidations += 1; },
  }), true);
  assert.ok(invalidations > 0, 'geometry changes must request a frame without another click');
}

for (const category of ['visual', 'collision'] as const) {
  for (const shape of [
    'size="0.08 0.06"',
    'size="0.08" fromto="0 0 -0.06 0 0 0.06"',
  ]) {
    test(`MJCF ${category} capsule ${shape} keeps its full extent through dimension patches`, async () => {
      const { runtime, link } = await createCapsuleRuntime(category, shape);
      try {
        assertCapsuleBounds(runtime, category, 0.08, 0.12);
        const originalGroup = getGeometryGroup(runtime, category);
        let previousLinkData = link;
        for (const [radius, bodyLength] of [[0.08, 0.04], [0.08, 0.6], [0.12, 0.6], [0.12, 0]]) {
          const linkData = {
            ...previousLinkData,
            [category]: {
              ...previousLinkData[category],
              dimensions: { x: radius, y: bodyLength, z: 0 },
            },
          };
          applyCapsulePatch(runtime, category, previousLinkData, linkData);
          assert.equal(getGeometryGroup(runtime, category), originalGroup);
          assertCapsuleBounds(runtime, category, radius, bodyLength);
          previousLinkData = linkData;
        }
      } finally {
        disposeObject3D(runtime);
      }
    });
  }

  for (const bodyLength of [0.12, 0]) {
    test(`MJCF ${category} capsule rebuilds a missing group with body length ${bodyLength}`, async () => {
      const { runtime, link } = await createCapsuleRuntime(category, 'size="0.08 0.06"');
      try {
        assertCapsuleBounds(runtime, category, 0.08, 0.12);
        const originalGroup = getGeometryGroup(runtime, category);
        runtime.links.base.remove(originalGroup);
        disposeObject3D(originalGroup);
        const linkData = {
          ...link,
          [category]: { ...link[category], dimensions: { x: 0.08, y: bodyLength, z: 0 } },
        };
        applyCapsulePatch(runtime, category, link, linkData);
        assert.notEqual(getGeometryGroup(runtime, category), originalGroup);
        assertCapsuleBounds(runtime, category, 0.08, bodyLength);
      } finally {
        disposeObject3D(runtime);
      }
    });
  }
}
