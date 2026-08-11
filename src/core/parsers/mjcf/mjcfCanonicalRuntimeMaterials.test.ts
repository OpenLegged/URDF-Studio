import test from 'node:test';
import assert from 'node:assert/strict';

import { JSDOM } from 'jsdom';
import * as THREE from 'three';

import {
  BOX_FACE_MATERIAL_ORDER,
  getVisualGeometryEntries,
  validateCanonicalRobotData,
} from '@/core/robot';
import { buildRobotRuntimeFromData } from '@/lib/robot-parser/runtime';
import { toRobotData } from '@/lib/robot-parser/toRobotData';
import type { RobotState, UrdfVisual } from '@/types';

import { parseMJCF as parseNullableMJCF } from './mjcfParser';

function installDomGlobals(): void {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    contentType: 'text/html',
  });
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    DOMParser: dom.window.DOMParser,
    XMLSerializer: dom.window.XMLSerializer,
    Node: dom.window.Node,
    Element: dom.window.Element,
    Document: dom.window.Document,
  });
}

function parseMJCF(source: string): RobotState {
  const robot = parseNullableMJCF(source);
  assert.ok(robot, 'expected MJCF source to parse');
  return robot;
}

function findVisualGeometry(robot: RobotState, name: string): UrdfVisual {
  for (const link of Object.values(robot.links)) {
    const match = getVisualGeometryEntries(link).find((entry) => entry.geometry.name === name);
    if (match) {
      return match.geometry;
    }
  }
  throw new Error(`Missing canonical visual geometry: ${name}`);
}

function findRuntimeMesh(root: THREE.Object3D, geometryName: string): THREE.Mesh {
  let result: THREE.Mesh | null = null;
  root.traverse((child) => {
    if (
      !result &&
      (child as THREE.Mesh).isMesh &&
      child.parent?.userData.geometryName === geometryName
    ) {
      result = child as THREE.Mesh;
    }
  });
  assert.ok(result, `Missing runtime mesh for geometry: ${geometryName}`);
  return result;
}

function readTexturePixel(texture: THREE.Texture, x: number, y: number): [number, number, number] {
  const image = texture.image as { data?: Uint8Array; width?: number; height?: number };
  assert.ok(image.data instanceof Uint8Array);
  assert.ok(image.width && image.height);
  const offset = (y * image.width + x) * 4;
  return [image.data[offset] ?? 0, image.data[offset + 1] ?? 0, image.data[offset + 2] ?? 0];
}

