import test from 'node:test';
import assert from 'node:assert/strict';

import * as sharedUtils from './index';

test('shared utils expose robot file support helpers for library export and import accept filters', () => {
  const robotFileSupport = sharedUtils as typeof sharedUtils & {
    isLibraryRobotExportableFormat?: (format: string) => boolean;
    isLibraryComponentAddableFile?: (file: { name: string; format: string }) => boolean;
    isLibraryPreviewableFile?: (file: { name: string; format: string }) => boolean;
    isVisibleLibraryAssetPath?: (path: string) => boolean;
    classifyLibraryFileKind?: (file: { name: string; format: string }) => string;
    ROBOT_IMPORT_ACCEPT_ATTRIBUTE?: string;
    LIBRARY_MESH_IMPORT_ACCEPT_ATTRIBUTE?: string;
    LIBRARY_IMAGE_IMPORT_ACCEPT_ATTRIBUTE?: string;
  };

  assert.equal(typeof robotFileSupport.isLibraryRobotExportableFormat, 'function');
  assert.equal(robotFileSupport.isLibraryRobotExportableFormat?.('urdf'), true);
  assert.equal(robotFileSupport.isLibraryRobotExportableFormat?.('mjcf'), true);
  assert.equal(robotFileSupport.isLibraryRobotExportableFormat?.('xacro'), true);
  assert.equal(robotFileSupport.isLibraryRobotExportableFormat?.('sdf'), true);
  assert.equal(robotFileSupport.isLibraryRobotExportableFormat?.('usd'), false);

  assert.match(robotFileSupport.ROBOT_IMPORT_ACCEPT_ATTRIBUTE ?? '', /(^|,)\.mjcf(,|$)/);
  assert.match(robotFileSupport.ROBOT_IMPORT_ACCEPT_ATTRIBUTE ?? '', /(^|,)\.glb(,|$)/);
  assert.match(robotFileSupport.ROBOT_IMPORT_ACCEPT_ATTRIBUTE ?? '', /(^|,)\.ply(,|$)/);
  assert.match(robotFileSupport.ROBOT_IMPORT_ACCEPT_ATTRIBUTE ?? '', /(^|,)\.png(,|$)/);
  assert.doesNotMatch(robotFileSupport.ROBOT_IMPORT_ACCEPT_ATTRIBUTE ?? '', /(^|,)\.bmp(,|$)/);
  assert.match(robotFileSupport.LIBRARY_MESH_IMPORT_ACCEPT_ATTRIBUTE ?? '', /(^|,)\.gltf(,|$)/i);
  assert.match(robotFileSupport.LIBRARY_MESH_IMPORT_ACCEPT_ATTRIBUTE ?? '', /(^|,)\.ply(,|$)/i);
  assert.match(robotFileSupport.LIBRARY_IMAGE_IMPORT_ACCEPT_ATTRIBUTE ?? '', /(^|,)\.webp(,|$)/i);

  assert.equal(
    robotFileSupport.classifyLibraryFileKind?.({
      name: 'robots/demo.urdf',
      format: 'urdf',
    }),
    'robot',
  );
  assert.equal(
    robotFileSupport.classifyLibraryFileKind?.({
      name: 'meshes/base.glb',
      format: 'mesh',
    }),
    'mesh',
  );
  assert.equal(
    robotFileSupport.classifyLibraryFileKind?.({
      name: 'textures/albedo.png',
      format: 'mesh',
    }),
    'image',
  );
  assert.equal(
    robotFileSupport.isLibraryComponentAddableFile?.({
      name: 'textures/albedo.png',
      format: 'mesh',
    }),
    false,
  );
  assert.equal(
    robotFileSupport.isLibraryPreviewableFile?.({
      name: 'textures/albedo.png',
      format: 'mesh',
    }),
    true,
  );
  assert.equal(
    robotFileSupport.classifyLibraryFileKind?.({
      name: 'materials/demo.material',
      format: 'asset',
    }),
    'support',
  );
  assert.equal(robotFileSupport.isVisibleLibraryAssetPath?.('textures/albedo.bmp'), false);
  assert.equal(
    robotFileSupport.classifyLibraryFileKind?.({
      name: 'textures/albedo.bmp',
      format: 'mesh',
    }),
    'support',
  );
});


test('MDL dependencies are collected as support assets without becoming library models', () => {
  for (const name of ['Surface.mdl', 'materials/Templates/GlassWithVolume.MDL']) {
    assert.equal(sharedUtils.isRobotImportCandidatePath(name), true);
    assert.equal(sharedUtils.isRobotImportAssetPath(name), true);
    assert.equal(sharedUtils.isVisibleLibraryAssetPath(name), false);
    assert.equal(sharedUtils.isLibraryPreviewableFile({ name, format: 'asset' }), false);
    assert.equal(sharedUtils.isLibraryComponentAddableFile({ name, format: 'asset' }), false);
    assert.equal(sharedUtils.classifyLibraryFileKind({ name, format: 'asset' }), 'support');
  }
  assert.doesNotMatch(sharedUtils.ROBOT_IMPORT_ACCEPT_ATTRIBUTE, /(^|,)\.mdl(,|$)/i);
});
