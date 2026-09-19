#!/usr/bin/env node

import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { chromium } from 'playwright';
import JSZip from 'jszip';
import { ensureSite } from '../helpers/browser-helpers.mjs';

const outputDir = path.resolve('tmp/regression/closed-loop-bridges');
const siteUrl = process.env.URDF_TEST_SITE_URL || 'http://127.0.0.1:4175';
const result = [];
const fourBar = `<robot name="closed_loop_audit">
<link name="base"><visual><origin xyz="0.5 0 0"/><geometry><box size="1.1 0.1 0.1"/></geometry></visual></link>
<link name="left"><visual><origin xyz="0 0 0.5"/><geometry><box size="0.08 0.08 1"/></geometry></visual></link>
<link name="right"><visual><origin xyz="0 0 0.5"/><geometry><box size="0.08 0.08 1"/></geometry></visual></link>
<link name="coupler"><visual><origin xyz="0.5 0 0"/><geometry><box size="1 0.08 0.08"/></geometry></visual></link>
<link name="right_tip"/>
<joint name="left_drive" type="revolute"><parent link="base"/><child link="left"/><axis xyz="0 1 0"/><limit lower="-1.2" upper="1.2" effort="100" velocity="10"/></joint>
<joint name="right_drive" type="revolute"><parent link="base"/><child link="right"/><origin xyz="1 0 0"/><axis xyz="0 1 0"/><limit lower="-1.2" upper="1.2" effort="100" velocity="10"/></joint>
<joint name="left_elbow" type="revolute"><parent link="left"/><child link="coupler"/><origin xyz="0 0 1"/><axis xyz="0 1 0"/><limit lower="-1.2" upper="1.2" effort="100" velocity="10"/></joint>
<joint name="right_tip_fixed" type="fixed"><parent link="right"/><child link="right_tip"/><origin xyz="0 0 1"/></joint>
</robot>`;

function slideRobot(names) {
  return `<robot name="closed_loop_audit"><link name="base"/>${names.map((name, index) => `
<link name="${name}"><visual><origin xyz="0 ${index * 0.2} 0"/><geometry><box size="0.2 0.1 0.1"/></geometry></visual></link>
<joint name="${name}_drive" type="prismatic"><parent link="base"/><child link="${name}"/><axis xyz="1 0 0"/><limit lower="-1" upper="1" effort="100" velocity="10"/></joint>`).join('')}</robot>`;
}

async function snapshot(page) {
  return page.evaluate(() => {
    const state = window.__URDF_STUDIO_DEBUG__.__workspaceStore__.getState();
    return { workspace: state.workspace, robot: state.getSceneProjection().robotData };
  });
}

async function noExportWarning(page) {
  assert.doesNotMatch(await page.locator('body').innerText(), /cannot express closed loops|Closed-loop bridges|Exported with \d+ closed-loop|已导出，文件中未包含/i);
}

async function loadRobot(page, content, firstJoint) {
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('input[type=file][accept]').setInputFiles({
    name: 'closed-loop.urdf', mimeType: 'application/xml', buffer: Buffer.from(content),
  });
  await page.getByRole('slider', { name: `${firstJoint} slider`, exact: true }).waitFor();
}

async function fill(page, name, value, index = 0) {
  const input = page.getByRole('textbox', { name, exact: true }).nth(index);
  await input.fill(String(value));
  await input.press('Tab');
}

async function bridge(page, { parent, child, type = 'Fixed', x = 0, axis = [0, 1, 0], limit = 0.1 }) {
  const count = Object.keys((await snapshot(page)).workspace.bridges).length;
  await page.getByRole('button', { name: 'Create Bridge', exact: true }).click();
  await page.getByRole('radio', { name: 'Link List', exact: true }).click();
  for (const [label, link] of [['Parent Link', parent], ['Child Link', child]]) {
    await page.getByRole('combobox', { name: label, exact: true }).click();
    await page.getByRole('option', { name: `closed_loop_audit › ${link}`, exact: true }).click();
  }
  if (type !== 'Fixed') {
    await page.getByRole('combobox').filter({ hasText: 'Fixed' }).click();
    await page.getByRole('option', { name: type, exact: true }).click();
    for (const [index, label] of ['X', 'Y', 'Z'].entries()) await fill(page, label, axis[index], 1);
    if (type !== 'Continuous') {
      await fill(page, 'Position Lower Limit', -limit);
      await fill(page, 'Position Upper Limit', limit);
    }
  }
  await fill(page, 'X', x);
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await page.waitForFunction(expected => Object.keys(window.__URDF_STUDIO_DEBUG__.__workspaceStore__.getState().workspace.bridges).length === expected, count + 1);
  await noExportWarning(page);
  assert.equal(await page.getByRole('img', {
    name: 'This component is already part of a bridge and cannot move independently.', exact: true,
  }).count(), 0, 'an internal loop must not display an external attachment lock');
}

