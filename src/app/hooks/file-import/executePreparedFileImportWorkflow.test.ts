import assert from 'node:assert/strict';
import test from 'node:test';

import { translations } from '@/shared/i18n';
import type { MotorLibrary } from '@/shared/data/motorLibrary';
import type { RobotFile } from '@/types';
import { executePreparedFileImportWorkflow } from './executePreparedFileImportWorkflow.ts';
import type { ExecutePreparedFileImportWorkflowPorts } from './executePreparedFileImportWorkflowTypes.ts';

function createEmptyMotorLibrary(): MotorLibrary {
  return {};
}

test('prepared import commits assets and auto-loads the preferred robot file', async () => {
  const robotFile: RobotFile = {
    name: 'robots/demo.urdf',
    content: '<robot name="demo"/>',
    format: 'urdf',
  };
  const assetsState = {
    allFileContents: {} as Record<string, string>,
    assets: {} as Record<string, string>,
    availableFiles: [] as RobotFile[],
    motorLibrary: createEmptyMotorLibrary(),
    selectedFile: null as RobotFile | null,
    addAssets: (assets: Record<string, string>) => {
      assetsState.assets = { ...assetsState.assets, ...assets };
    },
    setAllFileContents: (contents: Record<string, string>) => {
      assetsState.allFileContents = contents;
    },
    setAvailableFiles: (files: RobotFile[]) => {
      assetsState.availableFiles = files;
    },
    setMotorLibrary: (library: MotorLibrary) => {
      assetsState.motorLibrary = library;
    },
  };
  const loaded: Array<{
    assets?: Record<string, string>;
    file: RobotFile;
    files?: RobotFile[];
    text?: Record<string, string>;
  }> = [];
  const ports: ExecutePreparedFileImportWorkflowPorts = {
    clearPreparedUsdStageOpenCache: () => {},
    commitImportedProject: () => null,
    createAssetUrls: async () => ({ 'meshes/demo.stl': 'blob:mesh' }),
    createObjectUrl: () => 'blob:usd-source',
    getAssetsState: () => assetsState,
    hydrateDeferredArchiveAssetsInBackground: () => {},
    hydrateDeferredImportAssets: async () => [],
    importProject: async () => {
      throw new Error('project import should not run');
    },
    loadRobot: async (file, files, assets, text) => {
      loaded.push({ assets, file, files, text });
    },
    logRegressionInfo: () => {},
    markWorkspaceBaselineSaved: () => {},
    prepareImportPayload: async () => ({
      assetFiles: [{ name: 'meshes/demo.stl', blob: new Blob(['mesh']) }],
      deferredAssetFiles: [],
      libraryFiles: [],
      preferredFileName: robotFile.name,
      preResolvedImports: [],
      robotFiles: [robotFile],
      textFiles: [{ path: robotFile.name, content: robotFile.content }],
      usdSourceFiles: [],
    }),
    prewarmUsdSelectionInBackground: () => {},
    primePreResolvedRobotImports: () => {},
    waitForAnimationFrame: async () => {},
  };

  const result = await executePreparedFileImportWorkflow({
    files: [new File([robotFile.content], robotFile.name)],
    forceLoadRobot: false,
    isCurrentImport: () => true,
    lang: 'en',
    ports,
    t: translations.en,
  });

  assert.deepEqual(result, { status: 'completed' });
  assert.deepEqual(assetsState.availableFiles, [robotFile]);
  assert.equal(assetsState.assets['meshes/demo.stl'], 'blob:mesh');
  assert.equal(assetsState.allFileContents[robotFile.name], robotFile.content);
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0]?.file.name, robotFile.name);
  assert.equal(loaded[0]?.assets?.['meshes/demo.stl'], 'blob:mesh');
  assert.equal(loaded[0]?.text?.[robotFile.name], robotFile.content);
});
