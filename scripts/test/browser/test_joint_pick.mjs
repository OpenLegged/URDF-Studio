#!/usr/bin/env node

/**
 * Joint-origin Pick browser regression test (Fusion 360 style "Joint").
 *
 * Drives the real interactive flow that the debug-API assembly tests skip:
 * open the bridge modal, click hovered snap/link targets directly in the canvas
 * to fill parent and child, then confirm. Verifies the raycast -> snap resolve
 * -> relation sync -> auto-align pipeline end to end in a real browser.
 */

import { setTimeout as delay } from 'node:timers/promises';
import {
  createSession, createTestSuite, assert, assertEqual, assertGreaterThan,
  waitForReady, getAssemblyState, findAvailableFile, getProjectedInteractionTargets,
  clickCanvasTarget, store, writeReport, printSummary,
} from './helpers/base-helpers.mjs';

const CONFIRM = ['Confirm', '确认'];
const CREATE_BRIDGE = ['Create Bridge', '创建拼接'];
const CYLINDER_FILE = 'joint_pick_stl_cylinder.urdf';
const CYLINDER_MESH_FILE = 'meshes/joint_pick_stl_cylinder.stl';
const BOX_FILE = 'joint_pick_box.urdf';

function buildCylinderStl(radialSegments = 12) {
  const facets = [];
  const radius = 0.6;
  const halfLength = 0.2;
  const point = (index, z) => {
    const angle = (index / radialSegments) * Math.PI * 2;
    return [radius * Math.cos(angle), radius * Math.sin(angle), z];
  };
  const facet = (a, b, c) => {
    facets.push(
      '  facet normal 0 0 0',
      '    outer loop',
      `      vertex ${a.join(' ')}`,
      `      vertex ${b.join(' ')}`,
      `      vertex ${c.join(' ')}`,
      '    endloop',
      '  endfacet',
    );
  };

  for (let index = 0; index < radialSegments; index += 1) {
    const next = (index + 1) % radialSegments;
    // A tiny exporter-like Z jitter exercises tolerant logical-face fitting
    // while remaining visually indistinguishable from a planar cap.
    const topA = point(index, halfLength + (index % 2 === 0 ? 2e-6 : -2e-6));
    const topB = point(next, halfLength + (next % 2 === 0 ? 2e-6 : -2e-6));
    const bottomA = point(index, -halfLength);
    const bottomB = point(next, -halfLength);
    facet([0, 0, halfLength], topA, topB);
    facet([0, 0, -halfLength], bottomB, bottomA);
    facet(bottomA, bottomB, topB);
    facet(bottomA, topB, topA);
  }
  return ['solid joint_pick_stl_cylinder', ...facets, 'endsolid joint_pick_stl_cylinder'].join('\n');
}

const CYLINDER_STL = buildCylinderStl();

const CYLINDER_URDF = `<?xml version="1.0"?>
<robot name="joint_pick_cylinder">
  <link name="base_link">
    <visual>
      <origin xyz="0 0 0" rpy="0 0 0"/>
      <geometry>
        <mesh filename="${CYLINDER_MESH_FILE}"/>
      </geometry>
      <material name="cyan"><color rgba="0.1 0.7 0.9 1"/></material>
    </visual>
  </link>
</robot>`;

const BOX_URDF = `<?xml version="1.0"?>
<robot name="joint_pick_box">
  <link name="base_link">
    <visual>
      <origin xyz="0 0 0" rpy="0 0 0"/>
      <geometry>
        <box size="0.6 0.6 0.6"/>
      </geometry>
      <material name="green"><color rgba="0.1 0.8 0.3 1"/></material>
    </visual>
  </link>
</robot>`;

async function selectionOf(page) {
  return page.evaluate(() => {
    const snap = window.__URDF_STUDIO_DEBUG__?.getRegressionSnapshot?.();
    return snap?.interaction?.selection ?? null;
  });
}

