#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// This runner lives at scripts/test/runner/, so the repo root is three levels up.
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const TEST_FILE_PATTERN = /\.(?:test|spec)\.(?:cjs|mjs|js|jsx|ts|tsx)$/;

const FAST_APP_TESTS = [
  'src/app/hooks/sourcePreservingExportUtils.test.ts',
  'src/app/hooks/useEditableSourcePatches.test.ts',
  'src/app/hooks/useAppEffects.test.tsx',
  'src/app/hooks/workspaceGeneratedSourceState.test.ts',
  'src/app/utils/canonicalWorkspaceViewerDocument.test.ts',
  'src/app/utils/importPreparation.workerSafe.test.ts',
  'src/app/components/UnifiedViewer.typecheck.test.ts',
  'src/app/hooks/asset_import_from_url.test.ts',
  'src/app/Providers.test.tsx',
  'src/app/utils/initialLanguage.test.ts',
];

const CONFIG_TESTS = [
  'vite.config.test.ts',
  'scripts/test/quality_gates.test.mjs',
  'src/architecture-boundaries.test.ts',
  'src/source-governance.test.ts',
];

function toPosixPath(filePath) {
  return filePath.split(path.sep).join('/');
}

function pathExists(relativePath) {
  return fs.existsSync(path.resolve(REPO_ROOT, relativePath));
}

function dedupeAndSort(files) {
  return [...new Set(files)].sort((a, b) => a.localeCompare(b));
}

function collectTestFiles(relativeRoot) {
  const absoluteRoot = path.resolve(REPO_ROOT, relativeRoot);
  const files = [];

  if (!fs.existsSync(absoluteRoot)) {
    return files;
  }

  const visit = (absoluteDirectory) => {
    for (const entry of fs.readdirSync(absoluteDirectory, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.git') {
        continue;
      }

      const absoluteEntryPath = path.join(absoluteDirectory, entry.name);

      if (entry.isDirectory()) {
        visit(absoluteEntryPath);
        continue;
      }

      if (!entry.isFile() || !TEST_FILE_PATTERN.test(entry.name)) {
        continue;
      }

      files.push(toPosixPath(path.relative(REPO_ROOT, absoluteEntryPath)));
    }
  };

  visit(absoluteRoot);
  return dedupeAndSort(files);
}

function requireExisting(files, suiteName) {
  const missing = files.filter((filePath) => !pathExists(filePath));
  if (missing.length > 0) {
    throw new Error(
      `Suite "${suiteName}" references missing test file(s):\n${missing
        .map((filePath) => `- ${filePath}`)
        .join('\n')}`,
    );
  }

  return files;
}

function expandExplicitPath(filePath) {
  const normalizedPath = toPosixPath(filePath);
  const absolutePath = path.resolve(REPO_ROOT, normalizedPath);
  if (fs.existsSync(absolutePath) && fs.statSync(absolutePath).isDirectory()) {
    return collectTestFiles(normalizedPath);
  }
  return [normalizedPath];
}

const suiteDefinitions = {
  fast: {
    description: 'Fast repo-contained smoke lane used by npm test and verify:fast.',
    files: () => requireExisting(['vite.config.test.ts', ...FAST_APP_TESTS], 'fast'),
  },
  config: {
    description: 'Repository configuration and canonical quality-gate tests.',
    files: () => requireExisting(CONFIG_TESTS, 'config'),
  },
  'app-hooks': {
    description: 'App orchestration hook/util tests from the fast lane.',
    files: () => requireExisting(FAST_APP_TESTS, 'app-hooks'),
  },
  src: {
    description: 'All source-adjacent src/**/*.test.* and src/**/*.spec.* tests.',
    files: () => collectTestFiles('src'),
  },
  'regression-unit': {
    description: 'Lightweight node:test files that live beside testing scripts.',
    files: () => collectTestFiles('scripts/test'),
  },
  all: {
    description: 'All repository Node test files managed by this runner.',
    files: () =>
      dedupeAndSort([
        'vite.config.test.ts',
        ...collectTestFiles('src'),
        ...collectTestFiles('scripts/test'),
      ]),
  },
};

