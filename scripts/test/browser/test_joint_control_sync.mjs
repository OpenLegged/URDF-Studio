#!/usr/bin/env node

import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { buildBrowserLaunchArgs, ensureSite } from '../helpers/browser-helpers.mjs';

const output = path.resolve('tmp/regression/joint-control-sync');
const url = new URL(process.env.URDF_STUDIO_TEST_SITE_URL ?? 'http://127.0.0.1:4188');
url.searchParams.set('regressionDebug', '1');
const report = { cases: [], browserErrors: [], passed: false };

function fixture(type) {
  return `<robot name="joint_control_sync">
<link name="base"><visual><geometry><box size="0.2 0.2 0.2"/></geometry></visual></link>
<link name="arm"><visual><origin xyz="0 0 0.35"/><geometry><box size="0.1 0.1 0.7"/></geometry>
<material name="blue"><color rgba="0.1 0.5 0.9 1"/></material></visual></link>
<joint name="hinge" type="${type}"><parent link="base"/><child link="arm"/>
<origin xyz="0 0 0.2"/><axis xyz="${type === 'prismatic' ? '1 0 0' : '0 1 0'}"/>
${type === 'continuous' ? '' : '<limit lower="-1" upper="1" effort="100" velocity="10"/>'}
</joint></robot>`;
}

function slider(page) {
  return page.getByRole('slider', { name: 'hinge slider', exact: true });
}

function row(page) {
  return page.getByTestId('tree-editor-joint-section-content').getByRole('button', {
    name: 'hinge', exact: true,
  });
}

async function settle(page) {
  await page.evaluate(() => new Promise(resolve => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));
}

async function values(page) {
  return page.evaluate(() => {
    const api = window.__URDF_STUDIO_DEBUG__;
    const state = api.__workspaceStore__.getState();
    const joint = Object.values(state.workspace.components)[0].robot.joints.hinge;
    const snapshot = api.getRegressionSnapshot();
    const panel = document.querySelector('[role="slider"][aria-label="hinge slider"]');
    return {
      canonical: joint.angle ?? 0,
      viewer: snapshot.viewer?.jointAngles.hinge,
      runtime: snapshot.runtime?.joints.find(item => item.name === 'hinge')?.angle,
      panel: Number(panel?.getAttribute('aria-valuenow')),
      continuous: joint.type === 'continuous',
      panelDisplay: Number(document.querySelector(
        '[role="button"][aria-label="hinge"] button')?.textContent),
      history: state.history.past.length,
    };
  });
}

function near(actual, expected, label, tolerance = 1e-10) {
  assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance,
    `${label}: ${actual} != ${expected}`);
}

async function consistent(page, label, expected, unit = 'rad') {
  await settle(page);
  const state = await values(page);
  if (expected !== undefined) near(state.canonical, expected, `${label}: canonical`);
  near(state.viewer, state.canonical, `${label}: viewer`);
  near(state.runtime, state.canonical, `${label}: runtime`);
  const display = unit === 'deg' ? state.canonical * 180 / Math.PI : state.canonical;
  // Continuous sliders recenter their relative travel after each interaction.
  near(state.panel, state.continuous ? 0 : display, `${label}: slider`);
  near(state.panelDisplay, Number(display.toFixed(2)), `${label}: numeric label`);
  report.cases.push({ label, ...state });
  return state;
}

async function openInput(page) {
  await row(page).locator('button').first().click();
  const input = row(page).getByRole('textbox');
  await input.waitFor();
  return input;
}

async function enterValue(page, value, key = 'Enter') {
  const input = await openInput(page);
  await input.fill(String(value));
  await input.press(key);
  await settle(page);
}

async function dragSlider(page, direction, unit = 'rad') {
  const before = await values(page);
  const thumb = await page.getByRole('button', { name: 'hinge slider thumb', exact: true }).boundingBox();
  const track = await slider(page).boundingBox();
  assert.ok(thumb && track);
  const x = thumb.x + thumb.width / 2;
  const y = thumb.y + thumb.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(Math.max(track.x + 2, Math.min(track.x + track.width - 2,
    x + direction * track.width * 0.12)), y, { steps: 8 });
  await page.mouse.up();
  const after = await consistent(page, 'slider release', undefined, unit);
  assert.ok(Math.abs(after.canonical - before.canonical) > 0.01, 'slider really moved the joint');
}

async function dragLink(page, direction, unit = 'rad') {
  const before = await values(page);
  const target = await page.evaluate(() => window.__URDF_STUDIO_DEBUG__
    .getProjectedInteractionTargets().find(item => item.id === 'arm' && item.subType === 'visual'));
  assert.ok(target, 'arm has a projected hit target');
  const canvas = await page.locator('canvas').first().boundingBox();
  assert.ok(canvas && target.clientX > canvas.x && target.clientX < canvas.x + canvas.width &&
    target.clientY > canvas.y && target.clientY < canvas.y + canvas.height,
  'arm drag starts inside the canvas');
  await page.mouse.move(target.clientX, target.clientY);
  await page.mouse.down();
  const pressed = await values(page);
  near(pressed.canonical, before.canonical, 'link pointerdown retains current pose');
  near(pressed.runtime, before.runtime, 'link pointerdown retains runtime pose');
  await page.mouse.move(target.clientX + direction * 28, target.clientY - direction * 12, { steps: 10 });
  await settle(page);
  const during = await values(page);
  await page.mouse.up();
  const after = await consistent(page, 'link release', undefined, unit);
  assert.ok(Math.abs(after.canonical - before.canonical) > 1e-5, 'link drag really moved the joint');
  near(after.canonical, during.runtime, 'link release retains the last dragged pose');
}

