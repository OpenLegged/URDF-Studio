import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { JSDOM } from 'jsdom';

import { autoSeedAssembly } from '@/core/robot/auto_seed_assembly';
import { resolveRobotFileData } from '@/core/parsers/importRobotFile';
import { buildExportableAssemblyRobotData } from '@/core/robot/assemblyTransforms';
import type { RobotFile, RobotState } from '@/types';

import { exportRobotToUsd } from './usdExport.ts';

const { window } = new JSDOM();

if (!globalThis.DOMParser) {
  globalThis.DOMParser = window.DOMParser as typeof DOMParser;
}

if (!globalThis.XMLSerializer) {
  globalThis.XMLSerializer = window.XMLSerializer as typeof XMLSerializer;
}

const A2_ROOT = 'test/unitree_ros/robots/a2_description';
const A2_SOURCE_PATH = `${A2_ROOT}/a2.xml`;

function createA2SourceFile(): RobotFile {
  return {
    name: A2_SOURCE_PATH,
    format: 'mjcf',
    content: fs.readFileSync(A2_SOURCE_PATH, 'utf8'),
  };
}

function createA2MeshFiles(): Map<string, Blob> {
  const meshFiles = new Map<string, Blob>();
  const meshRoot = `${A2_ROOT}/meshes`;

  fs.readdirSync(meshRoot).forEach((fileName) => {
    const blob = new Blob([fs.readFileSync(`${meshRoot}/${fileName}`)]);
    meshFiles.set(`meshes/${fileName}`, blob);
    meshFiles.set(`${meshRoot}/${fileName}`, blob);
  });

  return meshFiles;
}

async function readUsdBaseLayer(robot: RobotState): Promise<string> {
  const payload = await exportRobotToUsd({
    robot,
    exportName: 'a2',
    assets: {},
    extraMeshFiles: createA2MeshFiles(),
    fileFormat: 'usda',
    layoutProfile: 'isaacsim',
  });
  const baseLayerPath = Array.from(payload.archiveFiles.keys()).find((filePath) =>
    /\/configuration\/a2_base\.usda$/i.test(filePath),
  );

  assert.ok(baseLayerPath, 'expected A2 USD base layer in the export archive');
  return payload.archiveFiles.get(baseLayerPath)!.text();
}

test('single A2 MJCF workspace USD export keeps original names and authored colors', async () => {
  const sourceFile = createA2SourceFile();
  const importResult = resolveRobotFileData(sourceFile, {
    availableFiles: [sourceFile],
    allFileContents: {
      [sourceFile.name]: sourceFile.content,
    },
    assets: {},
  });

  assert.equal(importResult.status, 'ready');
  if (importResult.status !== 'ready') {
    assert.fail('expected A2 MJCF fixture to import');
  }

  const assembly = autoSeedAssembly(importResult.robotData, sourceFile.name, { sourceFile });
  const robot: RobotState = {
    ...buildExportableAssemblyRobotData(assembly),
    selection: { type: null, id: null },
  };
  const baseLayer = await readUsdBaseLayer(robot);

  assert.doesNotMatch(baseLayer, /\bcomp_a2\b/);
  assert.doesNotMatch(baseLayer, /\bcomp_a2_/);
  assert.match(baseLayer, /def Xform "base_link"/);
  assert.match(baseLayer, /rel material:binding = <\/a2\/Looks\/Material_\d+>/);
  assert.match(baseLayer, /color3f inputs:diffuseColor = \(0\.590619, 0\.637597, 0\.854992\)/);
  assert.match(baseLayer, /color3f inputs:diffuseColor = \(0\.783537, 0\.822786, 0\.846874\)/);
  assert.match(baseLayer, /color3f inputs:diffuseColor = \(0\.445201, 0\.445201, 0\.445201\)/);
});
