#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

import puppeteer from 'puppeteer';

const DEFAULT_SITE_URL = 'http://127.0.0.1:4173/?regressionDebug=1';
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_SITE_TIMEOUT_MS = 120_000;
const DEFAULT_OUTPUT_PATH = path.resolve('tmp/regression/hover_press_results.json');
const DEFAULT_SCREENSHOT_DIR = path.resolve('tmp/regression');
const DEFAULT_START_COMMAND = (host, port) =>
  `npm run dev -- --host ${host} --port ${port} --strictPort`;

const HOLD_MS = 300;
const JITTER_PX = 2;

function fail(message) {
  throw new Error(message);
}

function parseInteger(value, flagName) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    fail(`Invalid value for ${flagName}: ${value}`);
  }
  return parsed;
}

function parseArgs(argv) {
  const options = {
    siteUrl: DEFAULT_SITE_URL,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    siteTimeoutMs: DEFAULT_SITE_TIMEOUT_MS,
    outputPath: DEFAULT_OUTPUT_PATH,
    screenshotDir: DEFAULT_SCREENSHOT_DIR,
    noStart: false,
    startCommand: null,
    headed: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    const nextValue = () => {
      const value = argv[index + 1];
      if (value == null) {
        fail(`Missing value for ${arg}`);
      }
      index += 1;
      return value;
    };

    switch (arg) {
      case '--site-url':
        options.siteUrl = nextValue();
        break;
      case '--timeout-ms':
        options.timeoutMs = parseInteger(nextValue(), '--timeout-ms');
        break;
      case '--site-timeout-ms':
        options.siteTimeoutMs = parseInteger(nextValue(), '--site-timeout-ms');
        break;
      case '--output':
        options.outputPath = path.resolve(nextValue());
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
        console.log(`Usage:
  node scripts/test/browser/test_hover_press.mjs [options]

Regressions covered:
  * Hovering a link shows the yellow semantic outline.
  * Pressing and HOLDING the mouse button on the hovered link (without moving)
    must keep the workspace out of the "interacting" state and keep the hover
    outline on screen.
  * Small pointer jitter below the drag threshold while holding must not drop
    the hover outline either.
  * Releasing the mouse still commits the click selection as before.
  * Clicking an empty workspace background clears hover, selection, and the
    semantic outline.

Options:
  --site-url <url>      Dev server URL. Default: ${DEFAULT_SITE_URL}
  --timeout-ms <ms>     Timeout for page operations. Default: ${DEFAULT_TIMEOUT_MS}
  --site-timeout-ms <ms> Site startup/connect timeout. Default: ${DEFAULT_SITE_TIMEOUT_MS}
  --output <path>       Result JSON path. Default: ${DEFAULT_OUTPUT_PATH}
  --screenshot-dir <p>  Screenshot directory. Default: ${DEFAULT_SCREENSHOT_DIR}
  --start-command <cmd> Override auto-start command when site is offline.
  --no-start            Fail instead of starting the site automatically.
  --headed              Launch a headed browser.
`);
        process.exit(0);
        break;
      default:
        fail(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

async function retryPageAction(action, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;

  while (Date.now() < deadline) {
    try {
      return await action();
    } catch (error) {
      lastError = error;
      await delay(150);
    }
  }

  throw new Error(`Timed out while ${label}: ${lastError?.message ?? 'unknown error'}`);
}

async function writeJsonAtomic(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await fs.rename(tempPath, filePath);
}

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      cache: 'no-store',
    });
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
      if (typeof line !== 'string' || line.length === 0) {
        return;
      }
      lines.push(line);
      if (lines.length > limit) {
        lines.splice(0, lines.length - limit);
      }
    },
    toString() {
      return lines.join('\n');
    },
  };
}

