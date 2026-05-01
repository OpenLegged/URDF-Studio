import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { RobotFile } from '@/types';
import {
  createRendererBackend,
  createRendererBackendForFormat,
  isFormatSupported,
} from './createRendererBackend';

const usdSourceFile: RobotFile = {
  name: 'robot.usda',
  content: '#usda 1.0',
  format: 'usd',
};

test('createRendererBackend rejects USD sources before visible rendering', () => {
  assert.throws(
    () =>
      createRendererBackend({
        sourceFile: usdSourceFile,
        assets: {},
      }),
    /USD sources must be hydrated to RobotState before rendering/,
  );
});

test('createRendererBackendForFormat rejects explicit USD backend creation', () => {
  assert.throws(
    () => createRendererBackendForFormat('usd', usdSourceFile, {}),
    /USD sources must be hydrated to RobotState before rendering/,
  );
});

test('createRendererBackendForFormat does not expose usda as a source format', () => {
  assert.equal(isFormatSupported('usda'), false);
  assert.throws(
    () => createRendererBackendForFormat('usda', usdSourceFile, {}),
    /Unsupported renderer source format: usda/,
  );
});
