import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assertRemoteImportBlobWithinLimits,
  assertCompletedRemoteImport,
  assertRemoteImportContentLengthWithinLimits,
  assertRemoteImportFileListWithinLimits,
  resolveAllowedRemoteImportOrigin,
  type FileDownloadInfo,
} from './useAssetImportFromUrl.ts';
import {
  isAllowedHandoffOrigin,
  normalizeHandoffOrigin,
} from '@/shared/utils/popupHandoffProtocol.ts';

test('resolveAllowedRemoteImportOrigin rejects userinfo origin confusion', () => {
  assert.equal(resolveAllowedRemoteImportOrigin('http://localhost:80@evil.example'), null);
  assert.equal(
    resolveAllowedRemoteImportOrigin('https://botworld.enkeebot.com'),
    'https://botworld.enkeebot.com',
  );
});

test('remote import file list rejects excessive file counts before download', () => {
  const files: FileDownloadInfo[] = Array.from({ length: 2_001 }, (_, index) => ({
    path: `mesh-${index}.stl`,
    url: `http://localhost:5173/files/mesh-${index}.stl`,
  }));

  assert.throws(
    () => assertRemoteImportFileListWithinLimits(files),
    /Remote import contains too many files \(2001\)\. Maximum: 2000\./i,
  );
});

test('remote import size checks reject oversized content-length and blobs', () => {
  const oversizedResponse = new Response('', {
    headers: {
      'content-length': String(512 * 1024 * 1024 + 1),
    },
  });
  assert.throws(
    () => assertRemoteImportContentLengthWithinLimits(oversizedResponse, 0),
    /Remote file is too large/i,
  );

  const oversizedBlob = new Blob([new Uint8Array(1)]);
  assert.throws(
    () => assertRemoteImportBlobWithinLimits(oversizedBlob, 512 * 1024 * 1024 + 1),
    /Remote import is too large/i,
  );
});

test('remote import only reports success for a completed core import', () => {
  assert.doesNotThrow(() => assertCompletedRemoteImport({ status: 'completed' }));
  assert.throws(
    () => assertCompletedRemoteImport({ status: 'skipped' }),
    /import was skipped/i,
  );
  assert.throws(
    () => assertCompletedRemoteImport({ status: 'failed' }),
    /could not be imported/i,
  );
});

test('handoff origin allowlist strips userinfo and validates the real host', () => {
  // Arrange: an origin embedding userinfo to confuse host parsing
  const maliciousOrigin = 'http://localhost:80@evil.example';

  // Assert: normalization strips userinfo (leaving the real host),
  // the allowlist then rejects the real host (evil.example not allowed),
  // Default fallback (no env) accepts production enkeebot domains but rejects
  // localhost (which must be added via env for local development).
  assert.equal(normalizeHandoffOrigin(maliciousOrigin), 'http://evil.example');
  assert.equal(isAllowedHandoffOrigin(maliciousOrigin), false);
  assert.equal(isAllowedHandoffOrigin('https://botworld.enkeebot.com'), true);
  assert.equal(isAllowedHandoffOrigin('http://localhost:5173'), false);
});
