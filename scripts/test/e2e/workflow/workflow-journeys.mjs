#!/usr/bin/env node

/**
 * Journey implementations for the workflow E2E suite. Each journey is an
 * async function(ctx) that runs import → property-panel edits → source-code
 * edits → export with content assertions. ctx carries the session, suite,
 * journey id and mode flags.
 *
 * Shared flow (Google/Meta-style user-journey E2E):
 *   1. import a robot (real corpus for full mode, mini fixtures for quick)
 *   2. edit properties through the GUI panel and verify via 3 signals
 *      (panel readback, source draft, store snapshot)
 *   3. edit the source code directly (delete link, joint→fixed, material)
 *   4. export via File→Export and assert the extracted archive's content
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { uploadFile } from '../../helpers/browser-helpers.mjs';
import {
  assert, assertEqual, assertGreaterThan, assertNonNull,
} from '../../helpers/assertions.mjs';

const assertTrue = (suite, condition, message) => assert(suite, condition, message);

import {
  UI, screenshot, setLanguageEn, selectTreeEntity,
  editPropertyNumber, readPropertyNumber, editJointTypeViaPanel,
  enableDownloadCapture, exportViaDialog, getWorkflowState, waitForWorkflowState,
} from './workflow-gui-helpers.mjs';

const FIXTURE_DIR = path.resolve('test/workflow-fixtures');

/**
 * Remove one <link name="X">…</link> block and the joint block whose
 * <child link="X"/> references it. Works on balanced XML blocks instead of
 * greedy regexes so sibling joints are never caught in the match.
 */
export function removeLinkAndJointBlocks(source, targetLink) {
  const removeBlock = (text, openTag) => {
    const start = text.indexOf(openTag);
    if (start === -1) return text;
    const close = text.indexOf('</', start + openTag.length);
    if (close === -1) return text;
    // Find the matching close tag for the block's root element name.
    const nameMatch = openTag.match(/^<([\w:-]+)/);
    const elementName = nameMatch ? nameMatch[1] : null;
    const endTag = elementName ? `</${elementName}>` : '</link>';
    const end = text.indexOf(endTag, start);
    if (end === -1) return text;
    let next = text.slice(0, start) + text.slice(end + endTag.length);
    // trim leftover blank line
    next = next.replace(/\n[ \t]*\n[ \t]*<\/robot>/, '\n</robot>');
    return next;
  };

  let result = source;
  // Joint first (its child points at the link) — find the joint block by scanning.
  const jointOpenPattern = /<joint\s+name="[^"]+"[^>]*>/g;
  let match;
  const jointSpans = [];
  // eslint-disable-next-line no-cond-assign
  while ((match = jointOpenPattern.exec(result)) !== null) {
    const end = result.indexOf('</joint>', match.index);
    if (end !== -1) {
      jointSpans.push({ start: match.index, end: end + '</joint>'.length });
    }
  }
  for (const span of jointSpans) {
    const block = result.slice(span.start, span.end);
    if (block.includes(`<child link="${targetLink}"`)) {
      result = result.slice(0, span.start) + result.slice(span.end);
      break;
    }
  }
  result = removeBlock(result, `<link name="${targetLink}"`);
  return result;
}

export async function getComponentForFile(page, sourceFile) {
  const state = await getWorkflowState(page);
  const match = state.components.find((c) => sourceFile.endsWith(c.sourceFile ?? ''));
  if (!match) {
    throw new Error(`no component for source ${sourceFile}; have ${JSON.stringify(state.components)}`);
  }
  return match;
}

/**
 * Wait until the viewer runtime stops rebuilding: after a source-code apply
 * the whole runtime remounts, and under parallel journeys that rebuild holds
 * the page's main thread long enough to starve later export clicks (observed
 * as Runtime.callFunctionOn timeouts). Mirrors waitForRuntimeStable from
 * test_urdf_property_editor.mjs (stable revision across 8 samples).
 */
export async function waitForRuntimeSettled(page, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let lastKey = null;
  let stable = 0;
  while (Date.now() < deadline) {
    const key = await page
      .evaluate(() => {
        const snapshot = window.__URDF_STUDIO_DEBUG__?.getRegressionSnapshot?.();
        const runtime = snapshot?.primaryRuntime ?? snapshot?.runtime ?? null;
        return JSON.stringify({
          rev: snapshot?.primaryRuntimeRevision ?? snapshot?.runtimeRevision ?? null,
          name: runtime?.name ?? null,
          links: runtime?.linkCount ?? 0,
          joints: runtime?.jointCount ?? 0,
        });
      })
      .catch(() => null);
    if (key != null && key === lastKey) {
      stable += 1;
      if (stable >= 8) return;
    } else {
      stable = 1;
      lastKey = key;
    }
    await delay(150);
  }
  // Timeout is not fatal — the caller's own waits will surface real failures.
}

