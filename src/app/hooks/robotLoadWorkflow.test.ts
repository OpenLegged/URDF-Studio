import assert from 'node:assert/strict';
import test from 'node:test';

import type { RobotImportResult } from '@/core/parsers/importRobotFile';
import type { DocumentLoadState } from '@/store/assetsStore';
import { DEFAULT_LINK, type RobotData, type RobotFile } from '@/types';

import { runRobotLoadWorkflow } from './robotLoadWorkflow.ts';

function createRobot(name: string): RobotData {
  return {
    name,
    rootLinkId: 'base',
    links: {
      base: { ...structuredClone(DEFAULT_LINK), id: 'base', name: 'base' },
    },
    joints: {},
  };
}

function createReadyResult(file: RobotFile): RobotImportResult {
  return {
    status: 'ready',
    format: file.format,
    robotData: createRobot('loaded'),
    resolvedUrdfContent: null,
    resolvedUrdfSourceFilePath: null,
  };
}

async function runReadyLoad(source: 'pre-resolved' | 'worker') {
  const file: RobotFile = {
    name: 'robots/demo.urdf',
    format: 'urdf',
    content: '<robot name="demo"><link name="base" /></robot>',
  };
  const result = createReadyResult(file);
  let documentLoadState: DocumentLoadState = {
    status: 'idle',
    fileName: null,
    format: null,
    error: null,
  };
  const committedResults: RobotImportResult[] = [];
  const workerRequests: string[] = [];

  const outcome = await runRobotLoadWorkflow({
    requestEpoch: { current: 0 },
    requestedFile: file,
    labels: {
      failedToParseFormat: 'Failed to parse {format}',
      importPackageAssetBundleHint: 'Missing assets: {assets}',
      xacroSourceOnlyPreviewHint: 'Source-only preview unavailable',
    },
    ports: {
      cancelPendingUsdLoad: () => false,
      commitResolvedLoad: ({ importResult }) => {
        committedResults.push(importResult);
        return null;
      },
      getAssetsState: () => ({
        allFileContents: { [file.name]: file.content },
        assets: {},
        availableFiles: [file],
        documentLoadState,
        getUsdPreparedExportCache: () => null,
        selectedFile: null,
      }),
      getCurrentAppMode: () => 'editor',
      getPendingUsdLoad: () => null,
      markWorkspaceBaselineSaved: () => {},
      onViewerReload: () => {},
      peekPreResolvedImport: () => (source === 'pre-resolved' ? result : null),
      prewarmUsdSelection: () => {},
      resolveRobotFileData: async (requestedFile) => {
        workerRequests.push(requestedFile.name);
        return result;
      },
      setAppMode: () => {},
      setDocumentLoadState: (state) => {
        documentLoadState = state;
      },
      showToast: () => {},
      waitForNextPaint: async () => {},
    },
  });

  return { committedResults, documentLoadState, outcome, workerRequests };
}

for (const source of ['pre-resolved', 'worker'] as const) {
  test(`${source} robot loads share the same commit and viewer handoff`, async () => {
    const loaded = await runReadyLoad(source);

    assert.equal(loaded.outcome, null);
    assert.equal(loaded.committedResults.length, 1);
    assert.equal(loaded.committedResults[0]?.status, 'ready');
    assert.deepEqual(loaded.workerRequests, source === 'worker' ? ['robots/demo.urdf'] : []);
    assert.deepEqual(loaded.documentLoadState, {
      status: 'loading',
      fileName: 'robots/demo.urdf',
      format: 'urdf',
      error: null,
      phase: 'preparing-scene',
      message: null,
      progressMode: 'percent',
      progressPercent: 40,
      loadedCount: null,
      totalCount: null,
    });
  });
}
