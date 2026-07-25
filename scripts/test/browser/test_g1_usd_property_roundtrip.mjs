#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import JSZip from 'jszip';
import {
  createSession, createTestSuite, assert, assertEqual, assertGreaterThan,
  importModel, waitForReady, getTopology, writeReport, printSummary, store,
} from './helpers/urdf-helpers.mjs';

const MODEL_DIR = path.resolve('C:/Users/jackmin/Documents/yuanqi_project/robot_model/unitree_ros/robots/g1_description');
const MODEL_FILE = 'g1_29dof.urdf';

async function prepareDownloadCapture(page) {
  const dir = path.resolve(`tmp/regression/g1_usd_property_download_${process.pid}_${Date.now()}`);
  await fs.mkdir(dir, { recursive: true });
  const client = await page.target().createCDPSession();
  await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: dir });
  return dir;
}

async function openExportDialog(page) {
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => /文件|\bfile\b/i.test(`${x.textContent ?? ''} ${x.getAttribute('aria-label') ?? ''}`));
    b?.click();
  });
  await delay(200);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('[role="menu"] button, [role="menuitem"], button')]
      .find((x) => /^(导出|export)$/i.test(x.textContent?.trim() ?? ''));
    b?.click();
  });
  await page.waitForSelector('[data-export-format-picker]', { timeout: 45_000 });
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('[data-export-format-picker] button')]
      .find((x) => /^USD$/i.test(x.textContent?.trim() ?? ''));
    b?.click();
  });
  await delay(150);
  await page.evaluate(() => {
    const usda = [...document.querySelectorAll('[data-usd-file-format-picker] button')]
      .find((x) => /^USDA$/i.test(x.textContent?.trim() ?? ''));
    usda?.click();
  });
  await delay(150);
}

async function exportZip(page, downloadDir) {
  await openExportDialog(page);
  await page.evaluate(() => {
    const buttons = [...document.querySelectorAll('button')];
    const b = buttons.reverse().find((x) => !x.disabled && !x.closest('[data-export-format-picker]') && /导出|export/i.test(x.textContent?.trim() ?? ''));
    b?.click();
  });
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const names = await fs.readdir(downloadDir).catch(() => []);
    const zipName = names.find((n) => n.endsWith('.zip') && !n.endsWith('.crdownload'));
    if (zipName) return path.join(downloadDir, zipName);
    await delay(500);
  }
  throw new Error(`timed out waiting for export in ${downloadDir}`);
}

async function readUsda(zipPath) {
  const zip = await JSZip.loadAsync(await fs.readFile(zipPath));
  const files = Object.values(zip.files).filter((f) => !f.dir);
  const usdLayers = files.filter((f) => /\.usda$/i.test(f.name));
  if (!usdLayers.length) throw new Error('archive contains no USDA layer');
  const text = (await Promise.all(usdLayers.map((f) => f.async('string')))).join('\n');
  return { text, entryNames: files.map((f) => f.name) };
}

function numberPattern(value) {
  return String(value).replace('.', '\\.');
}