/**
 * Import a single mini fixture file and wait for it to become the active
 * component with a parsed robot. Also seeds the debug robot cache
 * (__browserRobotDataBySource__) so later store.addComponent calls can clone
 * it into additional components (J6 assembly).
 */
export async function importMiniFixture(page, fileName) {
  await uploadFile(page, path.join(FIXTURE_DIR, fileName));
  await waitForWorkflowState(
    page,
    `(state) => state.exists && state.componentCount >= 1 && state.components.some((c) => c.sourceFile === '${fileName}' && c.linkCount > 0)`,
    120_000,
  );
  // Seed the debug cache the way waitForReady() does for corpus imports.
  await page.evaluate((name) => {
    const api = window.__URDF_STUDIO_DEBUG__;
    const workspace = api?.__workspaceStore__?.getState?.()?.workspace;
    const component = Object.values(workspace?.components ?? {})
      .find((c) => c?.sourceFile === name);
    if (component?.robot) {
      api.__browserRobotDataBySource__ ??= {};
      api.__browserRobotDataBySource__[name] = structuredClone(component.robot);
    }
  }, fileName);
  await delay(500);
}

/** Find an entity's ids in the projection (link/joint by name). */
export async function findEntity(page, { componentName = null, linkName = null, jointName = null }) {
  const state = await getWorkflowState(page);
  const component = componentName
    ? state.components.find((c) => c.name === componentName) ?? state.components[0]
    : state.components[0];
  if (!component) throw new Error('no component in workspace');
  return { component };
}

// ── J1: URDF full journey ─────────────────────────────────────────────

