import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createAppBuildInfo } from '../build/app-build-info.mjs';

function git(root, ...args) {
  return execFileSync('git', [
    '-c', 'user.name=Build metadata test',
    '-c', 'user.email=build-metadata@example.invalid',
    '-c', 'commit.gpgsign=false',
    '-C', root, ...args,
  ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function createRepository(root) {
  mkdirSync(root, { recursive: true });
  git(root, 'init', '--quiet');
  writeFileSync(path.join(root, 'tracked.txt'), 'original\n');
  git(root, 'add', 'tracked.txt');
  git(root, 'commit', '--quiet', '-m', 'test fixture');
  return git(root, 'rev-parse', 'HEAD');
}

test('captures the current checkout and tracked changes without counting untracked files', (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'app-build-info-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const revision = createRepository(root);
  const warnings = [];
  const options = { app: 'urdf-studio', root, warn: (message) => warnings.push(message) };
  const clean = createAppBuildInfo(options);
  assert.equal(clean.app, 'urdf-studio');
  assert.equal(clean.revision, revision);
  assert.equal(clean.coreRevision, null);
  assert.equal(clean.dirty, false);
  assert.equal(new Date(clean.builtAt).toISOString(), clean.builtAt);
  writeFileSync(path.join(root, 'scratch.txt'), 'untracked\n');
  assert.equal(createAppBuildInfo(options).dirty, false);
  writeFileSync(path.join(root, 'tracked.txt'), 'changed\n');
  assert.equal(createAppBuildInfo(options).dirty, true);
  assert.deepEqual(warnings, []);
});

test('captures the actual Pro submodule HEAD and reports tracked Core changes', (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'app-build-submodule-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const coreSource = path.join(directory, 'core-source');
  const coreRevision = createRepository(coreSource);
  const root = path.join(directory, 'pro');
  createRepository(root);
  git(root, '-c', 'protocol.file.allow=always', 'submodule', 'add', '--quiet', coreSource, 'core');
  git(root, 'commit', '--quiet', '-am', 'record core');
  const coreRoot = path.join(root, 'core');
  const options = { app: 'urdf-studio-pro', root, coreRoot };
  const info = createAppBuildInfo(options);
  assert.equal(info.revision, git(root, 'rev-parse', 'HEAD'));
  assert.equal(info.coreRevision, coreRevision);
  assert.equal(info.dirty, false);
  writeFileSync(path.join(coreRoot, 'tracked.txt'), 'changed core\n');
  assert.equal(createAppBuildInfo(options).dirty, true);
});

test('marks Git metadata unknown with a warning for an archive or a nested non-repository', (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'app-build-no-git-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const warnings = [];
  const warn = (message) => warnings.push(message);
  const archive = createAppBuildInfo({ app: 'urdf-studio', root, warn });
  assert.equal(archive.revision, null);
  assert.equal(archive.dirty, null);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /Git metadata unavailable/);

  createRepository(root);
  const coreRoot = path.join(root, 'core');
  mkdirSync(coreRoot);
  const nestedArchive = createAppBuildInfo({ app: 'urdf-studio-pro', root, coreRoot, warn });
  assert.equal(nestedArchive.revision, git(root, 'rev-parse', 'HEAD'));
  assert.equal(nestedArchive.coreRevision, null);
  assert.equal(nestedArchive.dirty, null);
  assert.equal(warnings.length, 2);
  assert.match(warnings[1], /not a Git worktree root/);
});
