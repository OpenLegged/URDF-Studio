#!/usr/bin/env node

/**
 * Format-agnostic browser/e2e infrastructure for URDF Studio regression tests.
 *
 * Responsibilities:
 *   - Site lifecycle: reuse a running dev/preview server or auto-start one.
 *   - Browser lifecycle: launch Puppeteer + open an instrumented page.
 *   - File upload: single file or whole directory into the app's <input type=file>.
 *   - Small fs utilities: ensureDir / writeJsonAtomic / collectFiles.
 *
 * This module is the shared foundation imported by
 * scripts/test/browser/helpers/*.mjs (base/urdf/mjcf/sdf/usd/xacro).
 *
 * Implementations are consolidated from the self-contained committed regression
 * scripts (run_menagerie_browser_regression.mjs, run_unitree_browser_regression.mjs,
 * run_shadow_hand_hover_regression.mjs) so behaviour matches the existing harness.
 *
 * The app only exposes window.__URDF_STUDIO_DEBUG__ when the URL carries
 * ?regressionDebug=1 (see CLAUDE.md). createSession() in base-helpers.mjs appends
 * that flag; the helpers here also tolerate its absence by waiting for the API.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import puppeteer from 'puppeteer';

// ── Defaults ─────────────────────────────────────────────────────────

export const DEFAULT_SITE_URL = 'http://127.0.0.1:4173';
export const DEFAULT_SITE_TIMEOUT_MS = 120_000;
export const DEFAULT_OPERATION_TIMEOUT_MS = 120_000;
export const DEFAULT_OUTPUT_DIR = path.resolve('tmp/e2e');
export const DEFAULT_SCREENSHOT_DIR = path.join(DEFAULT_OUTPUT_DIR, 'screenshots');
export const DEFAULT_RESULTS_PATH = path.join(DEFAULT_OUTPUT_DIR, 'results.json');

const DEFAULT_START_COMMAND = (host, port) =>
  `npm run dev -- --host ${host} --port ${port} --strictPort`;
const DEFAULT_EXECUTABLE_CANDIDATES = [
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
].filter(Boolean);
const PUPPETEER_LAUNCH_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--enable-unsafe-swiftshader',
];

export function resolveBrowserTestViteCacheDir(siteUrl) {
  const parsedUrl = new URL(siteUrl);
  const port = parsedUrl.port || (parsedUrl.protocol === 'https:' ? '443' : '80');
  const endpoint = `${parsedUrl.hostname}-${port}`.replace(/[^a-zA-Z0-9._-]+/g, '-');
  return path.resolve('tmp/vite-cache/browser', endpoint);
}

export function fail(message) {
  throw new Error(message);
}

export function parseInteger(value, flagName) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    fail(`Invalid value for ${flagName}: ${value}`);
  }
  return parsed;
}

export function parseCommonArgs(argv, { extraOptions } = {}) {
  const options = {
    siteUrl: DEFAULT_SITE_URL,
    siteTimeoutMs: DEFAULT_SITE_TIMEOUT_MS,
    timeoutMs: DEFAULT_OPERATION_TIMEOUT_MS,
    outputDir: DEFAULT_OUTPUT_DIR,
    resultsPath: DEFAULT_RESULTS_PATH,
    screenshotDir: DEFAULT_SCREENSHOT_DIR,
    noStart: false,
    startCommand: null,
    headed: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const nextValue = () => {
      const value = argv[index + 1];
      if (value == null) fail(`Missing value for ${arg}`);
      index += 1;
      return value;
    };

    switch (arg) {
      case '--site-url':
        options.siteUrl = nextValue();
        break;
      case '--site-timeout-ms':
        options.siteTimeoutMs = parseInteger(nextValue(), '--site-timeout-ms');
        break;
      case '--timeout-ms':
        options.timeoutMs = parseInteger(nextValue(), '--timeout-ms');
        break;
      case '--output-dir':
        options.outputDir = path.resolve(nextValue());
        break;
      case '--results':
        options.resultsPath = path.resolve(nextValue());
        break;
      case '--screenshot-dir':
        options.screenshotDir = path.resolve(nextValue());
        break;
      case '--start-command':
        options.startCommand = nextValue();
        break;
      case '--no-start':
        options.noStart = true;
        break;
      case '--headed':
        options.headed = true;
        break;
      case '--help':
      case '-h':
        return { help: true, options };
      default: {
        const handled = extraOptions?.({ arg, nextValue, options });
        if (!handled) fail(`Unknown argument: ${arg}`);
      }
    }
  }

  const url = new URL(options.siteUrl);
  url.searchParams.set('regressionDebug', '1');
  options.siteUrl = url.toString();

  return { help: false, options };
}

export function printCommonHelp({ scriptName = 'test.mjs', extraHelp = '' } = {}) {
  console.log(`Usage: node scripts/test/e2e/${scriptName} [options]

Options:
  --site-url <url>           URDF Studio site URL. Default: ${DEFAULT_SITE_URL}
  --site-timeout-ms <ms>     Site startup/connect timeout. Default: ${DEFAULT_SITE_TIMEOUT_MS}
  --timeout-ms <ms>          Browser operation timeout. Default: ${DEFAULT_OPERATION_TIMEOUT_MS}
  --output-dir <path>        Output directory. Default: ${DEFAULT_OUTPUT_DIR}
  --results <path>           Results JSON path. Default: ${DEFAULT_RESULTS_PATH}
  --screenshot-dir <path>    Screenshot directory. Default: ${DEFAULT_SCREENSHOT_DIR}
  --start-command <cmd>      Override auto-start command when site is offline.
  --no-start                 Fail instead of starting the site automatically.
  --headed                   Launch headed browser instead of headless.
  --help                     Show this help.
${extraHelp}`);
}

// ── fs utilities ─────────────────────────────────────────────────────

export async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

export async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/** Atomic JSON write (temp file + rename) so partial reports never appear. */
export async function writeJsonAtomic(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await fs.rename(tempPath, filePath);
}

