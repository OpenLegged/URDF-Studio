import { existsSync } from 'node:fs';
import path from 'node:path';

export function assertEnvMode(mode, root) {
  if (!['dev', 'fat', 'production'].includes(mode)) {
    throw new Error(`Unsupported environment mode "${mode}"; use dev, fat or production.`);
  }
  if (existsSync(path.join(root, '.env.local'))) {
    throw new Error('Move .env.local team settings to .env.<mode> and optional personal overrides to .env.<mode>.local; shared local overrides are not supported.');
  }
  return mode;
}
