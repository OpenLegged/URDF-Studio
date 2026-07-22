#!/usr/bin/env node

/**
 * Component auto-grounding browser regression.
 *
 * Uses the real Asset Library "Load to Workspace" action, then verifies each
 * independently placed component's visual mesh subtree against the ground plane.
 */

import { setTimeout as delay } from 'node:timers/promises';

import {
  assert,
  createSession,
  createTestSuite,
  printSummary,
  waitForReady,
  writeReport,
} from './helpers/urdf-helpers.mjs';
import { importModel as importMjcf } from './helpers/mjcf-helpers.mjs';
import { importModel as importUrdf } from './helpers/urdf-helpers.mjs';

const A1 = {
  rootFolder: 'a1_description',
  folderPath: ['urdf'],
  modelDir: 'a1_description',
  fileName: 'a1.urdf',
};
const GO2 = {
  rootFolder: 'go2_description',
  folderPath: ['urdf'],
  modelDir: 'go2_description',
  fileName: 'go2_description.urdf',
};
const G1 = {
  rootFolder: 'g1_description',
  folderPath: [],
  modelDir: 'g1_description',
  fileName: 'g1_23dof.urdf',
};
const MJCF_GO2 = {
  rootFolder: null,
  folderPath: [],
  modelDir: 'unitree_go2',
  fileName: 'go2.xml',
};
const MJCF_G1 = {
  rootFolder: null,
  folderPath: [],
  modelDir: 'unitree_g1',
  fileName: 'g1.xml',
};
const GROUND_TOLERANCE_METERS = 1e-3;
const LOAD_TIMEOUT_MS = 120_000;

async function clickLibraryTreeNode(page, rootFolder, descendantLabel) {
  const clicked = await page.evaluate(
    ({ descendantLabel: label, rootFolder: rootLabel }) => {
      const roleButtons = [...document.querySelectorAll('[role="button"]')];
      const rootRow = roleButtons.find(
        (node) => node.getAttribute('aria-label') === rootLabel,
      );
      const rootWrapper = rootRow?.parentElement;
      const target = rootWrapper
        ? [...rootWrapper.querySelectorAll('[role="button"]')].find(
            (node) => node.getAttribute('aria-label') === label,
          )
        : null;
      if (!target) return false;
      if (!target.querySelector('svg.lucide-chevron-down')) {
        target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      }
      return true;
    },
    { descendantLabel, rootFolder },
  );
  if (!clicked) {
    throw new Error(`Could not click library node "${rootFolder}/${descendantLabel}".`);
  }
  await delay(120);
}

async function addLibraryFileToWorkspace(page, fixture) {
  if (fixture.rootFolder) {
    const rootExpanded = await page.evaluate((rootLabel) => {
      const rootRow = [...document.querySelectorAll('[role="button"]')].find(
        (node) => node.getAttribute('aria-label') === rootLabel,
      );
      if (!rootRow) return false;
      const expanded = rootRow.querySelector('svg.lucide-chevron-down');
      if (!expanded) {
        rootRow.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      }
      return true;
    }, fixture.rootFolder);
    if (!rootExpanded) {
      throw new Error(`Could not find library root "${fixture.rootFolder}".`);
    }
    await delay(120);
  }

  for (const folder of fixture.folderPath) {
    await clickLibraryTreeNode(page, fixture.rootFolder, folder);
  }

  const clicked = await page.evaluate(
    ({ fileName, rootFolder }) => {
      const rootRow = [...document.querySelectorAll('[role="button"]')].find(
        (node) => node.getAttribute('aria-label') === rootFolder,
      );
      const rootWrapper = rootFolder ? rootRow?.parentElement : document;
      const fileRow = rootWrapper
        ? [...rootWrapper.querySelectorAll('[role="button"]')].find(
            (node) => node.getAttribute('aria-label') === fileName,
          )
        : null;
      const addButton = fileRow?.querySelector('button[title="Load to Workspace"]');
      if (!addButton) return false;
      addButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      return true;
    },
    { fileName: fixture.fileName, rootFolder: fixture.rootFolder },
  );
  if (!clicked) {
    throw new Error(
      `Could not invoke Load to Workspace for "${fixture.rootFolder}/${fixture.fileName}".`,
    );
  }
}

