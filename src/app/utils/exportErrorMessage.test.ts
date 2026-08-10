import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveExportErrorMessage } from './exportErrorMessage';

const labels = {
  exportFailedParse: '导出失败：文件解析失败',
  exportUrdfJointUnsupported:
    '无法将 {name} 导出为 URDF：检测到不受支持的 {type} 关节。请改用 MJCF、SDF 或 Xacro，或将其改写为可表达的关节组合。',
};

test('resolveExportErrorMessage maps unsupported URDF ball joint errors to friendly copy', () => {
  const message = resolveExportErrorMessage(
    new Error('[URDF export] Joint "joint_1" uses unsupported ball type.'),
    labels,
  );

  assert.equal(
    message,
    '无法将 joint_1 导出为 URDF：检测到不受支持的 ball 关节。请改用 MJCF、SDF 或 Xacro，或将其改写为可表达的关节组合。',
  );
});

test('resolveExportErrorMessage localizes unsupported URDF free joints', () => {
  const message = resolveExportErrorMessage(
    new Error('[URDF export] Joint "floating_base" uses unsupported free type.'),
    labels,
  );

  assert.equal(
    message,
    '无法将 floating_base 导出为 URDF：检测到不受支持的 free 关节。请改用 MJCF、SDF 或 Xacro，或将其改写为可表达的关节组合。',
  );
});

test('resolveExportErrorMessage falls back to raw error messages when no mapping exists', () => {
  const message = resolveExportErrorMessage(new Error('boom'), labels);

  assert.equal(message, 'boom');
});

test('resolveExportErrorMessage falls back to generic parse failure for unknown errors', () => {
  const message = resolveExportErrorMessage(null, labels);

  assert.equal(message, labels.exportFailedParse);
});