async function precisionChecks(page, unit = 'rad') {
  const before = await consistent(page, 'precision baseline', undefined, unit);
  for (const key of ['Tab', 'Enter', 'Escape']) {
    const input = await openInput(page);
    near(Number(await input.inputValue()), unit === 'deg'
      ? before.canonical * 180 / Math.PI : before.canonical, 'editable full precision');
    if (key === 'Escape') await input.fill('0.987654');
    await input.press(key);
    const after = await consistent(page, `unchanged/cancelled input ${key}`, before.canonical, unit);
    assert.equal(after.history, before.history, 'no edit means no history entry');
  }
}

async function inputToContinuousSlider(page) {
  const input = await openInput(page);
  await input.fill('0.2345678912345');
  const thumb = await page.getByRole('button', { name: 'hinge slider thumb', exact: true }).boundingBox();
  assert.ok(thumb);
  await page.mouse.move(thumb.x + thumb.width / 2, thumb.y + thumb.height / 2);
  await page.mouse.down();
  await page.mouse.up();
  await consistent(page, 'uncommitted input directly to continuous slider', 0.2345678912345);
}

async function exercise(page, type) {
  console.log(`START ${type}`);
  await page.goto(url.toString(), { waitUntil: 'networkidle' });
  await page.waitForFunction(() => Boolean(window.__URDF_STUDIO_DEBUG__?.__workspaceStore__));
  await page.evaluate(() => window.__URDF_STUDIO_DEBUG__.setBeforeUnloadPromptEnabled(false));
  await page.locator('input[type="file"]:not([webkitdirectory])').first().setInputFiles({
    name: `joint-sync-${type}.urdf`, mimeType: 'application/xml', buffer: Buffer.from(fixture(type)),
  });
  await slider(page).waitFor();
  await page.waitForFunction(() => window.__URDF_STUDIO_DEBUG__.getRegressionSnapshot()
    .runtime?.joints.some(joint => joint.name === 'hinge'));
  await consistent(page, `${type}: imported`, 0);
  if (type !== 'continuous') {
    for (const requested of [5, 6, -5, -6]) {
      await enterValue(page, requested);
      await consistent(page, `${type}: clamp ${requested}`, Math.sign(requested));
    }
    await dragLink(page, 1);
    await dragSlider(page, 1);
  }
  await enterValue(page, 0.12345678912345678);
  await precisionChecks(page);
  if (type === 'continuous') await inputToContinuousSlider(page);
  for (let index = 0; index < 4; index += 1) {
    const angle = index % 2 ? -0.2345678912345 : 0.12345678912345678;
    await enterValue(page, angle, index % 2 ? 'Tab' : 'Enter');
    await consistent(page, `${type}: numeric cycle ${index}`, angle);
    await dragSlider(page, index % 2 ? 1 : -1);
    await dragLink(page, index % 2 ? -1 : 1);
    await precisionChecks(page);
  }
  const beforeReset = await values(page);
  await page.getByRole('button', { name: /^(Reset joints|重置关节)$/ }).click();
  await consistent(page, `${type}: reset`, 0);
  await page.getByTestId('history-undo').click();
  await consistent(page, `${type}: undo reset`, beforeReset.canonical);
  await page.getByTestId('history-redo').click();
  await consistent(page, `${type}: redo reset`, 0);
  if (type !== 'prismatic') {
    await page.getByRole('button', { name: 'RAD', exact: true }).click();
    await consistent(page, `${type}: degrees`, undefined, 'deg');
    await precisionChecks(page, 'deg');
    await enterValue(page, 12.345678912345);
    await consistent(page, `${type}: degree input`, 12.345678912345 * Math.PI / 180, 'deg');
    await dragSlider(page, -1, 'deg');
    await dragLink(page, 1, 'deg');
  }
  await page.screenshot({ path: path.join(output, `${type}.png`) });
  console.log(`PASS ${type}: limits, precision and alternating controls`);
}

await mkdir(output, { recursive: true });
const site = await ensureSite(url.origin);
let browser;
let page;
try {
  browser = await chromium.launch({ channel: 'chrome', args: buildBrowserLaunchArgs() });
  for (const type of ['revolute', 'continuous', 'prismatic']) {
    const context = await browser.newContext({ viewport: { width: 1600, height: 1100 } });
    page = await context.newPage();
    page.on('pageerror', error => report.browserErrors.push(error.message));
    page.on('console', message => {
      if (message.type() === 'error') report.browserErrors.push(message.text());
    });
    await exercise(page, type);
    await context.close();
  }
  assert.deepEqual(report.browserErrors, []);
  report.passed = true;
} catch (error) {
  report.error = error.stack ?? String(error);
  if (page && !page.isClosed()) {
    await page.screenshot({ path: path.join(output, 'failure.png') });
    await writeFile(path.join(output, 'failure.txt'), await page.locator('body').innerText());
  }
  console.error(report.error);
  process.exitCode = 1;
} finally {
  await browser?.close();
  await site.stop();
  await writeFile(path.join(output, 'results.json'), JSON.stringify(report, null, 2));
}
