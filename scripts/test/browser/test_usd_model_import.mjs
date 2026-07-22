#!/usr/bin/env node

/**
 * USD/USDA Model Import browser regression test.
 *
 * Verifies seed-and-load import for USD and USDA model fixtures
 * using the regression debug API.
 */

import {
  createSession, createTestSuite, assert, assertEqual, assertGreaterThan,
  waitForReady, getTopology, getRuntimeTransforms,
  importUnitreeModel, writeReport, printSummary,
} from './helpers/usd-helpers.mjs';
import { resolveUploadedRobotFileName } from './helpers/zip-import-helpers.mjs';
import { triggerRobotLoad, uploadFile } from '../helpers/browser-helpers.mjs';

import path from 'node:path';

const MODELS = [
  { key: 'Go2', label: 'Go2 USD' },
];
const USD_IMPORT_TIMEOUT_MS = 180_000;

const USDA_FIXTURES = [
  {
    label: 'g1_29dof_with_hand USDA',
    filePath: path.resolve(
      'test/unitree_ros_usda/g1_description/configuration/g1_29dof_with_hand_base.usda',
    ),
    loadFileName: 'g1_29dof_with_hand_base.usda',
  },
];

async function getUsdLoadSignals(page) {
  const runtimeTransforms = await getRuntimeTransforms(page);
  const state = await page.evaluate(() => {
    const api = window.__URDF_STUDIO_DEBUG__;
    const snap = api?.getRegressionSnapshot?.();
    const load = api?.getDocumentLoadState?.();
    return { selectedFile: snap?.selectedFile ?? null, loadState: load ?? null };
  });
  return { runtimeTransforms, state };
}

async function waitForUsdRuntimeTransforms(page, timeoutMs = 60_000) {
  return page
    .waitForFunction(
      () => {
        const transforms = window.__URDF_STUDIO_DEBUG__?.getRuntimeSceneTransforms?.();
        return Object.values(transforms?.links ?? {}).length > 0;
      },
      { timeout: timeoutMs },
    )
    .then(() => true)
    .catch(() => false);
}

async function importSingleUsdFile(page, fixture, timeoutMs = 180_000) {
  await uploadFile(page, fixture.filePath, timeoutMs);
  const resolvedFileName = await resolveUploadedRobotFileName(page, fixture.loadFileName, timeoutMs);
  await triggerRobotLoad(page, resolvedFileName, timeoutMs);
  return resolvedFileName;
}

async function main() {
  const suite = createTestSuite('USD/USDA Model Import');
  const session = await createSession();
  const results = [];

  try {
    // ── USD models via importUnitreeModel ──
    for (const { key, label } of MODELS) {
      console.log(`\n── ${label} ──`);
      try {
        await importUnitreeModel(session.page, key, USD_IMPORT_TIMEOUT_MS);
        await waitForReady(session.page, USD_IMPORT_TIMEOUT_MS);
        await waitForUsdRuntimeTransforms(session.page, USD_IMPORT_TIMEOUT_MS);
        const topo = await getTopology(session.page);
        const { runtimeTransforms, state } = await getUsdLoadSignals(session.page);

        assertGreaterThan(suite, topo.linkCount, 0, `${label}: links > 0 (${topo.linkCount})`);
        assertGreaterThan(suite, runtimeTransforms.length, 0, `${label}: runtime transforms present`);
        assert(suite, state.selectedFile?.format === 'usd', `${label}: selected file is USD`);
        assert(suite, state.loadState?.format === 'usd', `${label}: load state is USD`);
        assertGreaterThan(suite, topo.jointCount, 0, `${label}: joints > 0 (${topo.jointCount})`);

        results.push({
          model: label,
          status: 'ok',
          linkCount: topo.linkCount,
          jointCount: topo.jointCount,
          runtimeTransforms: runtimeTransforms.length,
          selectedFile: state.selectedFile?.name ?? null,
        });
      } catch (err) {
        assert(suite, false, `${label}: import succeeded — ${err.message}`);
        results.push({ model: label, status: 'error', error: err.message });
      }
    }

    // ── USDA fixtures via direct importModel ──
    for (const fixture of USDA_FIXTURES) {
      console.log(`\n── ${fixture.label} ──`);
      try {
        // Navigate to fresh page for new seed
        await session.page.reload({ waitUntil: 'domcontentloaded' });
        await session.page.waitForFunction(
          () => Boolean(window.__URDF_STUDIO_DEBUG__),
          { timeout: 30_000 },
        );
        await session.page.evaluate(() => window.__URDF_STUDIO_DEBUG__?.setBeforeUnloadPromptEnabled?.(false));

        const resolvedFileName = await importSingleUsdFile(session.page, fixture);
        await waitForReady(session.page, 180_000);
        await waitForUsdRuntimeTransforms(session.page);
        const topo = await getTopology(session.page);
        const { runtimeTransforms, state } = await getUsdLoadSignals(session.page);

        assertGreaterThan(suite, topo.linkCount, 0, `${fixture.label}: links > 0 (${topo.linkCount})`);
        assertGreaterThan(suite, runtimeTransforms.length, 0, `${fixture.label}: runtime transforms present`);
        assertEqual(suite, state.selectedFile?.name, resolvedFileName, `${fixture.label}: selected file matches upload`);
        assert(suite, state.selectedFile?.format === 'usd', `${fixture.label}: selected file is USD`);
        assert(suite, state.loadState?.format === 'usd', `${fixture.label}: load state is USD`);
        assertGreaterThan(
          suite,
          topo.jointCount,
          0,
          `${fixture.label}: joints > 0 (${topo.jointCount})`,
        );

        results.push({
          model: fixture.label,
          status: 'ok',
          linkCount: topo.linkCount,
          jointCount: topo.jointCount,
          runtimeTransforms: runtimeTransforms.length,
          selectedFile: state.selectedFile?.name ?? null,
        });
      } catch (err) {
        assert(suite, false, `${fixture.label}: import succeeded — ${err.message}`);
        results.push({ model: fixture.label, status: 'error', error: err.message });
      }
    }

    const errs = session.errors();
    assert(suite, errs.page.length === 0, `no page errors (${errs.page.length})`);
  } finally {
    await session.cleanup();
  }

  await writeReport('usd_model_import', { results });
  process.exitCode = printSummary(suite) ? 0 : 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