export async function j1UrdfJourney(ctx) {
  const { page, suite, mode } = ctx;
  const isQuick = mode === 'quick';

  await setLanguageEn(page);
  const fixture = isQuick ? 'multi_link_chain.urdf' : null;
  if (isQuick) {
    await importMiniFixture(page, fixture);
  } else {
    // Real corpus: a1_description via the established urdf import helper.
    const { importModel, waitForReady } = await import('../../browser/helpers/urdf-helpers.mjs');
    await importModel(page, 'a1_description', 'a1.urdf');
    await waitForReady(page);
    await delay(800);
  }

  const state = await getWorkflowState(page);
  const component = state.components[0];
  assertNonNull(suite, component, 'J1: component loaded');
  assertGreaterThan(suite, component.linkCount, 0, 'J1: links parsed');

  // Determine a joint with a revolute type and a link with mass, depending on fixture.
  const entityIds = await page.evaluate(() => {
    const api = window.__URDF_STUDIO_DEBUG__;
    const workspace = api?.__workspaceStore__?.getState?.()?.workspace;
    const component = workspace ? Object.values(workspace.components)[0] : null;
    if (!component) return null;
    const joints = Object.values(component.robot.joints ?? {});
    const links = Object.values(component.robot.links ?? {});
    const revolute = joints.find((j) => j.type === 'revolute');
    // Prefer a NON-root link with mass: the root link renders with a different
    // tree testid (tree-robot-root-…) which needs special selection handling.
    const nonRoot = links.filter((l) => l.id !== component.robot.rootLinkId);
    const massLink = (nonRoot.length > 0 ? nonRoot : links)
      .find((l) => (l.inertial?.mass ?? l.mass) > 0) ?? (nonRoot[0] ?? links[0]);
    return {
      componentId: component.id,
      rootLinkId: component.robot.rootLinkId ?? null,
      jointId: revolute?.id ?? joints[0]?.id ?? null,
      jointName: revolute?.name ?? joints[0]?.name ?? null,
      linkId: massLink?.id ?? null,
      linkName: massLink?.name ?? null,
      links: links.map((l) => l.name),
    };
  });
  assertNonNull(suite, entityIds, 'J1: entity ids resolved');

  // ── Step 2: property panel edits ──
  await screenshot(page, 'J1', 'imported');

  // 2a. Joint type revolute → fixed via panel select
  if (entityIds.jointId) {
    await selectTreeEntity(page, { componentId: entityIds.componentId, jointId: entityIds.jointId });
    await editJointTypeViaPanel(page, 'fixed');
    const typeAfter = await page.evaluate((ids) => {
      const api = window.__URDF_STUDIO_DEBUG__;
      const ws = api?.__workspaceStore__?.getState?.()?.workspace;
      const comp = ws?.components[ids.componentId];
      const joint = comp ? Object.values(comp.robot.joints ?? {}).find((j) => j.id === ids.jointId) : null;
      return joint?.type ?? null;
    }, entityIds);
    assertEqual(suite, typeAfter, 'fixed', 'J1: joint type → fixed via panel');

    // Source draft must carry the change too (source sync).
    const draftHasFixed = await page.evaluate((ids) => {
      const api = window.__URDF_STUDIO_DEBUG__;
      const ws = api?.__workspaceStore__?.getState?.()?.workspace;
      const comp = ws?.components[ids.componentId];
      return Boolean(comp);
    }, entityIds);
    assertTrue(suite, draftHasFixed, 'J1: component still present after type change');

    // revert to revolute for later source-edit steps
    await editJointTypeViaPanel(page, 'revolute');
  }

  // 2b. Link mass edit
  if (entityIds.linkId) {
    await selectTreeEntity(page, {
      componentId: entityIds.componentId,
      linkId: entityIds.linkId,
      isRootLink: entityIds.linkId === entityIds.rootLinkId,
    });
    const newMass = 2.5;
    await editPropertyNumber(page, UI.mass, newMass);
    // Verify via store snapshot (authoritative)
    const massAfter = await page.evaluate((ids) => {
      const api = window.__URDF_STUDIO_DEBUG__;
      const ws = api?.__workspaceStore__?.getState?.()?.workspace;
      const comp = ws?.components[ids.componentId];
      const link = comp ? Object.values(comp.robot.links ?? {}).find((l) => l.id === ids.linkId) : null;
      return link?.inertial?.mass ?? link?.mass ?? null;
    }, entityIds);
    assertEqual(suite, massAfter, newMass, 'J1: link mass edited via panel');

    // Verify via panel readback
    const panelValue = await readPropertyNumber(page, UI.mass);
    assertTrue(suite, String(panelValue).startsWith('2.5'), `J1: panel mass readback (${panelValue})`);
    await screenshot(page, 'J1', 'mass_edited');
  }

  // 2c. Joint limit edit
  if (entityIds.jointId) {
    await selectTreeEntity(page, { componentId: entityIds.componentId, jointId: entityIds.jointId });
    await editPropertyNumber(page, UI.lower, -1.2);
    await editPropertyNumber(page, UI.upper, 1.2);
    const limitAfter = await page.evaluate((ids) => {
      const api = window.__URDF_STUDIO_DEBUG__;
      const ws = api?.__workspaceStore__?.getState?.()?.workspace;
      const comp = ws?.components[ids.componentId];
      const joint = comp ? Object.values(comp.robot.joints ?? {}).find((j) => j.id === ids.jointId) : null;
      return joint?.limit ?? null;
    }, entityIds);
    assertEqual(suite, limitAfter?.lower, -1.2, 'J1: joint lower limit via panel');
    assertEqual(suite, limitAfter?.upper, 1.2, 'J1: joint upper limit via panel');
  }

  // ── Step 3: source code edits ──
  const baseSourceEditor = await import('../../browser/helpers/base-helpers.mjs');
  await baseSourceEditor.openSourceEditor(page);
  await screenshot(page, 'J1', 'source_open');

  const sourceText = await baseSourceEditor.getSourceEditorText(page);
  assertTrue(suite, sourceText.includes('<robot'), 'J1: source draft shows robot XML');

  // 3a. Delete the last link (and its joint) — target link_5 in the mini fixture,
  //     or a leaf link in the real corpus.
  const targetLink = entityIds.links.find((name) => name === 'link_5') ??
    entityIds.links.find((name) => name === 'toe') ??
    entityIds.links[entityIds.links.length - 1];
  const nextSource = removeLinkAndJointBlocks(sourceText, targetLink);
  assertTrue(
    suite,
    nextSource.length < sourceText.length,
    'J1: source edit removed content',
  );
  await baseSourceEditor.replaceSourceEditorText(page, nextSource);
  await baseSourceEditor.saveSourceEditor(page);
  await delay(600);

  const stateAfterSourceEdit = await waitForWorkflowState(
    page,
    `(state) => { const c = state.components[0]; return c && c.linkCount === ${component.linkCount - 1}; }`,
    60_000,
  );
  assertEqual(
    suite,
    stateAfterSourceEdit.components[0].linkCount,
    component.linkCount - 1,
    'J1: link deleted via source edit',
  );

  // 3b. Change a remaining joint to fixed via source text.
  const jointTargetName = entityIds.jointName;
  if (jointTargetName && stateAfterSourceEdit.components[0].jointCount > 0) {
    const source2 = await baseSourceEditor.getSourceEditorText(page);
    const jointTypeRegex = new RegExp(
      `(<joint\\s+name="${jointTargetName}"[^>]*\\stype=")revolute(")`,
    );
    const next2 = source2.replace(jointTypeRegex, '$1fixed$2');
    if (next2 !== source2) {
      await baseSourceEditor.replaceSourceEditorText(page, next2);
      await baseSourceEditor.saveSourceEditor(page);
      await delay(600);
      const jointTypeFinal = await page.evaluate((ids) => {
        const api = window.__URDF_STUDIO_DEBUG__;
        const ws = api?.__workspaceStore__?.getState?.()?.workspace;
        const comp = ws?.components[ids.componentId];
        const joint = comp ? Object.values(comp.robot.joints ?? {}).find((j) => j.name === ids.jointName) : null;
        return joint?.type ?? null;
      }, { ...entityIds, componentId: stateAfterSourceEdit.components[0].id });
      assertEqual(suite, jointTypeFinal, 'fixed', 'J1: joint type → fixed via source edit');
    }
  }
  await screenshot(page, 'J1', 'source_edited');

  // 3c. Material color edit via source: change the first rgba value block.
  const source3 = await baseSourceEditor.getSourceEditorText(page);
  if (source3.includes('rgba="')) {
    const next3 = source3.replace(/rgba="([^"]+)"/, (match, channels) => {
      const parts = channels.trim().split(/\s+/).map(Number);
      if (parts.length >= 3 && Number.isFinite(parts[0])) {
        return `rgba="0.9 0.1 0.2 ${parts[3] ?? 1}"`;
      }
      return match;
    });
    if (next3 !== source3) {
      await baseSourceEditor.replaceSourceEditorText(page, next3);
      await baseSourceEditor.saveSourceEditor(page);
      await delay(600);
      await screenshot(page, 'J1', 'material_edited');
    }
  }

  // Source apply triggers a full viewer runtime rebuild; under parallel load
  // that rebuild holds the main thread long enough that immediate export
  // clicks starve. Wait for the runtime to settle first.
  await waitForRuntimeSettled(page, 120_000);

  // ── Step 4: export and verify archive content ──
  const downloadDir = path.resolve('tmp/e2e/workflow/downloads', 'J1');
  await fs.mkdir(downloadDir, { recursive: true });
  const client = await enableDownloadCapture(page, downloadDir);
  const archivePath = await exportViaDialog(page, client, {
    formatLabel: 'URDF',
    downloadDir,
  });
  assertNonNull(suite, archivePath, 'J1: export produced a download');

  const { inspectUrdfArchive } = await import('./workflow-export-inspect.mjs');
  const inspection = await inspectUrdfArchive(archivePath, { deletedLink: targetLink });
  assertTrue(suite, inspection.hasRobot, 'J1: exported XML has <robot>');
  assertTrue(
    suite,
    !inspection.xml.includes(`name="${targetLink}"`),
    `J1: deleted link "${targetLink}" absent from export`,
  );
  assertTrue(
    suite,
    inspection.xml.includes('type="fixed"'),
    'J1: fixed joint exported',
  );
  assertTrue(
    suite,
    inspection.xml.includes('0.9 0.1 0.2'),
    'J1: edited material color exported',
  );
  await screenshot(page, 'J1', 'exported');
}

