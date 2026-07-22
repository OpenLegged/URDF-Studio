import fs from 'fs';
import { createRequire } from 'node:module';
import path from 'path';
import { defineConfig, loadEnv, type ServerOptions } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const appPackageVersion =
  JSON.parse(fs.readFileSync(path.resolve(__dirname, 'package.json'), 'utf8')).version ?? '0.0.0';

const requireFromApp = createRequire(path.resolve(__dirname, 'package.json'));
const threeRoot = path.resolve(path.dirname(requireFromApp.resolve('three')), '..');
const threeModuleEntry = path.resolve(threeRoot, 'build/three.module.js');
const threeExamplesDir = path.resolve(threeRoot, 'examples/jsm');
const DEFAULT_VITE_CACHE_DIR = path.resolve(__dirname, 'node_modules/.vite/urdf-studio-app');

function buildConfigurationFileIndex(rootDirs: string[]): Map<string, string> {
  const fileIndex = new Map<string, string>();

  const visitDirectory = (currentDir: string) => {
    let entries: fs.Dirent[] = [];

    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    entries.forEach((entry) => {
      const fullPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        visitDirectory(fullPath);
        return;
      }

      if (!entry.isFile()) return;
      if (!/\.(usd|usda|usdc)$/i.test(entry.name)) return;
      if (!fullPath.includes(`${path.sep}configuration${path.sep}`)) return;
      if (fileIndex.has(entry.name)) return;

      fileIndex.set(entry.name, fullPath);
    });
  };

  rootDirs.forEach((rootDir) => visitDirectory(rootDir));
  return fileIndex;
}

function resolveUsdConfigurationRootDirs(): string[] {
  const candidateDirs = [
    path.resolve(__dirname, 'public/unitree_model'),
    path.resolve(__dirname, 'public/Robots'),
  ];

  return candidateDirs.filter((dirPath) => fs.existsSync(dirPath));
}