test('canonical MJCF runtime preserves checker, flat, gradient, cube faces, and texrepeat', async () => {
  installDomGlobals();
  const robot = parseMJCF(`
    <mujoco model="canonical-builtin-textures">
      <asset>
        <texture name="checker" type="2d" builtin="checker"
          rgb1="0.2 0.3 0.4" rgb2="0.1 0.2 0.3" width="8" height="8" />
        <texture name="flat" type="cube" builtin="flat"
          rgb1="0.7 0.7 0.7" rgb2="0.2 0.2 0.2" width="4" height="4" />
        <texture name="gradient" type="cube" builtin="gradient"
          rgb1="0.3 0.5 0.7" rgb2="0 0 0" width="4" height="4" />
        <material name="checker-material" texture="checker" texrepeat="5 4"
          shininess="0.25" reflectance="0.2" />
        <material name="flat-material" texture="flat" texrepeat="2 3" />
        <material name="gradient-material" texture="gradient" texrepeat="7 6" />
      </asset>
      <worldbody>
        <body name="base">
          <geom name="checker-plane" type="plane" size="1 1 0.1"
            material="checker-material" contype="0" conaffinity="0" />
          <geom name="flat-box" type="box" size="0.2 0.2 0.2" pos="0 0 0.5"
            material="flat-material" contype="0" conaffinity="0" />
          <geom name="gradient-box" type="box" size="0.2 0.2 0.2" pos="1 0 0.5"
            material="gradient-material" contype="0" conaffinity="0" />
        </body>
      </worldbody>
    </mujoco>
  `);

  const robotData = toRobotData(robot);
  const canonicalValidation = validateCanonicalRobotData(robotData);
  assert.equal(canonicalValidation.valid, true, JSON.stringify(canonicalValidation.issues));

  const checkerGeometry = findVisualGeometry(robot, 'checker-plane');
  assert.deepEqual(checkerGeometry.authoredMaterials?.[0]?.textureRepeat, [5, 4]);
  assert.equal(checkerGeometry.authoredMaterials?.[0]?.mjcfBuiltinTexture?.builtin, 'checker');

  const flatGeometry = findVisualGeometry(robot, 'flat-box');
  assert.equal(flatGeometry.authoredMaterials?.length, BOX_FACE_MATERIAL_ORDER.length);
  assert.deepEqual(
    flatGeometry.authoredMaterials?.map((material) => material.mjcfBuiltinTexture?.cubeFace),
    BOX_FACE_MATERIAL_ORDER,
  );
  assert.deepEqual(flatGeometry.authoredMaterials?.[0]?.textureRepeat, [2, 3]);

  const gradientGeometry = findVisualGeometry(robot, 'gradient-box');
  assert.equal(gradientGeometry.authoredMaterials?.length, BOX_FACE_MATERIAL_ORDER.length);
  assert.deepEqual(gradientGeometry.authoredMaterials?.[0]?.textureRepeat, [7, 6]);

  const runtime = await buildRobotRuntimeFromData(robotData, {
    manager: new THREE.LoadingManager(),
  });
  try {
    const checkerMaterial = findRuntimeMesh(runtime.root, 'checker-plane')
      .material as THREE.MeshStandardMaterial;
    assert.ok(checkerMaterial.map);
    assert.deepEqual(checkerMaterial.map.repeat.toArray(), [5, 4]);
    assert.deepEqual(readTexturePixel(checkerMaterial.map, 0, 0), [51, 77, 102]);
    assert.deepEqual(readTexturePixel(checkerMaterial.map, 7, 0), [26, 51, 77]);
    assert.equal(checkerMaterial.color.getHexString(), 'ffffff');
    assert.ok(Math.abs(checkerMaterial.roughness - 0.75) < 1e-9);
    assert.ok(Math.abs(checkerMaterial.metalness - 0.2) < 1e-9);

    const flatMaterials = findRuntimeMesh(runtime.root, 'flat-box')
      .material as THREE.MeshStandardMaterial[];
    assert.ok(Array.isArray(flatMaterials));
    const flatRight = flatMaterials[BOX_FACE_MATERIAL_ORDER.indexOf('right')];
    const flatDown = flatMaterials[BOX_FACE_MATERIAL_ORDER.indexOf('down')];
    assert.ok(flatRight?.map && flatDown?.map);
    assert.deepEqual(flatRight.map.repeat.toArray(), [2, 3]);
    assert.deepEqual(readTexturePixel(flatRight.map, 0, 0), [179, 179, 179]);
    assert.deepEqual(readTexturePixel(flatDown.map, 0, 0), [51, 51, 51]);

    const gradientMaterials = findRuntimeMesh(runtime.root, 'gradient-box')
      .material as THREE.MeshStandardMaterial[];
    assert.ok(Array.isArray(gradientMaterials));
    const gradientUp = gradientMaterials[BOX_FACE_MATERIAL_ORDER.indexOf('up')];
    const gradientDown = gradientMaterials[BOX_FACE_MATERIAL_ORDER.indexOf('down')];
    const gradientFront = gradientMaterials[BOX_FACE_MATERIAL_ORDER.indexOf('front')];
    assert.ok(gradientUp?.map && gradientDown?.map && gradientFront?.map);
    assert.deepEqual(gradientFront.map.repeat.toArray(), [7, 6]);
    assert.deepEqual(readTexturePixel(gradientUp.map, 0, 0), [77, 128, 179]);
    assert.deepEqual(readTexturePixel(gradientDown.map, 0, 0), [0, 0, 0]);
    assert.deepEqual(readTexturePixel(gradientFront.map, 0, 0), [77, 128, 179]);
    assert.deepEqual(readTexturePixel(gradientFront.map, 0, 3), [0, 0, 0]);
  } finally {
    runtime.dispose();
  }
});