/** Recursively list files under rootDir, sorted deterministically. */
export async function collectFiles(rootDir) {
  const entries = [];
  async function visit(currentDir) {
    const dirents = await fs.readdir(currentDir, { withFileTypes: true });
    dirents.sort((left, right) => left.name.localeCompare(right.name));
    for (const dirent of dirents) {
      const fullPath = path.join(currentDir, dirent.name);
      if (dirent.isDirectory()) {
        await visit(fullPath);
        continue;
      }
      if (dirent.isFile()) entries.push(fullPath);
    }
  }
  await visit(rootDir);
  return entries;
}

// ── Site lifecycle ───────────────────────────────────────────────────

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal, redirect: 'follow', cache: 'no-store' });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function isSiteReachable(siteUrl, timeoutMs) {
  try {
    const response = await fetchWithTimeout(siteUrl, Math.min(timeoutMs, 10_000));
    return response.ok;
  } catch {
    return false;
  }
}

function createLogBuffer(limit = 200) {
  const lines = [];
  return {
    push(line) {
      if (typeof line !== 'string' || line.length === 0) return;
      lines.push(line);
      if (lines.length > limit) lines.splice(0, lines.length - limit);
    },
    toString() {
      return lines.join('\n');
    },
  };
}

function spawnSiteProcess(command, cwd, environment = {}) {
  const logs = createLogBuffer();
  const child = spawn(command, {
    cwd,
    shell: true,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...environment, BROWSER: 'none' },
  });

  child.stdout?.setEncoding('utf8');
  child.stderr?.setEncoding('utf8');
  child.stdout?.on('data', (chunk) => logs.push(String(chunk).trimEnd()));
  child.stderr?.on('data', (chunk) => logs.push(String(chunk).trimEnd()));

  return {
    child,
    logs,
    async stop() {
      if (child.exitCode != null || child.signalCode != null) return;
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch {
        return;
      }
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline) {
        if (child.exitCode != null || child.signalCode != null) return;
        await delay(100);
      }
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        // ignore
      }
    },
  };
}