async function seedJointPickFixtures(page) {
  await page.waitForFunction(
    () => Boolean(
      window.__URDF_STUDIO_DEBUG__?.resetFixtureFiles
        && window.__URDF_STUDIO_DEBUG__?.seedFixtureFile
        && window.__URDF_STUDIO_DEBUG__?.loadRobotByName,
    ),
    { timeout: 30_000 },
  );
  await page.evaluate(
    ({ cylinderFile, cylinderMeshFile, cylinderStl, cylinderUrdf, boxFile, boxUrdf }) => {
      const api = window.__URDF_STUDIO_DEBUG__;
      api.resetFixtureFiles();
      const cylinderBlobUrl = URL.createObjectURL(new Blob([cylinderStl], { type: 'model/stl' }));
      api.seedFixtureFile({
        name: cylinderMeshFile,
        content: cylinderStl,
        format: 'mesh',
        blobUrl: cylinderBlobUrl,
      });
      api.seedFixtureFile({
        name: cylinderFile,
        content: cylinderUrdf,
        format: 'urdf',
        addFileContent: true,
      });
      api.seedFixtureFile({
        name: boxFile,
        content: boxUrdf,
        format: 'urdf',
        addFileContent: true,
      });
    },
    {
      cylinderFile: CYLINDER_FILE,
      cylinderMeshFile: CYLINDER_MESH_FILE,
      cylinderStl: CYLINDER_STL,
      cylinderUrdf: CYLINDER_URDF,
      boxFile: BOX_FILE,
      boxUrdf: BOX_URDF,
    },
  );
  // Fire-and-forget: awaiting loadRobotByName inside page.evaluate destroys
  // the evaluate's execution context when the load triggers an SPA navigation,
  // so the evaluate never resolves and Puppeteer times out
  // (Runtime.callFunctionOn timed out). Trigger it without awaiting, then poll
  // for the loaded robot name instead.
  await loadFixtureModel(page, CYLINDER_FILE);
}

async function loadFixtureModel(page, fileName) {
  await page.evaluate((nextFileName) => {
    void window.__URDF_STUDIO_DEBUG__.loadRobotByName(nextFileName);
  }, fileName);
  await page.waitForFunction(
    (expectedFileName) => {
      const api = window.__URDF_STUDIO_DEBUG__;
      const selectedFile = api?.__assetsStore__?.getState?.()?.selectedFile ?? null;
      const workspace = api?.__workspaceStore__?.getState?.()?.workspace ?? null;
      return String(selectedFile?.name ?? '').endsWith(expectedFileName) &&
        Object.values(workspace?.components ?? {}).some((component) =>
          String(component?.sourceFile ?? '').endsWith(expectedFileName));
    },
    { timeout: 60_000 },
    fileName,
  );
  await waitForReady(page);
}

async function jointPickSession(page) {
  return page.evaluate(() => {
    const state = window.__URDF_STUDIO_DEBUG__?.__jointPickSessionStore__?.getState?.();
    return state
      ? {
          active: state.active,
          side: state.side,
          parentSnap: state.parentSnap,
          childSnap: state.childSnap,
        }
      : null;
  });
}

async function waitForSnapKind(page, side, kind, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  const key = side === 'parent' ? 'parentSnap' : 'childSnap';
  let last = null;
  while (Date.now() < deadline) {
    last = await jointPickSession(page);
    if (last?.[key]?.kind === kind) return last[key];
    await delay(150);
  }
  throw new Error(`Timed out waiting for ${side} snap kind ${kind}; last=${JSON.stringify(last)}`);
}