async function drag(page, joint, fraction, previousFraction = 0.5) {
  const box = await page.getByRole('slider', { name: `component_1_${joint} slider`, exact: true }).boundingBox();
  assert.ok(box);
  await page.mouse.move(box.x + box.width * previousFraction, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * fraction, box.y + box.height / 2, { steps: 4 });
  await page.mouse.up();
  await page.waitForFunction(id => Number.isFinite(window.__URDF_STUDIO_DEBUG__.__workspaceStore__.getState().getSceneProjection().robotData.joints[id]?.angle), `component_1_${joint}`);
  // Allow the interaction's animation-frame flush and React projection to settle.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  return snapshot(page);
}

function angle(robot, name) { return robot.joints[`component_1_${name}`].angle ?? 0; }
function near(actual, expected, tolerance = 5e-4) { assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`); }

async function checkFourBar(page, type, axis, expected) {
  await loadRobot(page, fourBar, 'left_drive');
  await bridge(page, { parent: 'coupler', child: 'right_tip', type, x: 1, axis });
  const { robot } = await drag(page, 'left_drive', 0.7);
  const left = angle(robot, 'left_drive');
  const right = angle(robot, 'right_drive');
  const elbow = angle(robot, 'left_elbow');
  near(left, expected);
  near(right, expected);
  near(elbow, -expected);
  // Independently evaluate the two endpoints and their relative orientation.
  const anchorError = Math.hypot(
    Math.sin(left) + Math.cos(left + elbow) - 1 - Math.sin(right),
    Math.cos(left) - Math.sin(left + elbow) - Math.cos(right),
  );
  assert.ok(anchorError < 5e-4, `Open loop: ${anchorError}`);
  near(right - left - elbow, expected);
  await noExportWarning(page);
  await page.screenshot({ path: path.join(outputDir, `${type}-${axis.join('')}.png`) });
  return { left, right, elbow, anchorError, loopAngle: right - left - elbow };
}

async function runCase(name, fn) {
  if (process.env.CLOSED_LOOP_CASE && !name.includes(process.env.CLOSED_LOOP_CASE)) return;
  const evidence = await fn();
  result.push({ name, passed: true, evidence });
  console.log(`PASS ${name}`);
}

function waitForExportDownload(page) {
  return Promise.race([
    page.waitForEvent('download', { timeout: 120_000 }),
    page.getByRole('alert').waitFor({ timeout: 120_000 }).then(async () => {
      throw new Error(await page.getByRole('alert').innerText());
    }),
  ]);
}

await mkdir(outputDir, { recursive: true });
const site = await ensureSite(siteUrl);
let browser;
let context;
const ownedPids = new Set();
try {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--enable-unsafe-swiftshader'] });
  const cdp = await browser.newBrowserCDPSession();
  for (const processInfo of (await cdp.send('SystemInfo.getProcessInfo')).processInfo) ownedPids.add(processInfo.id);
  context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);
  page.on('pageerror', error => console.error('Browser error:', error.message));
  page.on('console', message => {
    if (message.type() === 'error' && !message.text().startsWith('[vite]')) console.error(message.text());
  });
  // Other workspace edits must not hot-reload an in-progress interaction.
  await page.routeWebSocket('**', ws => ws.close());
  await page.goto(`${siteUrl}/?regressionDebug=1`, { waitUntil: 'domcontentloaded' });
  await runCase('fixed locks orientation', () => checkFourBar(page, 'Fixed', [0, 1, 0], 0));
  await runCase('revolute respects its limit', () => checkFourBar(page, 'Revolute', [0, 1, 0], 0.1));
  await runCase('revolute rejects rotation about another axis', () => checkFourBar(page, 'Revolute', [0, 0, 1], 0));
  await runCase('continuous keeps its free rotation', () => checkFourBar(page, 'Continuous', [0, 1, 0], 0.48));
  await runCase('prismatic slides and respects its limit', async () => {
    await loadRobot(page, slideRobot(['a']), 'a_drive');
    await bridge(page, { parent: 'base', child: 'a', type: 'Prismatic', axis: [1, 0, 0], limit: 0.3 });
    const free = await drag(page, 'a_drive', 0.6);
    near(angle(free.robot, 'a_drive'), 0.2);
    const limited = await drag(page, 'a_drive', 0.75, 0.6);
    near(angle(limited.robot, 'a_drive'), 0.3);
    return { free: angle(free.robot, 'a_drive'), limited: angle(limited.robot, 'a_drive') };
  });
  await runCase('connected loops compensate all passive branches', async () => {
    await loadRobot(page, slideRobot(['a', 'b', 'c']), 'a_drive');
    await bridge(page, { parent: 'a', child: 'b' });
    await bridge(page, { parent: 'b', child: 'c' });
    const { robot } = await drag(page, 'a_drive', 0.6);
    const positions = ['a', 'b', 'c'].map(name => angle(robot, `${name}_drive`));
    positions.forEach(position => near(position, 0.2));
    assert.equal(robot.closedLoopConstraints.length, 2);
    return { positions };
  });
  await runCase('undo redo project save and export warning timing', async () => {
    await loadRobot(page, fourBar, 'left_drive');
    await bridge(page, { parent: 'coupler', child: 'right_tip', type: 'Revolute', x: 1 });
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    assert.equal(Object.keys((await snapshot(page)).workspace.bridges).length, 0);
    await page.getByRole('button', { name: 'Redo', exact: true }).click();
    assert.equal(Object.keys((await snapshot(page)).workspace.bridges).length, 1);
    await noExportWarning(page);
    await page.getByRole('button', { name: 'File', exact: true }).click();
    const projectDownload = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export Project (.usp)', exact: true }).click();
    const projectPath = path.join(outputDir, 'closed-loop.usp');
    await (await projectDownload).saveAs(projectPath);
    await noExportWarning(page);
    await page.locator('input[type=file][accept]').setInputFiles(projectPath);
    await page.waitForFunction(() => Object.keys(window.__URDF_STUDIO_DEBUG__.__workspaceStore__.getState().workspace.bridges).length === 1);
    await noExportWarning(page);
    await page.getByRole('button', { name: 'File', exact: true }).click();
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    await page.getByRole('button', { name: 'URDF', exact: true }).click();
    await noExportWarning(page);
    const exportDownload = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export ZIP', exact: true }).click();
    await (await exportDownload).saveAs(path.join(outputDir, 'closed-loop-urdf.zip'));
    await page.getByText('Exported with 1 closed-loop connection(s) omitted. Your model is unchanged.', { exact: true }).waitFor();
    assert.equal((await snapshot(page)).robot.closedLoopConstraints.length, 1);
    await page.screenshot({ path: path.join(outputDir, 'export-warning.png') });
    return { projectBytes: (await readFile(projectPath)).length, closuresAfterExport: 1 };
  });
  for (const format of ['SDF', 'USD']) {
    await runCase(`${format} export and browser reimport preserve the revolute closure`, async () => {
      await loadRobot(page, fourBar, 'left_drive');
      await bridge(page, { parent: 'coupler', child: 'right_tip', type: 'Revolute', x: 1 });
      await page.getByRole('button', { name: 'File', exact: true }).click();
      await page.getByRole('button', { name: 'Export', exact: true }).click();
      await page.getByRole('button', { name: format, exact: true }).click();
      const download = waitForExportDownload(page);
      await page.getByRole('button', { name: 'Export ZIP', exact: true }).click();
      const archivePath = path.join(outputDir, `closed-loop-${format.toLowerCase()}.zip`);
      await (await download).saveAs(archivePath);
      await page.reload({ waitUntil: 'domcontentloaded' });
      if (format === 'SDF') {
        const zip = await JSZip.loadAsync(await readFile(archivePath));
        const entry = Object.values(zip.files).find(file => file.name.endsWith('.sdf'));
        assert.ok(entry);
        await page.locator('input[type=file][accept]').setInputFiles({
          name: 'closed-loop.sdf', mimeType: 'application/xml', buffer: await entry.async('nodebuffer'),
        });
      } else {
        await page.locator('input[type=file][accept]').setInputFiles(archivePath);
      }
      await page.waitForFunction(expectedFormat => {
        const state = window.__URDF_STUDIO_DEBUG__.getDocumentLoadState();
        return state.status === 'ready' && state.format === expectedFormat;
      }, format.toLowerCase(), { timeout: 120_000 });
      const { robot } = await snapshot(page);
      assert.equal(robot.closedLoopConstraints?.length, 1, 'reimport must retain the closed-loop edge');
      assert.ok(Object.values(robot.joints).some(joint => joint.name === 'component_1_right_tip_fixed'),
        'the loop edge must not replace the original structural joint');
      const closure = robot.closedLoopConstraints[0];
      assert.equal(closure.type, 'joint');
      assert.equal(closure.jointType, 'revolute');
      near(closure.limit.lower, -0.1);
      near(closure.limit.upper, 0.1);
      near(closure.axis.y, 1);
      const moved = await drag(page, 'left_drive', 0.7);
      near(angle(moved.robot, 'left_drive'), 0.1);
      await noExportWarning(page);
      await page.screenshot({ path: path.join(outputDir, `${format.toLowerCase()}-reimport.png`) });
      return { linkCount: Object.keys(robot.links).length, closure, drivenAngle: angle(moved.robot, 'left_drive') };
    });
  }
  await runCase('MJCF movable closure warns only after export is requested', async () => {
    await loadRobot(page, fourBar, 'left_drive');
    await bridge(page, { parent: 'coupler', child: 'right_tip', type: 'Revolute', x: 1 });
    assert.doesNotMatch(await page.locator('body').innerText(), /unsupported revolute semantics/);
    await page.getByRole('button', { name: 'File', exact: true }).click();
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    await page.getByRole('button', { name: 'MJCF', exact: true }).click();
    assert.doesNotMatch(await page.locator('body').innerText(), /unsupported revolute semantics/);
    await page.getByRole('button', { name: 'Export ZIP', exact: true }).click();
    await page.getByText(/unsupported revolute semantics/).waitFor();
    assert.equal((await snapshot(page)).robot.closedLoopConstraints[0].jointType, 'revolute');
    return { modelPreserved: true, rejectionAfterExportRequest: true };
  });
  await runCase('MJCF fixed closure exports and reimports as a weld', async () => {
    const physicalFourBar = fourBar.replace(/(<link name="[^"]+">)/g,
      '$1<inertial><mass value="1"/><inertia ixx="0.1" ixy="0" ixz="0" iyy="0.1" iyz="0" izz="0.1"/></inertial>');
    await loadRobot(page, physicalFourBar, 'left_drive');
    await bridge(page, { parent: 'coupler', child: 'right_tip', x: 1 });
    await page.getByRole('button', { name: 'File', exact: true }).click();
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    await page.getByRole('button', { name: 'MJCF', exact: true }).click();
    const download = waitForExportDownload(page);
    await page.getByRole('button', { name: 'Export ZIP', exact: true }).click();
    const archivePath = path.join(outputDir, 'closed-loop-mjcf.zip');
    await (await download).saveAs(archivePath);
    const zip = await JSZip.loadAsync(await readFile(archivePath));
    const xmlFiles = await Promise.all(Object.values(zip.files)
      .filter(file => file.name.endsWith('.xml')).map(file => file.async('string')));
    const xml = xmlFiles.find(text => text.includes('<weld '));
    assert.ok(xml, 'export must contain a native weld');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('input[type=file][accept]').setInputFiles({
      name: 'closed-loop.xml', mimeType: 'application/xml', buffer: Buffer.from(xml),
    });
    await page.waitForFunction(() => window.__URDF_STUDIO_DEBUG__.__workspaceStore__.getState()
      .getSceneProjection().robotData.closedLoopConstraints?.[0]?.jointType === 'fixed');
    const closure = (await snapshot(page)).robot.closedLoopConstraints[0];
    await noExportWarning(page);
    return { closure };
  });
} catch (error) {
  result.push({ passed: false, error: error.stack });
  process.exitCode = 1;
  console.error(error);
  const page = context?.pages()[0];
  if (page && !page.isClosed()) {
    await page.screenshot({ path: path.join(outputDir, 'failure.png') });
    await writeFile(path.join(outputDir, 'failure-ui.txt'), await page.locator('body').ariaSnapshot());
    await writeFile(path.join(outputDir, 'failure-state.json'), JSON.stringify(await snapshot(page), null, 2));
  }
} finally {
  await context?.close();
  await browser?.close();
  await site.stop();
  const reportName = process.env.CLOSED_LOOP_CASE
    ? `results-${process.env.CLOSED_LOOP_CASE.replace(/[^a-z0-9]+/gi, '-')}.json`
    : 'results.json';
  await writeFile(path.join(outputDir, reportName), JSON.stringify(result, null, 2));
  // The legacy cleanup script scans all browsers; limit it to this run's PIDs.
  const originalKill = process.kill;
  process.kill = (pid, signal) => {
    if (!ownedPids.has(Number(pid))) throw new Error('Process belongs to another session');
    return originalKill(pid, signal);
  };
  try { createRequire(import.meta.url)('../../../test/usd-viewer/scripts/cleanup-headless.cjs'); }
  finally { process.kill = originalKill; }
}
