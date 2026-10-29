import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';

import { generateEditableRobotSource } from '@/app/utils/generateEditableRobotSource';
import { GeometryType } from '@/types';
import { rewriteRobotMeshPathsForSource } from '../meshPathUtils';
import { generateMujocoXML } from './mjcfGenerator';
import { validateMJCFImportExternalAssets } from './mjcfImportValidation';
import { parseMJCF } from './mjcfParser';

const { window } = new JSDOM();
globalThis.DOMParser = window.DOMParser as typeof DOMParser;

const MODEL = `<mujoco model="furniture">
  <asset>
    <mesh name="bed_mesh" file="library/bed/meshes/root.obj" />
    <mesh name="wardrobe_mesh" file="library/wardrobe/meshes/root.obj" />
    <texture name="bed_texture" type="2d" file="library/bed/textures/color.png" />
    <texture name="wardrobe_texture" type="2d" file="library/wardrobe/textures/color.png" />
    <material name="bed_material" texture="bed_texture" />
    <material name="wardrobe_material" texture="wardrobe_texture" />
  </asset>
  <worldbody><body name="base">
    <body name="bed"><geom type="mesh" mesh="bed_mesh" material="bed_material" /></body>
    <body name="wardrobe"><geom type="mesh" mesh="wardrobe_mesh" material="wardrobe_material" /></body>
  </body></worldbody>
</mujoco>`;
const ASSETS = {
  'library/bed/meshes/root.obj': 'blob:bed-mesh',
  'library/wardrobe/meshes/root.obj': 'blob:wardrobe-mesh',
  'library/bed/textures/color.png': 'blob:bed-texture',
  'library/wardrobe/textures/color.png': 'blob:wardrobe-texture',
};

function parse(content: string) {
  const robot = parseMJCF(content);
  assert.ok(robot);
  return robot;
}

function assetPaths(content: string, selector: string): string[] {
  const document = new DOMParser().parseFromString(content, 'application/xml');
  assert.equal(document.querySelector('parsererror'), null);
  return Array.from(document.querySelectorAll(selector), (element) => element.getAttribute('file')!).sort();
}

test('internal MJCF generation retains distinct mesh and texture paths with matching basenames', () => {
  const robot = parse(MODEL);
  const source = generateEditableRobotSource({ format: 'mjcf', robotState: robot });
  assert.deepEqual(assetPaths(source, 'mesh[file]'), [
    'library/bed/meshes/root.obj', 'library/wardrobe/meshes/root.obj',
  ]);
  assert.deepEqual(assetPaths(source, 'texture[file]'), [
    'library/bed/textures/color.png', 'library/wardrobe/textures/color.png',
  ]);
  assert.deepEqual(validateMJCFImportExternalAssets('scene.xml', source, [], ASSETS), []);
  assert.match(source, /meshdir=""/);
  assert.match(source, /texturedir=""/);
});

test('preserved library paths are relative to nested source files and ignore export directories', () => {
  const robot = parse(MODEL);
  const sourceFileName = 'scenes/nested/scene.xml';
  const source = generateMujocoXML(robot, {
    preserveAssetPaths: true,
    sourceFileName,
    meshdir: 'export-meshes/',
    texturedir: 'export-textures/',
  });
  assert.deepEqual(assetPaths(source, 'mesh[file]'), [
    '../../library/bed/meshes/root.obj', '../../library/wardrobe/meshes/root.obj',
  ]);
  assert.deepEqual(assetPaths(source, 'texture[file]'), [
    '../../library/bed/textures/color.png', '../../library/wardrobe/textures/color.png',
  ]);
  assert.deepEqual(validateMJCFImportExternalAssets(sourceFileName, source, [], ASSETS), []);
  const reopened = rewriteRobotMeshPathsForSource(parse(source), sourceFileName);
  for (const name of ['bed', 'wardrobe']) {
    assert.equal(reopened.links[name].visual.meshPath, robot.links[name].visual.meshPath);
    assert.equal(reopened.links[name].collision.meshPath, robot.links[name].collision.meshPath);
    assert.equal(reopened.materials?.[name]?.texture, robot.materials?.[name]?.texture);
  }
  assert.equal(
    generateEditableRobotSource({ format: 'mjcf', robotState: robot, sourceFileName }),
    generateMujocoXML(robot, {
      preserveAssetPaths: true, sourceFileName, preserveInertialData: true,
      preserveNumericPrecision: true, includeSceneHelpers: false,
    }),
  );
});