function createUsdConfigurationProxyPlugin() {
  const configurationFileIndex = buildConfigurationFileIndex(resolveUsdConfigurationRootDirs());

  return {
    name: 'usd-configuration-proxy',
    configureServer(server: import('vite').ViteDevServer) {
      server.middlewares.use((request, response, next) => {
        const requestUrl = String(request.url || '');
        const urlMatch = requestUrl.match(/^\/configuration\/([^/?#]+)$/);
        if (!urlMatch) {
          next();
          return;
        }

        const fileName = decodeURIComponent(urlMatch[1] || '');
        const filePath = configurationFileIndex.get(fileName);
        if (!filePath) {
          next();
          return;
        }

        response.statusCode = 200;
        response.setHeader('Content-Type', 'application/octet-stream');
        fs.createReadStream(filePath).pipe(response);
      });
    },
    generateBundle(this: import('rollup').PluginContext) {
      configurationFileIndex.forEach((filePath, fileName) => {
        this.emitFile({
          type: 'asset',
          fileName: `configuration/${fileName}`,
          source: fs.readFileSync(filePath),
        });
      });
    },
  };
}

function isMonacoReactChunkModule(normalizedId: string): boolean {
  return normalizedId.includes('/@monaco-editor/react/');
}

function isMonacoEditorChunkModule(normalizedId: string): boolean {
  return normalizedId.includes('/monaco-editor/esm/vs/');
}

const INITIAL_HTML_MODULE_PRELOAD_BLOCKLIST = [
  'feature-file-io-',
  'export-vendor-',
  'feature-property-editor-',
  'feature-robot-tree-',
  'feature-editor-runtime-',
  'feature-urdf-viewer-runtime-',
  'ViewerSceneConnector-',
  'ViewerJointsPanel-',
];

function shouldSkipInitialHtmlModulePreload(dependency: string): boolean {
  return INITIAL_HTML_MODULE_PRELOAD_BLOCKLIST.some((token) => dependency.includes(token));
}

const GENERATED_ARTIFACT_WATCH_IGNORE_ROOTS = [
  path.resolve(__dirname, '.venv'),
  path.resolve(__dirname, '.omx'),
  path.resolve(__dirname, 'tmp'),
  path.resolve(__dirname, '.tmp'),
  path.resolve(__dirname, 'output'),
  path.resolve(__dirname, 'dist'),
  path.resolve(__dirname, 'log'),
  path.resolve(__dirname, 'test'),
  path.resolve(__dirname, 'scripts/test'),
].map((entryPath) => entryPath.replace(/\\/g, '/'));

const GENERATED_ARTIFACT_WATCH_IGNORE_SEGMENTS = ['/.git/', '/.svn/', '/.hg/'];
const TEST_FILE_WATCH_IGNORE_PATTERN = /(?:^|\/)[^/]+\.(?:test|spec)\.(?:[cm]?[jt]sx?)$/;
const ISOLATED_DOCUMENT_HEADERS = {
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-site',
} as const;

// Vite crawls HTML entrypoints to discover dependency optimizer inputs.
// This repository intentionally keeps many fixture/example HTML files under
// tmp/, .tmp/, and test/, so constrain discovery to the actual app entry.
const OPTIMIZE_DEPS_ENTRY_FILES = ['index.html'];

const OPTIMIZE_DEPS_INCLUDE = [
  'three',
  '@react-three/fiber',
  '@react-three/drei',
  'zustand/react/shallow',
  'lucide-react',
  'zustand',
  '@monaco-editor/react',
  'jszip',
  'zustand/middleware/immer',
  'zustand/middleware',
  'immer',
  'three/examples/jsm/loaders/GLTFLoader.js',
  'three/examples/jsm/utils/SkeletonUtils.js',
  'three/examples/jsm/loaders/VTKLoader.js',
  'three/examples/jsm/loaders/STLLoader.js',
  'three/examples/jsm/geometries/ConvexGeometry.js',
  'three/examples/jsm/loaders/ColladaLoader.js',
  'three/examples/jsm/loaders/OBJLoader.js',
  'three/addons/exporters/OBJExporter.js',
  'three/examples/jsm/environments/RoomEnvironment.js',
  'three-stdlib',
  'linkedom',
  'html2canvas',
  'jspdf',
  'three/examples/jsm/postprocessing/EffectComposer.js',
  'three/examples/jsm/postprocessing/RenderPass.js',
  'three/examples/jsm/postprocessing/BokehPass.js',
  'three/addons/loaders/GLTFLoader.js',
];

function resolveAiRuntimeEnv(env: Record<string, string | undefined>): Record<string, string> {
  const apiKey = env.API_KEY?.trim() || env.OPENAI_API_KEY?.trim() || env.GEMINI_API_KEY?.trim() || '';

  return {
    API_KEY: apiKey,
    GEMINI_API_KEY: env.GEMINI_API_KEY?.trim() || '',
    OPENAI_API_KEY: env.OPENAI_API_KEY?.trim() || '',
    OPENAI_BASE_URL: env.OPENAI_BASE_URL?.trim() || '',
    OPENAI_MODEL: env.OPENAI_MODEL?.trim() || '',
  };
}

function resolveDevServerHost(env: Record<string, string | undefined>): string {
  const configuredHost = env.URDF_STUDIO_DEV_HOST?.trim();
  // 默认 127.0.0.1：仅本机 IPv4，无 Network URL 噪声、无局域网暴露。不用
  // 'localhost'（Windows + Node 18+ 会解析为仅 IPv6 [::1]，浏览器走 IPv4 时连不上）。
  return configuredHost || '127.0.0.1';
}

function resolveViteCacheDir(env: Record<string, string | undefined>): string {
  const configuredCacheDir = env.URDF_STUDIO_VITE_CACHE_DIR?.trim();
  return configuredCacheDir ? path.resolve(__dirname, configuredCacheDir) : DEFAULT_VITE_CACHE_DIR;
}

function resolveDevServerAllowedHosts(
  env: Record<string, string | undefined>,
): ServerOptions['allowedHosts'] | undefined {
  const configuredHosts = env.URDF_STUDIO_DEV_ALLOWED_HOSTS?.trim();
  if (!configuredHosts) {
    return undefined;
  }

  if (configuredHosts === '*' || configuredHosts.toLowerCase() === 'true') {
    return true;
  }

  const allowedHosts = configuredHosts
    .split(',')
    .map((host) => host.trim())
    .filter(Boolean);

  return allowedHosts.length > 0 ? allowedHosts : undefined;
}

function shouldIgnoreWatchPath(watchPath: string): boolean {
  const normalizedPath = watchPath.replace(/\\/g, '/');

  return (
    GENERATED_ARTIFACT_WATCH_IGNORE_ROOTS.some(
      (rootPath) => normalizedPath === rootPath || normalizedPath.startsWith(`${rootPath}/`),
    ) ||
    GENERATED_ARTIFACT_WATCH_IGNORE_SEGMENTS.some((segment) => normalizedPath.includes(segment)) ||
    TEST_FILE_WATCH_IGNORE_PATTERN.test(normalizedPath)
  );
}

interface IsolationHeaderRequestLike {
  headers?: {
    host?: string | string[];
    'x-forwarded-proto'?: string | string[];
  };
  socket?: {
    encrypted?: boolean;
  };
  url?: string;
}

function readFirstHeaderValue(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

function normalizeRequestHostname(hostHeader: string): string {
  const trimmedHost = hostHeader.trim();
  if (!trimmedHost) {
    return '';
  }

  try {
    return new URL(`http://${trimmedHost}`).hostname.replace(/^\[|\]$/g, '').toLowerCase();
  } catch {
    return trimmedHost
      .replace(/^\[|\]$/g, '')
      .replace(/:\d+$/, '')
      .toLowerCase();
  }
}

function isTrustedLocalDevHostname(hostname: string): boolean {
  const normalizedHostname = hostname.replace(/\.$/, '').toLowerCase();

  return (
    normalizedHostname === 'localhost' ||
    normalizedHostname.endsWith('.localhost') ||
    normalizedHostname === '::1' ||
    /^127(?:\.\d{1,3}){3}$/.test(normalizedHostname)
  );
}

function isHttpsDevRequest(request: IsolationHeaderRequestLike): boolean {
  if (request.socket?.encrypted) {
    return true;
  }

  const forwardedProto = readFirstHeaderValue(request.headers?.['x-forwarded-proto'])
    .split(',')[0]
    ?.trim()
    .toLowerCase();
  return forwardedProto === 'https';
}

function applyDocumentHeaders(
  response: import('node:http').ServerResponse,
  headers: Readonly<Record<string, string>>,
): void {
  Object.entries(headers).forEach(([headerName, headerValue]) => {
    response.setHeader(headerName, headerValue);
  });
}

function shouldApplyIsolatedDocumentHeaders(request: IsolationHeaderRequestLike): boolean {
  if (isHttpsDevRequest(request)) {
    return true;
  }

  return isTrustedLocalDevHostname(
    normalizeRequestHostname(readFirstHeaderValue(request.headers?.host)),
  );
}

function createConditionalIsolationHeadersPlugin() {
  const installHeaderMiddleware = (middlewareStack: {
    use: (handler: (req: any, res: any, next: () => void) => void) => void;
  }): void => {
    middlewareStack.use((request, response, next) => {
      if (shouldApplyIsolatedDocumentHeaders(request)) {
        applyDocumentHeaders(response, ISOLATED_DOCUMENT_HEADERS);
      }
      next();
    });
  };

  return {
    name: 'conditional-isolation-headers',
    configureServer(server: import('vite').ViteDevServer) {
      installHeaderMiddleware(server.middlewares);
    },
    configurePreviewServer(server: import('vite').PreviewServer) {
      installHeaderMiddleware(server.middlewares);
    },
  };
}

function createStaticHostingHeadersAssetPlugin() {
  return {
    name: 'static-hosting-headers-asset',
    generateBundle(this: import('rollup').PluginContext) {
      const headersPath = path.resolve(__dirname, 'public/_headers');
      if (!fs.existsSync(headersPath)) {
        return;
      }

      this.emitFile({
        type: 'asset',
        fileName: '_headers',
        source: fs.readFileSync(headersPath),
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  const devServerAllowedHosts = resolveDevServerAllowedHosts(env);
  const aiRuntimeEnv = resolveAiRuntimeEnv(env);
  const viteCacheDir = resolveViteCacheDir(env);

  return {
    cacheDir: viteCacheDir,
    server: {
      port: 3000,
      strictPort: false,
      host: resolveDevServerHost(env),
      ...(devServerAllowedHosts ? { allowedHosts: devServerAllowedHosts } : {}),
      // Optimized dependency URLs can retain the same Vite browser hash across
      // a no-reload optimizer update. Revalidate their ETags on page reload so
      // an old wrapper cannot keep importing chunks from a replaced cache graph.
      headers: {
        'Cache-Control': 'no-cache',
      },
      // Verification artifacts are intentionally written into tmp/ by repo policy.
      // Ignore generated directories so exports, screenshots, logs, and pid files
      // do not trigger full-page reloads and wipe imported workspace state.
      // Root-level test fixtures contain vendored repositories large enough to
      // exhaust OS watcher limits, so filter them explicitly by absolute path.
      watch: {
        ignored: shouldIgnoreWatchPath,
      },
    },
    build: {
      chunkSizeWarningLimit: 800,
      modulePreload: {
        resolveDependencies(_filename, deps, context) {
          if (context.hostType !== 'html') {
            return deps;
          }

          return deps.filter((dependency) => !shouldSkipInitialHtmlModulePreload(dependency));
        },
      },
      rollupOptions: {
        input: [path.resolve(__dirname, 'index.html')],
        output: {
          manualChunks(id) {
            const normalizedId = id.replace(/\\/g, '/');

            if (normalizedId.includes('/src/core/parsers/')) {
              return 'core-parsers';
            }

            if (!normalizedId.includes('/node_modules/')) return;

            if (normalizedId.includes('/@react-three/drei/')) {
              return 'drei-vendor';
            }

            if (normalizedId.includes('/@react-three/fiber/')) {
              return 'r3f-vendor';
            }

            if (
              normalizedId.includes('/three/examples/') ||
              normalizedId.includes('/three-stdlib/')
            ) {
              return 'three-addons';
            }

            if (normalizedId.includes('/three/')) {
              return 'three-core';
            }

            if (isMonacoReactChunkModule(normalizedId)) {
              return 'editor-monaco-react';
            }

            if (isMonacoEditorChunkModule(normalizedId)) {
              return 'editor-monaco';
            }

            if (normalizedId.includes('/jspdf/') || normalizedId.includes('/jszip/')) {
              return 'export-vendor';
            }

            if (normalizedId.includes('/lucide-react/')) {
              return 'icon-vendor';
            }

            if (normalizedId.includes('/zustand/') || normalizedId.includes('/immer/')) {
              return 'state-vendor';
            }

            if (
              normalizedId.includes('/react/') ||
              normalizedId.includes('/react-dom/') ||
              normalizedId.includes('/scheduler/')
            ) {
              return 'react-vendor';
            }
          },
        },
      },
    },
    worker: {
      format: 'es',
    },
    plugins: [
      react(),
      tailwindcss(),
      createUsdConfigurationProxyPlugin(),
      createConditionalIsolationHeadersPlugin(),
      createStaticHostingHeadersAssetPlugin(),
    ],
    define: {
      __APP_VERSION__: JSON.stringify(appPackageVersion),
      'process.env.API_KEY': JSON.stringify(aiRuntimeEnv.API_KEY),
      'process.env.GEMINI_API_KEY': JSON.stringify(aiRuntimeEnv.GEMINI_API_KEY),
      'process.env.OPENAI_API_KEY': JSON.stringify(aiRuntimeEnv.OPENAI_API_KEY),
      'process.env.OPENAI_BASE_URL': JSON.stringify(aiRuntimeEnv.OPENAI_BASE_URL),
      'process.env.OPENAI_MODEL': JSON.stringify(aiRuntimeEnv.OPENAI_MODEL),
    },
    optimizeDeps: {
      entries: OPTIMIZE_DEPS_ENTRY_FILES,
      // Keep the dependency optimizer on the same Three.js entry that the
      // application source and R3F use, otherwise optimized deps can pull in
      // a second copy from a different workspace path.
      include: OPTIMIZE_DEPS_INCLUDE,
      // The oxipng codec ships a `.wasm?url` import that esbuild's dependency
      // pre-bundling can't resolve; let Vite's asset pipeline handle it inside
      // the PNG optimization worker instead.
      exclude: ['@jsquash/oxipng'],
    },
    resolve: {
      dedupe: ['three', '@react-three/fiber', '@react-three/drei'],
      alias: [
        {
          find: '@',
          replacement: path.resolve(__dirname, './src'),
        },
        {
          find: /^three$/,
          replacement: threeModuleEntry,
        },
        {
          find: /^three\/addons\//,
          replacement: `${threeExamplesDir}/`,
        },
        {
          find: /^three\/examples\/jsm\//,
          replacement: `${threeExamplesDir}/`,
        },
      ],
    },
  };
});
