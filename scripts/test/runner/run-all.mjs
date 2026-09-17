#!/usr/bin/env node

/**
 * Unified "run everything" entry point — the one command for a full sweep.
 *
 * Stages (each can be toggled):
 *   1. unit     — Node unit tests via run-node-tests.mjs (default suite: all)
 *   2. browser  — every scripts/test/browser/test_*.mjs, auto-discovered from
 *                 package.json `test:browser:*` scripts (minus the `all` alias),
 *                 run by a worker pool (see --browser-concurrency)
 *   3. fixtures — opt-in golden/truth fixture regression (needs large corpora)
 *
 * Design choices that make a full sweep practical:
 *   - Failures do NOT abort the run; every stage is attempted and the exit code
 *     reflects whether anything failed (CI-style).
 *   - One shared dev server is started up front on the default site URL. Each
 *     browser test's ensureSite() finds it reachable and reuses it instead of
 *     cold-starting its own Vite — turning N cold starts into one.
 *   - Browser tests run in a worker pool (default 3-4 on a typical dev box;
 *     each headless Chrome needs ~1-2 GB and a few cores). With concurrency > 1
 *     each test's output is teed to tmp/regression/logs/<npm-key>.log — parallel
 *     stdout would otherwise interleave — and failed tests replay the tail of
 *     their log inline. Concurrency 1 keeps stdio inherited for debugging.
 *   - A consolidated pass/fail table is printed and written to
 *     tmp/regression/run-all-summary.json.
 *   - Browser automation is always cleaned up at the end (cleanup-headless.cjs).
 *
 * Usage:
 *   node scripts/test/runner/run-all.mjs [options]
 *     --unit-only            Run only the unit stage
 *     --browser-only         Run only the browser stage
 *     --skip-unit            Skip the unit stage
 *     --skip-browser         Skip the browser stage
 *     --fixtures             Include the (heavy) fixtures stage
 *     --unit-suite <name>    Unit suite to run (default: all)
 *     --browser-concurrency <n>  Max browser tests in parallel (default:
 *                                min(4, cores-derived), env
 *                                URDF_TEST_BROWSER_CONCURRENCY overrides; 1
 *                                streams test output live instead of to logs)
 *     --headed               Run browser tests headed (forces concurrency 1)
 *     --filter <substr>      Only browser tests whose npm key includes <substr>
 *     --list                 List the resolved stages/commands and exit
 *     --help
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import process from 'node:process';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { ensureSite, DEFAULT_SITE_URL, writeJsonAtomic } from '../helpers/browser-helpers.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const SUMMARY_PATH = path.resolve(REPO_ROOT, 'tmp/regression/run-all-summary.json');
const BROWSER_LOG_DIR = path.resolve(REPO_ROOT, 'tmp/regression/logs');
const CLEANUP_SCRIPT = 'test/usd-viewer/scripts/cleanup-headless.cjs';
const FAILURE_LOG_TAIL_LINES = 40;

function parseArgs(argv) {
  const opts = {
    unit: true,
    browser: true,
    fixtures: false,
    unitSuite: 'all',
    browserConcurrency: null,
    headed: false,
    filter: null,
    list: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--unit-only': opts.browser = false; opts.fixtures = false; break;
      case '--browser-only': opts.unit = false; opts.fixtures = false; break;
      case '--skip-unit': opts.unit = false; break;
      case '--skip-browser': opts.browser = false; break;
      case '--fixtures': opts.fixtures = true; break;
      case '--unit-suite': opts.unitSuite = argv[(i += 1)]; break;
      case '--browser-concurrency': {
        const value = Number.parseInt(argv[(i += 1)], 10);
        if (!Number.isFinite(value) || value < 1) {
          throw new Error(`--browser-concurrency expects a positive integer, got "${argv[i]}"`);
        }
        opts.browserConcurrency = value;
        break;
      }
      case '--headed': opts.headed = true; break;
      case '--filter': opts.filter = argv[(i += 1)]; break;
      case '--list': opts.list = true; break;
      case '--help': case '-h': opts.help = true; break;
      default: throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return opts;
}

/** Headless Chrome with software WebGL costs ~1-2 GB and a few cores each. */
function defaultBrowserConcurrency() {
  const fromEnv = Number.parseInt(process.env.URDF_TEST_BROWSER_CONCURRENCY ?? '', 10);
  if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;
  return Math.min(4, Math.max(1, Math.floor((os.cpus().length - 2) / 3)));
}

function resolveBrowserConcurrency(opts) {
  if (opts.headed) return 1; // headed windows compete for the same display
  if (opts.browserConcurrency != null) return opts.browserConcurrency;
  return defaultBrowserConcurrency();
}

function readPackageScripts() {
  const pkg = JSON.parse(fs.readFileSync(path.resolve(REPO_ROOT, 'package.json'), 'utf8'));
  return pkg.scripts ?? {};
}

