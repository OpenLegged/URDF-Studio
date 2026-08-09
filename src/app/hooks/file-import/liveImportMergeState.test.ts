import assert from 'node:assert/strict';
import test from 'node:test';

import type { RobotFile } from '@/types';
import { buildLiveImportMergeState } from './liveImportMergeState.ts';

const existingFile: RobotFile = {
  name: 'robots/existing.urdf',
  format: 'urdf',
  content: '<robot/>',
};
const importedFile: RobotFile = {
  name: 'robots/new.urdf',
  format: 'urdf',
  content: '<robot name="new"/>',
};

test('live import merge deduplicates files and composes resolution-only assets', () => {
  const result = buildLiveImportMergeState({
    allFileContents: { 'robots/existing.urdf': '<robot/>' },
    assets: { 'meshes/existing.stl': 'blob:existing' },
    availableFiles: [existingFile],
    deferredAssetResolutionAssets: { 'meshes/deferred.stl': 'meshes/deferred.stl' },
    importedFiles: [existingFile, importedFile],
    importedTextFiles: [{ path: 'robots/new.urdf', content: importedFile.content }],
    selectedFile: existingFile,
    sourceAssets: { 'meshes/new.stl': 'blob:new' },
  });

  assert.deepEqual(result.mergedFiles.map((file) => file.name), [
    existingFile.name,
    importedFile.name,
  ]);
  assert.equal(result.hadExistingAvailableFiles, true);
  assert.equal(result.hadSelectedFile, true);
  assert.equal(result.mergedAssets['meshes/deferred.stl'], undefined);
  assert.equal(
    result.mergedResolutionAssets['meshes/deferred.stl'],
    'meshes/deferred.stl',
  );
  assert.equal(result.mergedAllFileContents[importedFile.name], importedFile.content);
});