function readComponentGroundingInPage() {
  const api = window.__URDF_STUDIO_DEBUG__;
  const workspaceStore = api?.__workspaceStore__?.getState?.();
  const workspace = workspaceStore?.workspace ?? null;
  const projection = workspaceStore?.getSceneProjection?.() ?? null;
  const runtime = api?.getRuntimeSceneTransforms?.() ?? null;
  const groundPlaneOffset = Number(
    api?.__uiStore__?.getState?.()?.groundPlaneOffset ?? 0,
  );
  if (!workspace || !projection || !runtime) {
    return null;
  }

  const lowestByComponentId = new Map();
  for (const mesh of runtime.visualMeshes ?? []) {
    const minZ = Number(mesh?.boundsMin?.[2]);
    const ref = projection.globalToEntityRef.get(mesh?.link);
    if (!Number.isFinite(minZ) || ref?.type !== 'link') {
      continue;
    }
    const previous = lowestByComponentId.get(ref.componentId);
    lowestByComponentId.set(
      ref.componentId,
      previous === undefined ? minZ : Math.min(previous, minZ),
    );
  }

  const bridgeOwnedComponentIds = new Set(
    Object.values(workspace.bridges ?? {}).map((bridge) => bridge.childComponentId),
  );
  const components = Object.values(workspace.components ?? {})
    .filter((component) => component.visible !== false)
    .map((component) => ({
      componentId: component.id,
      groundedByBridge: bridgeOwnedComponentIds.has(component.id),
      lowestVisualZ: lowestByComponentId.get(component.id) ?? null,
      sourceFile: component.sourceFile,
      transform: structuredClone(component.transform),
    }));

  return {
    componentCount: components.length,
    components,
    groundPlaneOffset,
    pendingComponentIds: [...(workspaceStore.pendingAutoGroundComponentIds ?? [])],
  };
}

async function waitForGroundedComponents(
  page,
  expectedComponentCount,
  timeoutMs = LOAD_TIMEOUT_MS,
) {
  try {
    await page.waitForFunction(
      ({ expectedCount, tolerance }, readerSource) => {
        const reader = new Function(`return (${readerSource})`)();
        const snapshot = reader();
        if (
          !snapshot
          || snapshot.componentCount !== expectedCount
          || snapshot.pendingComponentIds.length > 0
        ) {
          return false;
        }

        return snapshot.components
          .filter((component) => !component.groundedByBridge)
          .every(
            (component) =>
              Number.isFinite(component.lowestVisualZ)
              && Math.abs(component.lowestVisualZ - snapshot.groundPlaneOffset) <= tolerance,
          );
      },
      { timeout: timeoutMs },
      { expectedCount: expectedComponentCount, tolerance: GROUND_TOLERANCE_METERS },
      readComponentGroundingInPage.toString(),
    );
  } catch (error) {
    const diagnostic = await page.evaluate(readComponentGroundingInPage);
    throw new Error(
      `Grounding wait failed for ${expectedComponentCount} components: ${JSON.stringify(diagnostic)}`,
      { cause: error },
    );
  }
  return page.evaluate(readComponentGroundingInPage);
}