/**
 * Reuse a reachable site, or auto-start one with the dev/preview command.
 * @param {string} siteUrl
 * @param {{ siteTimeoutMs?: number, timeoutMs?: number, noStart?: boolean, headed?: boolean, startCommand?: string|null }} [options]
 * @returns {Promise<{ startedByScript: boolean, siteUrl: string, stop: () => Promise<void> }>}
 */
export async function ensureSite(siteUrl, options = {}) {
  const siteTimeoutMs = options.siteTimeoutMs ?? DEFAULT_SITE_TIMEOUT_MS;

  if (await isSiteReachable(siteUrl, siteTimeoutMs)) {
    return { startedByScript: false, siteUrl, stop: async () => {} };
  }

  if (options.noStart) {
    fail(`Site is not reachable at ${siteUrl} and noStart was set.`);
  }

  const parsedUrl = new URL(siteUrl);
  const host = parsedUrl.hostname;
  const port = parsedUrl.port || (parsedUrl.protocol === 'https:' ? '443' : '80');
  const command = options.startCommand ?? DEFAULT_START_COMMAND(host, port);
  const siteProcess = spawnSiteProcess(command, process.cwd(), {
    // A browser regression often runs on 4173 while an interactive dev server
    // remains on 3000. Vite's optimizer cache has no cross-process lock, so the
    // test server must not replace the interactive server's dependency graph.
    URDF_STUDIO_VITE_CACHE_DIR: resolveBrowserTestViteCacheDir(siteUrl),
  });
  const deadline = Date.now() + siteTimeoutMs;

  try {
    while (Date.now() < deadline) {
      if (await isSiteReachable(siteUrl, 5_000)) {
        return { startedByScript: true, siteUrl, stop: siteProcess.stop };
      }
      if (siteProcess.child.exitCode != null) {
        fail(
          `Site start command exited early: ${command}\n` +
            `Last logs:\n${siteProcess.logs.toString() || '(no logs captured)'}`,
        );
      }
      await delay(500);
    }
    fail(
      `Timed out waiting for site ${siteUrl} after starting: ${command}\n` +
        `Last logs:\n${siteProcess.logs.toString() || '(no logs captured)'}`,
    );
  } catch (error) {
    await siteProcess.stop();
    throw error;
  }
  // Unreachable, but keeps the type checker honest.
  return { startedByScript: true, siteUrl, stop: siteProcess.stop };
}

// ── Browser lifecycle ────────────────────────────────────────────────

async function resolveChromeExecutable(chromePath) {
  if (chromePath) return chromePath;
  for (const candidate of DEFAULT_EXECUTABLE_CANDIDATES) {
    if (await fileExists(candidate)) return candidate;
  }
  return null;
}

/**
 * Launch a Puppeteer browser (headless unless options.headed).
 * @param {{ headed?: boolean, chromePath?: string|null }} [options]
 * @returns {Promise<import('puppeteer').Browser>}
 */
export async function launchBrowser(options = {}) {
  const executablePath = await resolveChromeExecutable(options.chromePath);
  return puppeteer.launch({
    headless: options.headed ? false : true,
    executablePath: executablePath ?? undefined,
    args: buildBrowserLaunchArgs(),
    defaultViewport: { width: 1600, height: 1000, deviceScaleFactor: 1 },
    // Several regression helpers await heavy in-page work inside a single
    // page.evaluate (loadRobotByName / addComponent trigger USD hydration).
    // Those evaluates run longer than the default 30s CDP round-trip, which
    // surfaces as `Runtime.callFunctionOn timed out`. Give a single evaluate
    // enough headroom to finish a cold load/hydrate.
    protocolTimeout: 180000,
  });
}

export function buildBrowserLaunchArgs() {
  return [...PUPPETEER_LAUNCH_ARGS];
}