async function hoverCandidateRegion(page, target, componentId, timeoutMs = 5000) {
  await page.mouse.move(target.clientX, target.clientY);
  await page.waitForFunction(
    (expectedComponentId) =>
      (window.__URDF_STUDIO_DEBUG__?.getJointPickHoverSummary?.() ?? [])
        .some((summary) =>
          summary.componentId === expectedComponentId
          && summary.valid
          && summary.triangleCount > 0
          && summary.candidateCount > 0),
    { timeout: timeoutMs },
    componentId,
  );
  return page.evaluate((expectedComponentId) =>
    (window.__URDF_STUDIO_DEBUG__?.getJointPickHoverSummary?.() ?? [])
      .find((summary) => summary.componentId === expectedComponentId) ?? null,
  componentId);
}

// Click an empty canvas spot to clear any pre-existing selection so the bridge
// modal's selection-sync does not swallow the first relation pick.
async function clearViewerSelection(page) {
  const rect = await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    if (!(canvas instanceof HTMLCanvasElement)) return null;
    const r = canvas.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  if (!rect) return;
  for (const [fx, fy] of [[0.06, 0.94], [0.94, 0.06], [0.06, 0.06]]) {
    await page.mouse.click(rect.x + rect.w * fx, rect.y + rect.h * fy);
    await delay(250);
    const sel = await selectionOf(page);
    if (!sel || !sel.id) return;
  }
}

async function clickByTitle(page, titles) {
  return page.evaluate((wanted) => {
    const normalizedWanted = new Set([...wanted, 'create-bridge'].map((value) => value.toLowerCase()));
    const button = [...document.querySelectorAll('button')].find((candidate) =>
      [candidate.title, candidate.getAttribute('aria-label'), candidate.textContent]
        .some((value) => normalizedWanted.has(String(value ?? '').trim().toLowerCase())));
    if (button instanceof HTMLElement) { button.click(); return true; }
    return false;
  }, titles);
}

async function clickButton(page, texts) {
  return page.evaluate((wanted) => {
    const button = Array.from(document.querySelectorAll('button')).find(
      (element) => wanted.includes(element.textContent?.trim()) && !element.disabled,
    );
    if (button instanceof HTMLElement) { button.click(); return true; }
    return false;
  }, texts);
}

async function waitForBridgeModal(page, timeoutMs = 8000) {
  try {
    await page.waitForSelector('[data-bridge-section-panel="relation"]', { timeout: timeoutMs });
    return true;
  } catch {
    return false;
  }
}

async function targetsForComponent(page, componentId, _allIds, modalSafeMaxX) {
  const targets = await getProjectedInteractionTargets(page, { type: 'link' });
  return page.evaluate(
    ({ nextTargets, expectedComponentId, maxX }) => {
      const projection = window.__URDF_STUDIO_DEBUG__?.__workspaceStore__
        ?.getState?.()
        ?.getSceneProjection?.();
      return nextTargets.filter((target) => {
        const ref = projection?.globalToEntityRef?.get(target.id) ?? null;
        return ref?.type === 'link' && ref.componentId === expectedComponentId &&
          Number(target.clientX) < maxX;
      });
    },
    { nextTargets: targets, expectedComponentId: componentId, maxX: modalSafeMaxX },
  );
}

async function focusComponent(page, componentId) {
  await page.evaluate((nextComponentId) => {
    window.__URDF_STUDIO_DEBUG__?.__selectionStore__?.getState?.()?.focusOn?.({
      type: 'component',
      componentId: nextComponentId,
    });
  }, componentId);
  await delay(700);
}

// Wait until a component has projected at least `minCount` pickable link targets,
// so we never sample mid-(re)projection after moving/loading it.
async function waitForComponentTargets(page, componentId, allIds, modalSafeMaxX, minCount, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let last = 0;
  while (Date.now() < deadline) {
    last = (await targetsForComponent(page, componentId, allIds, modalSafeMaxX)).length;
    if (last >= minCount) return last;
    await delay(300);
  }
  return last;
}

