#!/usr/bin/env node

/**
 * Collision Optimization browser regression test.
 *
 * Covers: loading model, collision visibility, opening the optimizer, the
 *         persistent split layout, per-candidate target editing, apply, and
 *         Unitree G1 mesh-to-capsule fitting.
 */

import { setTimeout as delay } from 'node:timers/promises';
import {
  createSession,
  createTestSuite,
  assert,
  assertGreaterThan,
  importModel,
  waitForReady,
  getTopology,
  store,
  writeReport,
  printSummary,
} from './helpers/urdf-helpers.mjs';

async function clickButtonByLabel(page, labels) {
  return page.evaluate((candidateLabels) => {
    const button = Array.from(document.querySelectorAll('button')).find((candidate) => {
      const label = candidate.getAttribute('aria-label') ?? candidate.textContent?.trim();
      return label ? candidateLabels.includes(label) : false;
    });
    button?.click();
    return Boolean(button);
  }, labels);
}

async function getCollisionTypeCounts(page) {
  return page.evaluate(() => {
    const workspace = window.__URDF_STUDIO_DEBUG__?.__workspaceStore__?.getState?.()?.workspace;
    const counts = {};
    Object.values(workspace?.components ?? {}).forEach((component) => {
      Object.values(component?.robot?.links ?? {}).forEach((link) => {
        [link?.collision, ...(link?.collisionBodies ?? [])].forEach((geometry) => {
          const type = geometry?.type;
          if (!type || type === 'none') return;
          counts[type] = (counts[type] ?? 0) + 1;
        });
      });
    });
    return counts;
  });
}

async function getCollisionGeometries(page) {
  return page.evaluate(() => {
    const workspace = window.__URDF_STUDIO_DEBUG__?.__workspaceStore__?.getState?.()?.workspace;
    const geometries = [];
    Object.values(workspace?.components ?? {}).forEach((component) => {
      Object.values(component?.robot?.links ?? {}).forEach((link) => {
        [link?.collision, ...(link?.collisionBodies ?? [])].forEach((geometry) => {
          if (!geometry?.type || geometry.type === 'none') return;
          geometries.push({
            linkName: link.name,
            type: geometry.type,
            dimensions: geometry.dimensions,
          });
        });
      });
    });
    return geometries;
  });
}

async function closeCollisionOptimizer(page) {
  const closed = await page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]');
    const closeButton = Array.from(dialog?.querySelectorAll('button') ?? []).find((button) =>
      ['Close', '关闭'].includes(button.textContent?.trim() ?? ''),
    );
    closeButton?.click();
    return Boolean(closeButton);
  });
  if (closed) {
    await page.waitForSelector('[role="dialog"]', { hidden: true, timeout: 10_000 });
  }
  return closed;
}

