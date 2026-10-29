import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import JSZip from 'jszip';

import { findAssetByPath } from '@/core/loaders/assetPathIndex';
import type { RobotFile } from '@/types';
import { validateMJCFImportExternalAssets } from './mjcfImportValidation.ts';
import { parseMJCFModel } from './mjcfModel.ts';
import { createCanonicalSnapshotFromParsedModel } from './mjcfSnapshot.ts';
import { resolveMJCFSource } from './mjcfSourceResolver.ts';

const dom = new JSDOM();
globalThis.DOMParser = dom.window.DOMParser as typeof DOMParser;
globalThis.XMLSerializer = dom.window.XMLSerializer as typeof XMLSerializer;

function file(name: string, content: string): RobotFile {
  return { name, content, format: 'mjcf' };
}

function assertClose(actual: number[] | undefined, expected: number[]): void {
  assert.ok(actual);
  assert.equal(actual.length, expected.length);
  actual.forEach((value, index) => assert.ok(Math.abs(value - expected[index]!) < 1e-6));
}

test('whole-model attach retains multiple roots and world elements under the host frame', () => {
  const files = [
    file('scene.xml', `<mujoco><compiler angle="radian"/>
      <asset><model name="child" file="parts/model.xml"/></asset>
      <worldbody><frame pos="1 2 3" euler="0 0 1.5707963267948966">
        <attach model="child" prefix="room__"/>
      </frame></worldbody></mujoco>`),
    file('parts/model.xml', `<mujoco><worldbody>
      <body name="first" pos="1 0 0" euler="90 0 0"><geom size="1"/></body>
      <body name="second" pos="0 1 0"/>
      <geom name="floor" type="box" size="2 2 .1"/>
      <site name="origin"/>
      <light name="sun"/><camera name="overview"/>
    </worldbody></mujoco>`),
  ];
  const resolved = resolveMJCFSource(files[0]!, files);
  assert.deepEqual(resolved.issues, []);
  const model = parseMJCFModel(resolved.content);
  assert.ok(model);
  assert.deepEqual(model.worldBody.children.map((body) => body.sourceName), [
    'room__first', 'room__second',
  ]);
  assertClose(model.worldBody.children[0]!.pos, [1, 3, 3]);
  assertClose(model.worldBody.children[0]!.quat, [.5, .5, .5, .5]);
  assertClose(model.worldBody.children[1]!.pos, [0, 2, 3]);
  assert.equal(model.worldBody.geoms[0]!.sourceName, 'room__floor');
  assert.equal(model.worldBody.sites[0]!.sourceName, 'room__origin');
  const doc = new DOMParser().parseFromString(resolved.content, 'text/xml');
  assert.equal(doc.querySelectorAll('attach').length, 0);
  assert.ok(doc.querySelector('light[name="room__sun"]'));
  assert.ok(doc.querySelector('camera[name="room__overview"]'));
});

test('attached mesh and texture paths remain distinct despite identical names and host directories', () => {
  const child = `<mujoco><compiler meshdir="meshes" texturedir="textures"/>
    <asset><mesh name="visual" file="root.obj"/>
      <texture name="color" type="2d" file="root.png"/>
      <texture name="cube" type="cube" fileup="up.png"/>
      <material name="surface" texture="color"/></asset>
    <worldbody><body name="root"><geom type="mesh" mesh="visual" material="surface"/></body></worldbody>
  </mujoco>`;
  const files = [
    file('bundle/scene.xml', `<mujoco><compiler meshdir="host-meshes" texturedir="host-textures"/>
      <asset><model name="left" file="left/model.xml"/><model name="right" file="right/model.xml"/></asset>
      <worldbody><attach model="left" prefix="left__"/><attach model="right" body="root" prefix="right__"/></worldbody>
    </mujoco>`),
    file('bundle/left/model.xml', child), file('bundle/right/model.xml', child),
  ];
  const resolved = resolveMJCFSource(files[0]!, files);
  const model = parseMJCFModel(resolved.content);
  assert.ok(model);
  const assets: Record<string, string> = {};
  for (const side of ['left', 'right']) {
    assert.equal(model.meshMap.get(`${side}__visual`)?.file, `/bundle/${side}/meshes/root.obj`);
    assert.equal(model.textureMap.get(`${side}__color`)?.file, `/bundle/${side}/textures/root.png`);
    assets[`bundle/${side}/meshes/root.obj`] = `blob:${side}-mesh`;
    assets[`bundle/${side}/textures/root.png`] = `blob:${side}-texture`;
    assets[`bundle/${side}/textures/up.png`] = `blob:${side}-cube`;
  }
  for (const side of ['left', 'right']) {
    assert.equal(findAssetByPath(model.meshMap.get(`${side}__visual`)!.file!, assets, 'bundle'), `blob:${side}-mesh`);
  }
  assert.deepEqual(validateMJCFImportExternalAssets(
    files[0]!.name, resolved.validationContent, files, assets,
  ), []);
  assert.match(resolved.content, /fileup="\/bundle\/left\/textures\/up.png"/);
});

