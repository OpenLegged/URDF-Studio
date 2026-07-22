import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

import { createServer, loadConfigFromFile, type UserConfig } from 'vite';

const CONFIG_ENV_KEYS = [
  'URDF_STUDIO_DEV_HOST',
  'URDF_STUDIO_DEV_ALLOWED_HOSTS',
  'URDF_STUDIO_VITE_CACHE_DIR',
  'API_KEY',
  'OPENAI_API_KEY',
  'GEMINI_API_KEY',
  'OPENAI_BASE_URL',
  'OPENAI_MODEL',
] as const;

async function loadViteConfigWithDevServerEnv(
  env: Partial<Record<(typeof CONFIG_ENV_KEYS)[number], string | undefined>>,
): Promise<UserConfig> {
  const previousEnv = new Map<string, string | undefined>();

  CONFIG_ENV_KEYS.forEach((key) => {
    previousEnv.set(key, process.env[key]);

    if (Object.prototype.hasOwnProperty.call(env, key)) {
      const value = env[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  try {
    const loaded = await loadConfigFromFile(
      {
        command: 'serve',
        mode: 'development',
        isSsrBuild: false,
        isPreview: false,
      },
      path.resolve('vite.config.ts'),
    );

    assert.ok(loaded?.config);
    return loaded.config as UserConfig;
  } finally {
    CONFIG_ENV_KEYS.forEach((key) => {
      const previousValue = previousEnv.get(key);
      if (previousValue === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previousValue;
      }
    });
  }
}

function readDefinedString(config: UserConfig, key: string): string {
  const definedValue = config.define?.[key];
  assert.equal(typeof definedValue, 'string');
  return JSON.parse(definedValue as string) as string;
}

function listen(server: net.Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      server.removeListener('error', onError);
      reject(error);
    };

    server.once('error', onError);
    server.listen(port, '127.0.0.1', () => {
      server.removeListener('error', onError);
      resolve();
    });
  });
}

function close(server: net.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

function requestDevServerHeaders(
  port: number,
  hostHeader: string,
  pathName = '/',
): Promise<http.IncomingHttpHeaders> {
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: pathName,
        headers: {
          Host: hostHeader,
        },
      },
      (response) => {
        response.resume();
        response.once('end', () => resolve(response.headers));
      },
    );

    request.once('error', reject);
    request.end();
  });
}

async function reserveFreePort(): Promise<number> {
  const probe = net.createServer();
  await listen(probe, 0);

  const address = probe.address();
  assert.ok(address && typeof address !== 'string');

  await close(probe);
  return address.port;
}

test('dev server listens on IPv4 loopback by default and supports host overrides', async () => {
  const defaultConfig = await loadViteConfigWithDevServerEnv({
    URDF_STUDIO_DEV_HOST: undefined,
    URDF_STUDIO_DEV_ALLOWED_HOSTS: undefined,
    URDF_STUDIO_VITE_CACHE_DIR: undefined,
  });

  assert.equal(defaultConfig.server?.host, '127.0.0.1');
  assert.equal(defaultConfig.cacheDir, path.resolve('node_modules/.vite/urdf-studio-app'));

  const overriddenConfig = await loadViteConfigWithDevServerEnv({
    URDF_STUDIO_DEV_HOST: '127.0.0.1',
    URDF_STUDIO_DEV_ALLOWED_HOSTS: undefined,
  });

  assert.equal(overriddenConfig.server?.host, '127.0.0.1');

  const remoteDevConfig = await loadViteConfigWithDevServerEnv({
    URDF_STUDIO_DEV_HOST: '0.0.0.0',
    URDF_STUDIO_DEV_ALLOWED_HOSTS: undefined,
  });

  assert.equal(remoteDevConfig.server?.host, '0.0.0.0');
});

test('vite config resolves Three from the active dependency graph', async () => {
  const config = await loadViteConfigWithDevServerEnv({});
  const aliases = config.resolve?.alias;

  assert.ok(Array.isArray(aliases));
  const threeAlias = aliases.find(
    (alias) => typeof alias === 'object' && String(alias.find) === String(/^three$/),
  );
  assert.ok(threeAlias && typeof threeAlias === 'object');
  assert.equal(existsSync(String(threeAlias.replacement)), true);
});

test('dev server accepts a comma-separated preview host allow-list', async () => {
  const config = await loadViteConfigWithDevServerEnv({
    URDF_STUDIO_DEV_HOST: undefined,
    URDF_STUDIO_DEV_ALLOWED_HOSTS: 'preview.example.test, .tunnel.example.test',
  });

  assert.deepEqual(config.server?.allowedHosts, ['preview.example.test', '.tunnel.example.test']);
});

