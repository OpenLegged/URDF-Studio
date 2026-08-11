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
  assert.ok(downloadedBlob);
  const archive = await JSZip.loadAsync(await downloadedBlob.arrayBuffer());
  const urdf = await archive.file('physical/physical.urdf')?.async('string');
  assert.match(urdf ?? '', /data-urdf-studio-geometry="capsule"/);
  assert.match(urdf ?? '', /radius="0\.2" length="1"/);
  assert.doesNotMatch(urdf ?? '', /<mesh\b/);
});
