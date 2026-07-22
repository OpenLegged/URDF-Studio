#!/usr/bin/env node

/**
 * Paint Mode browser regression test.
 *
 * Covers: actual surface paint, original-material restore, restore no-op,
 *         and switching back to select mode.
 */

import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import {
  createSession, createTestSuite, assert,
  importModel, waitForReady, getBestProjectedInteractionTarget, clickCanvasTarget,
  store, writeReport, printSummary,
} from './helpers/urdf-helpers.mjs';

const FIXTURE_DIR = path.resolve('scripts/test/fixtures/paint_restore');
const PAINT_TARGET_FILTERS = {
  type: 'link',
  subType: 'visual',
  targetKind: 'geometry',
};

async function getStablePaintTarget(page) {
  let previousTarget = null;

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const currentTarget = await getBestProjectedInteractionTarget(page, PAINT_TARGET_FILTERS);
    if (
      currentTarget &&
      previousTarget &&
      Math.hypot(
        currentTarget.clientX - previousTarget.clientX,
        currentTarget.clientY - previousTarget.clientY,
      ) <= 1
    ) {
      return currentTarget;
    }

    previousTarget = currentTarget;
    await delay(100);
  }

  return previousTarget;
}

async function getPaintGeometryState(page) {
  return page.evaluate(() => {
    const snapshot = window.__URDF_STUDIO_DEBUG__?.getRegressionSnapshot?.();
    const visual = snapshot?.store?.links?.find((link) => link.name === 'base_link')?.visual;
    const runtimeMesh = snapshot?.runtime?.visualMeshes?.find((mesh) => mesh.link === 'base_link');
    return {
      authoredMaterials: visual?.authoredMaterials ?? [],
      meshMaterialGroups: visual?.meshMaterialGroups ?? [],
      runtimeMaterials: runtimeMesh?.materials ?? [],
    };
  });
}

async function setRestoreOperation(page) {
  const clicked = await page.evaluate(() => {
    const button = document.querySelector('[data-paint-operation="erase"]');
    button?.click();
    return Boolean(button);
  });
  if (!clicked) {
    throw new Error('Could not find the paint restore operation button.');
  }
  await page.waitForSelector('[data-paint-operation="erase"][aria-pressed="true"]');
}

async function main() {
  const suite = createTestSuite('Paint Mode');
  const session = await createSession();
  const { page } = session;

  try {
    await importModel(page, FIXTURE_DIR, 'paint_restore.urdf');
    await waitForReady(page);

    const initialState = await getPaintGeometryState(page);
    assert(suite, initialState.meshMaterialGroups.length === 0, 'fixture starts unpainted');

    // ── 1. Switch to paint mode ──
    const paintResult = await store.setViewerToolMode(page, 'paint');
    assert(suite, paintResult?.ok, 'tool mode → paint accepted');
    await page.waitForSelector('[data-paint-operation="paint"][aria-pressed="true"]');

    const target = await getStablePaintTarget(page);
    assert(suite, Boolean(target), 'paintable visual target projected');
    if (!target) throw new Error('No paintable visual target was projected.');

    // ── 2. Paint an actual surface ──
    await clickCanvasTarget(page, target);
    await page.waitForFunction(() => {
      const snapshot = window.__URDF_STUDIO_DEBUG__?.getRegressionSnapshot?.();
      const visual = snapshot?.store?.links?.find((link) => link.name === 'base_link')?.visual;
      return (visual?.meshMaterialGroups?.length ?? 0) > 0;
    });
    const paintedState = await getPaintGeometryState(page);
    assert(suite, paintedState.meshMaterialGroups.length > 0, 'surface paint creates face groups');
    assert(suite, paintedState.authoredMaterials.length === 2, 'paint stores base and paint slots');

    // ── 3. Restore the clicked surface to its actual base ──
    await setRestoreOperation(page);
    const restoreTarget = await getStablePaintTarget(page);
    assert(suite, Boolean(restoreTarget), 'restore target projected after paint');
    if (!restoreTarget) throw new Error('No restore target was projected.');
    await clickCanvasTarget(page, restoreTarget);
    await page.waitForFunction(() => {
      const snapshot = window.__URDF_STUDIO_DEBUG__?.getRegressionSnapshot?.();
      const visual = snapshot?.store?.links?.find((link) => link.name === 'base_link')?.visual;
      return (visual?.meshMaterialGroups?.length ?? 0) === 0 &&
        (visual?.authoredMaterials?.length ?? 0) === 1;
    });
    await page.mouse.move(2, 2);
    await delay(200);
    const restoredState = await getPaintGeometryState(page);
    assert(suite, restoredState.meshMaterialGroups.length === 0, 'restore removes paint groups');
    assert(suite, restoredState.authoredMaterials.length === 1, 'restore compacts paint palette');
    assert(
      suite,
      restoredState.authoredMaterials[0]?.color === '#336699',
      'restore preserves actual runtime base color',
    );
    assert(
      suite,
      Math.abs((restoredState.authoredMaterials[0]?.opacity ?? 0) - 0.75) < 1e-6,
      'restore preserves actual runtime base opacity',
    );
    assert(
      suite,
      restoredState.runtimeMaterials.some(
        (material) => material.color === '#336699' && Math.abs((material.opacity ?? 0) - 0.75) < 1e-6,
      ),
      'runtime material returns to the original color and opacity',
    );

    // ── 4. Restoring again is a no-op with an explicit message ──
    const beforeSecondRestore = JSON.stringify(restoredState);
    const secondRestoreTarget = await getStablePaintTarget(page);
    assert(suite, Boolean(secondRestoreTarget), 'second restore target projected');
    if (!secondRestoreTarget) throw new Error('No second restore target was projected.');
    await clickCanvasTarget(page, secondRestoreTarget);
    await delay(300);
    await page.mouse.move(2, 2);
    const afterSecondRestore = await getPaintGeometryState(page);
    assert(
      suite,
      JSON.stringify(afterSecondRestore) === beforeSecondRestore,
      'second restore does not publish a material update',
    );
    const noRestoreMessageVisible = await page.evaluate(() =>
      [...document.querySelectorAll('div')].some((candidate) =>
        /no paint to restore|没有可恢复的涂色/i.test(candidate.textContent ?? ''),
      ),
    );
    assert(suite, noRestoreMessageVisible, 'second restore explains that nothing can be restored');

    // ── 5. Verify no errors in paint mode ──
    const errs1 = session.errors();
    assert(suite, errs1.page.length === 0, 'no errors in paint mode');

    // ── 6. Switch to face mode ──
    const faceResult = await store.setViewerToolMode(page, 'face');
    assert(suite, faceResult?.ok, 'tool mode → face accepted');
    await delay(200);

    // ── 7. Switch back to select mode ──
    const selectResult = await store.setViewerToolMode(page, 'select');
    assert(suite, selectResult?.ok, 'tool mode → select accepted');

    const errs = session.errors();
    assert(suite, errs.page.length === 0, 'no page errors overall');
  } finally {
    await session.cleanup();
  }

  await writeReport('paint_mode', {});
  process.exitCode = printSummary(suite) ? 0 : 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
