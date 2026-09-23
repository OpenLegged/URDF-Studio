import test from 'node:test';
import assert from 'node:assert/strict';
import { translations } from '@/shared/i18n';

import { resolveExportErrorMessage, resolveExportWarningMessage } from './exportErrorMessage';

const labels = translations.zh;

test('resolveExportErrorMessage maps unsupported URDF ball joint errors to friendly copy', () => {
  const message = resolveExportErrorMessage(
    new Error('[URDF export] Joint "joint_1" uses unsupported ball type.'),
    labels,
  );

  assert.equal(
    message,
    '无法导出为 URDF/Xacro：关节 joint_1 使用了不受支持的 ball 类型。可以继续编辑，或导出为 MJCF、SDF，或保存为 .usp 项目。',
  );
});

test('resolveExportErrorMessage localizes unsupported URDF free joints', () => {
  const message = resolveExportErrorMessage(
    new Error('[URDF export] Joint "floating_base" uses unsupported free type.'),
    labels,
  );

  assert.equal(
    message,
    '无法导出为 URDF/Xacro：关节 floating_base 使用了不受支持的 free 类型。可以继续编辑，或导出为 MJCF、SDF，或保存为 .usp 项目。',
  );
});

test('resolveExportErrorMessage localizes unrecognized runtime errors', () => {
  const message = resolveExportErrorMessage(new Error('boom'), labels);

  assert.equal(message, labels.exportFailed);
});

test('resolveExportErrorMessage does not mislabel unknown errors as parse failures', () => {
  const message = resolveExportErrorMessage(null, labels);

  assert.equal(message, labels.exportFailed);
});

for (const language of ['zh', 'en'] as const) {
  const t = translations[language];
  test(`${language} export errors retain actionable translated workflow details`, () => {
    const parseError = t.exportLibraryParseFailed.replace('{file}', 'robots/机械臂.urdf');
    assert.equal(resolveExportErrorMessage(new Error(parseError), t), parseError);
    assert.equal(resolveExportErrorMessage(new Error(translations.en.usdExportUnavailable), t), t.usdExportUnavailable);
    const unsupportedMeshes = translations.en.usdExportWorkerUnsupportedMeshes
      .replace('{count}', '2').replace('{meshPath}', 'robot/mesh.xyz');
    assert.equal(resolveExportErrorMessage(new Error(unsupportedMeshes), t), t.usdExportWorkerUnsupportedMeshes
      .replace('{count}', '2').replace('{meshPath}', 'robot/mesh.xyz'));
    assert.equal(resolveExportErrorMessage(new Error('Failed to pack asset "robot/mesh.stl": fetch failed'), t),
      t.exportAssetPackagingFailed.replace('{file}', 'robot/mesh.stl'));
    assert.equal(resolveExportErrorMessage(new Error('Missing component mesh asset "robot/mesh.stl" for arm'), t),
      t.exportMissingMeshAsset.replace('{file}', 'robot/mesh.stl').replace('{name}', 'arm'));
    assert.equal(resolveExportErrorMessage(new Error('Cannot export a project while an exclusive workspace operation is active.'), t),
      t.exportWorkspaceBusy);
    assert.equal(resolveExportErrorMessage(new Error('Failed to commit the pending workspace edit before project export.'), t),
      t.exportPendingEditFailed);
    assert.equal(resolveExportErrorMessage('Unrecognized worker failure', t), t.exportFailed);
  });

  test(`${language} MJCF failures retain format alternatives and collision repair instructions`, () => {
    const unsupportedLoop = new Error(
      '[MJCF export] Closed-loop joint "bridge_1" uses unsupported revolute semantics. Export SDF or USD to preserve its axis, limits, and degrees of freedom.',
    );
    assert.equal(resolveExportErrorMessage(unsupportedLoop, t),
      t.exportMjcfClosedLoopJointUnsupported.replace('{name}', 'bridge_1').replace('{type}', 'revolute'));
    const missingCollision = new Error(
      '[MJCF export] arm: wrist: missing collision geometry for mass/inertia estimation. Add collision shapes in the model editor.',
    );
    assert.equal(resolveExportErrorMessage(missingCollision, t),
      t.exportMjcfMissingCollisionGeometry.replace('{name}', 'arm: wrist'));
  });

  test(`${language} export warnings describe specific topology changes`, () => {
    assert.equal(resolveExportWarningMessage('[MJCF export] Joint "joint_1" uses unsupported planar type, degrading to freejoint.', t),
      t.exportMjcfPlanarJointWarning.replace('{name}', 'joint_1'));
    assert.equal(resolveExportWarningMessage('[MJCF export] Skipping cyclic link reference at "base".', t),
      t.exportMjcfCyclicLinkWarning.replace('{name}', 'base'));
    assert.equal(resolveExportWarningMessage('[SDF export] Joint "floating" uses unsupported floating type; skipping (link will be fixed to parent).', t),
      t.exportSdfFloatingJointWarning.replace('{name}', 'floating'));
    assert.equal(resolveExportWarningMessage(translations.en.exportClosedLoopUrdfStripped.replace('{count}', '3'), t),
      t.exportClosedLoopUrdfStripped.replace('{count}', '3'));
    const textureWarning = t.exportUrdfBoxFaceTextureFallbackWarning.replace('{count}', '2');
    assert.equal(resolveExportWarningMessage(textureWarning, t), textureWarning);
    assert.equal(resolveExportWarningMessage('Unknown raw compatibility diagnostic', t), t.exportCompatibilityWarning);
  });
}
