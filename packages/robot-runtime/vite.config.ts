import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { type GetManualChunk } from 'rollup';
import { defineConfig, transformWithEsbuild, type Plugin } from 'vite';

const packageDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(packageDir, '../..');

const resolveWorkerVendorChunk: GetManualChunk = (id, { getModuleInfo }) => {
  const normalizedId = id.replace(/\\/g, '/');

  if (!normalizedId.includes('/node_modules/') || !getModuleInfo(id)?.isIncluded) return;

  if (normalizedId.includes('/three/examples/') || normalizedId.includes('/three-stdlib/')) {
    return 'three-addons';
  }

  if (normalizedId.includes('/three/')) {
    return 'three-core';
  }
};

function createWorkerMinifyPlugin(): Plugin {
  return {
    name: 'robot-runtime:minify-worker-chunks',
    renderChunk: {
      order: 'post',
      async handler(code, chunk) {
        // Vite carries library mode into worker builds, so ES worker chunks keep
        // library-style whitespace unless they are minified independently. Run
        // after Vite's library transpilation so it cannot reformat the result.
        const result = await transformWithEsbuild(code, chunk.fileName, {
          minify: true,
        });
        return {
          code: result.code,
          map: result.map,
        };
      },
    },
  };
}

export default defineConfig({
  root: repoRoot,
  // Package assets/workers must stay relative to each published entry so a
  // consuming Vite app does not reinterpret them as its own `/assets/*` files.
  base: './',
  resolve: {
    alias: {
      '@': path.resolve(repoRoot, 'src'),
    },
  },
  worker: {
    format: 'es',
    plugins: () => [createWorkerMinifyPlugin()],
    rollupOptions: {
      output: {
        manualChunks: resolveWorkerVendorChunk,
      },
    },
  },
  build: {
    outDir: path.resolve(packageDir, 'dist'),
    emptyOutDir: true,
    copyPublicDir: false,
    cssCodeSplit: false,
    lib: {
      entry: {
        index: path.resolve(repoRoot, 'src/lib/robot-parser/runtime/index.ts'),
        mesh: path.resolve(repoRoot, 'src/lib/robot-parser/mesh/index.ts'),
        parser: path.resolve(repoRoot, 'src/lib/robot-parser/index.ts'),
        'motion-studio': path.resolve(repoRoot, 'src/lib/robot-parser/motion-studio/index.ts'),
        usd: path.resolve(repoRoot, 'src/lib/robot-parser/usd/index.ts'),
      },
      name: 'UrdfStudioRobotRuntime',
      formats: ['es'],
      fileName: (_format, entryName) => `${entryName}.js`,
    },
    rollupOptions: {
      external: ['three'],
      output: {
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
});