function printUsage() {
  console.log(`Usage:
  node scripts/test/runner/run-node-tests.mjs [suite] [-- node-test-args...]
  node scripts/test/runner/run-node-tests.mjs <test-file...> [-- node-test-args...]

Suites:
${Object.entries(suiteDefinitions)
  .map(([suiteName, suite]) => `  ${suiteName.padEnd(15)} ${suite.description}`)
  .join('\n')}

Examples:
  npm test
  npm run test:unit:all
  npm run test:unit -- src/core/robot/builders.test.ts
  npm run test:unit -- src/core/robot/builders.test.ts -- --test-name-pattern "builder"
  npm run test:unit:list
  node scripts/test/runner/run-node-tests.mjs --list-files`);
}

function parseArgs(argv) {
  const separatorIndex = argv.indexOf('--');
  const runnerArgs = separatorIndex === -1 ? argv : argv.slice(0, separatorIndex);
  const nodeTestArgs = separatorIndex === -1 ? [] : argv.slice(separatorIndex + 1);
  const dryRun = runnerArgs.includes('--dry-run');
  const list = runnerArgs.includes('--list');
  const listFiles = runnerArgs.includes('--list-files');
  const help = runnerArgs.includes('--help') || runnerArgs.includes('-h');
  const positional = runnerArgs.filter((arg) => !arg.startsWith('-'));

  return {
    dryRun,
    help,
    list,
    listFiles,
    nodeTestArgs,
    positional,
  };
}

function resolveFiles(positional) {
  if (positional.length === 0) {
    return {
      label: 'fast',
      files: suiteDefinitions.fast.files(),
    };
  }

  const [firstArg, ...restArgs] = positional;

  if (Object.prototype.hasOwnProperty.call(suiteDefinitions, firstArg)) {
    if (restArgs.length > 0) {
      throw new Error(
        `Suite "${firstArg}" does not accept extra positional arguments. Put node:test flags after "--".`,
      );
    }

    return {
      label: firstArg,
      files: suiteDefinitions[firstArg].files(),
    };
  }

  return {
    label: 'explicit-files',
    files: requireExisting(dedupeAndSort(positional.flatMap(expandExplicitPath)), 'explicit-files'),
  };
}

function main() {
  const { dryRun, help, list, listFiles, nodeTestArgs, positional } = parseArgs(
    process.argv.slice(2),
  );

  if (help) {
    printUsage();
    return 0;
  }

  if (list) {
    for (const [suiteName, suite] of Object.entries(suiteDefinitions)) {
      const files = suite.files();
      console.log(
        `${suiteName.padEnd(15)} ${String(files.length).padStart(4)}  ${suite.description}`,
      );
    }
    return 0;
  }

  if (listFiles) {
    for (const [suiteName, suite] of Object.entries(suiteDefinitions)) {
      const files = suite.files();
      console.log(`${suiteName} (${files.length})`);
      for (const filePath of files) {
        console.log(`  ${filePath}`);
      }
    }
    return 0;
  }

  const { label, files } = resolveFiles(positional);

  if (files.length === 0) {
    throw new Error(`Suite "${label}" did not resolve any test files.`);
  }

  // Node stops parsing some test-runner flags after the first positional test
  // file, so forwarded flags must precede the resolved file list.
  const nodeArgs = ['--import', 'tsx', '--test', ...nodeTestArgs, ...files];
  console.log(`[run-node-tests] suite=${label} files=${files.length}`);

  if (dryRun) {
    console.log(`node ${nodeArgs.map((arg) => JSON.stringify(arg)).join(' ')}`);
    return 0;
  }

  const result = spawnSync(process.execPath, nodeArgs, {
    cwd: REPO_ROOT,
    stdio: 'inherit',
  });

  if (result.error) {
    throw result.error;
  }

  return typeof result.status === 'number' ? result.status : 1;
}

try {
  process.exitCode = main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
