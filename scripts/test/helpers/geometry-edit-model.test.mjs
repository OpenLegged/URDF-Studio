import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { inspectGeometryModel } from './geometry-edit-model.mjs';

const mesh = '<mesh filename="package://example/meshes/link.stl" scale="0.001 0.001 0.001"/>';
const body = (subType, shape, name = '') => `<${subType} name="${name}"><geometry>${shape}</geometry></${subType}>`;
const link = (name, shapes = body('visual', mesh) + body('collision', mesh)) => `<link name="${name}">${shapes}</link>`;
const robot = (contents = link('base')) => `<robot name="example">${contents}</robot>`;

async function withFiles(files, run) {
  const directory = await mkdtemp(path.join(tmpdir(), 'geometry-edit-model-'));
  try {
    for (const [relative, contents] of Object.entries(files)) {
      const filename = path.join(directory, relative);
      await mkdir(path.dirname(filename), { recursive: true });
      await writeFile(filename, contents);
    }
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('reads UTF-8 source identity and mesh collision cases without treating XML comments as geometry', async () => {
  const source = `<?xml version="1.0"?>\r\n<robot name="真实模型">\r\n\t${link('base', body('visual', mesh, 'visual name') + body('collision', mesh))}\r\n  <!-- ${link('commented', body('collision', '<sphere radius="1"/>'))} -->\r\n  <joint name="fixed" type="fixed"/>\r\n</robot>`;
  await withFiles({ 'urdf/model.urdf': source }, async directory => {
    const model = await inspectGeometryModel(directory);
    assert.equal(model.directory, directory);
    assert.equal(model.entry, 'urdf/model.urdf');
    assert.equal(model.name, '真实模型');
    assert.equal(model.linkCount, 1);
    assert.equal(model.jointCount, 1);
    assert.equal(model.sourceBytes, Buffer.byteLength(source));
    assert.equal(model.sourceSha256, createHash('sha256').update(source).digest('hex'));
    assert.equal(model.maxIndent, 2);
    assert.deepEqual(model.cases, [
      { link: 'base', subType: 'visual', objectIndex: 0, type: 'mesh', name: 'visual name' },
      { link: 'base', subType: 'collision', objectIndex: 0, type: 'mesh', name: '' },
    ]);
    assert.deepEqual(model.coverage.testedTypes, { visual: ['mesh'], collision: ['mesh'] });
    assert.deepEqual(model.coverage.omittedCases, []);
  });
});

test('prioritizes shape coverage, all collisions of a selected link, and the document tail within twelve links', async () => {
  const repeated = Array.from({ length: 25 }, (_, index) => link(`leg_${index}`, body('visual', mesh) + body('collision', '<box size="1 1 1"/>')));
  repeated.splice(15, 0, link('primitive_visual', body('visual', '<box size="1 1 1"/>')));
  repeated.splice(19, 0, link('sphere_foot', body('collision', '<sphere radius="0.1"/>')));
  repeated.splice(22, 0, link('multi_arm', body('visual', mesh) + body('collision', '<cylinder radius="0.1" length="1"/>') + body('collision', '<capsule radius="0.1" length="1"/>') + body('collision', '<box size="1 1 1"/>')));
  repeated.splice(23, 0, ...Array.from({ length: 4 }, (_, index) =>
    link(`multi_leg_${index}`, body('visual', mesh) + body('collision', mesh) + body('collision', mesh))));
  repeated.push(link('tail'));
  await withFiles({ 'model.urdf': robot(repeated.join('')) }, async directory => {
    const first = await inspectGeometryModel(directory);
    const second = await inspectGeometryModel(directory);
    assert.deepEqual(first.cases, second.cases, 'selection is deterministic');
    assert.equal(first.coverage.selectedLinks.length, 12);
    assert.ok(first.coverage.selectedLinks.includes('tail'));
    assert.ok(first.coverage.selectedLinks.includes('primitive_visual'));
    assert.ok(first.coverage.selectedLinks.includes('sphere_foot'));
    assert.ok(first.coverage.selectedLinks.includes('multi_arm'));
    for (let index = 0; index < 4; index += 1) {
      assert.ok(first.coverage.selectedLinks.includes(`multi_leg_${index}`));
    }
    assert.deepEqual(first.cases.filter(item => item.link === 'multi_arm' && item.subType === 'collision').map(item => item.objectIndex), [0, 1, 2]);
    assert.deepEqual(first.coverage.uncoveredTypes, { visual: [], collision: [] });
    assert.ok(first.coverage.omittedCases.some(item => item.reason === 'link-limit'));
    assert.equal(first.coverage.testedGeometryCount, first.cases.length);
    assert.equal(first.coverage.availableGeometryCount, first.cases.length + first.coverage.omittedCases.length);
  });
});

test('fills the remaining link budget with paired roles before single-role links', async () => {
  const links = [
    ...Array.from({ length: 15 }, (_, index) => link(`rotor_${index}`, body('collision', mesh))),
    ...Array.from({ length: 15 }, (_, index) => link(`paired_${index}`)),
  ];
  await withFiles({ 'model.urdf': robot(links.join('')) }, async directory => {
    const model = await inspectGeometryModel(directory);
    assert.equal(model.coverage.selectedLinks.length, 12);
    assert.ok(model.coverage.selectedLinks.every(name => name.startsWith('paired_')));
    assert.ok(model.coverage.selectedLinks.includes('paired_14'));
  });
});

test('reports additional visuals and unsupported shapes instead of including them in passed coverage', async () => {
  const source = robot(link('base', body('visual', '<box size="1 1 1"/>') + body('visual', '<sphere radius="1"/>', 'extra') + body('collision', mesh) + body('collision', '<heightfield/>', 'unsupported')));
  await withFiles({ 'model.urdf': source }, async directory => {
    const model = await inspectGeometryModel(directory);
    assert.equal(model.cases.length, 2);
    assert.deepEqual(model.coverage.omittedCases.map(item => [item.name, item.reason]), [
      ['extra', 'additional-visual'], ['unsupported', 'unsupported-type'],
    ]);
    assert.deepEqual(model.coverage.uncoveredTypes.visual, ['sphere']);
  });
});

test('filters hidden files/directories and node_modules while keeping normal model resources', async () => {
  await withFiles({
    'urdf/model.urdf': robot(), 'meshes/link.stl': 'mesh data', 'package.xml': '<package/>',
    '.git/old.urdf': robot(), '.cache.urdf': robot(), '.hidden/nested.urdf': robot(),
    'node_modules/library/model.urdf': robot(), 'meshes/.DS_Store': 'metadata',
  }, async directory => {
    const model = await inspectGeometryModel(directory);
    assert.deepEqual(model.files.map(filename => path.relative(directory, filename)), ['meshes/link.stl', 'package.xml', 'urdf/model.urdf']);
  });
});

test('rejects missing directories, directories without a URDF, and ambiguous URDF entries', async () => {
  await withFiles({ 'README.txt': 'empty model folder' }, async directory => {
    await assert.rejects(inspectGeometryModel(path.join(directory, 'missing')), /Cannot read model directory/);
    await assert.rejects(inspectGeometryModel(path.join(directory, 'README.txt')), /not a directory/);
    await assert.rejects(inspectGeometryModel(directory), /No URDF entry/);
  });
  await withFiles({ 'one.urdf': robot(), 'two.URDF': robot() }, async directory => {
    await assert.rejects(inspectGeometryModel(directory), /Multiple URDF entries.*one\.urdf.*two\.URDF/);
  });
});

test('rejects invalid XML and non-robot roots', async () => {
  await withFiles({ 'model.urdf': '<robot><link></robot>' }, async directory => {
    await assert.rejects(inspectGeometryModel(directory), /Invalid URDF XML/);
  });
  await withFiles({ 'model.urdf': '<package/>' }, async directory => {
    await assert.rejects(inspectGeometryModel(directory), /Expected a <robot> URDF root/);
  });
});

test('requires both testable visual and collision roles', async () => {
  for (const subType of ['visual', 'collision']) {
    await withFiles({ 'model.urdf': robot(link('base', body(subType, mesh))) }, async directory => {
      await assert.rejects(inspectGeometryModel(directory), /both a testable first visual and a testable collision/);
    });
  }
});

test('does not follow visible file or directory symbolic links', async () => {
  await withFiles({ 'model.urdf': robot(), 'meshes/link.stl': 'mesh data' }, async directory => {
    const alias = path.join(directory, 'alias.stl');
    await symlink(path.join(directory, 'meshes/link.stl'), alias);
    await assert.rejects(inspectGeometryModel(directory), /Symbolic links are not supported.*alias\.stl/);
    await rm(alias);
    await symlink(path.join(directory, 'meshes'), path.join(directory, 'alias'));
    await assert.rejects(inspectGeometryModel(directory), /Symbolic links are not supported.*alias/);
    await assert.rejects(inspectGeometryModel(path.join(directory, 'alias')), /Symbolic links are not supported/);
  });
});

test('rejects missing and duplicate link names before planning browser selectors', async () => {
  for (const contents of [link(''), link('base') + link('base')]) {
    await withFiles({ 'model.urdf': robot(contents) }, async directory => {
      await assert.rejects(inspectGeometryModel(directory), /Missing or duplicate URDF link name/);
    });
  }
});