async function main() {
  const suite = createTestSuite('Collision Optimization');
  const session = await createSession();
  const { page } = session;

  try {
    await importModel(page, 'a1_description', 'a1.urdf');
    await waitForReady(page);
    const topo = await getTopology(page);
    assert(suite, topo.linkCount > 0, 'model loaded');

    // ── 1. Check collision bodies in topology ──
    const linksWithCollision = topo.links.filter((l) => l.collisionCount > 0);
    assertGreaterThan(suite, linksWithCollision.length, 0, 'links with collision bodies');

    // ── 2. Show collision bodies ──
    const showResult = await store.setViewerFlags(page, { showCollision: true });
    assert(suite, showResult?.ok, 'showCollision flag set');
    await delay(300);

    // ── 3. Verify no errors after collision display ──
    const errs1 = session.errors();
    assert(suite, errs1.page.length === 0, 'no errors after collision display');

    // ── 4. Check collision body counts per link ──
    const topoWithCollision = await getTopology(page);
    const stillHasCollision = topoWithCollision.links.filter((l) => l.collisionCount > 0);
    assert(suite, stillHasCollision.length > 0, 'collision bodies still present after toggle');

    // ── 5. Open collision optimization from the toolbox ──
    const countsBefore = await getCollisionTypeCounts(page);
    assertGreaterThan(suite, countsBefore.box ?? 0, 0, 'fixture contains box collisions');
    assert(
      suite,
      await clickButtonByLabel(page, ['Toolbox', '工具箱']),
      'toolbox button available',
    );
    await page.waitForSelector(
      'button[aria-label="Collision Optimization"], button[aria-label="碰撞体优化"]',
    );
    assert(
      suite,
      await clickButtonByLabel(page, ['Collision Optimization', '碰撞体优化']),
      'optimizer action available',
    );
    await page.waitForSelector(
      '[role="dialog"][aria-label="Collision Optimization"], [role="dialog"][aria-label="碰撞体优化"]',
    );

    // ── 6. Verify the candidates and editor stay side by side ──
    await page.waitForSelector('[data-collision-optimization-layout="split"]');
    const splitLayout = await page.evaluate(() => {
      const candidates = document.querySelector('[data-collision-optimization-panel="candidates"]');
      const editor = document.querySelector('[data-collision-optimization-panel="editor"]');
      const splitter = document.querySelector('[data-collision-optimization-splitter="true"]');
      if (!candidates || !editor || !splitter) return null;
      const dialog = candidates.closest('[role="dialog"]');
      const candidateRect = candidates.getBoundingClientRect();
      const editorRect = editor.getBoundingClientRect();
      const splitterRect = splitter.getBoundingClientRect();
      return {
        dialogWidth: dialog?.getBoundingClientRect().width ?? null,
        candidateWidth: candidateRect.width,
        candidateRight: candidateRect.right,
        candidateTop: candidateRect.top,
        editorLeft: editorRect.left,
        editorTop: editorRect.top,
        splitterLeft: splitterRect.left,
        splitterRight: splitterRect.right,
      };
    });
    assert(suite, splitLayout !== null, 'split panels rendered');
    assert(
      suite,
      splitLayout?.dialogWidth !== null && splitLayout.dialogWidth <= 840,
      'optimizer opens at the compact default width',
    );
    assert(
      suite,
      splitLayout && splitLayout.editorLeft >= splitLayout.candidateRight,
      'editor is positioned to the right of candidates',
    );
    assert(
      suite,
      splitLayout && Math.abs(splitLayout.editorTop - splitLayout.candidateTop) <= 2,
      'split panels share the same top edge',
    );
    assert(
      suite,
      splitLayout &&
        splitLayout.splitterLeft >= splitLayout.candidateRight &&
        splitLayout.splitterRight <= splitLayout.editorLeft,
      'accessible splitter separates the two panels',
    );

    const splitter = await page.$('[data-collision-optimization-splitter="true"]');
    const splitterBox = await splitter?.boundingBox();
    assert(suite, Boolean(splitterBox), 'splitter has a draggable hit area');
    if (splitterBox) {
      await page.mouse.move(
        splitterBox.x + splitterBox.width / 2,
        splitterBox.y + splitterBox.height / 2,
      );
      await page.mouse.down();
      await page.mouse.move(
        splitterBox.x + splitterBox.width / 2 - 80,
        splitterBox.y + splitterBox.height / 2,
        { steps: 4 },
      );
      await page.mouse.up();
    }
    const resizedSplit = await page.evaluate(() => {
      const candidates = document.querySelector('[data-collision-optimization-panel="candidates"]');
      const editor = document.querySelector('[data-collision-optimization-panel="editor"]');
      if (!candidates || !editor) return null;
      return {
        candidateWidth: candidates.getBoundingClientRect().width,
        editorWidth: editor.getBoundingClientRect().width,
      };
    });
    assert(
      suite,
      resizedSplit && splitLayout && resizedSplit.candidateWidth <= splitLayout.candidateWidth - 60,
      'dragging the splitter makes the candidate panel narrower',
    );
    assert(
      suite,
      resizedSplit && resizedSplit.editorWidth >= 400,
      'dragging the splitter gives the released space to the editor',
    );

    // ── 7. Select a Box candidate and change its target type ──
    await page.waitForFunction(
      () =>
        Array.from(
          document.querySelectorAll(
            '[data-collision-optimization-panel="candidates"] button[aria-pressed]',
          ),
        ).some(
          (button) => button.textContent?.includes('BOX') && button.textContent?.includes('CAP'),
        ),
      { timeout: 120_000 },
    );
    const selectedBoxCandidate = await page.evaluate(() => {
      const button = Array.from(
        document.querySelectorAll(
          '[data-collision-optimization-panel="candidates"] button[aria-pressed]',
        ),
      ).find(
        (candidate) =>
          candidate.textContent?.includes('BOX') && candidate.textContent?.includes('CAP'),
      );
      button?.click();
      return Boolean(button);
    });
    assert(suite, selectedBoxCandidate, 'box to capsule candidate can be selected');
    await page.waitForFunction(() =>
      Array.from(
        document.querySelectorAll('[data-collision-optimization-panel="editor"] button'),
      ).some((button) => ['Cylinder', '圆柱体'].includes(button.textContent?.trim() ?? '')),
    );
    assert(
      suite,
      await clickButtonByLabel(page, ['Cylinder', '圆柱体']),
      'selected candidate target changed to cylinder',
    );
    await page.screenshot({
      path: 'tmp/e2e/screenshots/collision_optimization_split.png',
      fullPage: true,
    });

    const rightResizeHandle = await page.$('[role="dialog"] .resize-edge-right');
    const rightResizeBox = await rightResizeHandle?.boundingBox();
    assert(suite, Boolean(rightResizeBox), 'dialog right resize handle is available');
    if (rightResizeBox) {
      await page.mouse.move(
        rightResizeBox.x + rightResizeBox.width / 2,
        rightResizeBox.y + rightResizeBox.height / 2,
      );
      await page.mouse.down();
      await page.mouse.move(
        rightResizeBox.x + rightResizeBox.width / 2 - 400,
        rightResizeBox.y + rightResizeBox.height / 2,
        { steps: 6 },
      );
      await page.mouse.up();
    }
    await delay(100);

    const narrowLayout = await page.evaluate(() => {
      const split = document.querySelector('[data-collision-optimization-layout="split"]');
      const scrollContainer = split?.parentElement;
      const candidates = document.querySelector('[data-collision-optimization-panel="candidates"]');
      const editor = document.querySelector('[data-collision-optimization-panel="editor"]');
      const candidateButton = candidates?.querySelector('button[aria-pressed]');
      if (!scrollContainer || !candidates || !editor || !candidateButton) return null;
      const candidateRect = candidates.getBoundingClientRect();
      const editorRect = editor.getBoundingClientRect();
      const redundantMergeLabel = Array.from(candidateButton.querySelectorAll('span')).some(
        (span) => ['to', '合并为'].includes(span.textContent?.trim() ?? ''),
      );
      const componentLabel = Array.from(candidateButton.querySelectorAll('span')).find((span) =>
        ['Component:', '组件:', '组件：'].some((prefix) =>
          span.textContent?.trim().startsWith(prefix),
        ),
      );
      return {
        clientWidth: scrollContainer.clientWidth,
        scrollWidth: scrollContainer.scrollWidth,
        candidateWidth: candidateRect.width,
        candidateRight: candidateRect.right,
        editorWidth: editorRect.width,
        editorLeft: editorRect.left,
        hasRedundantMergeLabel: redundantMergeLabel,
        componentLabelDisplay: componentLabel ? getComputedStyle(componentLabel).display : null,
        hasImportantShapeFlow:
          candidateButton.textContent?.includes('BOX') &&
          (candidateButton.textContent?.includes('CAP') ||
            candidateButton.textContent?.includes('CYL')),
      };
    });
    assert(
      suite,
      narrowLayout && narrowLayout.scrollWidth <= narrowLayout.clientWidth + 1,
      'narrow window keeps both panels visible without horizontal scrolling',
    );
    assert(
      suite,
      narrowLayout && narrowLayout.editorLeft >= narrowLayout.candidateRight,
      'narrow window preserves the split panel order',
    );
    assert(
      suite,
      narrowLayout && narrowLayout.candidateWidth >= 200 && narrowLayout.editorWidth >= 278,
      'narrow window preserves usable minimum widths for both panels',
    );
    assert(
      suite,
      narrowLayout &&
        !narrowLayout.hasRedundantMergeLabel &&
        narrowLayout.componentLabelDisplay !== 'inline' &&
        narrowLayout.hasImportantShapeFlow,
      'narrow candidates keep the shape flow and hide secondary wording',
    );

    // ── 8. Apply and verify canonical collision geometry changes ──
    assert(
      suite,
      await clickButtonByLabel(page, ['Apply Optimization', '应用优化']),
      'apply optimization action available',
    );
    await page.waitForFunction(
      (boxCountBefore) => {
        const workspace = window.__URDF_STUDIO_DEBUG__?.__workspaceStore__?.getState?.()?.workspace;
        let boxCount = 0;
        Object.values(workspace?.components ?? {}).forEach((component) => {
          Object.values(component?.robot?.links ?? {}).forEach((link) => {
            [link?.collision, ...(link?.collisionBodies ?? [])].forEach((geometry) => {
              if (geometry?.type === 'box') boxCount += 1;
            });
          });
        });
        return boxCount < boxCountBefore;
      },
      { timeout: 30_000 },
      countsBefore.box ?? 0,
    );
    const countsAfter = await getCollisionTypeCounts(page);
    assert(
      suite,
      (countsAfter.box ?? 0) < (countsBefore.box ?? 0),
      'applying optimization reduces box collisions',
    );
    assertGreaterThan(
      suite,
      (countsAfter.capsule ?? 0) + (countsAfter.cylinder ?? 0),
      (countsBefore.capsule ?? 0) + (countsBefore.cylinder ?? 0),
      'applying optimization creates capsule or cylinder collisions',
    );

    // ── 9. Hide collision bodies ──
    const hideResult = await store.setViewerFlags(page, { showCollision: false });
    assert(suite, hideResult?.ok, 'showCollision flag unset');

    // ── 10. Reproduce the Unitree G1 mesh-to-capsule workflow ──
    assert(suite, await closeCollisionOptimizer(page), 'A1 optimizer dialog closes');
    await importModel(page, 'g1_description', 'g1_29dof.urdf', 120_000);
    await waitForReady(page);
    const g1Before = await getCollisionGeometries(page);
    const g1MeshLinks = new Set(
      g1Before.filter((geometry) => geometry.type === 'mesh').map((geometry) => geometry.linkName),
    );
    assert(suite, g1Before.length === 37, 'G1 starts with all 37 collision bodies');
    assert(suite, g1MeshLinks.size === 25, 'G1 starts with 25 mesh collision bodies');

    const showG1Collisions = await store.setViewerFlags(page, {
      showVisual: false,
      showCollision: true,
    });
    assert(suite, showG1Collisions?.ok, 'G1 collision-only view enabled');
    assert(
      suite,
      await clickButtonByLabel(page, ['Toolbox', '工具箱']),
      'G1 toolbox button available',
    );
    await page.waitForSelector(
      'button[aria-label="Collision Optimization"], button[aria-label="碰撞体优化"]',
    );
    assert(
      suite,
      await clickButtonByLabel(page, ['Collision Optimization', '碰撞体优化']),
      'G1 optimizer action available',
    );
    await page.waitForSelector(
      '[role="dialog"][aria-label="Collision Optimization"], [role="dialog"][aria-label="碰撞体优化"]',
    );
    await page.waitForFunction(
      () => {
        const candidates = document.querySelectorAll(
          '[data-collision-optimization-panel="candidates"] button[aria-pressed]',
        );
        const apply = Array.from(document.querySelectorAll('button')).find((button) =>
          ['Apply Optimization', '应用优化'].includes(button.textContent?.trim() ?? ''),
        );
        return candidates.length === 37 && apply && !apply.disabled;
      },
      { timeout: 120_000 },
    );
    assert(
      suite,
      await clickButtonByLabel(page, ['Apply Optimization', '应用优化']),
      'G1 optimization applies',
    );
    await page.waitForFunction(
      () => {
        const workspace = window.__URDF_STUDIO_DEBUG__?.__workspaceStore__?.getState?.()?.workspace;
        return Object.values(workspace?.components ?? {}).every((component) =>
          Object.values(component?.robot?.links ?? {}).every((link) =>
            [link?.collision, ...(link?.collisionBodies ?? [])].every(
              (geometry) => geometry?.type !== 'mesh',
            ),
          ),
        );
      },
      { timeout: 30_000 },
    );

    const g1After = await getCollisionGeometries(page);
    const g1MeshCapsules = g1After.filter(
      (geometry) => geometry.type === 'capsule' && g1MeshLinks.has(geometry.linkName),
    );
    const epsilonSizedCapsules = g1MeshCapsules.filter(
      (geometry) => (geometry.dimensions?.x ?? 0) <= 1e-4 || (geometry.dimensions?.y ?? 0) <= 1e-4,
    );
    const elongatedCapsules = g1MeshCapsules.filter(
      (geometry) => (geometry.dimensions?.y ?? 0) - 2 * (geometry.dimensions?.x ?? 0) > 1e-4,
    );
    const kneeCapsules = g1MeshCapsules.filter((geometry) =>
      ['left_knee_link', 'right_knee_link'].includes(geometry.linkName),
    );
    const elbowCapsules = g1MeshCapsules.filter((geometry) =>
      ['left_elbow_link', 'right_elbow_link'].includes(geometry.linkName),
    );
    const capsuleCountByMeshLink = new Map();
    g1MeshCapsules.forEach((geometry) => {
      capsuleCountByMeshLink.set(
        geometry.linkName,
        (capsuleCountByMeshLink.get(geometry.linkName) ?? 0) + 1,
      );
    });
    const meshLinkSegmentCounts = Array.from(
      g1MeshLinks,
      (linkName) => capsuleCountByMeshLink.get(linkName) ?? 0,
    );
    const segmentedMeshLinkCount = meshLinkSegmentCounts.filter((count) => count > 1).length;
    const nonMeshCollisionCount = g1Before.filter((geometry) => geometry.type !== 'mesh').length;

    assert(
      suite,
      g1After.length === nonMeshCollisionCount + g1MeshCapsules.length,
      'G1 preserves non-mesh collisions while atomically replacing each mesh',
    );
    assert(
      suite,
      g1MeshCapsules.length === 31,
      'G1 approximates 25 meshes with a controlled total of 31 capsules',
    );
    assert(
      suite,
      meshLinkSegmentCounts.every((count) => count >= 1 && count <= 3),
      'every G1 mesh uses between one and three capsule segments',
    );
    assert(
      suite,
      segmentedMeshLinkCount === 6 && Math.max(...meshLinkSegmentCounts) === 2,
      'G1 only splits the six bodies whose fit improves materially',
    );
    assert(
      suite,
      epsilonSizedCapsules.length === 0,
      'G1 mesh capsules retain non-zero fitted dimensions',
    );
    assertGreaterThan(
      suite,
      elongatedCapsules.length,
      14,
      'G1 keeps a distributed humanoid capsule body instead of four balls',
    );
    assert(
      suite,
      kneeCapsules.length === 4 &&
        ['left_knee_link', 'right_knee_link'].every(
          (linkName) =>
            kneeCapsules
              .filter((geometry) => geometry.linkName === linkName)
              .reduce(
                (length, geometry) =>
                  length +
                  Math.max((geometry.dimensions?.y ?? 0) - 2 * (geometry.dimensions?.x ?? 0), 0),
                0,
              ) > 0.22,
        ),
      'G1 knees use two compact capsules while retaining their long body profile',
    );
    assert(
      suite,
      elbowCapsules.length === 2 &&
        elbowCapsules.every(
          (geometry) =>
            (geometry.dimensions?.x ?? 0) > 0.025 &&
            (geometry.dimensions?.x ?? 0) < 0.045 &&
            (geometry.dimensions?.y ?? 0) > 0.13,
        ),
      'G1 elbows follow their principal axes without inflating into balls',
    );
    assert(suite, await closeCollisionOptimizer(page), 'G1 optimizer dialog closes');
    await page.screenshot({
      path: 'tmp/e2e/screenshots/collision_optimization_g1_capsules.png',
      fullPage: true,
    });

    const errs = session.errors();
    assert(suite, errs.page.length === 0, 'no page errors overall');
  } finally {
    await session.cleanup();
  }

  await writeReport('collision_optimization', {});
  process.exitCode = printSummary(suite) ? 0 : 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