function ringBuffer(limit = 100) {
  const values = [];
  return {
    push(value) {
      values.push(value);
      if (values.length > limit) values.splice(0, values.length - limit);
    },
    snapshot() {
      return [...values];
    },
  };
}

export async function waitForDebugApi(page, timeoutMs) {
  await retryPageAction(
    () =>
      page.waitForFunction(
        () => Boolean(globalThis.window && window.__URDF_STUDIO_DEBUG__),
        { timeout: timeoutMs },
      ),
    timeoutMs,
    'debug API availability',
  );
  try {
    await retryPageAction(
      () =>
        page.evaluate(async () => {
          const api = window.__URDF_STUDIO_DEBUG__;
          for (const name of ['ping', 'healthCheck', 'healthcheck', 'ready']) {
            if (typeof api?.[name] === 'function') {
              await api[name]();
              return;
            }
          }
        }),
      Math.min(timeoutMs, 10_000),
      'debug API ping',
    );
  } catch {
    // ping is optional
  }
}

/**
 * True when an error is the transient "the page navigated/reloaded while we were
 * evaluating" class — safe to retry rather than fail the test. Consolidated from
 * the committed regression scripts.
 * @param {unknown} error
 */
export function isTransientPageContextError(error) {
  const message = String(error?.stack || error?.message || error || '');
  return (
    message.includes('Execution context was destroyed') ||
    message.includes('Cannot find context with specified id') ||
    message.includes('Runtime.getProperties') ||
    message.includes('window.__URDF_STUDIO_DEBUG__ is not available') ||
    message.includes('Inspected target navigated or closed') ||
    message.includes('Navigating frame was detached') ||
    message.includes('detached Frame') ||
    message.includes('frame got detached') ||
    message.includes('Protocol error') ||
    message.includes('Target closed') ||
    message.includes('Session closed')
  );
}

export function isRetryableExecutionError(error) {
  return isTransientPageContextError(error);
}

export async function retryPageAction(action, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;

  while (Date.now() < deadline) {
    try {
      return await action();
    } catch (error) {
      if (!isTransientPageContextError(error)) throw error;
      lastError = error;
      await delay(200);
    }
  }

  fail(
    `Timed out while retrying ${label} after page execution context resets.\n` +
      `${lastError?.stack || lastError?.message || String(lastError)}`,
  );
}

/**
 * Let an initial post-load SPA navigation settle: wait for the debug API, pause,
 * then wait again. Mirrors `stabilizeDebugPage` from the committed scripts.
 * @param {import('puppeteer').Page} page
 * @param {number} [timeoutMs]
 */
export async function stabilizeDebugPage(page, timeoutMs = DEFAULT_OPERATION_TIMEOUT_MS) {
  await waitForDebugApi(page, timeoutMs);
  await delay(1_000);
  await waitForDebugApi(page, timeoutMs);
}

/**
 * Explicitly load a registered/selected file into the viewer via the debug API.
 *
 * Uploading a file only registers + auto-selects it; the document is not loaded
 * into the viewer until loadRobotByName() runs (see App.tsx loadRobotFile). The
 * format helpers call this after upload so a subsequent waitForReady() can reach
 * the 'ready' state. Tolerant of the transient navigation the load may trigger.
 * @param {import('puppeteer').Page} page
 * @param {string} fileName - The available/selected file name to load.
 * @param {number} [timeoutMs]
 * @returns {Promise<unknown>} the debug API's load result (or null)
 */
