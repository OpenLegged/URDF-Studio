import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { assertEnvMode } from './env-mode.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
let recorded;
try {
  recorded = JSON.parse(readFileSync(path.join(root, 'dist/.build-environment.json'), 'utf8'));
} catch (error) {
  throw new Error('Build the app before previewing: dist/.build-environment.json is missing or invalid.', { cause: error });
}
const mode = assertEnvMode(recorded.mode, root);
const args = process.argv.slice(2);
if (['dev', 'fat', 'production'].includes(args[0])) {
  if (args.shift() !== mode) throw new Error('The requested preview mode does not match the built artifact. Rebuild first.');
}
if (args.some((arg) => arg === '--mode' || arg.startsWith('--mode=') || arg.startsWith('-m'))) {
  throw new Error('Preview uses the recorded build mode; mode flags cannot override it.');
}
console.log(`[preview] Serving the recorded ${mode} build.`);
const result = spawnSync(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--mode', mode, ...args], {
  cwd: root, stdio: 'inherit',
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
