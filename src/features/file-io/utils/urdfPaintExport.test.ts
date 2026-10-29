import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { OBJExporter } from 'three/addons/exporters/OBJExporter.js';
import { JSDOM } from 'jsdom';
import { DEFAULT_LINK, GeometryType, type RobotState, type UrdfVisual } from '@/types';
import { getVisualGeometryEntries } from '@/core/robot';
import { generateURDF } from '@/core/parsers';
import { prepareUrdfPaintExport } from './urdfPaintExport';

const dom = new JSDOM();
globalThis.ProgressEvent = dom.window.ProgressEvent as typeof ProgressEvent;

function paintedVisual(): UrdfVisual {
  return {
    ...structuredClone(DEFAULT_LINK.visual), type: GeometryType.BOX,
    dimensions: { x: 2, y: 3, z: 4 }, color: '#ffffff',
    origin: { xyz: { x: 1, y: 2, z: 3 }, rpy: { r: 0.1, p: 0.2, y: 0.3 } },
    authoredMaterials: [
      { name: 'checker', color: '#ffffff', texture: 'checker.png', opacity: 0.75 },
      { name: 'orange', color: '#ff6c0a', opacity: 1 },
      { name: 'green', color: '#00cc44', opacity: 0.4 },
    ],
    meshMaterialGroups: [
      { meshKey: '0', start: 0, count: 30, materialIndex: 0 },
      { meshKey: '0', start: 30, count: 3, materialIndex: 1 },
      { meshKey: '0', start: 33, count: 3, materialIndex: 2 },
    ],
  };
}

function robotWith(visual: UrdfVisual): RobotState {
  return {
    name: 'painted', rootLinkId: 'base', selection: { type: null, id: null }, joints: {},
    links: { base: { ...structuredClone(DEFAULT_LINK), id: 'base', name: 'base', visual } },
  };
}

async function meshEvidence(files: Map<string, Blob>, visuals: UrdfVisual[]) {
  const merged = new THREE.Box3();
  const faces: number[] = [];
  for (const visual of visuals) {
    const text = await files.get(visual.meshPath!)!.text();
    faces.push(text.split('\n').filter(line => line.startsWith('f ')).length);
    assert.match(text, /^vt /m, 'UVs must be exported for the untouched texture');
    const object = new OBJLoader().parse(text);
    merged.union(new THREE.Box3().setFromObject(object));
    object.traverse(child => { if (child instanceof THREE.Mesh) child.geometry.dispose(); });
  }
  return { faces, size: merged.getSize(new THREE.Vector3()).toArray() };
}

