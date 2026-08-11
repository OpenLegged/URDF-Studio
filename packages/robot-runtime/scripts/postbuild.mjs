import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const packageDir = path.resolve(scriptDir, '..');
const repoRoot = path.resolve(packageDir, '../..');
const indexJs = path.join(packageDir, 'dist', 'index.js');

if (!existsSync(indexJs)) {
  throw new Error(`Expected build output not found: ${indexJs}`);
}

// Copy USD WASM assets (~20MB: emHdBindings.wasm/.js/.data/.worker.js) so
// consumers can serve them. Consumers copy dist/wasm/ into their public/usd/bindings/
// and call configureUsdRuntime({ wasmBaseUrl: '/usd/bindings' }) before
// ensureUsdWasmRuntime(). Skipped if the source dir is absent (e.g. minimal CI).
const wasmSourceDir = path.join(repoRoot, 'public', 'usd', 'bindings');
const wasmTargetDir = path.join(packageDir, 'dist', 'wasm');
if (existsSync(wasmSourceDir)) {
  mkdirSync(wasmTargetDir, { recursive: true });
  for (const file of readdirSync(wasmSourceDir)) {
    copyFileSync(path.join(wasmSourceDir, file), path.join(wasmTargetDir, file));
  }
}