async function main() {
  const suite = createTestSuite('Component Auto Grounding');
  const session = await createSession();
  const report = { scenarios: [] };

  try {
    const { page } = session;
    await importUrdf(page, GO2.modelDir, GO2.fileName, LOAD_TIMEOUT_MS);
    await waitForReady(page, LOAD_TIMEOUT_MS);
    await importUrdf(page, G1.modelDir, G1.fileName, LOAD_TIMEOUT_MS);
    await waitForReady(page, LOAD_TIMEOUT_MS);

    const humanoid = await waitForGroundedComponents(page, 1);
    report.scenarios.push({ name: 'initial-g1-humanoid', snapshot: humanoid });
    assert(
      suite,
      humanoid?.components.every(
        (component) =>
          component.groundedByBridge
          || Math.abs(component.lowestVisualZ - humanoid.groundPlaneOffset)
            <= GROUND_TOLERANCE_METERS,
      ),
      'initial G1 humanoid rests on the ground',
    );

    await addLibraryFileToWorkspace(page, GO2);
    const heterogeneous = await waitForGroundedComponents(page, 2);
    report.scenarios.push({ name: 'heterogeneous-g1-go2', snapshot: heterogeneous });
    assert(
      suite,
      heterogeneous?.components.every(
        (component) =>
          component.groundedByBridge
          || Math.abs(component.lowestVisualZ - heterogeneous.groundPlaneOffset)
            <= GROUND_TOLERANCE_METERS,
      ),
      'G1 humanoid and Go2 quadruped each rest on the ground',
    );

    await addLibraryFileToWorkspace(page, GO2);
    const repeatedWithHumanoid = await waitForGroundedComponents(page, 3, 30_000);
    report.scenarios.push({
      name: 'repeated-go2-with-g1',
      snapshot: repeatedWithHumanoid,
    });
    assert(
      suite,
      repeatedWithHumanoid?.components.every(
        (component) =>
          component.groundedByBridge
          || Math.abs(component.lowestVisualZ - repeatedWithHumanoid.groundPlaneOffset)
            <= GROUND_TOLERANCE_METERS,
      ),
      'repeated Go2 remains grounded beside G1',
    );

    await importUrdf(page, A1.modelDir, A1.fileName, LOAD_TIMEOUT_MS);
    await waitForReady(page, LOAD_TIMEOUT_MS);
    const quadruped = await waitForGroundedComponents(page, 1);
    report.scenarios.push({ name: 'initial-a1-quadruped', snapshot: quadruped });

    await addLibraryFileToWorkspace(page, GO2);
    const mixedQuadrupeds = await waitForGroundedComponents(page, 2, 30_000);
    report.scenarios.push({ name: 'heterogeneous-a1-go2', snapshot: mixedQuadrupeds });
    assert(
      suite,
      mixedQuadrupeds?.components.every(
        (component) =>
          component.groundedByBridge
          || Math.abs(component.lowestVisualZ - mixedQuadrupeds.groundPlaneOffset)
            <= GROUND_TOLERANCE_METERS,
      ),
      'different quadruped families each rest on the ground',
    );

    await importMjcf(page, MJCF_GO2.modelDir, MJCF_GO2.fileName, LOAD_TIMEOUT_MS);
    await waitForReady(page, LOAD_TIMEOUT_MS);
    await importMjcf(page, MJCF_G1.modelDir, MJCF_G1.fileName, LOAD_TIMEOUT_MS);
    await waitForReady(page, LOAD_TIMEOUT_MS);

    const mjcfHumanoid = await waitForGroundedComponents(page, 1);
    report.scenarios.push({ name: 'initial-mjcf-g1', snapshot: mjcfHumanoid });

    await addLibraryFileToWorkspace(page, MJCF_GO2);
    const mixedMjcf = await waitForGroundedComponents(page, 2, 30_000);
    report.scenarios.push({ name: 'heterogeneous-mjcf-g1-go2', snapshot: mixedMjcf });
    assert(
      suite,
      mixedMjcf?.components.every(
        (component) =>
          component.groundedByBridge
          || Math.abs(component.lowestVisualZ - mixedMjcf.groundPlaneOffset)
            <= GROUND_TOLERANCE_METERS,
      ),
      'MJCF G1 humanoid and Go2 quadruped each rest on the ground',
    );

    await addLibraryFileToWorkspace(page, MJCF_GO2);
    const repeatedMjcf = await waitForGroundedComponents(page, 3, 30_000);
    report.scenarios.push({ name: 'repeated-mjcf-go2-with-g1', snapshot: repeatedMjcf });
    assert(
      suite,
      repeatedMjcf?.components.every(
        (component) =>
          component.groundedByBridge
          || Math.abs(component.lowestVisualZ - repeatedMjcf.groundPlaneOffset)
            <= GROUND_TOLERANCE_METERS,
      ),
      'repeated MJCF Go2 remains grounded beside MJCF G1',
    );

    await page.screenshot({
      path: 'tmp/regression/component_auto_grounding.png',
      fullPage: true,
    });
    const errors = session.errors();
    assert(suite, errors.page.length === 0, 'no browser page errors');
    report.errors = errors;
  } finally {
    await session.cleanup();
  }

  await writeReport('component_auto_grounding', report);
  process.exitCode = printSummary(suite) ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
