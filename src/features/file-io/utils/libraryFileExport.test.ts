import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';

import { parseHTML } from 'linkedom';

import { exportLibraryRobotFile } from './libraryFileExport.ts';

const { window } = parseHTML('<!doctype html><html><body></body></html>');
const originalDOMParser = globalThis.DOMParser;
const originalXMLSerializer = globalThis.XMLSerializer;
const originalDocument = globalThis.document;
globalThis.DOMParser = window.DOMParser as typeof globalThis.DOMParser;
globalThis.XMLSerializer = window.XMLSerializer as typeof globalThis.XMLSerializer;
globalThis.document = {
  body: {
    appendChild: () => undefined,
    removeChild: () => undefined,
  },
  createElement: () => ({
    href: '',
    download: '',
    click: () => undefined,
  }),
} as unknown as Document;

const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;
const originalFetch = globalThis.fetch;
let downloadedBlob: Blob | null = null;

URL.createObjectURL = ((blob: Blob) => {
  downloadedBlob = blob;
  return 'blob:library-export-test';
}) as typeof URL.createObjectURL;
URL.revokeObjectURL = (() => undefined) as typeof URL.revokeObjectURL;

async function readDownloadedArchive(): Promise<JSZip> {
  assert.ok(downloadedBlob);
  return JSZip.loadAsync(await downloadedBlob.arrayBuffer());
}

const meshRobotUrdf = `<?xml version="1.0"?>
<robot name="mesh_bot">
  <link name="base_link">
    <visual>
      <geometry>
        <mesh filename="meshes/base.stl" />
      </geometry>
    </visual>
  </link>
</robot>`;

test.after(() => {
  URL.createObjectURL = originalCreateObjectURL;
  URL.revokeObjectURL = originalRevokeObjectURL;
  globalThis.fetch = originalFetch;
  globalThis.DOMParser = originalDOMParser;
  globalThis.XMLSerializer = originalXMLSerializer;
  globalThis.document = originalDocument;
});

test('exportLibraryRobotFile returns non-success when referenced mesh asset is missing', async () => {
  globalThis.fetch = originalFetch;

  const result = await exportLibraryRobotFile({
    file: {
      name: 'robots/mesh_bot.urdf',
      format: 'urdf',
      content: meshRobotUrdf,
    },
    targetFormat: 'urdf',
    assets: {},
  });

  assert.equal(result.success, false);
  assert.equal(result.reason, 'missing-mesh-assets');
  assert.deepEqual(result.missingMeshPaths, ['meshes/base.stl']);
  assert.equal(result.zipFileName, undefined);
});

test('exportLibraryRobotFile returns non-success when mesh fetch fails', async () => {
  globalThis.fetch = async () => {
    throw new Error('network-failure');
  };

  const result = await exportLibraryRobotFile({
    file: {
      name: 'robots/mesh_bot.urdf',
      format: 'urdf',
      content: meshRobotUrdf,
    },
    targetFormat: 'urdf',
    assets: {
      'meshes/base.stl': 'https://example.test/meshes/base.stl',
    },
  });

  assert.equal(result.success, false);
  assert.equal(result.reason, 'missing-mesh-assets');
  assert.deepEqual(result.missingMeshPaths, ['meshes/base.stl']);
  assert.equal(result.zipFileName, undefined);
});

test('exportLibraryRobotFile fits MJCF mesh-backed collision primitives before conversion', async () => {
  downloadedBlob = null;
  globalThis.fetch = originalFetch;

  const result = await exportLibraryRobotFile({
    file: {
      name: 'robots/physical.xml',
      format: 'mjcf',
      content: `<mujoco model="physical">
        <compiler fitaabb="true"/>
        <asset>
          <mesh name="fit" vertex="-0.1 -0.2 -0.5 -0.1 -0.2 0.5 -0.1 0.2 -0.5 -0.1 0.2 0.5 0.1 -0.2 -0.5 0.1 -0.2 0.5 0.1 0.2 -0.5 0.1 0.2 0.5"/>
        </asset>
        <worldbody><body name="base"><geom type="capsule" mesh="fit" group="3"/></body></worldbody>
      </mujoco>`,
    },
    targetFormat: 'urdf',
    assets: {},
  });

  assert.equal(result.success, true);
  const archive = await readDownloadedArchive();
  const urdf = await archive.file('physical/physical.urdf')?.async('string');
  assert.match(urdf ?? '', /data-urdf-studio-geometry="capsule"/);
  const cylinder = new DOMParser().parseFromString(urdf ?? '', 'text/xml').querySelector('cylinder');
  assert.ok(cylinder);
  // Mesh fitting reads Float32 vertices; exporting must retain that fitted value.
  assert.equal(Number(cylinder.getAttribute('radius')), Math.fround(0.2));
  assert.equal(Number(cylinder.getAttribute('length')), 1);
  assert.doesNotMatch(urdf ?? '', /<mesh\b/);
});

for (const { targetFormat, jointType, expectedWarning } of [
  { targetFormat: 'mjcf', jointType: 'planar', expectedWarning: /unsupported planar type/ },
  { targetFormat: 'sdf', jointType: 'floating', expectedWarning: /unsupported floating type/ },
] as const) {
  test(`library ${targetFormat} export returns compatibility warnings alongside the generated archive`, async (t) => {
    downloadedBlob = null;
    globalThis.fetch = originalFetch;
    const warn = t.mock.method(console, 'warn', () => {});
    const source = `<robot name="joint_robot">
      <link name="base"><visual><geometry><box size="0.2 0.2 0.2" /></geometry></visual></link>
      <link name="tip"><visual><geometry><sphere radius="0.1" /></geometry></visual></link>
      <joint name="mount" type="${jointType}"><parent link="base" /><child link="tip" /></joint>
    </robot>`;

    const result = await exportLibraryRobotFile({
      file: { name: 'robots/joint_robot.urdf', format: 'urdf', content: source },
      targetFormat,
      assets: {},
    });

    assert.equal(result.success, true);
    assert.equal(result.zipFileName, `joint_robot_${targetFormat}.zip`);
    assert.deepEqual(result.missingMeshPaths, []);
    assert.ok(result.warnings);
    assert.equal(result.warnings.length, 1);
    assert.match(result.warnings[0], expectedWarning);
    assert.equal(warn.mock.callCount(), 0);
    const archive = await readDownloadedArchive();
    const outputPath = targetFormat === 'mjcf' ? 'joint_robot/joint_robot.xml' : 'joint_robot/model.sdf';
    const output = await archive.file(outputPath)?.async('string');
    assert.ok(output);
    const document = new DOMParser().parseFromString(output, 'text/xml');
    assert.equal(document.getElementsByTagName('parsererror').length, 0);
    if (targetFormat === 'mjcf') {
      assert.equal(document.getElementsByTagName('freejoint').item(0)?.getAttribute('name'), 'mount');
      assert.equal(document.getElementsByTagName('body').length, 2);
    } else {
      assert.equal(document.getElementsByTagName('joint').length, 0);
      assert.equal(document.getElementsByTagName('link').length, 2);
      assert.ok(archive.file('joint_robot/model.config'));
    }
  });
}
