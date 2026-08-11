import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const packageDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(packageDir, '../..');

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
