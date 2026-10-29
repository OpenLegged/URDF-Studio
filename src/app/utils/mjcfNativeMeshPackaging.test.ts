import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';

import { DEFAULT_LINK, GeometryType, type RobotState } from '@/types';
import { prepareMjcfExport } from '@/features/file-io/utils/mjcfExport';
import {
  hydratePrepareExportArchiveAssetsArgsFromWorker,
  prepareExportArchiveAssets,
  serializePrepareExportArchiveAssetsArgsForWorker,
} from './exportArchiveAssetsWorker';

const dom = new JSDOM();
globalThis.DOMParser = dom.window.DOMParser as typeof DOMParser;
globalThis.XMLSerializer = dom.window.XMLSerializer as typeof XMLSerializer;

for (const useInlineFiles of [false, true]) {
  test(`MJCF keeps same-basename native meshes bound to their original bytes with ${useInlineFiles ? 'inline reuse' : 'asset URLs'}`, async (context) => {
    const paths = ['left', 'right', 'copy'].map((name) => `parts/${name}/meshes/root.obj`);
    const contents = ['left geometry', 'different right geometry', 'left geometry'];
    const files = new Map(paths.map((path, index) => [path, new Blob([contents[index]!])]));
    const assets = Object.fromEntries([...files].map(([path, blob]) => [path, URL.createObjectURL(blob)]));
    context.after(() => Object.values(assets).forEach((url) => URL.revokeObjectURL(url)));
    const robot: RobotState = {
      name: 'mesh-collisions', rootLinkId: 'left', joints: {},
      selection: { type: null, id: null },
      links: Object.fromEntries(['left', 'right', 'copy'].map((name, index) => {
        const link = { ...structuredClone(DEFAULT_LINK), id: name, name };
        link.visual.type = GeometryType.MESH;
        link.visual.meshPath = paths[index]!;
        link.visual.mjcfMesh = { name: `${name}_mesh`, file: `/${paths[index]!}` };
        return [name, link];
      })),
    };
    const prepared = await prepareMjcfExport({
      robot, assets, ...(useInlineFiles ? { extraMeshFiles: files } : {}),
      mujoco: { meshdir: 'meshes/', includeSceneHelpers: false },
    });
    const args = hydratePrepareExportArchiveAssetsArgsFromWorker(structuredClone(
      serializePrepareExportArchiveAssetsArgsForWorker({
        robot, assets, targetFormat: 'mjcf', ...(useInlineFiles ? { extraMeshFiles: files } : {}),
        meshPathOverrides: prepared.meshes.meshPathOverrides,
        skipMeshPaths: prepared.meshes.convertedSourceMeshPaths,
      }),
    ));
    const packaged = await prepareExportArchiveAssets(args);
    assert.deepEqual(packaged.failedAssets, []);
    assert.equal(packaged.files.length, useInlineFiles ? 2 : 3);
    const document = new DOMParser().parseFromString(prepared.xml, 'text/xml');
    const exportedBytes = new Map(packaged.files.map((file) => [file.exportPath, new TextDecoder().decode(file.bytes)]));
    for (const [index, name] of ['left', 'right', 'copy'].entries()) {
      const mesh = document.querySelector(`mesh[name="${name}_mesh"]`);
      assert.ok(mesh);
      const path = mesh.getAttribute('file')!;
      assert.equal(exportedBytes.get(path), contents[index], `wrong mesh bytes for ${name}: ${path}`);
    }
    assert.notEqual(prepared.meshes.meshPathOverrides.get(paths[0]!), prepared.meshes.meshPathOverrides.get(paths[1]!));
    assert.equal(robot.links.left!.visual.meshPath, paths[0]);
  });
}