// The original archive is kept outside Git. Set this variable to rerun the
// user-reported scene, without flattening XML or changing any archive entry.
const sceneArchivePath = process.env.MJCF_SCENE_REGRESSION_ZIP;
test('original scene-editor ZIP matches the native MuJoCo structure and resource paths', {
  skip: !sceneArchivePath,
}, async (context) => {
  const bytes = await readFile(sceneArchivePath!);
  assert.equal(createHash('sha256').update(bytes).digest('hex'),
    '67c6d2ca0508d15ece94a72f75ca5307f28340db8511bef35c965e9cb6163412');
  const zip = await JSZip.loadAsync(bytes, { checkCRC32: true });
  const files: RobotFile[] = [];
  const assets: Record<string, string> = {};
  for (const entry of Object.values(zip.files)) {
    if (entry.dir) continue;
    assets[entry.name] = `blob:${entry.name}`;
    if (entry.name.endsWith('.xml')) {
      files.push(file(entry.name, await entry.async('string')));
    }
  }
  const source = files.find((entry) => entry.name === 'scene.xml');
  assert.ok(source);
  const resolved = resolveMJCFSource(source, files);
  assert.deepEqual(resolved.issues, []);
  assert.deepEqual(validateMJCFImportExternalAssets(source.name, resolved.validationContent, files, assets), []);
  const model = parseMJCFModel(resolved.content);
  assert.ok(model);
  assert.deepEqual(model.recoveryDiagnostics, []);
  const snapshot = createCanonicalSnapshotFromParsedModel(model);
  assert.equal(snapshot.counts.bodies, 15);
  assert.equal(snapshot.counts.geoms, 19);
  assert.equal(snapshot.counts.joints, 4);
  assert.equal(snapshot.counts.meshes, 8);
  // The canonical texture map contains the five named textures; the unnamed
  // procedural skybox remains in the resolved source.
  assert.equal(model.textureMap.size, 5);
  assert.equal(new DOMParser().parseFromString(resolved.content, 'text/xml').querySelectorAll('asset > texture').length, 6);
  assert.equal(model.keyframes[0]?.name, 'enkeebot_initial');
  const expectedPositions: Record<string, number[]> = {
    bed: [0, 1.05, .002],
    'nightstand-left': [-1.42, 1.9, .002],
    'nightstand-right': [1.42, 1.9, .002],
    wardrobe: [-1.88, -1.2, .002],
  };
  for (const [name, position] of Object.entries(expectedPositions)) {
    const body = model.worldBody.children.find((entry) => entry.sourceName === `${name}__root`);
    assert.ok(body);
    assertClose(body.pos, position);
    assert.equal(body.geoms.length, 2);
    assert.equal(body.joints[0]?.type, 'free');
    const mesh = model.meshMap.get(`${name}__root_visual_0`);
    assert.ok(mesh?.file?.startsWith(`/instance-models/${name}/`));
  }
  for (const mesh of model.meshMap.values()) {
    assert.ok(mesh.file);
    assert.equal(findAssetByPath(mesh.file, assets, ''), assets[mesh.file.slice(1)]);
  }
  for (const texture of model.textureMap.values()) {
    if (texture.file) {
      assert.equal(findAssetByPath(texture.file, assets, ''), assets[texture.file.slice(1)]);
    }
  }
  context.diagnostic(JSON.stringify({ sha256: createHash('sha256').update(bytes).digest('hex'), ...snapshot.counts }));
});

