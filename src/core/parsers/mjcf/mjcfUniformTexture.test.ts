import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import * as THREE from 'three';
import { getVisualGeometryEntries, validateCanonicalRobotData } from '@/core/robot';
import { buildRobotRuntimeFromData } from '@/lib/robot-parser/runtime';
import { toRobotData } from '@/lib/robot-parser/toRobotData';
import { patchPrimitiveDimensionsInPlace } from '@/shared/components/3d/robot/utils/robotLoaderGeometryPatchHelpers';
import { GeometryType, type RobotState, type UrdfVisual } from '@/types';
import { generateMujocoXML } from './mjcfGenerator';
import { parseMJCF } from './mjcfParser';
import { applyCanonicalMjcfTextureMapping } from './mjcfTextureMapping';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
Object.assign(globalThis, {
  window: dom.window, document: dom.window.document, DOMParser: dom.window.DOMParser,
  XMLSerializer: dom.window.XMLSerializer, Node: dom.window.Node, Element: dom.window.Element,
});

function parse(source: string): RobotState {
  const robot = parseMJCF(source);
  assert.ok(robot);
  return robot;
}

function groundSource(uniform = true, textureType = '2d'): string {
  return `<mujoco model="ground"><asset>
    <texture name="grid" type="${textureType}" builtin="checker" mark="edge"
      rgb1="0.2 0.3 0.4" rgb2="0.1 0.2 0.3" markrgb="0.8 0.8 0.8" width="300" height="300"/>
    <material name="grid" texture="grid" texrepeat="5 5" texuniform="${uniform}"/>
    </asset><worldbody><geom name="ground" type="box" size="500 500 0.05"
      pos="0 0 -0.05" material="grid"/></worldbody></mujoco>`;
}

function visual(robot: RobotState): UrdfVisual {
  const geometry = Object.values(robot.links).flatMap(getVisualGeometryEntries)[0]?.geometry;
  assert.ok(geometry);
  return geometry;
}

function runtimeMesh(root: THREE.Object3D): THREE.Mesh {
  let found: THREE.Mesh | undefined;
  root.traverse((node) => {
    if (!found && node instanceof THREE.Mesh && node.parent?.userData.geometryRole === 'visual') {
      found = node;
    }
  });
  assert.ok(found);
  return found;
}

function uvRange(mesh: THREE.Mesh): [number, number] {
  const uv = mesh.geometry.getAttribute('uv');
  return [
    Math.max(...Array.from({ length: uv.count }, (_, i) => uv.getX(i))),
    Math.max(...Array.from({ length: uv.count }, (_, i) => uv.getY(i))),
  ];
}

test('1000m ground uses native half-size texture scaling and updates across repeated resize', async () => {
  const robot = parse(groundSource());
  const geometry = visual(robot);
  const before = JSON.stringify(geometry);
  assert.equal(geometry.authoredMaterials?.[0].mjcfTextureUniform, true);
  assert.deepEqual(geometry.authoredMaterials?.[0].textureRepeat, [5, 5]);
  const { sourceDocument: _sourceDocument, ...canonicalData } = toRobotData(robot);
  assert.equal(validateCanonicalRobotData(canonicalData).valid, true);
  const runtime = await buildRobotRuntimeFromData(toRobotData(robot), { manager: new THREE.LoadingManager() });
  try {
    const mesh = runtimeMesh(runtime.root);
    assert.deepEqual(uvRange(mesh), [500, 500]);
    const map = (mesh.material as THREE.MeshStandardMaterial).map;
    assert.ok(map);
    assert.deepEqual(map.repeat.toArray(), [5, 5]);
    // MuJoCo 3.11 classic settexture multiplies by geom.size: 5 * 500 = 2500 tiles.
    assert.equal(uvRange(mesh)[0] * map.repeat.x, 2500);
    const resized = { ...geometry, dimensions: { x: 8, y: 6, z: 0.1 } };
    assert.equal(patchPrimitiveDimensionsInPlace(mesh.parent!, resized), true);
    assert.deepEqual(uvRange(mesh), [4, 3]);
    patchPrimitiveDimensionsInPlace(mesh.parent!, geometry);
    assert.deepEqual(uvRange(mesh), [500, 500]);
    patchPrimitiveDimensionsInPlace(mesh.parent!, resized);
    assert.deepEqual(uvRange(mesh), [4, 3]);
    applyCanonicalMjcfTextureMapping(mesh, {
      ...resized, authoredMaterials: [{ ...resized.authoredMaterials![0], mjcfTextureUniform: false }],
    });
    assert.deepEqual(uvRange(mesh), [1, 1]);
    assert.equal(JSON.stringify(geometry), before, 'runtime mapping must not rewrite canonical geometry');
  } finally {
    runtime.dispose();
  }
});

test('object-relative and cube textures keep their existing normalized UVs', async () => {
  for (const [uniform, type] of [[false, '2d'], [true, 'cube']] as const) {
    const robot = parse(groundSource(uniform, type));
    assert.equal(visual(robot).authoredMaterials?.[0].mjcfTextureUniform, undefined);
    const runtime = await buildRobotRuntimeFromData(toRobotData(robot), { manager: new THREE.LoadingManager() });
    try { assert.deepEqual(uvRange(runtimeMesh(runtime.root)), [1, 1]); }
    finally { runtime.dispose(); }
  }
});

test('plane mapping keeps texuniform proportional to the current dimensions', () => {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1));
  const geometry = { ...visual(parse(groundSource())), type: GeometryType.PLANE };
  applyCanonicalMjcfTextureMapping(mesh, geometry);
  assert.deepEqual(uvRange(mesh), [500, 500]);
  mesh.geometry.dispose();
  (mesh.material as THREE.Material).dispose();
});

test('generated MJCF retains builtin ground and authored repeat without baking runtime scale', () => {
  const robot = parse(groundSource());
  const before = visual(robot);
  const xml = generateMujocoXML(robot, { preserveNumericPrecision: true });
  const document = new DOMParser().parseFromString(xml, 'text/xml');
  const texture = document.querySelector('texture[builtin="checker"]');
  assert.ok(texture);
  assert.equal(texture.getAttribute('mark'), 'edge');
  assert.equal(texture.getAttribute('width'), '300');
  const material = document.querySelector(`material[texture="${texture.getAttribute('name')}"]`);
  assert.equal(material?.getAttribute('texrepeat'), '5 5');
  assert.equal(material?.getAttribute('texuniform'), 'true');
  const reopened = visual(parse(xml));
  assert.deepEqual(reopened.dimensions, before.dimensions);
  assert.deepEqual(reopened.origin, before.origin);
  assert.deepEqual(reopened.authoredMaterials?.[0].mjcfBuiltinTexture, before.authoredMaterials?.[0].mjcfBuiltinTexture);
  assert.equal(reopened.authoredMaterials?.[0].mjcfTextureUniform, true);
  assert.deepEqual(reopened.authoredMaterials?.[0].textureRepeat, [5, 5]);
});

test('file texture export also retains 2D uniform repeat metadata', () => {
  const robot = parse(groundSource().replace(/builtin="checker"[^>]+/, 'file="grid.png"/'));
  const xml = generateMujocoXML(robot);
  assert.match(xml, /texrepeat="5 5" texuniform="true"/);
  assert.match(xml, /file="grid.png"/);
});
