#!/usr/bin/env node

/**
 * Workflow E2E suite: full user-journey regression across formats.
 *
 * Each journey walks the real user path — import (URDF/Xacro/MJCF/SDF/USD),
 * edit properties in the right-side panel, edit the source code (delete a
 * link, joint→fixed, material color), export and verify the exported archive
 * content — and J6 assembles multiple robots through the BridgeCreateModal
 * GUI (all joint types, chained + closed-loop + self-loop bridges, limits).
 *
 * Journeys are independent and run in parallel browsers (default 3; one
 * shared dev server). A journey failure does not abort the others; the exit
 * code reflects the aggregate.
 *
 * Usage:
 *   node scripts/test/e2e/test_workflow_suite.mjs [--quick] [--concurrency N]
 *     [--site-url URL] [--headed] [--filter J1|J2|...] [--help]
 *
 *   --quick      Mini fixtures only (committed under test/workflow-fixtures),
 *                skips USD/xacro/real corpora. ~5 min.
 *   full mode    Real corpora (test/unitree_ros, menagerie, Go2 USD). ~10 min
 *                at concurrency 3.
 *
 * Output: screenshots in tmp/e2e/workflow/screenshots/, downloads in
 * tmp/e2e/workflow/downloads/<Jn>/, aggregate report in
 * tmp/regression/workflow-suite_results.json.
 *
 * Cleanup: run node test/usd-viewer/scripts/cleanup-headless.cjs afterwards
 * (CLAUDE.md red line) — this script also closes its own browsers and stops
 * a self-started server in `finally`.
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';

import {
  ensureSite, launchBrowser, createPage, writeJsonAtomic, DEFAULT_SITE_URL,
  isTransientPageContextError,
} from '../helpers/browser-helpers.mjs';

import { createTestSuite } from '../helpers/assertions.mjs';

import { QUICK_JOURNEYS, FULL_JOURNEYS } from './workflow/workflow-journeys.mjs';

const SCRIPT_NAME = 'test_workflow_suite.mjs';
const REPORT_PATH = path.resolve('tmp/regression/workflow-suite_results.json');

function parseArgs(argv) {
  const opts = {
    quick: false,
    noRetry: false,
    concurrency: null,
    siteUrl: process.env.URDF_STUDIO_TEST_SITE_URL ?? DEFAULT_SITE_URL,
    headed: false,
    filter: null,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--quick': opts.quick = true; break;
      case '--no-retry': opts.noRetry = true; break;
      case '--headed': opts.headed = true; break;
      case '--concurrency': {
        const value = Number.parseInt(argv[(i += 1)], 10);
        if (!Number.isFinite(value) || value < 1) {
          throw new Error(`--concurrency expects a positive integer, got "${argv[i]}"`);
        }
        opts.concurrency = value;
        break;
      }
      case '--site-url': opts.siteUrl = argv[(i += 1)]; break;
      case '--filter': opts.filter = argv[(i += 1)]; break;
      case '--help': case '-h': opts.help = true; break;
      default: throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return opts;
}

function defaultConcurrency(quick) {
  const fromEnv = Number.parseInt(process.env.URDF_TEST_WORKFLOW_CONCURRENCY ?? '', 10);
  if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;
  // Parallel journeys share one Vite dev server and software-WebGL Chrome
  // instances. Empirically, 3+ parallel journeys starve the page main threads
  // (export zips freeze the page, lazy dialog chunks stall on "Loading
  // panel…") and every failure mode just moves around; 2 is the reliable
  // sweet spot on a 12-core dev box. Override with --concurrency when the
  // machine has headroom.
  return 2;
}

async function runJourney(journey, opts) {
  const suite = createTestSuite(`workflow:${journey.name}`);
  const siteUrlObj = new URL(opts.siteUrl);
  siteUrlObj.searchParams.set('regressionDebug', '1');
  const siteUrl = siteUrlObj.toString();

  const site = await ensureSite(siteUrl, { siteTimeoutMs: 180_000 });
  let browser = null;
  const mode = opts.quick ? 'quick' : 'full';
  const startedAt = Date.now();
  let failure = null;
  let browserErrors = { console: [], page: [] };

  try {
    browser = await launchBrowser({ headed: opts.headed });
    const { page, consoleMessages, pageErrors } = await createPage(
      browser, siteUrl, 120_000,
    );
    await page.evaluate(() => window.__URDF_STUDIO_DEBUG__?.setBeforeUnloadPromptEnabled?.(false));

    console.log(`\n──────── [${journey.id}] ${journey.name} (${mode}) ────────`);
    // Warm the lazy ExportDialog chunk while the machine is still idle —
    // later, under parallel load, the Vite dev server can starve the chunk
    // request and the dialog would sit on "Loading panel…" forever.
    const { warmExportDialog } = await import('./workflow/workflow-gui-helpers.mjs');
    await warmExportDialog(page);
    await journey.run({ page, suite, mode, journeyId: journey.id });

    browserErrors = {
      console: consoleMessages.snapshot().filter(
        (entry) => !/favicon|DevTools|net::ERR/i.test(entry) && entry.length > 0,
      ),
      page: pageErrors.snapshot(),
    };
  } catch (error) {
    failure = error?.stack || error?.message || String(error);
    console.error(`[workflow] journey ${journey.id} threw: ${failure}`);
  } finally {
    try {
      await browser?.close();
    } catch (error) {
      if (!isTransientPageContextError(error)) throw error;
    }
    await site.stop();
  }

  const ok = failure == null && suite.failed === 0 && browserErrors.page.length === 0;
  return {
    id: journey.id,
    name: journey.name,
    mode,
    ok,
    failure,
    assertions: { total: suite.passed + suite.failed, failures: suite.failed },
    browserErrors,
    ms: Date.now() - startedAt,
  };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(`Usage: node scripts/test/e2e/${SCRIPT_NAME} [options]

Options:
  --quick            Mini fixtures only (test/workflow-fixtures), no USD/xacro.
  --concurrency <n>  Parallel journeys (default 2; env URDF_TEST_WORKFLOW_CONCURRENCY).
  --site-url <url>   Site URL (default ${DEFAULT_SITE_URL}; env URDF_STUDIO_TEST_SITE_URL).
  --headed           Headed browsers (forces concurrency 1).
  --filter <id>      Only run journeys whose id matches (repeatable prefix match, e.g. J1).
  --help             This help.
`);
    return 0;
  }

  const journeys = (opts.quick ? QUICK_JOURNEYS : FULL_JOURNEYS)
    .filter((journey) => (opts.filter ? journey.id.startsWith(opts.filter) : true));
  if (journeys.length === 0) {
    console.error('[workflow] no journeys selected.');
    return 1;
  }

  const concurrency = opts.headed ? 1 : (opts.concurrency ?? defaultConcurrency(opts.quick));
  console.log(
    `[workflow] ${opts.quick ? 'QUICK' : 'FULL'} mode: ${journeys.length} journey(ies), concurrency=${concurrency}`,
  );

  // Wipe per-journey downloads so stale archives cannot satisfy assertions.
  await fs.rm(path.resolve('tmp/e2e/workflow/downloads'), { recursive: true, force: true });

  const queue = [...journeys];
  const results = [];

  async function worker() {
    for (;;) {
      const journey = queue.shift();
      if (!journey) return;
      let result = await runJourney(journey, opts);
      results.push(result);
      const mark = result.ok ? 'PASS' : 'FAIL';
      console.log(`[workflow] ${mark} ${result.id} (${result.name}) in ${(result.ms / 1000).toFixed(1)}s`);
      if (!result.ok && result.failure) {
        const head = String(result.failure).split('\n').slice(0, 6).join('\n');
        console.log(`    ${head.replace(/\n/g, '\n    ')}`);
      }
      // One retry for flaky journeys: parallel journeys on a shared dev server
      // hit intermittent main-thread stalls (lazy chunk loads, frozen
      // evaluates under CPU contention). Deterministic failures fail twice;
      // transient ones get a second chance before failing the suite.
      if (!result.ok && !opts.noRetry) {
        console.log(`[workflow] RETRY ${result.id} (${result.name}) — transient failure, retrying once`);
        const retried = await runJourney(journey, opts);
        if (retried.ok) {
          console.log(`[workflow] PASS ${result.id} on retry (${(retried.ms / 1000).toFixed(1)}s)`);
          retried.retried = true;
          // Replace the failed entry with the successful rerun.
          const index = results.indexOf(result);
          results[index] = retried;
          result = retried;
        } else {
          console.log(`[workflow] FAIL ${result.id} on retry too — real failure`);
          const index = results.indexOf(result);
          results[index] = { ...result, retried: true, retryFailure: retried.failure };
        }
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, journeys.length) }, async (_, workerIndex) => {
      // Stagger worker starts: simultaneous cold launches (browser + Vite
      // on-demand compile + model import) pile up and starve the earliest
      // journeys' first evaluates. A 25s head start per worker avoids the
      // stampede at almost no total-time cost.
      if (workerIndex > 0) await delay(25_000);
      await worker();
    }),
  );

  results.sort((a, b) => a.id.localeCompare(b.id));

  // Aggregate table.
  const width = Math.max(...results.map((r) => r.name.length), 8);
  console.log(`\n${'='.repeat(width + 40)}`);
  console.log(`${'JOURNEY'.padEnd(width)}  ${'MODE'.padEnd(5)}  ${'RESULT'.padEnd(6)}  ${'ASSERTS'.padEnd(8)}  TIME`);
  for (const r of results) {
    const asserts = `${r.assertions.total - r.assertions.failures}/${r.assertions.total}`;
    console.log(
      `${r.name.padEnd(width)}  ${r.mode.padEnd(5)}  ${(r.ok ? 'PASS' : 'FAIL').padEnd(6)}  ${asserts.padEnd(8)}  ${(r.ms / 1000).toFixed(1)}s`,
    );
  }
  console.log('='.repeat(width + 40));
  const failed = results.filter((r) => !r.ok);
  console.log(`[workflow] total: ${results.length}, passed: ${results.length - failed.length}, failed: ${failed.length}`);
  if (failed.length > 0) console.log(`[workflow] failed: ${failed.map((r) => r.id).join(', ')}`);

  await writeJsonAtomic(REPORT_PATH, {
    mode: opts.quick ? 'quick' : 'full',
    concurrency,
    generatedAt: new Date().toISOString(),
    results,
  });
  console.log(`[workflow] report written to ${path.relative(process.cwd(), REPORT_PATH)}`);

  return failed.length === 0 ? 0 : 1;
}

main()
  .then((code) => { process.exitCode = code; })
  .catch((error) => { console.error(error); process.exitCode = 1; });
