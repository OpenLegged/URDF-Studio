import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import path from 'node:path';

function readGit(root, args) {
  const result = spawnSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `git exited with status ${result.status}`);
  }
  return result.stdout.trim();
}

function readRepository(root, warn) {
  const directory = path.resolve(root);
  try {
    // A source archive nested in another checkout must not inherit that checkout's HEAD.
    const topLevel = readGit(directory, ['rev-parse', '--show-toplevel']);
    if (realpathSync(topLevel) !== realpathSync(directory)) {
      throw new Error('directory is not a Git worktree root');
    }
    const revision = readGit(directory, ['rev-parse', '--verify', 'HEAD']);
    const status = readGit(directory, [
      'status', '--porcelain=v1', '--untracked-files=no', '--ignore-submodules=untracked',
    ]);
    return { revision, dirty: status.length > 0 };
  } catch (error) {
    warn(`[app-build-info] Git metadata unavailable for ${directory}: ${error.message}`);
    return { revision: null, dirty: null };
  }
}

/** Captures only public build provenance; no environment variables or remote URLs. */
export function createAppBuildInfo({ app, root, coreRoot, warn = console.warn }) {
  const repository = readRepository(root, warn);
  const core = coreRoot ? readRepository(coreRoot, warn) : null;
  return {
    app,
    revision: repository.revision,
    coreRevision: core?.revision ?? null,
    builtAt: new Date().toISOString(),
    dirty: repository.dirty === true || core?.dirty === true
      ? true
      : repository.dirty === null || core?.dirty === null ? null : false,
  };
}