function spawnSiteProcess(command, cwd) {
  const logs = createLogBuffer();
  const child = spawn(command, {
    cwd,
    shell: true,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      BROWSER: 'none',
    },
  });

  child.stdout?.setEncoding('utf8');
  child.stderr?.setEncoding('utf8');
  child.stdout?.on('data', (chunk) => logs.push(String(chunk).trimEnd()));
  child.stderr?.on('data', (chunk) => logs.push(String(chunk).trimEnd()));

  return {
    child,
    logs,
    async stop() {
      if (child.exitCode != null || child.signalCode != null) {
        return;
      }

      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch {
        return;
      }

      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline) {
        if (child.exitCode != null || child.signalCode != null) {
          return;
        }
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

async function ensureSite(siteUrl, options) {
  if (await isSiteReachable(siteUrl, options.siteTimeoutMs)) {
    return {
      startedByScript: false,
      stop: async () => {},
    };
  }

  if (options.noStart) {
    fail(`Site is not reachable at ${siteUrl} and --no-start was set.`);
  }

  const parsedUrl = new URL(siteUrl);
  const host = parsedUrl.hostname;
  const port = parsedUrl.port || (parsedUrl.protocol === 'https:' ? '443' : '80');
  const command = options.startCommand ?? DEFAULT_START_COMMAND(host, port);
  const siteProcess = spawnSiteProcess(command, process.cwd());
  const deadline = Date.now() + options.siteTimeoutMs;

  try {
    while (Date.now() < deadline) {
      if (await isSiteReachable(siteUrl, 5_000)) {
        return {
          startedByScript: true,
          stop: siteProcess.stop,
        };
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
}

function summarizeSelection(selection) {
  if (!selection?.type || !selection?.id) {
    return {
      type: null,
      id: null,
      subType: null,
      objectIndex: null,
    };
  }

  return {
    type: selection.type,
    id: selection.id,
    subType: selection.subType ?? null,
    objectIndex: selection.objectIndex ?? null,
  };
}

function matchesBaseLinkVisual(selection) {
  return (
    selection?.type === 'link' &&
    selection.id === 'base_link' &&
    selection.subType === 'visual' &&
    (selection.objectIndex ?? 0) === 0
  );
}

async function waitForDebugApi(page, timeoutMs) {
  await retryPageAction(
    () =>
      page.waitForFunction(
        () => {
          return Boolean(
            window.__URDF_STUDIO_DEBUG__?.getRegressionSnapshot &&
            window.__URDF_STUDIO_DEBUG__?.getProjectedInteractionTargets,
          );
        },
        { timeout: Math.min(timeoutMs, 5_000) },
      ),
    timeoutMs,
    'waiting for regression debug API',
  );
}

async function setViewerToolMode(page, toolMode, timeoutMs) {
  await retryPageAction(
    () =>
      page.evaluate(
        (nextToolMode) => window.__URDF_STUDIO_DEBUG__?.setViewerToolMode?.(nextToolMode) ?? null,
        toolMode,
      ),
    timeoutMs,
    `setting viewer tool mode to ${toolMode}`,
  );

  await retryPageAction(
    () =>
      page.waitForFunction(
        (expectedToolMode) =>
          window.__URDF_STUDIO_DEBUG__?.getRegressionSnapshot?.()?.viewer?.toolMode ===
          expectedToolMode,
        { timeout: Math.min(timeoutMs, 5_000) },
        toolMode,
      ),
    timeoutMs,
    `waiting for viewer tool mode ${toolMode}`,
  );
}

async function getBaseLinkVisualTarget(page, timeoutMs) {
  await retryPageAction(
    () =>
      page.waitForFunction(
        () => {
          const targets = window.__URDF_STUDIO_DEBUG__?.getProjectedInteractionTargets?.() ?? [];
          return targets.some(
            (entry) =>
              entry?.type === 'link' &&
              entry?.id === 'base_link' &&
              entry?.subType === 'visual' &&
              Number.isFinite(entry?.clientX) &&
              Number.isFinite(entry?.clientY),
          );
        },
        { timeout: Math.min(timeoutMs, 5_000) },
      ),
    timeoutMs,
    'waiting for base_link visual target',
  );

  return await retryPageAction(
    () =>
      page.evaluate(() => {
        const targets = window.__URDF_STUDIO_DEBUG__?.getProjectedInteractionTargets?.() ?? [];
        return (
          targets.find(
            (entry) =>
              entry?.type === 'link' && entry?.id === 'base_link' && entry?.subType === 'visual',
          ) ?? null
        );
      }),
    timeoutMs,
    'reading base_link visual target',
  );
}

async function getEmptyWorkspaceTarget(page, timeoutMs) {
  const candidates = await retryPageAction(
    () =>
      page.evaluate(() => {
        const canvas = document.querySelector('canvas');
        if (!(canvas instanceof HTMLCanvasElement)) {
          return [];
        }

        const rect = canvas.getBoundingClientRect();
        const inset = 48;
        return [
          { clientX: rect.left + inset, clientY: rect.top + inset },
          { clientX: rect.right - inset, clientY: rect.top + inset },
          { clientX: rect.left + inset, clientY: rect.bottom - inset },
          { clientX: rect.right - inset, clientY: rect.bottom - inset },
          { clientX: rect.left + rect.width / 2, clientY: rect.top + inset },
        ].filter(({ clientX, clientY }) => {
          const hit = document.elementFromPoint(clientX, clientY);
          return hit === canvas || canvas.contains(hit);
        });
      }),
    timeoutMs,
    'resolving empty workspace candidates',
  );

  const inspectedCandidates = [];
  for (const candidate of candidates) {
    await page.mouse.move(candidate.clientX, candidate.clientY);
    await delay(180);
    const state = await readHoverPressState(page, timeoutMs);
    inspectedCandidates.push({
      ...candidate,
      state: summarizeState(state),
    });
    if (!state.hoveredSelection?.type || !state.hoveredSelection?.id) {
      return candidate;
    }
  }

  fail(
    `Could not resolve an empty workspace background target: ${JSON.stringify(inspectedCandidates)}`,
  );
}

async function waitForOutlineOverlay(page, expected, timeoutMs) {
  await retryPageAction(
    () =>
      page.waitForFunction(
        (expectedOverlay) => {
          const canvas = document.querySelector('canvas');
          return (
            canvas instanceof HTMLCanvasElement &&
            canvas.dataset.semanticOutlineOverlay === expectedOverlay
          );
        },
        { timeout: Math.min(timeoutMs, 10_000) },
        expected,
      ),
    timeoutMs,
    `waiting for semantic outline overlay "${expected}"`,
  );
}

async function readHoverPressState(page, timeoutMs) {
  return await retryPageAction(
    () =>
      page.evaluate(() => {
        const interaction =
          window.__URDF_STUDIO_DEBUG__?.getRegressionSnapshot?.()?.interaction ?? null;
        const workspaceContainer = document.querySelector('[data-interacting]');
        const canvas = document.querySelector('canvas');
        return {
          selection: interaction?.selection ?? null,
          hoveredSelection: interaction?.hoveredSelection ?? null,
          isInteracting:
            workspaceContainer instanceof HTMLElement
              ? workspaceContainer.dataset.interacting === 'true'
              : null,
          outlineOverlay:
            canvas instanceof HTMLCanvasElement
              ? (canvas.dataset.semanticOutlineOverlay ?? null)
              : null,
        };
      }),
    timeoutMs,
    'reading hover/press state',
  );
}

function summarizeState(state) {
  return {
    selection: summarizeSelection(state.selection),
    hoveredSelection: summarizeSelection(state.hoveredSelection),
    isInteracting: state.isInteracting,
    outlineOverlay: state.outlineOverlay,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const site = await ensureSite(options.siteUrl, options);
  const browser = await puppeteer.launch({
    headless: options.headed ? false : true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
    defaultViewport: {
      width: 1600,
      height: 1100,
      deviceScaleFactor: 1,
    },
  });

  let result = null;

  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(options.timeoutMs);

    await page.goto(options.siteUrl, {
      waitUntil: 'domcontentloaded',
      timeout: options.timeoutMs,
    });

    await waitForDebugApi(page, options.timeoutMs);
    await setViewerToolMode(page, 'select', options.timeoutMs);

    const target = await getBaseLinkVisualTarget(page, options.timeoutMs);
    if (!target) {
      fail('Could not resolve a projected base_link visual hover target.');
    }

    await fs.mkdir(options.screenshotDir, { recursive: true });
    const hoverScreenshotPath = path.join(options.screenshotDir, 'hover_press_hover.png');
    const holdScreenshotPath = path.join(options.screenshotDir, 'hover_press_hold.png');

    await page.mouse.move(target.clientX, target.clientY);
    await waitForOutlineOverlay(page, 'hover', options.timeoutMs);
    await delay(120);

    const hoverState = await readHoverPressState(page, options.timeoutMs);
    await page.screenshot({ path: hoverScreenshotPath, type: 'png' });

    await page.mouse.down();
    await delay(HOLD_MS);
    const holdState = await readHoverPressState(page, options.timeoutMs);
    await page.screenshot({ path: holdScreenshotPath, type: 'png' });

    await page.mouse.move(target.clientX + JITTER_PX, target.clientY);
    await delay(140);
    const jitterState = await readHoverPressState(page, options.timeoutMs);

    await page.mouse.up();
    await retryPageAction(
      () =>
        page.waitForFunction(
          () => {
            const selection =
              window.__URDF_STUDIO_DEBUG__?.getRegressionSnapshot?.()?.interaction?.selection;
            return (
              selection?.type === 'link' &&
              selection?.id === 'base_link' &&
              selection?.subType === 'visual'
            );
          },
          { timeout: Math.min(options.timeoutMs, 10_000) },
        ),
      options.timeoutMs,
      'waiting for base_link click selection to commit',
    );
    await delay(120);
    const releaseState = await readHoverPressState(page, options.timeoutMs);

    // A real drag beyond the threshold must still engage the interaction
    // render path, and releasing it must settle back afterwards.
    await page.mouse.move(target.clientX, target.clientY);
    await delay(120);
    await page.mouse.down();
    await page.mouse.move(target.clientX + 30, target.clientY);
    await delay(140);
    const dragState = await readHoverPressState(page, options.timeoutMs);
    await page.mouse.up();
    // The main thread can be busy right after a drag (always frameloop +
    // raycasts), so wait for the settle deterministically instead of racing
    // the 180ms recovery timer with a fixed delay.
    await retryPageAction(
      () =>
        page.waitForFunction(
          () =>
            document.querySelector('[data-interacting]') instanceof HTMLElement &&
            document.querySelector('[data-interacting]').dataset.interacting === 'false',
          { timeout: Math.min(options.timeoutMs, 10_000) },
        ),
      options.timeoutMs,
      'waiting for the workspace to settle after the drag',
    );
    const dragSettleState = await readHoverPressState(page, options.timeoutMs);

    const backgroundTarget = await getEmptyWorkspaceTarget(page, options.timeoutMs);
    const backgroundHoverState = await readHoverPressState(page, options.timeoutMs);
    await page.mouse.click(backgroundTarget.clientX, backgroundTarget.clientY);
    await retryPageAction(
      () =>
        page.waitForFunction(
          () => {
            const interaction =
              window.__URDF_STUDIO_DEBUG__?.getRegressionSnapshot?.()?.interaction ?? null;
            return (
              !interaction?.selection?.type &&
              !interaction?.selection?.id &&
              !interaction?.hoveredSelection?.type &&
              !interaction?.hoveredSelection?.id
            );
          },
          { timeout: Math.min(options.timeoutMs, 10_000) },
        ),
      options.timeoutMs,
      'waiting for a background click to clear selection and hover',
    );
    await waitForOutlineOverlay(page, 'off', options.timeoutMs);
    const backgroundClickState = await readHoverPressState(page, options.timeoutMs);

    result = {
      siteUrl: options.siteUrl,
      target: {
        id: target.id,
        subType: target.subType,
        objectIndex: target.objectIndex ?? null,
        clientX: target.clientX,
        clientY: target.clientY,
      },
      holdMs: HOLD_MS,
      jitterPx: JITTER_PX,
      states: {
        hover: summarizeState(hoverState),
        hold: summarizeState(holdState),
        jitter: summarizeState(jitterState),
        release: summarizeState(releaseState),
        drag: summarizeState(dragState),
        dragSettle: summarizeState(dragSettleState),
        backgroundHover: summarizeState(backgroundHoverState),
        backgroundClick: summarizeState(backgroundClickState),
      },
      screenshots: {
        hover: hoverScreenshotPath,
        hold: holdScreenshotPath,
      },
      generatedAt: new Date().toISOString(),
    };

    await writeJsonAtomic(options.outputPath, result);

    assert.equal(
      matchesBaseLinkVisual(hoverState.hoveredSelection),
      true,
      'expected the initial mouse move to hover the default base_link visual',
    );
    assert.equal(
      hoverState.outlineOverlay,
      'hover',
      'expected the hover outline overlay to render while hovering base_link',
    );

    assert.equal(
      matchesBaseLinkVisual(holdState.hoveredSelection),
      true,
      'expected hover state to survive a stationary mouse press on base_link',
    );
    assert.equal(
      holdState.isInteracting,
      false,
      'a stationary mouse press must not mark the workspace as interacting ' +
        '(interaction is reserved for actual drags beyond the threshold)',
    );
    assert.equal(
      holdState.outlineOverlay,
      'hover',
      'expected the hover outline overlay to stay visible while the mouse button is held',
    );

    assert.equal(
      jitterState.outlineOverlay,
      'hover',
      `expected sub-threshold jitter (${JITTER_PX}px) during a press to keep the hover outline`,
    );

    assert.equal(
      matchesBaseLinkVisual(releaseState.selection),
      true,
      'expected releasing the mouse to commit the base_link click selection',
    );
    assert.notEqual(
      releaseState.outlineOverlay,
      'off',
      'expected a semantic outline (hover or selection) to remain after the click',
    );

    assert.equal(
      dragState.isInteracting,
      true,
      'expected a drag beyond the threshold to engage the interaction render path',
    );
    assert.equal(
      dragSettleState.isInteracting,
      false,
      'expected the workspace to settle after the drag is released',
    );
    assert.deepEqual(
      summarizeSelection(backgroundHoverState.hoveredSelection),
      summarizeSelection(null),
      'expected moving onto the empty workspace background to clear hover',
    );
    assert.equal(
      matchesBaseLinkVisual(backgroundHoverState.selection),
      true,
      'expected the base_link selection to remain until the background is clicked',
    );
    assert.deepEqual(
      summarizeSelection(backgroundClickState.selection),
      summarizeSelection(null),
      'expected clicking the empty workspace background to clear selection',
    );
    assert.deepEqual(
      summarizeSelection(backgroundClickState.hoveredSelection),
      summarizeSelection(null),
      'expected clicking the empty workspace background to keep hover cleared',
    );
    assert.equal(
      backgroundClickState.outlineOverlay,
      'off',
      'expected no semantic outline after clicking the empty workspace background',
    );

    console.log(
      JSON.stringify(
        {
          ok: true,
          outputPath: options.outputPath,
          states: result.states,
        },
        null,
        2,
      ),
    );
  } finally {
    await browser.close();
    await site.stop();
  }
}

await main();
