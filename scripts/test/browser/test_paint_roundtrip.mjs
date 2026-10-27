#!/usr/bin/env node

/** Real GUI paint, texture restoration, and downloaded archive roundtrips.
 * URDF_STUDIO_TEST_SITE_URL=http://127.0.0.1:4187 node scripts/test/browser/test_paint_roundtrip.mjs
 * Each import uses a fresh browser context so assets cannot leak across exports.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import JSZip from 'jszip';
import { ensureSite, buildBrowserLaunchArgs, DEFAULT_SITE_URL } from '../helpers/browser-helpers.mjs';
import { zipDir } from './helpers/zip-import-helpers.mjs';

const OUTPUT = path.resolve('tmp/regression/paint-roundtrip');
const FIXTURE = path.resolve('scripts/test/fixtures/paint_textured');
const GREEN = '#00cc44';
const ORANGE = '#ff6c0a';
const FORMATS = (process.env.PAINT_ROUNDTRIP_FORMATS ?? 'USP,URDF,MJCF').split(',').map(format => format.trim().toUpperCase());
if (FORMATS.some(format => !['USP', 'URDF', 'MJCF'].includes(format))) {
  throw new Error('PAINT_ROUNDTRIP_FORMATS must contain USP, URDF, and/or MJCF');
}
const results = { startedAt: new Date().toISOString(), formats: FORMATS, checks: [], exports: {}, browserErrors: [], consoleErrors: [] };
const closeTo = (a, b) => Math.abs(Number(a) - b) < 1e-6;

function check(label, passed, detail = null) {
  results.checks.push({ label, passed: Boolean(passed), detail });
  console.log(`[paint-roundtrip] ${passed ? 'PASS' : 'FAIL'} ${label}`);
}

async function snapshot(page) {
  return page.evaluate(() => window.__URDF_STUDIO_DEBUG__.getRegressionSnapshot());
}

function meshes(s) {
  return (s?.runtime?.visualMeshes ?? []).filter(mesh => mesh.effectiveVisible !== false);
}

function geometry(s) {
  return s.store.links.find(link => link.name === 'base_link')?.visual;
}

function material(s, color) {
  return meshes(s).flatMap(mesh => mesh.materials).find(item => item.color === color);
}

// Native USP keeps face groups; MJCF represents the same partition as separate
// visual meshes. Compare triangle counts by material, not renderer object names.
function facePartition(s) {
  const visual = geometry(s);
  const groups = visual?.meshMaterialGroups ?? [];
  const counts = { textured: 0, [ORANGE]: 0, [GREEN]: 0, unclassified: 0 };
  const classify = (color, textured, triangles) => {
    const key = textured ? 'textured' : color === ORANGE || color === GREEN ? color : 'unclassified';
    counts[key] += triangles;
  };
  if (groups.length) {
    for (const group of groups) {
      const descriptor = visual.authoredMaterials[group.materialIndex];
      classify(descriptor?.color?.slice(0, 7), Boolean(descriptor?.texture), group.count / 3);
    }
  } else {
    for (const mesh of meshes(s)) {
      if (mesh.materials.length !== 1) {
        counts.unclassified += mesh.triangleCount;
        continue;
      }
      const entry = mesh.materials[0];
      classify(entry.color, entry.hasTexture, mesh.triangleCount);
    }
  }
  return counts;
}

async function waitSnapshot(page, predicate, label, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  let last;
  do {
    last = await snapshot(page);
    if (predicate(last)) return last;
    await delay(100);
  } while (Date.now() < deadline);
  await fs.writeFile(path.join(OUTPUT, `timeout-${label}.json`), JSON.stringify(last, null, 2));
  throw new Error(`Timed out: ${label}`);
}

async function evidence(page, label) {
  await page.mouse.move(5, 5);
  const state = await snapshot(page);
  await fs.writeFile(path.join(OUTPUT, `${label}.json`), JSON.stringify(state, null, 2));
  await page.screenshot({ path: path.join(OUTPUT, `${label}.png`) });
  return state;
}

async function newPage(browser, siteUrl) {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1200 }, acceptDownloads: true });
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  page.on('pageerror', error => results.browserErrors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') results.consoleErrors.push(message.text());
  });
  try {
    await page.goto(siteUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => Boolean(window.__URDF_STUDIO_DEBUG__?.getRegressionSnapshot));
    await page.evaluate(() => window.__URDF_STUDIO_DEBUG__.setBeforeUnloadPromptEnabled(false));
    return { context, page };
  } catch (error) {
    await context.close();
    throw error;
  }
}

async function importArchive(page, archive) {
  await page.locator('input[type="file"]:not([webkitdirectory])').first().setInputFiles(archive);
  await waitSnapshot(page, s => /paint_textured/.test(s.store?.name ?? '') && meshes(s).length > 0, 'import', 90_000);
  await page.evaluate(() => window.__URDF_STUDIO_DEBUG__.frameScene());
}

async function clickSurface(page) {
  const point = await page.evaluate(() => window.__URDF_STUDIO_DEBUG__.getProjectedInteractionTargets()
    .filter(target => target.subType === 'visual' && target.targetKind === 'geometry')
    .sort((a, b) => b.projectedArea - a.projectedArea)[0]);
  if (!point || !Number.isFinite(point.clientX) || !Number.isFinite(point.clientY)) {
    throw new Error('No projected visual surface');
  }
  await page.mouse.click(point.clientX, point.clientY);
  await page.mouse.move(5, 5);
}

async function setPaint(page, color, opacity, scope) {
  await page.locator('[data-paint-operation="paint"]').click();
  await page.getByPlaceholder('#ff6c0a80').fill(color);
  await page.getByPlaceholder('#ff6c0a80').press('Tab');
  const panel = page.getByRole('toolbar', { name: /^(Paint|涂色)$/ }).first();
  await panel.locator('input[type="number"]').fill(String(opacity));
  await panel.locator('input[type="number"]').press('Tab');
  await page.getByRole('button', { name: scope === 'face' ? /^(Triangle|单个三角面)$/ : /^(Connected Surface|相连表面)$/ }).click();
}

async function paintChecks(page) {
  const initial = await waitSnapshot(page, s => meshes(s).some(mesh => mesh.materials.some(m => m.hasTexture)), 'initial-texture');
  check('initial OBJ texture is rendered', meshes(initial).some(mesh => mesh.materials.some(m => m.hasTexture)));
  check('initial texture material opacity is 0.75', meshes(initial).some(mesh => mesh.materials.some(m => m.hasTexture && closeTo(m.opacity, 0.75))));
  await evidence(page, '01-original-texture');
  await page.getByRole('toolbar', { name: /^(Toolbar|工具栏)$/ }).getByRole('button', { name: /^(Paint|涂色)$/ }).click();
  await setPaint(page, GREEN, 0.4, 'face');
  await clickSurface(page);
  let state = await waitSnapshot(page, s => material(s, GREEN) && closeTo(material(s, GREEN).opacity, 0.4), 'paint-alpha04');
  check('single triangle gets selected color and opacity 0.4', facePartition(state)[GREEN] === 1);
  check('unpainted triangles retain texture', facePartition(state).textured === 11);
  check('painted triangle overrides base texture', material(state, GREEN)?.hasTexture === false);
  await evidence(page, '02-triangle-alpha04');

  await setPaint(page, GREEN, 1, 'face');
  await clickSurface(page);
  state = await waitSnapshot(page, s => material(s, GREEN) && closeTo(material(s, GREEN).opacity, 1), 'paint-alpha1');
  check('opacity 0.4 to 1 is fully opaque', closeTo(material(state, GREEN).opacity, 1));
  await evidence(page, '03-triangle-alpha1');
  await page.getByTestId('history-undo').click();
  await waitSnapshot(page, s => material(s, GREEN) && closeTo(material(s, GREEN).opacity, 0.4), 'undo');
  check('undo restores opacity 0.4', true);
  await page.getByTestId('history-redo').click();
  await waitSnapshot(page, s => material(s, GREEN) && closeTo(material(s, GREEN).opacity, 1), 'redo');
  check('redo restores opacity 1', true);
  await page.locator('[data-paint-operation="erase"]').click();
  await clickSurface(page);
  state = await waitSnapshot(page, s => !(geometry(s)?.meshMaterialGroups?.length) && meshes(s).some(mesh => mesh.materials.some(m => m.hasTexture)), 'restore-texture');
  check('restore removes paint groups and restores all textured faces', facePartition(state).textured === 12);
  check('restore preserves base opacity 0.75', meshes(state).some(mesh => mesh.materials.some(m => m.hasTexture && closeTo(m.opacity, 0.75))));
  await evidence(page, '04-restored-texture');

  await setPaint(page, ORANGE, 1, 'island');
  await clickSurface(page);
  state = await waitSnapshot(page, s => material(s, ORANGE) && facePartition(s)[ORANGE] === 2, 'paint-island');
  check('connected surface paints two coplanar triangles', facePartition(state)[ORANGE] === 2);
  await setPaint(page, GREEN, 0.4, 'face');
  await clickSurface(page);
  state = await waitSnapshot(page, s => facePartition(s)[GREEN] === 1 && facePartition(s)[ORANGE] === 1, 'mixed-paint');
  check('mixed paint retains ten textured faces', facePartition(state).textured === 10);
  check('mixed paint has opaque orange and translucent green', closeTo(material(state, ORANGE)?.opacity, 1) && closeTo(material(state, GREEN)?.opacity, 0.4));
  await page.getByRole('toolbar', { name: /^(Toolbar|工具栏)$/ }).getByRole('button', { name: /^(Select|选择)$/ }).click();
  return evidence(page, '05-before-export');
}

async function exportArchive(page, format) {
  await page.getByRole('button', { name: /^(File|文件)$/ }).click();
  let download;
  if (format === 'USP') {
    [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 120_000 }),
      page.getByRole('button', { name: /^(Export Project \(\.usp\)|导出工程 \(\.usp\))$/ }).click(),
    ]);
  } else {
    await page.getByRole('button', { name: /^(Export|导出)$/ }).click();
    await page.locator('[data-export-format-picker]').getByRole('button', { name: format, exact: true }).click();
    [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 120_000 }),
      page.getByRole('button', { name: /^(Export ZIP|导出 ZIP)$/ }).click(),
    ]);
  }
  const destination = path.join(OUTPUT, `${format.toLowerCase()}-${download.suggestedFilename()}`);
  await download.saveAs(destination);
  const failure = await download.failure();
  if (failure) throw new Error(failure);
  const zip = await JSZip.loadAsync(await fs.readFile(destination));
  results.exports[format] = { archive: destination, entries: Object.keys(zip.files).sort() };
  await fs.writeFile(path.join(OUTPUT, `${format.toLowerCase()}-archive-entries.json`), JSON.stringify(Object.keys(zip.files).sort(), null, 2));
  return destination;
}

async function roundtrip(browser, siteUrl, archive, format, expected) {
  const { context, page } = await newPage(browser, siteUrl);
  try {
    await importArchive(page, archive);
    await waitSnapshot(page, s => meshes(s).some(mesh => mesh.materials.some(m => m.hasTexture)), `${format}-texture`, 45_000);
    const state = await evidence(page, `roundtrip-${format.toLowerCase()}`);
    const partition = facePartition(state);
    results.exports[format].partition = partition;
    check(`${format}: face material assignments survive`, JSON.stringify(partition) === JSON.stringify(facePartition(expected)), partition);
    check(`${format}: orange color and alpha 1 survive`, closeTo(material(state, ORANGE)?.opacity, 1));
    check(`${format}: green color and alpha 0.4 survive`, closeTo(material(state, GREEN)?.opacity, 0.4));
    check(`${format}: painted faces remain untextured`,
      material(state, ORANGE)?.hasTexture === false && material(state, GREEN)?.hasTexture === false);
    check(`${format}: untouched texture and alpha 0.75 survive`, meshes(state).some(mesh => mesh.materials.some(m => m.hasTexture && closeTo(m.opacity, 0.75))));
    if (format === 'USP') {
      check('USP: canonical face groups survive exactly', JSON.stringify(geometry(state)?.meshMaterialGroups) === JSON.stringify(geometry(expected)?.meshMaterialGroups));
    }
  } finally {
    await context.close();
  }
}

async function main() {
  await fs.mkdir(OUTPUT, { recursive: true });
  const url = new URL(process.env.URDF_STUDIO_TEST_SITE_URL ?? DEFAULT_SITE_URL);
  url.searchParams.set('regressionDebug', '1');
  results.siteUrl = url.toString();
  const site = await ensureSite(url.toString());
  let browser;
  let source;
  try {
    browser = await chromium.launch({
      ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }),
      headless: process.env.URDF_E2E_HEADED !== '1',
      args: buildBrowserLaunchArgs(),
    });
    const fixtureZip = path.join(OUTPUT, 'paint-textured-input.zip');
    await fs.writeFile(fixtureZip, await zipDir(FIXTURE));
    source = await newPage(browser, url.toString());
    await importArchive(source.page, fixtureZip);
    const expected = await paintChecks(source.page);
    for (const format of FORMATS) {
      try {
        const archive = await exportArchive(source.page, format);
        await roundtrip(browser, url.toString(), archive, format, expected);
      } catch (error) {
        check(`${format}: download and fresh-context reimport`, false, error.stack ?? error.message);
        await evidence(source.page, `failure-${format.toLowerCase()}`).catch(() => {});
        await source.page.keyboard.press('Escape').catch(() => {});
      }
    }
  } catch (error) {
    check('paint workflow completes', false, error.stack ?? error.message);
    if (source) await evidence(source.page, 'workflow-failure').catch(() => {});
  } finally {
    await browser?.close();
    await site.stop();
    check('no uncaught browser errors', results.browserErrors.length === 0, results.browserErrors);
    check('no console errors, including texture loads', results.consoleErrors.length === 0, results.consoleErrors);
    results.passed = results.checks.every(item => item.passed);
    await fs.writeFile(path.join(OUTPUT, 'results.json'), JSON.stringify(results, null, 2));
    process.exitCode = results.passed ? 0 : 1;
    console.log(`Results: ${path.join(OUTPUT, 'results.json')}`);
  }
}

await main();