export async function triggerRobotLoad(page, fileName, timeoutMs = DEFAULT_OPERATION_TIMEOUT_MS) {
  await page.waitForFunction(
    () => typeof window.__URDF_STUDIO_DEBUG__?.loadRobotByName === 'function',
    { timeout: timeoutMs },
  );
  // Kick the load off WITHOUT awaiting its resolved promise. The debug bridge's
  // loadRobotByName internally awaits a "stable snapshot" that requires
  // documentLoadState.status === 'ready'; for the standard (non-USD) editor that
  // status stays at 'loading' even after the runtime robot is fully built, so
  // awaiting here would block until timeout. We fire it and let waitForReady()
  // poll for the built runtime instead (mirrors the menagerie regression).
  try {
    await page.evaluate((fn) => { void window.__URDF_STUDIO_DEBUG__?.loadRobotByName?.(fn); }, fileName);
  } catch (error) {
    if (!isTransientPageContextError(error)) throw error;
  }
}

/**
 * Open a new page, instrument console/error capture, navigate, and wait for the
 * debug API.
 * @param {import('puppeteer').Browser} browser
 * @param {string} siteUrl
 * @param {number} [timeoutMs]
 * @param {{ beforeNavigate?: (page: import('puppeteer').Page) => Promise<void> | void }} [options]
 * @returns {Promise<{ page: import('puppeteer').Page, consoleMessages: { snapshot(): string[] }, pageErrors: { snapshot(): string[] } }>}
 */