/** Discover `test:browser:*` npm keys, excluding the `all` aggregate. */
function discoverBrowserKeys(scripts, filter) {
  return Object.keys(scripts)
    .filter((key) => key.startsWith('test:browser:') && key !== 'test:browser:all')
    .filter((key) => key !== 'test:browser:editor-deep-all')
    .filter((key) => (filter ? key.includes(filter) : true))
    .sort();
}

/** Discover `test:fixtures:*` npm keys, excluding aggregate/benchmark-heavy ones. */
function discoverFixtureKeys(scripts) {
  return Object.keys(scripts)
    .filter((key) => key.startsWith('test:fixtures:') && key !== 'test:fixtures')
    .filter((key) => !key.includes('benchmark') && !key.includes('isaacsim') && !key.includes('performance'))
    .sort();
}

/**
 * Run one npm test, teeing output to a log file (concurrency > 1) or streaming
 * it live (concurrency 1). Resolves to { exitCode, ms, logPath }.
 */
function spawnBrowserTest(key, { env, logPath, live }) {
  return new Promise((resolve) => {
    const start = Date.now();
    const stdio = live ? 'inherit' : ['ignore', 'pipe', 'pipe'];
    const child = spawn('npm', ['run', key], { cwd: REPO_ROOT, env, stdio });

    let stream = null;
    if (!live) {
      stream = fs.createWriteStream(logPath, { flags: 'w' });
      child.stdout.pipe(stream);
      child.stderr.pipe(stream);
    }

    const settle = (exitCode) => {
      if (stream) stream.end();
      resolve({ exitCode, ms: Date.now() - start, logPath: live ? null : logPath });
    };

    child.on('error', (error) => {
      console.error(`[run-all] ${key} failed to spawn: ${error.message}`);
      settle(1);
    });
    child.on('close', (code) => settle(typeof code === 'number' ? code : 1));
  });
}

function printFailureTail(logPath) {
  if (!logPath || !fs.existsSync(logPath)) return;
  const tail = fs.readFileSync(logPath, 'utf8').trimEnd().split('\n')
    .slice(-FAILURE_LOG_TAIL_LINES);
  if (tail.length === 0) return;
  console.log(`    ── log tail (${path.relative(REPO_ROOT, logPath)}) ──`);
  for (const line of tail) console.log(`    ${line}`);
}

/**
 * Worker pool over the discovered browser npm keys. Each worker pulls the next
 * test off the queue; results come back sorted by key so the summary table is
 * stable regardless of completion order.
 */
async function runBrowserPool(keys, opts) {
  const concurrency = resolveBrowserConcurrency(opts);
  const live = concurrency === 1;
  fs.mkdirSync(BROWSER_LOG_DIR, { recursive: true });
  const env = { ...process.env, ...(opts.headed ? { URDF_E2E_HEADED: '1' } : {}) };

  console.log(
    `[run-all] browser stage: ${keys.length} test(s), concurrency=${concurrency}` +
    (live ? ' (output streamed live)' : `, logs teed to ${path.relative(REPO_ROOT, BROWSER_LOG_DIR)}/`),
  );

  const queue = [...keys];
  const results = [];

  async function worker() {
    for (;;) {
      const key = queue.shift();
      if (!key) return;
      console.log(`[browser] START ${key}`);
      const logPath = path.join(BROWSER_LOG_DIR, `${key}.log`);
      const { exitCode, ms, logPath: log } = await spawnBrowserTest(key, { env, logPath, live });
      const mark = exitCode === 0 ? 'PASS' : 'FAIL';
      console.log(`[browser] ${mark} ${key} (${(ms / 1000).toFixed(1)}s)`);
      if (exitCode !== 0) printFailureTail(log);
      results.push({ stage: 'browser', name: key, exitCode, ms, log: log ?? undefined });
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, keys.length) }, () => worker()));
  results.sort((a, b) => a.name.localeCompare(b.name));
  return results;
}

function buildStages(opts, scripts) {
  /** @type {Array<{ stage: string, name: string, keys?: string[], run: () => number | Promise<number | Array> }>} */
  const stages = [];

  if (opts.unit) {
    stages.push({
      stage: 'unit',
      name: `unit:${opts.unitSuite}`,
      run: () => spawnSync(
        process.execPath,
        ['scripts/test/runner/run-node-tests.mjs', opts.unitSuite],
        { cwd: REPO_ROOT, stdio: 'inherit' },
      ).status ?? 1,
    });
  }

  if (opts.browser) {
    const keys = discoverBrowserKeys(scripts, opts.filter);
    if (keys.length > 0) {
      stages.push({
        stage: 'browser',
        name: `browser-pool (${keys.length} tests)`,
        keys,
        // Resolves to an array of per-test results (already timed & logged).
        run: () => runBrowserPool(keys, opts),
      });
    }
  }

  if (opts.fixtures) {
    for (const key of discoverFixtureKeys(scripts)) {
      stages.push({
        stage: 'fixtures',
        name: key,
        run: () => spawnSync('npm', ['run', key], { cwd: REPO_ROOT, stdio: 'inherit' }).status ?? 1,
      });
    }
  }

  return stages;
}