test('internal mesh generation uses canonical geometry paths ahead of original MJCF file spelling', () => {
  const robot = parse(MODEL);
  for (const link of Object.values(robot.links)) {
    for (const geometry of [link.visual, link.collision]) {
      if (geometry.mjcfMesh) geometry.mjcfMesh.file = 'root.obj';
    }
  }
  const source = generateMujocoXML(robot, { preserveAssetPaths: true });
  assert.deepEqual(assetPaths(source, 'mesh[file]'), [
    'library/bed/meshes/root.obj', 'library/wardrobe/meshes/root.obj',
  ]);
});

test('downloadable MJCF generation retains its existing export path policy', () => {
  const robot = parse(MODEL);
  const options = { meshdir: 'meshes/', texturedir: 'textures/' };
  const source = generateMujocoXML(robot, options);
  assert.equal(source, generateMujocoXML(robot, { ...options, preserveAssetPaths: false }));
  assert.deepEqual(assetPaths(source, 'mesh[file]'), ['root.obj', 'root.obj']);
  assert.deepEqual(assetPaths(source, 'texture[file]'), [
    'library/bed/color.png', 'library/wardrobe/color.png',
  ]);
  assert.match(source, /meshdir="meshes\/"/);
  assert.match(source, /texturedir="textures\/"/);
  generateMujocoXML(robot, { preserveAssetPaths: true });
  assert.equal(generateMujocoXML(robot, options), source);
});

test('canonical mesh overrides take priority over original MJCF spelling and shared basename aliases', () => {
  const robot = parse(MODEL);
  const meshPathOverrides = new Map([['root.obj', 'incorrect-shared.obj']]);
  for (const name of ['bed', 'wardrobe']) {
    for (const geometry of [robot.links[name].visual, robot.links[name].collision]) {
      assert.ok(geometry.meshPath);
      assert.ok(geometry.mjcfMesh);
      geometry.mjcfMesh.file = `/${geometry.meshPath}`;
      meshPathOverrides.set(geometry.meshPath, `distinct/${name}/root.obj`);
    }
  }
  const source = generateMujocoXML(robot, { meshPathOverrides });
  const document = new DOMParser().parseFromString(source, 'application/xml');
  assert.deepEqual(assetPaths(source, 'mesh[file]'), [
    'distinct/bed/root.obj', 'distinct/wardrobe/root.obj',
  ]);
  for (const name of ['bed', 'wardrobe']) {
    for (const geom of document.querySelectorAll(`body[name="${name}"] > geom`)) {
      const mesh = document.querySelector(`mesh[name="${geom.getAttribute('mesh')}"]`);
      assert.equal(mesh?.getAttribute('file'), `distinct/${name}/root.obj`);
    }
  }
});

test('preservation also keeps cube faces and file-backed heightfields at their library locations', () => {
  const robot = parse(`<mujoco><asset>
    <hfield name="terrain" file="library/terrain/height.png" size="1 1 1 0.1" />
    </asset><worldbody><body name="base"><geom type="hfield" hfield="terrain" /></body>
    </worldbody></mujoco>`);
  const faces = ['right', 'left', 'up', 'down', 'front', 'back'];
  const facePaths = faces.map((face) => `library/cube/${face}/color.png`);
  robot.links.base.visual = {
    ...robot.links.base.visual,
    type: GeometryType.BOX,
    dimensions: { x: 1, y: 1, z: 1 },
    authoredMaterials: facePaths.map((texture) => ({ texture })),
  };
  const sourceFileName = 'scenes/scene.xml';
  const source = generateMujocoXML(robot, { preserveAssetPaths: true, sourceFileName });
  const document = new DOMParser().parseFromString(source, 'application/xml');
  const cube = document.querySelector('texture[type="cube"]');
  assert.ok(cube);
  faces.forEach((face, index) => {
    assert.equal(cube.getAttribute(`file${face}`), `../${facePaths[index]}`);
  });
  assert.deepEqual(assetPaths(source, 'hfield[file]'), ['../library/terrain/height.png']);
  const assets = Object.fromEntries([...facePaths, 'library/terrain/height.png']
    .map((path) => [path, `blob:${path}`]));
  assert.deepEqual(validateMJCFImportExternalAssets(sourceFileName, source, [], assets), []);
});

test('preserved asset paths containing XML attribute characters remain valid references', () => {
  const robot = parse(MODEL);
  robot.links.bed.visual.meshPath = 'library/bed & table/meshes/root.obj';
  const source = generateMujocoXML(robot, { preserveAssetPaths: true });
  assert.ok(assetPaths(source, 'mesh[file]').includes('library/bed & table/meshes/root.obj'));
});