export async function createPage(
  browser,
  siteUrl,
  timeoutMs = DEFAULT_OPERATION_TIMEOUT_MS,
  options = {},
) {
  const page = await browser.newPage();
  const consoleMessages = ringBuffer(100);
  const pageErrors = ringBuffer(50);

  page.setDefaultTimeout(timeoutMs);
  page.setDefaultNavigationTimeout(timeoutMs);
  page.on('console', (message) => consoleMessages.push(`[${message.type()}] ${message.text()}`));
  page.on('pageerror', (error) => pageErrors.push(String(error?.stack || error?.message || error)));

  await options.beforeNavigate?.(page);
  await page.goto(siteUrl, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
  await stabilizeDebugPage(page, timeoutMs);

  return { page, consoleMessages, pageErrors };
}

// ── File upload ──────────────────────────────────────────────────────

/**
 * Upload a single file into the app's import <input type=file>.
 * Prefers an input whose `accept` matches the file extension, then any
 * non-directory file input.
 * @param {import('puppeteer').Page} page
 * @param {string} filePath - Absolute path to the file
 * @param {number} [timeoutMs]
 */
export async function uploadFile(page, filePath, timeoutMs = DEFAULT_OPERATION_TIMEOUT_MS) {
  await page.waitForSelector('input[type="file"]', { timeout: timeoutMs });
  const handles = await page.$$('input[type="file"]');
  if (handles.length === 0) fail('Could not find a file input on the page.');

  const ext = path.extname(filePath).toLowerCase();
  let bestHandle = null;
  let bestScore = -1;
  for (const handle of handles) {
    const score = await handle.evaluate((element, extension) => {
      if (!(element instanceof HTMLInputElement) || element.type !== 'file') return -1;
      // Directory inputs cannot take a single arbitrary file reliably.
      if (element.webkitdirectory || element.hasAttribute('webkitdirectory') || element.hasAttribute('directory')) {
        return 0;
      }
      const accept = (element.accept || '').toLowerCase();
      let value = 1; // any plain file input is usable
      if (extension && accept.includes(extension)) value += 100;
      if (!accept) value += 10; // unrestricted input is a good generic target
      return value;
    }, ext);
    if (score > bestScore) {
      bestScore = score;
      bestHandle = handle;
    }
  }

  if (!bestHandle) fail('Could not find a usable file input on the page.');
  await bestHandle.uploadFile(filePath);
}

/**
 * Upload an entire directory of files into the app's directory import input
 * (the one with `webkitdirectory`), falling back to a multiple-file input.
 * @param {import('puppeteer').Page} page
 * @param {string} dir - Absolute path to the directory
 * @param {number} [timeoutMs]
 */
export async function uploadDirectory(page, dir, timeoutMs = DEFAULT_OPERATION_TIMEOUT_MS) {
  await page.waitForSelector('input[type="file"]', { timeout: timeoutMs });
  const handles = await page.$$('input[type="file"]');
  if (handles.length === 0) fail('Could not find a folder input on the page.');

  let bestHandle = null;
  for (const handle of handles) {
    const isDirectoryInput = await handle.evaluate((element) => {
      if (!(element instanceof HTMLInputElement) || element.type !== 'file') return false;
      return (
        element.webkitdirectory ||
        element.hasAttribute('webkitdirectory') ||
        element.hasAttribute('directory')
      );
    });
    if (isDirectoryInput) {
      bestHandle = handle;
      break;
    }
  }
  // Fall back to the first plain file input if no explicit directory input exists.
  if (!bestHandle) bestHandle = handles[0];

  const files = await collectFiles(dir);
  if (files.length === 0) fail(`Directory is empty: ${dir}`);

  await bestHandle.evaluate((element) => {
    if (element instanceof HTMLInputElement) {
      element.multiple = true;
      element.setAttribute('multiple', '');
    }
  });
  await bestHandle.uploadFile(...files);
}

export async function waitForExpectedRobot(page, robotName, timeoutMs = DEFAULT_OPERATION_TIMEOUT_MS) {
  await retryPageAction(
    () =>
      page.waitForFunction(
        (expected) => {
          const api = window.__URDF_STUDIO_DEBUG__;
          const snapshot = api?.getRegressionSnapshot?.();
          const loadState = api?.getDocumentLoadState?.();
          const storeName = snapshot?.store?.name ?? null;
          const runtimeName = snapshot?.runtime?.name ?? null;
          return loadState?.status === 'ready' && (storeName === expected || runtimeName === expected);
        },
        { timeout: Math.min(timeoutMs, 5_000) },
        robotName,
      ),
    timeoutMs,
    `robot "${robotName}" to load`,
  );
}

export async function waitForSceneToSettle(
  page,
  robotName,
  timeoutMs = DEFAULT_OPERATION_TIMEOUT_MS,
  stableMs = 1_200,
) {
  const deadline = Date.now() + timeoutMs;
  let stableSince = null;
  let lastStatus = null;

  while (Date.now() < deadline) {
    const status = await retryPageAction(
      () =>
        page.evaluate((expected) => {
          const api = window.__URDF_STUDIO_DEBUG__;
          const snapshot = api?.getRegressionSnapshot?.() ?? null;
          const loadState = api?.getDocumentLoadState?.() ?? null;
          const bodyText = document.body?.innerText ?? '';
          const canvas = document.querySelector('canvas');
          const storeName = snapshot?.store?.name ?? null;
          const runtimeName = snapshot?.runtime?.name ?? null;
          const docStatus = loadState?.status ?? null;
          const docError = loadState?.error ?? null;
          return {
            hasRobot: storeName === expected || runtimeName === expected,
            hasCanvas: canvas instanceof HTMLCanvasElement,
            loadingTexts: docStatus === 'loading' || docStatus === 'hydrating' ? [docStatus] : [],
            errorTexts: docStatus === 'error' ? [docError || 'document-load-error'] : [],
            docStatus,
            fileName: loadState?.fileName ?? null,
            bodyExcerpt: bodyText.slice(0, 2_000),
          };
        }, robotName),
      10_000,
      `reading scene status for ${robotName}`,
    );

    lastStatus = status;

    if (status.errorTexts.length > 0) {
      fail(
        `Scene entered error state for ${robotName}: ${status.errorTexts.join(', ')}\n` +
          `Body:\n${status.bodyExcerpt}`,
      );
    }

    const isStable = status.hasRobot && status.hasCanvas && status.loadingTexts.length === 0;
    if (isStable) {
      if (stableSince == null) {
        stableSince = Date.now();
      } else if (Date.now() - stableSince >= stableMs) {
        return status;
      }
    } else {
      stableSince = null;
    }

    await delay(200);
  }

  fail(
    `Timed out waiting for ${robotName} scene to settle.\n` +
      `Last status: ${JSON.stringify(lastStatus, null, 2)}`,
  );
}

export async function clickElementByText(page, selector, text, timeoutMs = DEFAULT_OPERATION_TIMEOUT_MS) {
  await retryPageAction(
    () =>
      page.waitForFunction(
        ({ sel, expected }) =>
          Array.from(document.querySelectorAll(sel)).some(
            (element) => element.textContent?.trim() === expected,
          ),
        { timeout: Math.min(timeoutMs, 5_000) },
        { sel: selector, expected: text },
      ),
    timeoutMs,
    `${selector} with text "${text}" to appear`,
  );

  const clicked = await retryPageAction(
    () =>
      page.evaluate(
        ({ sel, expected }) => {
          const match = Array.from(document.querySelectorAll(sel)).find(
            (element) => element.textContent?.trim() === expected,
          );
          if (match instanceof HTMLElement) {
            match.click();
            return true;
          }
          return false;
        },
        { sel: selector, expected: text },
      ),
    timeoutMs,
    `clicking ${selector} with text "${text}"`,
  );

  if (!clicked) fail(`Could not click ${selector} with text "${text}"`);
}

export async function clickLabelByText(page, text, timeoutMs = DEFAULT_OPERATION_TIMEOUT_MS) {
  await retryPageAction(
    () =>
      page.waitForFunction(
        (expected) =>
          Array.from(document.querySelectorAll('label')).some((label) =>
            label.textContent?.includes(expected),
          ),
        { timeout: Math.min(timeoutMs, 5_000) },
        text,
      ),
    timeoutMs,
    `label containing "${text}" to appear`,
  );

  const clicked = await retryPageAction(
    () =>
      page.evaluate((expected) => {
        const match = Array.from(document.querySelectorAll('label')).find((label) =>
          label.textContent?.includes(expected),
        );
        if (match instanceof HTMLElement) {
          match.click();
          return true;
        }
        return false;
      }, text),
    timeoutMs,
    `clicking label containing "${text}"`,
  );

  if (!clicked) fail(`Could not click label containing "${text}"`);
}

export async function captureCanvasBox(page) {
  return retryPageAction(
    () =>
      page.evaluate(() => {
        const canvas = document.querySelector('canvas');
        if (!(canvas instanceof HTMLCanvasElement)) return null;
        const rect = canvas.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      }),
    10_000,
    'capturing canvas bounds',
  );
}

export async function takeScreenshot(page, name, screenshotDir) {
  await ensureDir(screenshotDir);
  const filePath = path.join(screenshotDir, `${name}.png`);
  await page.screenshot({ path: filePath, type: 'png' });
  return filePath;
}

export async function getAssemblySnapshot(page) {
  return retryPageAction(
    () =>
      page.evaluate(() => {
        const snapshot = window.__URDF_STUDIO_DEBUG__?.getRegressionSnapshot?.();
        return snapshot?.assembly ?? null;
      }),
    10_000,
    'reading assembly snapshot',
  );
}

export async function getStoreSnapshot(page) {
  return retryPageAction(
    () =>
      page.evaluate(() => {
        const snapshot = window.__URDF_STUDIO_DEBUG__?.getRegressionSnapshot?.();
        return snapshot?.store ?? null;
      }),
    10_000,
    'reading store snapshot',
  );
}

export async function getSelectionSnapshot(page) {
  return retryPageAction(
    () =>
      page.evaluate(() => {
        const snapshot = window.__URDF_STUDIO_DEBUG__?.getRegressionSnapshot?.();
        return snapshot?.interaction?.selection ?? null;
      }),
    10_000,
    'reading selection snapshot',
  );
}

export async function waitForCondition(page, conditionFn, timeoutMs, label) {
  await retryPageAction(
    () =>
      page.waitForFunction(
        (fnSource) => {
          const fn = new Function(`return (${fnSource})`);
          return fn()();
        },
        { timeout: Math.min(timeoutMs, 5_000) },
        conditionFn.toString(),
      ),
    timeoutMs,
    label,
  );
}