async function main() {
  const suite = createTestSuite('Joint Pick');
  const session = await createSession();
  const { page } = session;
  const viewportWidth = await page.evaluate(() => window.innerWidth);
  // Keep picks clear of the top-right bridge modal (~600px wide).
  const modalSafeMaxX = viewportWidth - 640;

  try {
    // ── Two-component assembly with controlled primitive snap surfaces ──
    await seedJointPickFixtures(page);
    await loadFixtureModel(page, BOX_FILE);
    // `seedJointPickFixtures` already loaded/cached the cylinder. Reloading that
    // same source after the box can race the selected-file/workspace handoff;
    // the assembly helper only needs both source robots in its cache.

    await store.initAssembly(page, 'joint_pick_asm'); await delay(300);
    const cylinderFile = await findAvailableFile(page, CYLINDER_FILE);
    const boxFile = await findAvailableFile(page, BOX_FILE);
    const compA = await store.addComponent(page, cylinderFile); await delay(500);
    const compB = await store.addComponent(page, boxFile); await delay(800);
    assert(suite, compA.ok && compB.ok, 'two components added');
    assertEqual(suite, (await getAssemblyState(page)).componentCount, 2, '2 components');
    const allIds = [compA.id, compB.id];

    // Separate the child sideways so both render fully (no occlusion) and stay
    // left of the top-right modal.
    await store.updateComponentTransform(page, compB.id, {
      position: { x: -1.2, y: 0, z: 0 }, rotation: { r: 0, p: 0, y: 0 },
    });
    await delay(1000);

    // ── Clear selection, then open the bridge modal ──
    await clearViewerSelection(page);
    assert(suite, await clickByTitle(page, CREATE_BRIDGE), 'create-bridge button clicked');
    assert(suite, await waitForBridgeModal(page, 10000), 'bridge modal open with compact geometry UI');
    const initialModalProbe = await page.evaluate(() => {
      const relation = document.querySelector('[data-bridge-section-panel="relation"]');
      const footer = document.querySelector('[data-bridge-footer]');
      const windowRoot = footer?.parentElement ?? null;
      const rect = windowRoot?.getBoundingClientRect() ?? null;
      return {
        advanced: document.querySelector('[data-bridge-advanced]')?.getAttribute('data-bridge-advanced'),
        geometryRails: relation?.querySelectorAll('[data-bridge-endpoint-rail]').length ?? 0,
        height: rect?.height ?? 0,
        inputMode: relation?.getAttribute('data-bridge-input-mode'),
        linkEndpoints: relation?.querySelectorAll('[data-bridge-link-endpoint]').length ?? 0,
        width: rect?.width ?? 0,
      };
    });
    assert(
      suite,
      initialModalProbe.width >= 400 && initialModalProbe.width <= 440
        && initialModalProbe.height >= 460 && initialModalProbe.height <= 500,
      `bridge modal uses compact 420x480 footprint; probe=${JSON.stringify(initialModalProbe)}`,
    );
    assertEqual(suite, initialModalProbe.inputMode, 'geometry', 'geometry snap is the default mode');
    assertEqual(suite, initialModalProbe.geometryRails, 2, 'geometry mode shows two endpoint rails');
    assertEqual(suite, initialModalProbe.linkEndpoints, 0, 'geometry mode hides link dropdowns');
    assertEqual(suite, initialModalProbe.advanced, 'expanded', 'advanced settings start expanded');
    const customBridgeName = 'editable_stl_joint';

    const switchedModes = await page.evaluate(() => {
      const relation = document.querySelector('[data-bridge-section-panel="relation"]');
      const modeButtons = relation?.querySelectorAll('[role="radiogroup"] [role="radio"]');
      const linkButton = modeButtons?.item(1);
      if (!(linkButton instanceof HTMLButtonElement)) return false;
      linkButton.click();
      return true;
    });
    assert(suite, switchedModes, 'switch to Link-list mode');
    await page.waitForFunction(() =>
      document.querySelector('[data-bridge-section-panel="relation"]')
        ?.getAttribute('data-bridge-input-mode') === 'link',
    );
    const linkModeProbe = await page.evaluate(() => {
      const relation = document.querySelector('[data-bridge-section-panel="relation"]');
      return {
        active: window.__URDF_STUDIO_DEBUG__?.__jointPickSessionStore__?.getState?.()?.active,
        geometryRails: relation?.querySelectorAll('[data-bridge-endpoint-rail]').length ?? 0,
        linkEndpoints: relation?.querySelectorAll('[data-bridge-link-endpoint]').length ?? 0,
      };
    });
    assertEqual(suite, linkModeProbe.linkEndpoints, 2, 'Link-list mode has one selector per endpoint');
    assertEqual(suite, linkModeProbe.geometryRails, 0, 'Link-list mode hides geometry rails');
    assertEqual(suite, linkModeProbe.active, false, 'Link-list mode disables canvas snap picking');

    await page.evaluate(() => {
      const relation = document.querySelector('[data-bridge-section-panel="relation"]');
      const geometryButton = relation
        ?.querySelectorAll('[role="radiogroup"] [role="radio"]')
        .item(0);
      if (geometryButton instanceof HTMLButtonElement) geometryButton.click();
    });
    await page.waitForFunction(() =>
      document.querySelector('[data-bridge-section-panel="relation"]')
        ?.getAttribute('data-bridge-input-mode') === 'geometry'
      && window.__URDF_STUDIO_DEBUG__?.__jointPickSessionStore__?.getState?.()?.active === true,
    );
    assert(suite, true, 'switching back restores geometry snap picking');
    const hasOldSidePickers = await page.evaluate(() =>
      ['Pick parent', 'Pick child', '拾取父侧', '拾取子侧'].some((text) =>
        document.body.textContent?.includes(text),
      ),
    );
    assert(suite, !hasOldSidePickers, 'old parent/child pick buttons are not rendered');
    const initialJointPick = await jointPickSession(page);
    assert(suite, initialJointPick?.active === true, 'snap hover session active immediately');

    // ── Pick each component directly; the snap click also fills relation sides ──
    // Focus each component before sampling so the projected target point stays
    // inside the canvas after switching from a single model to an assembly.
    await focusComponent(page, compA.id);
    await waitForComponentTargets(page, compA.id, allIds, modalSafeMaxX, 1);
    const parentTargets = await targetsForComponent(page, compA.id, allIds, modalSafeMaxX);
    assertGreaterThan(suite, parentTargets.length, 0, 'parent link targets projected');
    const parentTarget = parentTargets[0];

    const parentHover = await hoverCandidateRegion(page, parentTarget, compA.id);
    assert(
      suite,
      parentHover?.triangleCount > 1 && parentHover?.boundaryLoopCount > 0,
      `hover renders a connected candidate region; summary=${JSON.stringify(parentHover)}`,
    );
    assertGreaterThan(
      suite,
      parentHover?.candidateCount ?? 0,
      1,
      'hover exposes multiple smart candidate points',
    );
    assert(
      suite,
      parentHover?.featureKind === 'planar' && parentHover?.truncated === false,
      `real non-indexed STL cap resolves as a complete logical planar feature; summary=${JSON.stringify(parentHover)}`,
    );

    await clickCanvasTarget(page, parentTarget); await delay(700);
    const parentClickProbe = {
      selection: await selectionOf(page),
      session: await jointPickSession(page),
      target: parentTarget,
    };
    if (!parentClickProbe.session?.parentSnap) {
      console.error('Parent click did not commit a snap:', JSON.stringify(parentClickProbe));
    }
    const parentSnap = await waitForSnapKind(page, 'parent', 'circleCenter');
    assert(suite, Boolean(parentSnap), 'parent snap committed by first canvas click');
    assertEqual(suite, parentSnap.kind, 'circleCenter', 'cylinder cap pick snaps to circle center');

    await focusComponent(page, compB.id);
    await waitForComponentTargets(page, compB.id, allIds, modalSafeMaxX, 1);
    const childTargets = await targetsForComponent(page, compB.id, allIds, modalSafeMaxX);
    assertGreaterThan(suite, childTargets.length, 0, 'child link targets projected');
    const childTarget = childTargets[0];
    const childHover = await hoverCandidateRegion(page, childTarget, compB.id);
    assert(
      suite,
      childHover?.triangleCount > 0 && childHover?.recommendedKind === 'faceCenter',
      `box hover recommends its connected face center; summary=${JSON.stringify(childHover)}`,
    );
    assert(
      suite,
      childHover?.candidateKinds?.includes('geometryCenter'),
      `object geometry center is exposed as a selectable candidate; summary=${JSON.stringify(childHover)}`,
    );
    await clickCanvasTarget(page, childTarget); await delay(800);
    await page.waitForFunction(
      () => Boolean(window.__URDF_STUDIO_DEBUG__?.__jointPickSessionStore__?.getState?.()?.childSnap),
      { timeout: 5000 },
    );
    assert(suite, Boolean((await jointPickSession(page))?.childSnap), 'child snap committed');
    // Box has no circular face; the smart pick lands on a feature snap (face
    // center or object center depending on where the cursor hits the box)
    // instead of the raw surface point. Either feature snap is acceptable; the
    // raw surface point — the pre-fix "arbitrary point" behavior the user
    // complained about — is not.
    const childSnap = (await jointPickSession(page))?.childSnap ?? null;
    assert(
      suite,
      childSnap !== null && childSnap.kind !== 'surface',
      `box pick smart-snaps to a feature point (not raw surface); got ${childSnap?.kind ?? 'none'}`,
    );
    await page.waitForFunction(
      () => document.querySelector('[data-bridge-inline-field="name"] input')?.value?.length > 0,
      { timeout: 5000 },
    );
    const suggestedNameValue = await page.evaluate(() => {
      const input = document.querySelector('[data-bridge-inline-field="name"] input');
      return input instanceof HTMLInputElement ? input.value : '';
    });
    assert(
      suite,
      suggestedNameValue.length > 0,
      `endpoint-based bridge name is stored as the input value; value=${suggestedNameValue}`,
    );
    await page.click('[data-bridge-inline-field="name"] input', { clickCount: 3 });
    await page.type('[data-bridge-inline-field="name"] input', customBridgeName);
    assertEqual(
      suite,
      await page.evaluate(() => {
        const input = document.querySelector('[data-bridge-inline-field="name"] input');
        return input instanceof HTMLInputElement ? input.value : '';
      }),
      customBridgeName,
      'default bridge name can be edited directly',
    );
    // The preview bridge moves the child immediately. Both committed axes must
    // stay attached to their selected runtime links instead of leaving the
    // child axes at its click-time world pose.
    const trackedSnapDeadline = Date.now() + 5000;
    let trackedSnapProbe = null;
    while (Date.now() < trackedSnapDeadline) {
      trackedSnapProbe = await page.evaluate(() => {
        const state = window.__URDF_STUDIO_DEBUG__?.__jointPickSessionStore__?.getState?.();
        const snaps = window.__URDF_STUDIO_DEBUG__?.getJointPickOverlaySummary?.() ?? [];
        const parentEntry = snaps.find((entry) => entry.side === 'parent') ?? null;
        const childEntry = snaps.find((entry) => entry.side === 'child') ?? null;
        const parent = parentEntry?.position ?? null;
        const child = childEntry?.position ?? null;
        const capturedChild = state?.childSnap?.pointWorld ?? null;
        const inputValue = (fieldKey) => {
          const input = document.querySelector(`[data-bridge-inline-field="${fieldKey}"] input`);
          return input instanceof HTMLInputElement ? input.value : null;
        };
        const selectValue = (fieldKey) => {
          const select = document.querySelector(`[data-bridge-field="${fieldKey}"] select`);
          return select instanceof HTMLSelectElement ? select.value : null;
        };
        return {
          tracksLiveLinks:
            snaps.length === 2 && snaps.every((entry) => entry.tracksLiveLink === true),
          connectorLength: parent && child
            ? Math.hypot(
                child[0] - parent[0],
                child[1] - parent[1],
                child[2] - parent[2],
              )
            : null,
          connectorHidden:
            snaps.length === 2 && snaps.every((entry) => entry.connectorVisible === false),
          childMovedDistance: child && capturedChild
            ? Math.hypot(
                child[0] - capturedChild.x,
                child[1] - capturedChild.y,
                child[2] - capturedChild.z,
              )
            : null,
          draftOrigin: {
            x: inputValue('origin-x'),
            y: inputValue('origin-y'),
            z: inputValue('origin-z'),
          },
          draftRelation: {
            parentComponentId: selectValue('parent-component'),
            parentLinkId: selectValue('parent-link'),
            childComponentId: selectValue('child-component'),
            childLinkId: selectValue('child-link'),
          },
          sessionRelation: state
            ? {
                parentComponentId: state.parentComponentId,
                parentLinkId: state.parentLinkId,
                childComponentId: state.childComponentId,
                childLinkId: state.childLinkId,
              }
            : null,
          snaps,
        };
      });
      if (
        trackedSnapProbe.tracksLiveLinks
        && trackedSnapProbe.connectorLength !== null
        && trackedSnapProbe.connectorLength < 1e-3
        && trackedSnapProbe.connectorHidden
        && trackedSnapProbe.childMovedDistance !== null
        && trackedSnapProbe.childMovedDistance > 0.1
      ) {
        break;
      }
      await delay(150);
    }
    if (
      !trackedSnapProbe?.tracksLiveLinks
      || trackedSnapProbe.connectorLength === null
      || trackedSnapProbe.connectorLength >= 1e-3
      || !trackedSnapProbe.connectorHidden
      || trackedSnapProbe.childMovedDistance <= 0.1
    ) {
      console.error('Committed snap markers did not track:', JSON.stringify(trackedSnapProbe));
    }
    assert(
      suite,
      trackedSnapProbe.tracksLiveLinks,
      'committed parent/child axes track the live runtime links after preview rebuild',
    );
    assert(
      suite,
      trackedSnapProbe.childMovedDistance !== null && trackedSnapProbe.childMovedDistance > 0.1,
      `child axes moved away from their click-time world pose with the child robot; distance=${trackedSnapProbe.childMovedDistance}`,
    );
    assert(
      suite,
      trackedSnapProbe.connectorLength !== null && trackedSnapProbe.connectorLength < 1e-3,
      `picked frames coincide so the yellow connector collapses; length=${trackedSnapProbe.connectorLength}`,
    );
    assert(
      suite,
      trackedSnapProbe.connectorHidden,
      'yellow connector is hidden after the picked frames coincide',
    );

    // ── Confirm → bridge created + child auto-aligned by the picked snaps ──
    const beforeChild = (await getAssemblyState(page)).components.find((c) => c.id === compB.id);
    assert(suite, await clickButton(page, CONFIRM), 'confirm bridge');
    await delay(1200);

    const asm = await getAssemblyState(page);
    assertEqual(suite, asm.bridgeCount, 1, 'bridge created via pick flow');
    assertEqual(suite, asm.bridges[0]?.name, customBridgeName, 'edited bridge name is committed');
    const afterChild = asm.components.find((c) => c.id === compB.id);
    assert(
      suite,
      JSON.stringify(afterChild?.transform) !== JSON.stringify(beforeChild?.transform),
      'child component transform changed by snap alignment',
    );

    const errs = session.errors();
    assert(suite, errs.page.length === 0, `no page errors${errs.page.length ? `: ${errs.page.join(' | ')}` : ''}`);
  } finally {
    await session.cleanup();
  }

  await writeReport('joint_pick', {});
  process.exitCode = printSummary(suite) ? 0 : 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
