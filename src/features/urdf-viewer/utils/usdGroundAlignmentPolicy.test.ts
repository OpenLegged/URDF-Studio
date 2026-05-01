import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isTextualUsdGroundAlignmentSource,
  shouldSettleUsdGroundAlignmentAfterInitialLoad,
} from './usdGroundAlignmentPolicy.ts';

test('treats .usda stage paths as textual usd sources', () => {
  assert.equal(isTextualUsdGroundAlignmentSource('/robots/go2/scene.usda'), true);
  assert.equal(shouldSettleUsdGroundAlignmentAfterInitialLoad('/robots/go2/scene.usda'), false);
});

test('treats usd files with a USDA header as textual usd sources', () => {
  assert.equal(
    isTextualUsdGroundAlignmentSource({
      name: '/robots/go2/scene.usd',
      content: '#usda 1.0\n(\n  defaultPrim = "Robot"\n)\n',
    }),
    true,
  );
  assert.equal(
    shouldSettleUsdGroundAlignmentAfterInitialLoad({
      name: '/robots/go2/scene.usd',
      content: '#usda 1.0\n',
    }),
    false,
  );
});

test('keeps settle passes enabled for binary and unknown usd sources', () => {
  assert.equal(isTextualUsdGroundAlignmentSource('/robots/go2/scene.usdc'), false);
  assert.equal(shouldSettleUsdGroundAlignmentAfterInitialLoad('/robots/go2/scene.usdc'), true);
  assert.equal(
    isTextualUsdGroundAlignmentSource({
      name: '/robots/go2/scene.usdc',
      content: '#usda 1.0\n',
    }),
    false,
  );
  assert.equal(
    isTextualUsdGroundAlignmentSource({
      name: '/robots/go2/scene.usdz',
      content: '#usda 1.0\n',
    }),
    false,
  );
  assert.equal(shouldSettleUsdGroundAlignmentAfterInitialLoad(null), true);
});
