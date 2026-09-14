import test from 'node:test';
import assert from 'node:assert/strict';
import { translations } from '@/shared/i18n';

import { resolveExportErrorMessage } from './exportErrorMessage';

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

test('resolveExportErrorMessage falls back to raw error messages when no mapping exists', () => {
  const message = resolveExportErrorMessage(new Error('boom'), labels);

  assert.equal(message, 'boom');
});

test('resolveExportErrorMessage falls back to generic parse failure for unknown errors', () => {
  const message = resolveExportErrorMessage(null, labels);

  assert.equal(message, labels.exportFailedParse);
});
