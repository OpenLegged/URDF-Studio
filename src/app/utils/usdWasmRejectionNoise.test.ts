import test from 'node:test';
import assert from 'node:assert/strict';

import { isExpectedUsdWasmSharedArrayBufferRejection } from './usdWasmRejectionNoise.ts';

const SAB_TRANSFER_MESSAGE =
  "Failed to execute 'postMessage' on 'Worker': SharedArrayBuffer transfer requires self.crossOriginIsolated.";

test('matches the SAB-transfer rejection on a non-isolated SAB-less scope', () => {
  const reason = new Error(SAB_TRANSFER_MESSAGE);

  assert.equal(
    isExpectedUsdWasmSharedArrayBufferRejection(reason, {
      crossOriginIsolated: false,
      SharedArrayBuffer: undefined,
    }),
    true,
  );
});

test('does not match when the scope is cross-origin isolated', () => {
  const reason = new Error(SAB_TRANSFER_MESSAGE);

  assert.equal(
    isExpectedUsdWasmSharedArrayBufferRejection(reason, { crossOriginIsolated: true }),
    false,
  );
});

test('does not match when SharedArrayBuffer exists', () => {
  const reason = new Error(SAB_TRANSFER_MESSAGE);

  assert.equal(
    isExpectedUsdWasmSharedArrayBufferRejection(reason, {
      crossOriginIsolated: false,
      SharedArrayBuffer: class SharedArrayBuffer {},
    }),
    false,
  );
});

test('does not match unrelated Error messages', () => {
  assert.equal(
    isExpectedUsdWasmSharedArrayBufferRejection(new Error('some other error'), {
      crossOriginIsolated: false,
    }),
    false,
  );
});

test('does not match non-Error values', () => {
  const scope = { crossOriginIsolated: false };

  assert.equal(isExpectedUsdWasmSharedArrayBufferRejection(undefined, scope), false);
  assert.equal(isExpectedUsdWasmSharedArrayBufferRejection(SAB_TRANSFER_MESSAGE, scope), false);
  assert.equal(
    isExpectedUsdWasmSharedArrayBufferRejection({ message: SAB_TRANSFER_MESSAGE }, scope),
    false,
  );
});