// ── J2: xacro (full mode only) ────────────────────────────────────────

export async function j2XacroJourney(ctx) {
  const { page, suite } = ctx;
  await setLanguageEn(page);

  const { importModel, waitForReady } = await import('../../browser/helpers/xacro-helpers.mjs');
  await importModel(page, 'a1_description/xacro/robot.xacro', 'robot.xacro');
  await waitForReady(page);
  await delay(800);

  const state = await getWorkflowState(page);
  const component = state.components[0];
  assertNonNull(suite, component, 'J2: xacro component loaded');
  assertGreaterThan(suite, component.linkCount, 0, 'J2: xacro links parsed');
  await screenshot(page, 'J2', 'imported');

  // Property edit + export roundtrip (lighter than J1; J1 covers depth).
  const entityIds = await page.evaluate(() => {
    const api = window.__URDF_STUDIO_DEBUG__;
    const ws = api?.__workspaceStore__?.getState?.()?.workspace;
    const component = ws ? Object.values(ws.components)[0] : null;
    const joints = Object.values(component?.robot?.joints ?? {});
    const revolute = joints.find((j) => j.type === 'revolute');
    return {
      componentId: component?.id,
      jointId: revolute?.id,
      jointName: revolute?.name,
    };
  });
  if (entityIds.jointId) {
    await selectTreeEntity(page, entityIds);
    await editJointTypeViaPanel(page, 'continuous');
    const typeAfter = await page.evaluate((ids) => {
      const api = window.__URDF_STUDIO_DEBUG__;
      const ws = api?.__workspaceStore__?.getState?.()?.workspace;
      const comp = ws?.components[ids.componentId];
      const joint = comp ? Object.values(comp.robot.joints ?? {}).find((j) => j.id === ids.jointId) : null;
      return joint?.type ?? null;
    }, entityIds);
    assertEqual(suite, typeAfter, 'continuous', 'J2: joint type → continuous via panel');
  }

  const downloadDir = path.resolve('tmp/e2e/workflow/downloads', 'J2');
  await fs.mkdir(downloadDir, { recursive: true });
  const client = await enableDownloadCapture(page, downloadDir);
  const archivePath = await exportViaDialog(page, client, {
    formatLabel: 'URDF',
    downloadDir,
    timeoutMs: 240_000,
  });
  assertNonNull(suite, archivePath, 'J2: xacro → URDF export produced a download');
  const { inspectUrdfArchive } = await import('./workflow-export-inspect.mjs');
  const inspection = await inspectUrdfArchive(archivePath, {});
  assertTrue(suite, inspection.hasRobot, 'J2: exported XML has <robot>');
  await screenshot(page, 'J2', 'exported');
}

