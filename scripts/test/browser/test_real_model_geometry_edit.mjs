#!/usr/bin/env node

// Opt-in real URDF stress regression. Model assets stay outside the repository.
import assert from 'node:assert/strict';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { execFileSync } from 'node:child_process';
import JSZip from 'jszip';
import { chromium } from 'playwright';
import { buildBrowserLaunchArgs, ensureSite } from '../helpers/browser-helpers.mjs';
import { inspectGeometryModel } from '../helpers/geometry-edit-model.mjs';
import {
  assertGeometryMetrics, checkGeometryHistory, checkGeometrySource, exerciseGeometry,
  readGeometryMetrics, summarizeEditTimes,
} from '../helpers/geometry-edit-browser.mjs';

function parseOptions(argv) {
  const options = { directories: [], siteUrl: 'http://127.0.0.1:4187', headed: false, edits: 40, modelTimeout: 300_000,
    output: path.resolve('tmp/regression/geometry-real', new Date().toISOString().replace(/[:.]/g, '-')) };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') return { help: true };
    if (arg === '--headed') { options.headed = true; continue; }
    const value = argv[++index];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}`);
    if (arg === '--model-dir') options.directories.push(path.resolve(value));
    else if (arg === '--site-url') options.siteUrl = value;
    else if (arg === '--output-dir') options.output = path.resolve(value);
    else if (arg === '--edits-per-case') options.edits = Number(value);
    else if (arg === '--model-timeout-ms') options.modelTimeout = Number(value);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  assert.ok(options.directories.length, 'Supply --model-dir <directory>; external models are never assumed or downloaded.');
  assert.ok(Number.isSafeInteger(options.edits) && options.edits >= 8, '--edits-per-case must be an integer >= 8');
  assert.ok(Number.isSafeInteger(options.modelTimeout) && options.modelTimeout >= 5000, '--model-timeout-ms must be an integer >= 5000');
  const url = new URL(options.siteUrl);
  assert.ok(['http:', 'https:'].includes(url.protocol), '--site-url must be HTTP(S)');
  url.searchParams.set('regressionDebug', '1');
  options.siteUrl = url.toString();
  return options;
}

async function createModelArchive(model, archive) {
  const zip = new JSZip();
  for (const file of model.files) {
    const relative = path.relative(model.directory, file).split(path.sep).join('/');
    zip.file(`${path.basename(model.directory)}/${relative}`, createReadStream(file));
  }
  await pipeline(zip.generateNodeStream({ streamFiles: true, compression: 'DEFLATE', compressionOptions: { level: 1 } }),
    createWriteStream(archive));
}

async function importModel(page, archive, model, report) {
  // A cold Vite optimizer may reload once when archive support is first used.
  // Only bootstrap navigation is retried; editing failures are never retried.
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.waitForFunction(() => Boolean(window.__URDF_STUDIO_DEBUG__?.__workspaceStore__));
    await page.evaluate(() => window.__URDF_STUDIO_DEBUG__.setBeforeUnloadPromptEnabled(false));
    let navigated = false;
    const onNavigation = frame => { if (frame === page.mainFrame()) navigated = true; };
    page.on('framenavigated', onNavigation);
    try {
      await page.locator('input[type="file"]:not([webkitdirectory])').first().setInputFiles(archive);
      const deadline = Date.now() + 120_000;
      while (Date.now() < deadline && !navigated) {
        const loaded = await page.evaluate(expected => {
          const debug = window.__URDF_STUDIO_DEBUG__;
          const snapshot = debug?.getRegressionSnapshot();
          const fileName = snapshot?.selectedFile?.name ?? '';
          return debug?.getDocumentLoadState()?.status === 'ready'
            && fileName.endsWith(expected.entry) && snapshot?.store?.linkCount === expected.linkCount
            && snapshot?.runtime?.visualMeshCount > 0;
        }, { entry: model.entry, linkCount: model.linkCount }).catch(error => {
          if (navigated || error.message.includes('Execution context was destroyed')) return false;
          throw error;
        });
        if (loaded) return;
        await page.waitForTimeout(100);
      }
    } finally {
      page.off('framenavigated', onNavigation);
    }
    if (!navigated) throw new Error(`Import did not become ready: ${model.entry}`);
    report.bootstrapReloads += 1;
  }
  throw new Error('Import repeatedly navigated/reloaded before becoming ready');
}

async function stabilizeRuntime(page) {
  await page.getByRole('checkbox', { name: /^(显示碰撞体|Show Collision)$/ }).check();
  await page.waitForFunction(() => window.__URDF_STUDIO_DEBUG__.getRegressionSnapshot().runtime?.collisionMeshCount > 0);
  let previous;
  let stable = 0;
  for (let attempt = 0; attempt < 100; attempt++) {
    const metrics = await readGeometryMetrics(page);
    stable = metrics.runtimeRevision === previous ? stable + 1 : 0;
    if (stable >= 10) return metrics;
    previous = metrics.runtimeRevision;
    await page.waitForTimeout(100);
  }
  throw new Error('Imported collision runtime did not stabilize');
}

async function runModel(browser, model, options, output) {
  const { files, ...description } = model;
  const report = { ...description, inputFileCount: files.length, cases: [], samples: [], browserErrors: [],
    warnings: [], browserCrashes: [], phase: 'prepare', bootstrapReloads: 0, edits: 0, passed: false, startedAt: new Date().toISOString() };
  await mkdir(output, { recursive: true });
  const temporary = await mkdtemp(path.join(tmpdir(), 'urdf-geometry-'));
  let context;
  let page;
  let browserSession;
  // page.evaluate()/RAF can remain pending when the renderer hangs. This Node
  // watchdog closes only this runner's browser and makes that a recorded failure.
  const watchdog = setTimeout(() => {
    report.timeoutError = `Model exceeded ${options.modelTimeout} ms (possible renderer hang)`;
    report.browserErrors.push(report.timeoutError);
    console.error(report.timeoutError);
    browser.close().catch(error => console.error(error));
  }, options.modelTimeout);
  try {
    browserSession = await browser.newBrowserCDPSession();
    browserSession.on('Target.targetCrashed', event => report.browserCrashes.push({ ...event, phase: report.phase }));
    await browserSession.send('Target.setDiscoverTargets', { discover: true });
    context = await browser.newContext({ viewport: { width: 1600, height: 1100 }, locale: 'zh-CN' });
    page = await context.newPage();
    page.setDefaultTimeout(15_000);
    page.on('pageerror', error => report.browserErrors.push(error.message));
    page.on('crash', () => report.browserErrors.push('Target crashed'));
    page.on('console', message => {
      if (message.type() === 'error') report.browserErrors.push(message.text());
      if (message.type() === 'warning') report.warnings.push(message.text());
    });
    const archive = path.join(temporary, 'model.zip');
    await createModelArchive(model, archive);
    report.phase = 'import';
    await page.goto(options.siteUrl, { waitUntil: 'networkidle' });
    await importModel(page, archive, model, report);
    report.baseline = await stabilizeRuntime(page);
    assertGeometryMetrics(report.baseline, model, report.baseline, false);
    await page.evaluate(() => {
      window.__geometryEditContextLosses = 0;
      document.addEventListener('webglcontextlost', () => window.__geometryEditContextLosses++, true);
      window.__URDF_STUDIO_DEBUG__.frameScene();
    });
    const cdp = await context.newCDPSession(page);
    await cdp.send('HeapProfiler.collectGarbage');
    report.heapBefore = await cdp.send('Runtime.getHeapUsage');
    await page.screenshot({ path: path.join(output, 'before.png') });
    const sample = async () => {
      const metrics = await readGeometryMetrics(page);
      report.samples.push(metrics);
      assertGeometryMetrics(metrics, model, report.baseline);
    };
    const durations = [];
    report.phase = 'edit';
    for (const target of [...model.cases, { ...model.cases.at(-1), burst: true }]) {
      const result = await exerciseGeometry(page, target, options.edits, sample, target.burst);
      durations.push(...result.durations);
      const { durations: _durations, ...summary } = result;
      report.cases.push(summary);
      report.edits += result.edits;
      console.log(JSON.stringify({ model: model.name, totalEdits: report.edits, ...summary }));
      await writeFile(path.join(output, 'results.json'), JSON.stringify(report, null, 2));
    }
    await page.screenshot({ path: path.join(output, 'after-edits.png') });
    report.phase = 'history';
    report.history = await checkGeometryHistory(page, model.cases.at(-1));
    report.edits += report.history.checkpointEdits;
    report.afterHistory = await readGeometryMetrics(page);
    assertGeometryMetrics(report.afterHistory, model, report.baseline, false);
    report.phase = 'source-editor';
    report.source = await checkGeometrySource(page, model);
    report.final = await readGeometryMetrics(page);
    assertGeometryMetrics(report.final, model, report.baseline, false);
    await cdp.send('HeapProfiler.collectGarbage');
    report.heapAfter = await cdp.send('Runtime.getHeapUsage');
    assert.deepEqual(report.browserErrors, []);
    assert.deepEqual(report.browserCrashes, []);
    report.timing = summarizeEditTimes(durations);
    report.passed = true;
    report.phase = 'complete';
  } catch (error) {
    report.error = [report.timeoutError, error.stack ?? String(error)].filter(Boolean).join('\n');
    console.error(report.error);
    if (page) {
      await page.screenshot({ path: path.join(output, 'failure.png'), timeout: 5000 }).catch(() => {});
      await writeFile(path.join(output, 'failure.txt'), await page.locator('body').ariaSnapshot({ timeout: 5000 }).catch(() => ''));
    }
  } finally {
    clearTimeout(watchdog);
    report.finishedAt = new Date().toISOString();
    const cleanup = await Promise.allSettled([browserSession?.detach(), context?.close(), rm(temporary, { recursive: true, force: true })]);
    for (const result of cleanup) {
      if (result.status === 'rejected') { report.passed = false; report.cleanupError = String(result.reason); }
    }
    await writeFile(path.join(output, 'results.json'), JSON.stringify(report, null, 2));
  }
  return report;
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  if (options.help) {
    console.log('Usage: npm run test:geometry:real-model -- --model-dir <directory> [--model-dir <directory> ...]\n'
      + 'Options: --edits-per-case <integer >= 8> (40), --model-timeout-ms <ms> (300000), --headed, --site-url <url>, --output-dir <directory>\n'
      + 'Each directory must contain one URDF and its assets. No model assets are downloaded or committed.');
    return;
  }
  // Validate every directory before starting any browser/server.
  const models = [];
  for (const directory of options.directories) models.push(await inspectGeometryModel(directory));
  await mkdir(options.output, { recursive: true });
  const summary = { gitSha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    options, models: [], passed: false };
  let site;
  let browser;
  const onInterrupt = () => {
    summary.interrupted = true;
    process.exitCode = 130;
    browser?.close().catch(error => console.error(error));
  };
  process.once('SIGINT', onInterrupt);
  process.once('SIGTERM', onInterrupt);
  try {
    site = await ensureSite(options.siteUrl);
    if (summary.interrupted) throw new Error('Interrupted during server startup');
    browser = await chromium.launch({ channel: 'chrome', headless: !options.headed, args: buildBrowserLaunchArgs() });
    if (summary.interrupted) throw new Error('Interrupted during browser startup');
    summary.browserVersion = browser.version();
    for (const [index, model] of models.entries()) {
      if (summary.interrupted) break;
      const name = `${index + 1}-${path.basename(model.directory).replace(/[^a-z0-9_-]/gi, '_')}`;
      const output = path.join(options.output, name);
      const result = await runModel(browser, model, options, output);
      summary.models.push({ name: model.name, passed: result.passed, edits: result.edits, output, timing: result.timing, error: result.error ?? result.cleanupError });
    }
    summary.passed = !summary.interrupted && summary.models.length === models.length && summary.models.every(model => model.passed);
    if (!summary.passed) process.exitCode = 1;
  } finally {
    for (const close of [() => browser?.close(), () => site?.stop()]) {
      try { await close(); } catch (error) {
        summary.passed = false;
        summary.cleanupError = String(error);
        process.exitCode = 1;
      }
    }
    process.removeListener('SIGINT', onInterrupt);
    process.removeListener('SIGTERM', onInterrupt);
    await writeFile(path.join(options.output, 'summary.json'), JSON.stringify(summary, null, 2));
    console.log(JSON.stringify(summary, null, 2));
  }
}

main().catch(error => { console.error(error.stack ?? String(error)); process.exitCode = 1; });
