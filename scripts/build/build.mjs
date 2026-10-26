import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertEnvMode } from './env-mode.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const mode = assertEnvMode(process.argv[2] ?? 'production', root);
if (process.argv.length > 3) {
  throw new Error('Additional build arguments are unsupported. Select build:dev, build:fat, or build:production.');
}
function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'production' }, shell: process.platform === 'win32' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
for (const script of ['generate:check', 'usd:bindings:check', 'test:env']) run('npm', ['run', script]);
run(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--mode', mode]);
run(process.execPath, ['scripts/generate/seo_prerender.mjs', mode]);
run('npm', ['run', 'precompress']);

writeFileSync(path.join(root, 'dist/.build-environment.json'), JSON.stringify({ mode }) + '\n');