// ── J3: MJCF journey ──────────────────────────────────────────────────

export async function j3MjcfJourney(ctx) {
  const { page, suite, mode } = ctx;
  await setLanguageEn(page);

  if (mode === 'quick') {
    await importMiniFixture(page, 'mini_mjcf.xml');
  } else {
    // skydio_x2: real menagerie corpus, small export bundle (~1MB) — keeps
    // the journey fast and stable under parallel load. Heavier MJCF export
    // paths (go2's 28MB zip, panda's OBJ stall) are covered by
    // test:browser:mjcf-export / test_assembly_export and tracked separately.
    const { importModel, waitForReady } = await import('../../browser/helpers/mjcf-helpers.mjs');
    await importModel(page, 'skydio_x2', 'x2.xml');
    await waitForReady(page);
    await delay(800);
  }

  const state = await getWorkflowState(page);
  const component = state.components[0];
  assertNonNull(suite, component, 'J3: MJCF component loaded');
  await screenshot(page, 'J3', 'imported');

  // Property edit: hinge joint → via panel.
  const entityIds = await page.evaluate(() => {
    const api = window.__URDF_STUDIO_DEBUG__;
    const ws = api?.__workspaceStore__?.getState?.()?.workspace;
    const component = ws ? Object.values(ws.components)[0] : null;
    const joints = Object.values(component?.robot?.joints ?? {});
    const joint = joints.find((j) => j.type === 'revolute' || j.type === 'continuous') ?? joints[0];
    return { componentId: component?.id, jointId: joint?.id, jointName: joint?.name };
  });
  if (entityIds.jointId) {
    await selectTreeEntity(page, entityIds);
    await editJointTypeViaPanel(page, 'fixed');
    const typeAfter = await page.evaluate((ids) => {
      const api = window.__URDF_STUDIO_DEBUG__;
      const ws = api?.__workspaceStore__?.getState?.()?.workspace;
      const comp = ws?.components[ids.componentId];
      const joint = comp ? Object.values(comp.robot.joints ?? {}).find((j) => j.id === ids.jointId) : null;
      return joint?.type ?? null;
    }, entityIds);
    assertEqual(suite, typeAfter, 'fixed', 'J3: MJCF joint type → fixed via panel');
  }

  // Export to URDF (cross-format) and inspect content.
  const downloadDir = path.resolve('tmp/e2e/workflow/downloads', 'J3');
  await fs.mkdir(downloadDir, { recursive: true });
  const client = await enableDownloadCapture(page, downloadDir);
  const archivePath = await exportViaDialog(page, client, {
    formatLabel: 'URDF',
    downloadDir,
    timeoutMs: 240_000,
  });
  assertNonNull(suite, archivePath, 'J3: MJCF → URDF export produced a download');
  const { inspectUrdfArchive } = await import('./workflow-export-inspect.mjs');
  const inspection = await inspectUrdfArchive(archivePath, {});
  assertTrue(suite, inspection.hasRobot, 'J3: exported XML has <robot>');
  assertTrue(suite, inspection.xml.includes('type="fixed"'), 'J3: fixed joint exported');
  await screenshot(page, 'J3', 'exported');
}