async function main() {
  const suite = createTestSuite('G1 USD property roundtrip');
  const report = { modelDir: MODEL_DIR, modelFile: MODEL_FILE, steps: [] };
  let session;
  try {
    session = await createSession();
    const { page } = session;
    await importModel(page, MODEL_DIR, MODEL_FILE, 180_000);
    await waitForReady(page, 180_000);
    const topology = await getTopology(page);
    assertGreaterThan(suite, topology.linkCount, 20, 'G1 links loaded');
    assertGreaterThan(suite, topology.jointCount, 20, 'G1 joints loaded');

    const target = await page.evaluate(() => {
      const links = window.__URDF_STUDIO_DEBUG__?.__workspaceStore__?.getState?.()?.getSceneProjection?.()?.robotData?.links ?? {};
      const link = Object.values(links).find((x) => x?.visual?.type === 'mesh' && x?.visual?.meshPath && x?.inertial?.mass > 0);
      return link ? { id: link.id, name: link.name, visual: link.visual, inertial: link.inertial } : null;
    });
    assert(suite, Boolean(target), 'mesh link with inertial mass found');
    report.target = target;

    const baselineDir = await prepareDownloadCapture(page);
    const baselineZip = await exportZip(page, baselineDir);
    const baseline = await readUsda(baselineZip);
    report.steps.push({ name: 'baseline-export', zip: baselineZip, entries: baseline.entryNames.length });
    assert(suite, baseline.text.includes(`urdf:linkId = \"${target.id}\"`), 'baseline USDA contains target link');

    const nextVisual = {
      ...target.visual,
      dimensions: { x: 1.05, y: 0.95, z: 1.1 },
      origin: { ...target.visual.origin, xyz: { x: 0.011, y: -0.022, z: 0.033 } },
    };
    const nextInertial = { ...target.inertial, mass: Number((target.inertial.mass * 1.07).toFixed(6)) };
    const updateResult = await store.updateLink(page, target.id, { visual: nextVisual, inertial: nextInertial });
    assert(suite, updateResult?.ok !== false, 'property update dispatched');
    await page.waitForFunction((id, expectedMass) => {
      const links = window.__URDF_STUDIO_DEBUG__?.__workspaceStore__?.getState?.()?.getSceneProjection?.()?.robotData?.links ?? {};
      const link = links[id];
      return link?.visual?.dimensions?.x === 1.05 && link?.visual?.origin?.xyz?.y === -0.022 && link?.inertial?.mass === expectedMass;
    }, { timeout: 30_000 }, target.id, nextInertial.mass);
    const afterState = await page.evaluate((id) => {
      const links = window.__URDF_STUDIO_DEBUG__?.__workspaceStore__?.getState?.()?.getSceneProjection?.()?.robotData?.links ?? {};
      const link = links[id];
      return { visual: link?.visual, mass: link?.inertial?.mass };
    }, target.id);
    report.steps.push({ name: 'property-edit', afterState });
    assertEqual(suite, afterState.visual.dimensions.x, 1.05, 'mesh scale X stored');
    assertEqual(suite, afterState.visual.origin.xyz.y, -0.022, 'mesh position Y stored');
    assertEqual(suite, afterState.mass, nextInertial.mass, 'mass stored');

    const modifiedDir = await prepareDownloadCapture(page);
    const modifiedZip = await exportZip(page, modifiedDir);
    const modified = await readUsda(modifiedZip);
    report.steps.push({ name: 'modified-export', zip: modifiedZip, entries: modified.entryNames.length });
    const targetBlock = modified.text.slice(modified.text.indexOf(`urdf:linkId = \"${target.id}\"`) - 1200, modified.text.indexOf(`urdf:linkId = \"${target.id}\"`) + 1200);
    const massFound = new RegExp(`physics:mass\\s*=\\s*${numberPattern(nextInertial.mass)}`).test(modified.text);
    assert(suite, massFound, `modified USDA contains physics:mass ${nextInertial.mass}`);
    assert(suite, /xformOp:scale\s*=\s*\(1\.05, 0\.95, 1\.1\)/.test(modified.text), 'modified USDA contains mesh scale');
    assert(suite, /xformOp:translate\s*=\s*\(0\.011, -0\.022, 0\.033\)/.test(targetBlock) || modified.text.includes('(0.011, -0.022, 0.033)'), 'modified USDA contains mesh position');
    report.modifiedChecks = { massFound, scaleFound: /xformOp:scale\s*=\s*\(1\.05, 0\.95, 1\.1\)/.test(modified.text), positionFound: modified.text.includes('(0.011, -0.022, 0.033)') };

    report.errors = session.errors();
  } catch (error) {
    report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
    assert(suite, false, `unexpected error: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    if (session) await session.cleanup();
  }
  await writeReport('g1_usd_property_roundtrip', report);
  process.exitCode = printSummary(suite) ? 0 : 1;
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
