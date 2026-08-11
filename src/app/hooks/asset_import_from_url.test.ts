import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assertRemoteImportBlobWithinLimits,
  assertCompletedRemoteImport,
  assertRemoteImportContentLengthWithinLimits,
  assertRemoteImportFileListWithinLimits,
  buildAssetDownloadRequestHeaders,
  resolveAllowedRemoteImportOrigin,
  type FileDownloadInfo,
} from './useAssetImportFromUrl.ts';
import {
  resolveAssetDownloadEndpoint,
  setAssetDownloadAuthTokenProvider,
  setAssetDownloadEndpointResolver,
} from './assetDownloadEndpoint.ts';
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

test('asset download endpoint defaults to the validated handoff origin', () => {
  setAssetDownloadEndpointResolver(null);

  assert.equal(
    resolveAssetDownloadEndpoint('https://botworld.enkeebot.com').toString(),
    'https://botworld.enkeebot.com/api/download-asset',
  );
});

test('hosting shells can inject a same-origin asset download endpoint', () => {
  const receivedOrigins: string[] = [];
  setAssetDownloadEndpointResolver((remoteImportOrigin) => {
    receivedOrigins.push(remoteImportOrigin);
    return new URL('/api/download-asset', 'https://studio.example');
  });

  try {
    assert.equal(
      resolveAssetDownloadEndpoint('https://botworld.enkeebot.com').toString(),
      'https://studio.example/api/download-asset',
    );
    assert.deepEqual(receivedOrigins, ['https://botworld.enkeebot.com']);
  } finally {
    setAssetDownloadEndpointResolver(null);
  }
});

test('asset import never embeds a Vite service credential in browser code', async () => {
  const source = await import('node:fs/promises').then(({ readFile }) =>
    readFile(new URL('./useAssetImportFromUrl.ts', import.meta.url), 'utf8'),
  );
  assert.doesNotMatch(source, /VITE_API_TOKEN|BOTBASE_API_TOKEN/);
});

test('asset download request headers carry a shell-provided Bearer token', () => {
  // Arrange: hosting shell registers a service-token provider
  setAssetDownloadAuthTokenProvider(() => 'service-token-from-shell');
  try {
    // Act
    const headers = buildAssetDownloadRequestHeaders();

    // Assert: token read at call time, surfaced as a Bearer header
    assert.equal(headers.Authorization, 'Bearer service-token-from-shell');
    assert.equal(headers['Content-Type'], 'application/json');
  } finally {
    setAssetDownloadAuthTokenProvider(null);
  }
});

test('asset download request headers omit Authorization when no provider is registered', () => {
  // Arrange: no hosting shell → BYOK / unauthenticated local dev
  setAssetDownloadAuthTokenProvider(null);

  // Act
  const headers = buildAssetDownloadRequestHeaders();

  // Assert: never an "Authorization: Bearer undefined" leak
  assert.equal(Object.hasOwn(headers, 'Authorization'), false);
  assert.equal(headers['Content-Type'], 'application/json');
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