test('URDF paint export splits a primitive into UV meshes and exact independent materials without mutating the model', async () => {
  const robot = robotWith(paintedVisual());
  const before = structuredClone(robot);
  const result = await prepareUrdfPaintExport({ robot, assets: {} });
  const visuals = getVisualGeometryEntries(result.robot.links.base).map(entry => entry.geometry);
  assert.equal(visuals.length, 3);
  assert.deepEqual(visuals.map(v => v.authoredMaterials?.[0].opacity), [0.75, 1, 0.4]);
  assert.deepEqual(visuals.map(v => v.authoredMaterials?.[0].texture), ['checker.png', undefined, undefined]);
  for (const visual of visuals) {
    assert.deepEqual(visual.origin, robot.links.base.visual.origin);
    assert.deepEqual(visual.dimensions, { x: 1, y: 1, z: 1 });
    assert.equal(visual.meshMaterialGroups, undefined);
  }
  assert.deepEqual(await meshEvidence(result.extraMeshFiles!, visuals), { faces: [10, 1, 1], size: [2, 3, 4] });
  const xml = generateURDF(result.robot, { preserveNumericPrecision: true, useRelativePaths: true });
  assert.equal((xml.match(/<visual\b/g) ?? []).length, 3);
  assert.match(xml, /0\.4"/);
  assert.match(xml, /0\.75"/);
  assert.deepEqual(robot, before);
});

test('URDF paint export treats shared mesh references per visual, keeps collision assets, and avoids generated path collisions', async () => {
  const cube = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
  const meshBlob = new Blob([new OBJExporter().parse(cube)]);
  cube.geometry.dispose();
  const first = { ...paintedVisual(), type: GeometryType.MESH, meshPath: 'cube.obj' };
  const robot = robotWith(first);
  robot.links.base.visualBodies = [{
    ...structuredClone(first),
    authoredMaterials: [{ color: '#123456', opacity: 0 }],
    meshMaterialGroups: [{ meshKey: '0', start: 0, count: 36, materialIndex: 0 }],
  }];
  robot.links.base.collision = { ...structuredClone(first), authoredMaterials: undefined, meshMaterialGroups: undefined };
  const reserved = new Blob(['reserved']);
  const input = new Map([['cube.obj', meshBlob], ['painted/base_0_slot_0.obj', reserved]]);
  const before = structuredClone(robot);
  const result = await prepareUrdfPaintExport({ robot, assets: {}, extraMeshFiles: input });
  const visuals = getVisualGeometryEntries(result.robot.links.base).map(entry => entry.geometry);
  assert.equal(visuals.length, 4);
  assert.equal(new Set(visuals.map(v => v.meshPath)).size, 4);
  assert.equal(visuals[3].authoredMaterials?.[0].opacity, 0);
  assert.deepEqual((await meshEvidence(result.extraMeshFiles!, visuals)).faces, [10, 1, 1, 12]);
  assert.equal(result.extraMeshFiles!.get('painted/base_0_slot_0.obj'), reserved);
  assert.equal(result.robot.links.base.collision.meshPath, 'cube.obj');
  assert.deepEqual(robot, before);
  assert.equal(input.size, 2);
});

test('URDF paint export leaves unpainted geometry and assets unchanged', async () => {
  const robot = robotWith({ ...paintedVisual(), meshMaterialGroups: undefined });
  const files = new Map<string, Blob>();
  const result = await prepareUrdfPaintExport({ robot, assets: {}, extraMeshFiles: files });
  assert.equal(result.robot, robot);
  assert.equal(result.extraMeshFiles, files);
});

test('URDF paint export resolves source-local meshes and texture-only alpha in separate component directories', async () => {
  const files = new Map<string, Blob>();
  for (const [dir, width] of [['left', 1], ['right', 5]] as const) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, 1, 1));
    files.set(`${dir}/cube.obj`, new Blob([new OBJExporter().parse(mesh)]));
    mesh.geometry.dispose();
  }
  const robot = robotWith({ ...paintedVisual(), type: GeometryType.MESH, meshPath: 'cube.obj' });
  robot.links.base.visual.authoredMaterials![0] = { texture: 'checker.png', opacity: 0.75 };
  for (const [dir, width] of [['left', 2], ['right', 10]] as const) {
    const result = await prepareUrdfPaintExport({
      robot, extraMeshFiles: files, sourceFileDir: `${dir}/`,
      assets: { 'left/checker.png': 'data:image/png;base64,', 'right/checker.png': 'data:image/png;base64,' },
    });
    const visuals = getVisualGeometryEntries(result.robot.links.base).map(entry => entry.geometry);
    assert.equal((await meshEvidence(result.extraMeshFiles!, visuals)).size[0], width);
    assert.equal(visuals[0].authoredMaterials![0].texture, `${dir}/checker.png`);
    assert.equal(visuals[0].authoredMaterials![0].color, '#ffffff');
    const rgba = generateURDF(result.robot, { preserveNumericPrecision: true }).match(/<color rgba="([^"]+)"/)?.[1];
    assert.deepEqual(rgba?.split(' ').map(Number), [1, 1, 1, 0.75]);
  }
});

test('URDF paint export preserves outward triangle winding when baking a mirrored primitive', async () => {
  const visual = paintedVisual();
  visual.dimensions.x = -2;
  const result = await prepareUrdfPaintExport({ robot: robotWith(visual), assets: {} });
  for (const entry of getVisualGeometryEntries(result.robot.links.base)) {
    const mesh = new OBJLoader().parse(await result.extraMeshFiles!.get(entry.geometry.meshPath!)!.text());
    mesh.traverse(child => {
      if (!(child instanceof THREE.Mesh)) return;
      const positions = child.geometry.getAttribute('position');
      const normals = child.geometry.getAttribute('normal');
      for (let i = 0; i < positions.count; i += 3) {
        const a = new THREE.Vector3().fromBufferAttribute(positions, i);
        const b = new THREE.Vector3().fromBufferAttribute(positions, i + 1).sub(a);
        const c = new THREE.Vector3().fromBufferAttribute(positions, i + 2).sub(a);
        assert.ok(b.cross(c).dot(new THREE.Vector3().fromBufferAttribute(normals, i)) > 0);
      }
      child.geometry.dispose();
    });
  }
});

test('URDF paint export rejects missing required mesh assets instead of dropping paint', async () => {
  const robot = robotWith({ ...paintedVisual(), type: GeometryType.MESH, meshPath: 'absent.obj' });
  await assert.rejects(prepareUrdfPaintExport({ robot, assets: {} }), /absent\.obj/);
});
