import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';

import {
  useAssetImportFromUrl,
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

test('asset download request headers carry a shell-provided Bearer token', async () => {
  // Arrange: hosting shell registers a service-token provider
  setAssetDownloadAuthTokenProvider(() => 'service-token-from-shell');
  try {
    // Act
    const headers = await buildAssetDownloadRequestHeaders(new URL('https://gallery.example/api/download-asset'));

    // Assert: token read at call time, surfaced as a Bearer header
    assert.equal(headers.Authorization, 'Bearer service-token-from-shell');
    assert.equal(headers['Content-Type'], 'application/json');
  } finally {
    setAssetDownloadAuthTokenProvider(null);
  }
});

test('asset download request headers omit Authorization when no provider is registered', async () => {
  // Arrange: no hosting shell → BYOK / unauthenticated local dev
  setAssetDownloadAuthTokenProvider(null);

  // Act
  const headers = await buildAssetDownloadRequestHeaders(new URL('https://gallery.example/api/download-asset'));

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


test('asset credentials wait for the host and receive the actual request destination', async () => {
  let resolveToken: (token: string) => void = () => {};
  const tokenPromise = new Promise<string>((resolve) => { resolveToken = resolve; });
  const requestUrl = new URL('https://gallery.example/api/collections/robots');
  let receivedUrl: URL | undefined;
  let completed = false;
  setAssetDownloadAuthTokenProvider((url) => {
    receivedUrl = url;
    return tokenPromise;
  });
  try {
    const pending = buildAssetDownloadRequestHeaders(requestUrl).then((headers) => {
      completed = true;
      return headers;
    });
    await Promise.resolve();
    assert.equal(completed, false);
    assert.equal(receivedUrl, requestUrl);
    resolveToken('restored-user-token');
    assert.equal((await pending).Authorization, 'Bearer restored-user-token');
  } finally {
    setAssetDownloadAuthTokenProvider(null);
  }
});

test('asset credential failures propagate without an anonymous retry', async () => {
  setAssetDownloadAuthTokenProvider(async () => { throw new Error('Session unavailable'); });
  try {
    await assert.rejects(
      buildAssetDownloadRequestHeaders(new URL('https://gallery.example/api/download-asset')),
      /Session unavailable/,
    );
  } finally {
    setAssetDownloadAuthTokenProvider(null);
  }
});


function captureImportActions() {
  let actions: ReturnType<typeof useAssetImportFromUrl> | undefined;
  function ImportHarness() {
    actions = useAssetImportFromUrl({
      enabled: false,
      handleImport: async () => ({ status: 'completed' }),
    });
    return null;
  }
  renderToString(createElement(ImportHarness));
  assert.ok(actions);
  return actions;
}

test('single and collection imports await credentials and never forward them to object storage', async (t) => {
  let resolveToken: (token: string) => void = () => {};
  const tokenPromise = new Promise<string>((resolve) => { resolveToken = resolve; });
  const credentialUrls: string[] = [];
  const requests: { url: string; authorization: string | null }[] = [];
  setAssetDownloadAuthTokenProvider((url) => {
    credentialUrls.push(url.pathname);
    return tokenPromise;
  });
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    requests.push({ url, authorization: new Headers(init?.headers).get('Authorization') });
    if (url.includes('/api/collections/')) {
      return Response.json({ data: { assetIds: ['one', 'two'] } });
    }
    if (url.includes('/api/download-asset')) {
      return Response.json({ success: true, data: {
        rootFolderName: 'robot', files: [{ path: 'robot.urdf', url: 'https://objects.example/signed-file' }],
      } });
    }
    return new Response('<robot/>');
  });
  try {
    const actions = captureImportActions();
    const single = actions.importAssetFromBotWorld('one', 'https://botworld.enkeebot.com');
    await Promise.resolve();
    assert.equal(requests.length, 0);
    resolveToken('user-token');
    assert.deepEqual(await single, { success: true });
    assert.deepEqual(await actions.importCollectionFromBotWorld('robots', 'https://botworld.enkeebot.com'), { success: true });
    assert.deepEqual(credentialUrls, ['/api/download-asset', '/api/collections/robots', '/api/download-asset', '/api/download-asset']);
    for (const request of requests) {
      assert.equal(request.authorization, request.url.startsWith('https://objects.example') ? null : 'Bearer user-token');
      assert.equal(request.url.includes('user-token'), false);
    }
  } finally {
    setAssetDownloadAuthTokenProvider(null);
  }
});

test('401 is reported after one manifest request without a public-token retry', async (t) => {
  let requests = 0;
  setAssetDownloadAuthTokenProvider(async () => 'expired-user-token');
  t.mock.method(globalThis, 'fetch', async () => {
    requests += 1;
    return new Response('', { status: 401, statusText: 'Unauthorized' });
  });
  const errors: unknown[][] = [];
  t.mock.method(console, 'error', (...args: unknown[]) => { errors.push(args); });
  try {
    const actions = captureImportActions();
    assert.deepEqual(await actions.importAssetFromBotWorld('one', 'https://botworld.enkeebot.com'), { success: false });
    assert.equal(requests, 1);
    assert.match(String(errors[0]), /401 Unauthorized/);
  } finally {
    setAssetDownloadAuthTokenProvider(null);
  }
});