function runCleanup() {
  if (!fs.existsSync(path.resolve(REPO_ROOT, CLEANUP_SCRIPT))) return;
  console.log(`\n[run-all] cleaning up headless browsers (${CLEANUP_SCRIPT})`);
  spawnSync(process.execPath, [CLEANUP_SCRIPT], { cwd: REPO_ROOT, stdio: 'inherit' });
}

function printHelp() {
  const lines = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n');
  const end = lines.indexOf(' */');
  console.log(lines.slice(2, end === -1 ? 38 : end).join('\n'));
}

function printTable(results) {
  const pad = (s, n) => String(s).padEnd(n);
  const nameWidth = Math.max(20, ...results.map((r) => r.name.length));
  console.log(`\n${'='.repeat(nameWidth + 26)}`);
  console.log(`${pad('TEST', nameWidth)}  ${pad('STAGE', 9)}  ${pad('RESULT', 7)}  TIME`);
  console.log('-'.repeat(nameWidth + 26));
  for (const r of results) {
    const mark = r.exitCode === 0 ? 'PASS' : 'FAIL';
    console.log(`${pad(r.name, nameWidth)}  ${pad(r.stage, 9)}  ${pad(mark, 7)}  ${(r.ms / 1000).toFixed(1)}s`);
  }
  console.log('='.repeat(nameWidth + 26));
  const passed = results.filter((r) => r.exitCode === 0).length;
  const failed = results.length - passed;
  console.log(`[run-all] total: ${results.length}, passed: ${passed}, failed: ${failed}`);
  if (failed > 0) {
    console.log(`[run-all] failed: ${results.filter((r) => r.exitCode !== 0).map((r) => r.name).join(', ')}`);
    const withLogs = results.filter((r) => r.exitCode !== 0 && r.log);
    if (withLogs.length > 0) {
      console.log(`[run-all] failure logs: ${withLogs.map((r) => path.relative(REPO_ROOT, r.log)).join(', ')}`);
    }
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    printHelp();
    return 0;
  }

  const scripts = readPackageScripts();
  const stages = buildStages(opts, scripts);

  if (stages.length === 0) {
    console.error('[run-all] no stages selected.');
    return 1;
  }

  if (opts.list) {
    console.log('[run-all] resolved stages:');
    for (const s of stages) {
      console.log(`  ${s.stage.padEnd(9)} ${s.name}`);
      for (const key of s.keys ?? []) console.log(`             ${key}`);
    }
    return 0;
  }

  const needsBrowser = stages.some((s) => s.stage === 'browser');
  let sharedSite = null;
  if (needsBrowser) {
    // Start one shared dev server so each browser test reuses it via ensureSite,
    // instead of cold-starting Vite N times.
    const siteUrl = new URL(DEFAULT_SITE_URL);
    siteUrl.searchParams.set('regressionDebug', '1');
    console.log(`[run-all] ensuring shared dev server at ${DEFAULT_SITE_URL} …`);
    try {
      sharedSite = await ensureSite(siteUrl.toString(), { siteTimeoutMs: 180_000 });
      console.log(`[run-all] shared server ready (started by run-all: ${sharedSite.startedByScript}).`);
    } catch (error) {
      console.error(`[run-all] could not start shared server: ${error.message}`);
      console.error('[run-all] browser tests will each start their own server.');
    }
  }

  const results = [];
  try {
    for (const stage of stages) {
      console.log(`\n──────── [${stage.stage}] ${stage.name} ────────`);
      const start = Date.now();
      try {
        // Browser stages resolve to an array of already-timed per-test results;
        // every other stage resolves to its own exit code.
        const outcome = await stage.run();
        if (Array.isArray(outcome)) {
          results.push(...outcome);
        } else {
          results.push({ stage: stage.stage, name: stage.name, exitCode: outcome, ms: Date.now() - start });
        }
      } catch (error) {
        console.error(`[run-all] ${stage.name} threw: ${error.message}`);
        results.push({ stage: stage.stage, name: stage.name, exitCode: 1, ms: Date.now() - start });
      }
    }
  } finally {
    if (sharedSite?.startedByScript) {
      console.log('[run-all] stopping shared dev server …');
      await sharedSite.stop();
    }
    if (needsBrowser) runCleanup();
  }

  await writeJsonAtomic(SUMMARY_PATH, {
    options: {
      unitSuite: opts.unitSuite,
      browser: opts.browser,
      fixtures: opts.fixtures,
      headed: opts.headed,
      browserConcurrency: stages.some((s) => s.stage === 'browser')
        ? resolveBrowserConcurrency(opts)
        : undefined,
    },
    results,
  });
  printTable(results);
  console.log(`[run-all] summary written to ${path.relative(REPO_ROOT, SUMMARY_PATH)}`);

  return results.some((r) => r.exitCode !== 0) ? 1 : 0;
}

main()
  .then((code) => { process.exitCode = code; })
  .catch((error) => { console.error(error); process.exitCode = 1; });