test('nested whole-model attachments preserve inner paths and compiler settings', () => {
  const files = [
    file('scene.xml', `<mujoco><asset><model name="outer" file="parts/outer.xml"/></asset>
      <worldbody><attach model="outer" prefix="a__"/></worldbody></mujoco>`),
    file('parts/outer.xml', `<mujoco><compiler angle="radian" meshdir="outer-meshes"/>
      <asset><model name="inner" file="inner/model.xml"/></asset>
      <worldbody><attach model="inner" prefix="b__"/></worldbody></mujoco>`),
    file('parts/inner/model.xml', `<mujoco><compiler meshdir="meshes"/>
      <asset><mesh name="visual" file="root.obj"/></asset>
      <worldbody><body name="root" euler="90 0 0"><geom type="mesh" mesh="visual"/></body></worldbody>
    </mujoco>`),
  ];
  const resolved = resolveMJCFSource(files[0]!, files);
  assert.deepEqual(resolved.issues, []);
  const model = parseMJCFModel(resolved.content);
  assert.ok(model);
  assert.equal(model.meshMap.get('a__b__visual')?.file, '/parts/inner/meshes/root.obj');
  assert.equal(model.worldBody.children[0]?.sourceName, 'a__b__root');
  assertClose(model.worldBody.children[0]?.quat, [Math.SQRT1_2, Math.SQRT1_2, 0, 0]);
  assert.deepEqual(validateMJCFImportExternalAssets(
    files[0]!.name, resolved.validationContent, files, { 'parts/inner/meshes/root.obj': 'blob:inner' },
  ), []);
});

test('attached resources resolve parent directories before normalizing bundle paths', () => {
  const files = [
    file('scene.xml', `<mujoco><asset><model name="child" file="parts/xml/model.xml"/></asset>
      <worldbody><attach model="child" prefix="child__"/></worldbody></mujoco>`),
    file('parts/xml/model.xml', `<mujoco><compiler assetdir="../assets"/>
      <asset><mesh name="visual" file="../meshes/root.obj"/>
        <hfield name="terrain" file="height.bin" size="1 1 1 1"/></asset>
      <worldbody><geom type="hfield" hfield="terrain"/></worldbody></mujoco>`),
  ];
  const resolved = resolveMJCFSource(files[0]!, files);
  const model = parseMJCFModel(resolved.content);
  assert.ok(model);
  assert.equal(model.meshMap.get('child__visual')?.file, '/parts/meshes/root.obj');
  assert.equal(model.hfieldMap.get('child__terrain')?.file, '/parts/assets/height.bin');
  assert.equal(model.worldBody.geoms[0]?.hfield, 'child__terrain');
});

test('explicit body selection preserves the compiler scope of an inner whole-model attachment', () => {
  const files = [
    file('scene.xml', `<mujoco><asset><model name="outer" file="outer.xml"/></asset>
      <worldbody><attach model="outer" body="b__root" prefix="a__"/></worldbody></mujoco>`),
    file('outer.xml', `<mujoco><compiler angle="radian"/>
      <asset><model name="inner" file="inner.xml"/></asset>
      <worldbody><attach model="inner" prefix="b__"/></worldbody></mujoco>`),
    file('inner.xml', '<mujoco><worldbody><body name="root" euler="90 0 0"/></worldbody></mujoco>'),
  ];
  const model = parseMJCFModel(resolveMJCFSource(files[0]!, files).content);
  assertClose(model?.worldBody.children[0]?.quat, [Math.SQRT1_2, Math.SQRT1_2, 0, 0]);
});

test('whole-model attach retains every worldbody section, including expanded includes', () => {
  const files = [
    file('scene.xml', `<mujoco><asset><model name="child" file="parts/model.xml"/></asset>
      <worldbody><attach model="child" prefix="child__"/></worldbody></mujoco>`),
    file('parts/model.xml', `<mujoco><worldbody><body name="first"/></worldbody>
      <include file="extra.xml"/></mujoco>`),
    file('parts/extra.xml', '<mujocoinclude><worldbody><body name="second"/></worldbody></mujocoinclude>'),
  ];
  const model = parseMJCFModel(resolveMJCFSource(files[0]!, files).content);
  assert.deepEqual(model?.worldBody.children.map((body) => body.sourceName), ['child__first', 'child__second']);
});

test('whole-model attach reports unresolved and circular models instead of silently dropping them', () => {
  const files = [file('scene.xml', `<mujoco><asset>
    <model name="missing" file="absent.xml"/><model name="cycle" file="scene.xml"/>
    </asset><worldbody><attach model="unknown"/><attach model="missing"/><attach model="cycle"/></worldbody></mujoco>`)];
  const resolved = resolveMJCFSource(files[0]!, files);
  assert.deepEqual(resolved.issues.map((issue) => issue.kind), [
    'missing_attached_model_asset', 'missing_attached_model_file', 'circular_attach',
  ]);
});
