#!/usr/bin/env node

// Real property-panel edits must not exponentially inflate the editable XML.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { buildBrowserLaunchArgs, ensureSite } from '../helpers/browser-helpers.mjs';

const output = path.resolve('tmp/regression/geometry-edit');
const url = new URL(process.env.URDF_STUDIO_TEST_SITE_URL ?? 'http://127.0.0.1:4186');
url.searchParams.set('regressionDebug', '1');
const report = { cases: [], browserErrors: [], passed: false };
const names = ['base', 'Larm', 'Rarm'];
const fixture = `<robot name="geometry_edit_stability">
  <!-- preserve this authored comment -->
${names.map(name => `  <link name="${name}">
    <visual><geometry><cylinder radius="0.03" length="0.15"/></geometry></visual>
    <collision><geometry><cylinder radius="0.03" length="0.15"/></geometry></collision>
  </link>`).join('\n')}
${names.slice(1).map((name, index) => `  <joint name="${name}_joint" type="fixed">
    <parent link="base"/><child link="${name}"/><origin xyz="${index ? -0.15 : 0.15} 0 0"/>
  </joint>`).join('\n')}
</robot>`;

async function metrics(page) {
  return page.evaluate(() => {
    const debug = window.__URDF_STUDIO_DEBUG__;
    const snapshot = debug.getRegressionSnapshot();
    const drafts = Object.values(debug.__assetsStore__.getState().componentSourceDrafts);
    const content = drafts.map(draft => draft.content).join('\n');
    return {
      sourceBytes: content.length,
      maxIndent: Math.max(0, ...content.split(/\r?\n/).map(line => line.match(/^[ \t]*/)[0].length)),
      runtimeRevision: snapshot.primaryRuntimeRevision ?? snapshot.runtimeRevision,
      heapBytes: performance.memory?.usedJSHeapSize,
      canvasCount: document.querySelectorAll('canvas').length,
    };
  });
}

async function settle(page) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function waitForImportedRuntime(page) {
  let previousRevision;
  let stableSamples = 0;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const revision = (await metrics(page)).runtimeRevision;
    stableSamples = revision === previousRevision ? stableSamples + 1 : 0;
    if (stableSamples >= 6) return;
    previousRevision = revision;
    await delay(100);
  }
  throw new Error('Imported runtime did not stabilize');
}

async function exercise(page, link, tab, count) {
  await page.getByRole('button', { name: link, exact: true }).click();
  await page.getByRole('button', { name: tab, exact: true }).click();
  const pitch = page.getByRole('button', { name: /^(俯仰 增加 90°|Pitch increase 90°)$/ });
  await pitch.waitFor();
  await settle(page);
  const before = await metrics(page);
  const durations = [];
  for (let index = 0; index < count; index += 1) {
    const start = performance.now();
    if (index % 3 === 0) {
      await pitch.click();
    } else if (index % 3 === 1) {
      await page.getByRole('button', { name: 'Increase X', exact: true }).click();
    } else {
      await page.getByRole('button', { name: 'Increase value', exact: true }).first().click();
    }
    await settle(page);
    durations.push(performance.now() - start);
    const current = await metrics(page);
    // Fail before the old doubling bug can exhaust the browser's memory.
    assert.ok(current.maxIndent < 64, `edit ${index}: indentation grew to ${current.maxIndent}`);
    assert.ok(current.sourceBytes < 20_000, `edit ${index}: source grew to ${current.sourceBytes}`);
    assert.ok(current.canvasCount > 0, 'viewer remains mounted');
  }
  const after = await metrics(page);
  assert.equal(after.runtimeRevision, before.runtimeRevision, 'property edits reuse the runtime');
  const sorted = [...durations].sort((a, b) => a - b);
  const result = { link, tab: String(tab), edits: count, before, after,
    medianMs: sorted[Math.floor(sorted.length / 2)], maxMs: sorted.at(-1) };
  report.cases.push(result);
  console.log(JSON.stringify(result));
}

async function geometryState(page) {
  return page.evaluate(() => {
    const robot = window.__URDF_STUDIO_DEBUG__.__workspaceStore__.getState().getSceneProjection().robotData;
    return Object.values(robot.links).map(link => ({ visual: link.visual, collision: link.collision }));
  });
}

await mkdir(output, { recursive: true });
const site = await ensureSite(url.toString());
let browser;
let page;
try {
  browser = await chromium.launch({ channel: 'chrome', args: buildBrowserLaunchArgs() });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1100 } });
  page = await context.newPage();
  page.on('pageerror', error => report.browserErrors.push(error.message));
  page.on('crash', () => report.browserErrors.push('Target crashed'));
  page.on('console', message => {
    if (message.type() === 'error') report.browserErrors.push(message.text());
  });
  await page.goto(url.toString(), { waitUntil: 'networkidle' });
  await page.waitForFunction(() => Boolean(window.__URDF_STUDIO_DEBUG__?.__workspaceStore__));
  await page.evaluate(() => window.__URDF_STUDIO_DEBUG__.setBeforeUnloadPromptEnabled(false));
  await exercise(page, 'base_link', /^(可视化几何|Visual Geometry)$/, 60);
  await page.locator('input[type="file"]:not([webkitdirectory])').first().setInputFiles({
    name: 'geometry-edit.urdf', mimeType: 'application/xml', buffer: Buffer.from(fixture),
  });
  await page.getByRole('button', { name: 'Larm', exact: true }).waitFor();
  await page.getByRole('checkbox', { name: /^(显示碰撞体|Show Collision)$/ }).check();
  await page.waitForFunction(() => window.__URDF_STUDIO_DEBUG__.getRegressionSnapshot().runtime?.linkCount >= 3);
  await waitForImportedRuntime(page);
  for (const link of names) {
    for (const tab of [/^(可视化几何|Visual Geometry)$/, /^(碰撞几何|Collision Geometry)$/]) {
      await exercise(page, link, tab, 30);
    }
  }
  const edited = await geometryState(page);
  await page.getByTestId('history-undo').click();
  await settle(page);
  assert.notDeepEqual(await geometryState(page), edited, 'undo changes the edited geometry');
  await page.getByTestId('history-redo').click();
  await settle(page);
  assert.deepEqual(await geometryState(page), edited, 'redo restores the edited geometry');
  assert.deepEqual(report.browserErrors, []);
  await page.screenshot({ path: path.join(output, 'after-repeated-edits.png') });
  report.passed = true;
  await context.close();
} catch (error) {
  report.error = error.stack ?? String(error);
  if (page) {
    await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
    await writeFile(path.join(output, 'failure.txt'), await page.locator('body').innerText().catch(() => ''));
  }
  process.exitCode = 1;
  console.error(report.error);
} finally {
  await browser?.close();
  await site.stop();
  await writeFile(path.join(output, 'results.json'), JSON.stringify(report, null, 2));
}