test('vite config injects AI runtime env into browser process env defines', async () => {
  const config = await loadViteConfigWithDevServerEnv({
    API_KEY: 'test-primary-key',
    OPENAI_API_KEY: 'test-openai-key',
    GEMINI_API_KEY: 'test-gemini-key',
    OPENAI_BASE_URL: 'https://example.test/v1',
    OPENAI_MODEL: 'test-model',
  });

  assert.equal(readDefinedString(config, 'process.env.API_KEY'), 'test-primary-key');
  assert.equal(readDefinedString(config, 'process.env.OPENAI_API_KEY'), 'test-openai-key');
  assert.equal(readDefinedString(config, 'process.env.GEMINI_API_KEY'), 'test-gemini-key');
  assert.equal(readDefinedString(config, 'process.env.OPENAI_BASE_URL'), 'https://example.test/v1');
  assert.equal(readDefinedString(config, 'process.env.OPENAI_MODEL'), 'test-model');
});

test('dev server ignores non-runtime and test-only files during watch', async () => {
  const config = await loadViteConfigWithDevServerEnv({
    URDF_STUDIO_DEV_HOST: undefined,
    URDF_STUDIO_DEV_ALLOWED_HOSTS: undefined,
  });
  const ignored = config.server?.watch?.ignored;

  assert.equal(typeof ignored, 'function');
  assert.equal(
    ignored(path.resolve('.venv/genesis-truth/lib/python3.11/site-packages/pkg/module.py')),
    true,
  );
  assert.equal(
    ignored(path.resolve('scripts/test/browser/test_urdf_source_editor.mjs')),
    true,
  );
  assert.equal(ignored(path.resolve('src/app/App.test.tsx')), true);
  assert.equal(ignored(path.resolve('vite.config.test.ts')), true);
  assert.equal(ignored(path.resolve('src/app/App.tsx')), false);
});

test('dev server revalidates optimized deps and accepts an isolated cache directory', async () => {
  const configuredCacheDir = path.resolve('tmp/vite-cache/config-contract');
  const config = await loadViteConfigWithDevServerEnv({
    URDF_STUDIO_VITE_CACHE_DIR: configuredCacheDir,
  });

  assert.equal(config.cacheDir, configuredCacheDir);
  assert.equal(config.server?.headers?.['Cache-Control'], 'no-cache');
});

test('dev server only sends isolation headers to trustworthy local origins', async () => {
  const loaded = await loadConfigFromFile(
    {
      command: 'serve',
      mode: 'development',
      isSsrBuild: false,
      isPreview: false,
    },
    path.resolve('vite.config.ts'),
  );
  let viteServer: Awaited<ReturnType<typeof createServer>> | null = null;
  let cacheDir: string | null = null;

  assert.ok(loaded?.config);

  try {
    cacheDir = await mkdtemp(path.join(os.tmpdir(), 'urdf-studio-vite-config-'));
    viteServer = await createServer({
      ...(loaded.config as UserConfig),
      cacheDir,
      clearScreen: false,
      configFile: false,
      logLevel: 'silent',
      server: {
        ...loaded.config.server,
        allowedHosts: true,
        host: '127.0.0.1',
        port: await reserveFreePort(),
      },
    });

    await viteServer.listen();

    const address = viteServer.httpServer?.address();
    assert.ok(address && typeof address !== 'string');

    const localhostHeaders = await requestDevServerHeaders(address.port, 'localhost:3000');
    assert.equal(localhostHeaders['cross-origin-opener-policy'], 'same-origin');
    assert.equal(localhostHeaders['cross-origin-embedder-policy'], 'require-corp');

    const lanHeaders = await requestDevServerHeaders(address.port, '10.19.125.173:3000');
    assert.equal(lanHeaders['cross-origin-opener-policy'], undefined);
    assert.equal(lanHeaders['cross-origin-embedder-policy'], undefined);
  } finally {
    if (viteServer) {
      await viteServer.close();
    }
    if (cacheDir) {
      await rm(cacheDir, { recursive: true, force: true });
    }
  }
});

test('dev server falls back to another port when the requested port is occupied', async () => {
  const occupiedPort = await reserveFreePort();
  const blocker = net.createServer();
  let viteServer: Awaited<ReturnType<typeof createServer>> | null = null;
  let cacheDir: string | null = null;

  await listen(blocker, occupiedPort);

  try {
    cacheDir = await mkdtemp(path.join(os.tmpdir(), 'urdf-studio-vite-config-'));
    const loaded = await loadConfigFromFile(
      {
        command: 'serve',
        mode: 'development',
        isSsrBuild: false,
        isPreview: false,
      },
      path.resolve('vite.config.ts'),
    );

    assert.ok(loaded?.config);

    viteServer = await createServer({
      ...(loaded.config as UserConfig),
      cacheDir,
      clearScreen: false,
      configFile: false,
      logLevel: 'silent',
      server: {
        ...loaded.config.server,
        host: '127.0.0.1',
        port: occupiedPort,
      },
    });

    await viteServer.listen();

    const address = viteServer.httpServer?.address();
    assert.ok(address && typeof address !== 'string');
    assert.notEqual(address.port, occupiedPort);
  } finally {
    if (viteServer) {
      await viteServer.close();
    }
    if (cacheDir) {
      await rm(cacheDir, { recursive: true, force: true });
    }

    await close(blocker);
  }
});