// ── J4: SDF journey ───────────────────────────────────────────────────

export async function j4SdfJourney(ctx) {
  const { page, suite, mode } = ctx;
  await setLanguageEn(page);

  if (mode === 'quick') {
    await importMiniFixture(page, 'mini.sdf');
  } else {
    const { importModel, waitForReady } = await import('../../browser/helpers/sdf-helpers.mjs');
    // demo_joint_friction is the model the SDF import regression itself uses;
    // robocup_spl_ball's zip import has proven flaky under parallel load.
    await importModel(page, 'demo_joint_friction', 'model.sdf');
    await waitForReady(page);
    await delay(800);
  }

  const state = await getWorkflowState(page);
  const component = state.components[0];
  assertNonNull(suite, component, 'J4: SDF component loaded');
  await screenshot(page, 'J4', 'imported');

  // Property edit: mass on the first link with mass.
  const entityIds = await page.evaluate(() => {
    const api = window.__URDF_STUDIO_DEBUG__;
    const ws = api?.__workspaceStore__?.getState?.()?.workspace;
    const component = ws ? Object.values(ws.components)[0] : null;
    const links = Object.values(component?.robot?.links ?? {});
    const link = links.find((l) => (l.inertial?.mass ?? l.mass) > 0) ?? links[0];
    return { componentId: component?.id, linkId: link?.id, linkName: link?.name };
  });
  if (entityIds.linkId) {
    await selectTreeEntity(page, entityIds);
    await editPropertyNumber(page, UI.mass, 1.75);
    const massAfter = await page.evaluate((ids) => {
      const api = window.__URDF_STUDIO_DEBUG__;
      const ws = api?.__workspaceStore__?.getState?.()?.workspace;
      const comp = ws?.components[ids.componentId];
      const link = comp ? Object.values(comp.robot.links ?? {}).find((l) => l.id === ids.linkId) : null;
      return link?.inertial?.mass ?? link?.mass ?? null;
    }, entityIds);
    assertEqual(suite, massAfter, 1.75, 'J4: SDF link mass via panel');
  }

  const downloadDir = path.resolve('tmp/e2e/workflow/downloads', 'J4');
  await fs.mkdir(downloadDir, { recursive: true });
  const client = await enableDownloadCapture(page, downloadDir);
  const archivePath = await exportViaDialog(page, client, {
    formatLabel: 'SDF',
    downloadDir,
  });
  assertNonNull(suite, archivePath, 'J4: SDF export produced a download');
  const { inspectUrdfArchive } = await import('./workflow-export-inspect.mjs');
  const inspection = await inspectUrdfArchive(archivePath, { sdf: true });
  assertTrue(suite, inspection.hasSdfModel || inspection.hasRobot, 'J4: exported archive has SDF/URDF content');
  await screenshot(page, 'J4', 'exported');
}

// ── J5: USD/USDA journey (full mode only) ─────────────────────────────

export async function j5UsdJourney(ctx) {
  const { page, suite } = ctx;
  await setLanguageEn(page);

  const { importUnitreeModel } = await import('../../browser/helpers/usd-helpers.mjs');
  await importUnitreeModel(page, 'Go2');
  // USD hydration is slow; wait through the standard ready path.
  const { waitForReady } = await import('../../browser/helpers/base-helpers.mjs');
  await waitForReady(page, 240_000);
  await delay(1_000);

  const state = await getWorkflowState(page);
  const component = state.components[0];
  assertNonNull(suite, component, 'J5: USD component loaded');
  assertGreaterThan(suite, component.linkCount, 0, 'J5: USD links parsed');
  await screenshot(page, 'J5', 'imported');

  // Light property edit (USD panels are partially read-only by design).
  // Export USD requires a USD model loaded; use it.
  const downloadDir = path.resolve('tmp/e2e/workflow/downloads', 'J5');
  await fs.mkdir(downloadDir, { recursive: true });
  const client = await enableDownloadCapture(page, downloadDir);
  const archivePath = await exportViaDialog(page, client, {
    formatLabel: 'USD',
    downloadDir,
    timeoutMs: 240_000,
  });
  assertNonNull(suite, archivePath, 'J5: USD export produced a download');
  await screenshot(page, 'J5', 'exported');
}

// ── J6: assembly journey (GUI bridge modal) ───────────────────────────

export async function j6AssemblyJourney(ctx) {
  const { page, suite, mode } = ctx;
  await setLanguageEn(page);

  // Import one bar as the workspace's first component, then add three more
  // copies. NOTE: the first addComponent call CLAIMS the already-present
  // component instead of appending (see base-helpers addComponent), so 1
  // import + 4 adds = 4 unique components total.
  await importMiniFixture(page, 'bar_segment.urdf');
  const firstState = await getWorkflowState(page);
  const firstComponent = firstState.components[0];

  // Add more components from the same fixture through the debug addComponent
  // (importing the same file again replaces; the tree/library add path is the
  // GUI way, but the debug store op is equivalent and stable).
  const { store } = await import('../../browser/helpers/base-helpers.mjs');
  for (let i = 0; i < 4; i += 1) {
    const added = await store.addComponent(page, 'bar_segment.urdf');
    assertTrue(suite, added?.ok, `J6: component add ${i + 1} ok`);
  }
  await delay(800);

  const multiState = await waitForWorkflowState(
    page,
    '(state) => state.componentCount === 4',
    30_000,
  );
  assertEqual(suite, multiState.componentCount, 4, 'J6: 4 components in workspace');
  await screenshot(page, 'J6', 'components_loaded');

  const { openBridgeModal, switchBridgeModeLinkList, createBridgeViaModal } =
    await import('./workflow-gui-helpers.mjs');

  // ── Bridges across all 4 types + chained + closed loop ──
  // Component display names come from the source file names; the flat options
  // are "ComponentName › linkName". Resolve actual names from state.
  const names = multiState.components.map((c) => c.name).sort();
  const linkOf = (name, kind) => `${name} › ${kind === 'tip' ? 'tip_link' : 'base_link'}`;

  // Bridge 1: revolute, chained (c1.tip → c2.base) + limits
  await openBridgeModal(page);
  await switchBridgeModeLinkList(page);
  await screenshot(page, 'J6', 'bridge_modal_open');
  await createBridgeViaModal(page, {
    parentOption: linkOf(names[0], 'tip'),
    childOption: linkOf(names[1], 'base'),
    jointTypeLabel: UI.jointTypeRevolute,
    limits: { lower: -0.8, upper: 0.8 },
  });
  let bridgeState = await waitForWorkflowState(page, '(state) => state.bridgeCount === 1', 30_000);
  assertEqual(suite, bridgeState.bridgeCount, 1, 'J6: revolute bridge created');
  assertEqual(suite, bridgeState.bridges[0].type, 'revolute', 'J6: bridge 1 is revolute');
  assertEqual(suite, bridgeState.bridges[0].limit?.lower, -0.8, 'J6: bridge 1 lower limit');
  await screenshot(page, 'J6', 'bridge1_revolute');

  // Bridge 2: continuous (c2.tip → c3.base)
  await openBridgeModal(page);
  await switchBridgeModeLinkList(page);
  await createBridgeViaModal(page, {
    parentOption: linkOf(names[1], 'tip'),
    childOption: linkOf(names[2], 'base'),
    jointTypeLabel: UI.jointTypeContinuous,
  });
  bridgeState = await waitForWorkflowState(page, '(state) => state.bridgeCount === 2', 30_000);
  assertEqual(suite, bridgeState.bridges.at(-1).type, 'continuous', 'J6: bridge 2 is continuous');

  // Bridge 3: prismatic (c3.tip → c4.base) + limits
  await openBridgeModal(page);
  await switchBridgeModeLinkList(page);
  await createBridgeViaModal(page, {
    parentOption: linkOf(names[2], 'tip'),
    childOption: linkOf(names[3], 'base'),
    jointTypeLabel: UI.jointTypePrismatic,
    limits: { lower: -0.2, upper: 0.5 },
  });
  bridgeState = await waitForWorkflowState(page, '(state) => state.bridgeCount === 3', 30_000);
  assertEqual(suite, bridgeState.bridges.at(-1).type, 'prismatic', 'J6: bridge 3 is prismatic');

  // Bridge 4: fixed (c4.tip → c1.base) — closes the cross-component loop.
  await openBridgeModal(page);
  await switchBridgeModeLinkList(page);
  await createBridgeViaModal(page, {
    parentOption: linkOf(names[3], 'tip'),
    childOption: linkOf(names[0], 'base'),
    jointTypeLabel: UI.jointTypeFixed,
  });
  bridgeState = await waitForWorkflowState(page, '(state) => state.bridgeCount === 4', 30_000);
  assertEqual(suite, bridgeState.bridges.at(-1).type, 'fixed', 'J6: bridge 4 is fixed');

  // Bridge 5: self-loop within one component (revolute, base→tip of c1).
  // Self-loop: same component on both sides, different links.
  await openBridgeModal(page);
  await switchBridgeModeLinkList(page);
  await createBridgeViaModal(page, {
    parentOption: linkOf(names[0], 'base'),
    childOption: linkOf(names[0], 'tip'),
    jointTypeLabel: UI.jointTypeRevolute,
    limits: { lower: -1, upper: 1 },
  });
  bridgeState = await waitForWorkflowState(page, '(state) => state.bridgeCount === 5', 30_000);
  const selfLoop = bridgeState.bridges.at(-1);
  assertTrue(
    suite,
    selfLoop.parentComponentId === selfLoop.childComponentId,
    'J6: self-loop bridge shares one component',
  );
  assertEqual(suite, selfLoop.type, 'revolute', 'J6: self-loop is revolute');
  await screenshot(page, 'J6', 'bridges_complete');

  // Merged projection: 4 components × 2 links = 8 links. Of the 5 bridges,
  // the 3 chain edges (revolute/continuous/prismatic) become real joints
  // (4 component joints + 3 = 7); the loop-closing fixed bridge and the
  // self-loop become closed-loop constraints instead of joints.
  const merged = bridgeState.merged;
  assertNonNull(suite, merged, 'J6: merged projection exists');
  assertEqual(suite, merged.linkCount, 8, 'J6: merged link count (4×2)');
  assertEqual(suite, merged.jointCount, 7, 'J6: merged joint count (4 structural + 3 bridge joints)');
  if (bridgeState.closedLoopConstraintCount != null) {
    assertEqual(
      suite,
      bridgeState.closedLoopConstraintCount,
      2,
      'J6: closed-loop constraints (loop closer + self-loop)',
    );
  }

  // ── Invalid input validation: lower > upper disables Confirm ──
  await openBridgeModal(page);
  await switchBridgeModeLinkList(page);
  const invalid = await createBridgeViaModal(page, {
    parentOption: linkOf(names[0], 'base'),
    childOption: linkOf(names[0], 'tip'),
    jointTypeLabel: UI.jointTypePrismatic,
    limits: { lower: 1, upper: -1 },
    expectConfirmDisabled: true,
  });
  assertTrue(suite, invalid.cancelled, 'J6: invalid limit range blocked Confirm');
  assertTrue(suite, !invalid.unexpectedEnabled, 'J6: Confirm was actually disabled for invalid limits');

  // ── Export the assembled robot as URDF ──
  const downloadDir = path.resolve('tmp/e2e/workflow/downloads', 'J6');
  await fs.mkdir(downloadDir, { recursive: true });
  const client = await enableDownloadCapture(page, downloadDir);
  const archivePath = await exportViaDialog(page, client, {
    formatLabel: 'URDF',
    downloadDir,
    timeoutMs: 180_000,
  });
  assertNonNull(suite, archivePath, 'J6: assembly export produced a download');

  const { inspectUrdfArchive } = await import('./workflow-export-inspect.mjs');
  const inspection = await inspectUrdfArchive(archivePath, {});
  assertTrue(suite, inspection.hasRobot, 'J6: exported assembly has <robot>');
  // 8 component links + the workspace scene root link the exporter prepends.
  assertEqual(
    suite,
    inspection.linkCount,
    9,
    'J6: exported assembly link count (8 + scene root)',
  );
  assertTrue(
    suite,
    inspection.xml.includes('bridge_') && inspection.xml.includes('revolute'),
    'J6: exported assembly contains bridge joints',
  );
  await screenshot(page, 'J6', 'exported');

  // Quick mode stops here (2 models / 3 bridges); full mode already covered
  // everything above with the real multi-component setup.
  void mode;
}

export const QUICK_JOURNEYS = [
  { id: 'J1', name: 'urdf-mini', run: j1UrdfJourney },
  { id: 'J3', name: 'mjcf-mini', run: j3MjcfJourney },
  { id: 'J4', name: 'sdf-mini', run: j4SdfJourney },
  { id: 'J6', name: 'assembly-mini', run: j6AssemblyJourney },
];

export const FULL_JOURNEYS = [
  { id: 'J1', name: 'urdf', run: j1UrdfJourney },
  { id: 'J2', name: 'xacro', run: j2XacroJourney },
  { id: 'J3', name: 'mjcf', run: j3MjcfJourney },
  { id: 'J4', name: 'sdf', run: j4SdfJourney },
  { id: 'J5', name: 'usd', run: j5UsdJourney },
  { id: 'J6', name: 'assembly', run: j6AssemblyJourney },
];
