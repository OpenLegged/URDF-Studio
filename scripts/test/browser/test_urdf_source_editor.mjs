#!/usr/bin/env node

/**
 * URDF Source Editor browser regression test.
 *
 * Covers: opening source editor, verifying Monaco editor content,
 *         basic XML editing, undo workflow.
 */

import { setTimeout as delay } from 'node:timers/promises';
import {
  createSession,
  createTestSuite,
  assert,
  assertEqual,
  importModel,
  waitForReady,
  getTopology,
  openSourceEditor,
  getSourceEditorText,
  replaceSourceEditorText,
  saveSourceEditor,
  store,
  writeReport,
  printSummary,
} from './helpers/urdf-helpers.mjs';

const MODEL = { dir: 'a1_description', file: 'a1.urdf' };
const SOURCE_EDITOR_MODULE_PATHS = new Set([
  '/src/features/code-editor/index.ts',
  '/src/features/code-editor/components/SourceCodeEditor.tsx',
  '/src/features/code-editor/runtime.ts',
  '/src/features/code-editor/retry.ts',
  '/src/features/code-editor/utils/monacoLoader.ts',
]);

function isLateSourceEditorModuleRequest(url) {
  if (SOURCE_EDITOR_MODULE_PATHS.has(url.pathname)) {
    return true;
  }

  if (url.pathname.includes('/node_modules/.vite/deps/@monaco-editor_react')) {
    return true;
  }

  return false;
}

async function closeSourceEditor(page) {
  await page.evaluate(() => {
    const controls = document.querySelectorAll(
      '.source-code-editor-window button[data-window-control]',
    );
    const closeButton = controls.item(controls.length - 1);
    if (closeButton instanceof HTMLButtonElement) {
      closeButton.click();
    }
  });
  await page.waitForSelector('.source-code-editor-window', { hidden: true, timeout: 10_000 });
}

async function main() {
  const suite = createTestSuite('URDF Source Editor');
  const session = await createSession(
    process.env.URDF_STUDIO_TEST_SITE_URL ? { siteUrl: process.env.URDF_STUDIO_TEST_SITE_URL } : {},
  );
  const { page } = session;

  try {
    await importModel(page, MODEL.dir, MODEL.file);
    await waitForReady(page);
    const topo = await getTopology(page);
    assert(suite, topo.linkCount > 0, 'model loaded');

    // Mount once before enabling the late-request fault injection. This proves
    // the real first-open path and deterministically loads the complete lazy
    // module graph; hover-only prefetch can resolve before Vite has fetched every
    // transitive module after an HMR invalidation.
    const sourceEditorButton = await page
      .waitForSelector('[data-testid="source-code-open"]:not([disabled])', { timeout: 30_000 })
      .catch(() => null);
    assert(suite, Boolean(sourceEditorButton), 'source editor button found');
    if (sourceEditorButton) {
      await sourceEditorButton.click();
      await page.waitForSelector('.monaco-editor', { timeout: 30_000 });
      await closeSourceEditor(page);
    }

    const lateEditorModuleRequests = [];
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (isLateSourceEditorModuleRequest(url)) {
        lateEditorModuleRequests.push(url.toString());
        console.error('[source-editor-test] blocking late JS module:', url.toString());
        void request.respond({
          status: 503,
          contentType: 'application/javascript',
          headers: { 'cache-control': 'no-store' },
          body: 'throw new Error("source editor module was fetched after app startup");',
        });
        return;
      }
      void request.continue();
    });

    // ── 1. Open source editor via UI ──
    if (sourceEditorButton) {
      await sourceEditorButton.click();
    }

    await page
      .waitForSelector(
        '.monaco-editor, [data-mode-id], [data-testid="source-code-editor-load-error"]',
        { timeout: 30_000 },
      )
      .catch(() => undefined);
    if (lateEditorModuleRequests.length > 0) {
      console.error('[source-editor-test] late module requests:', lateEditorModuleRequests);
    }
    assert(
      suite,
      lateEditorModuleRequests.length === 0,
      'opening source editor performs no late feature-module fetches',
    );

    // ── 2. Verify Monaco editor loaded with URDF XML ──
    const hasMonaco = Boolean(await page.$('.monaco-editor, [data-mode-id]'));
    assert(suite, hasMonaco, 'Monaco editor present');
    if (!hasMonaco) {
      const diagnostics = await page.evaluate(() => ({
        bodyText: (document.body.textContent ?? '').slice(0, 2_000),
        globalErrorTitle:
          [...document.querySelectorAll('h1')].find((heading) =>
            /Something went wrong|应用遇到错误/i.test(heading.textContent ?? ''),
          )?.textContent ?? null,
        localEditorError:
          document.querySelector('[data-testid="source-code-editor-load-error"]')?.textContent ??
          null,
        sourceEditorWindow: Boolean(document.querySelector('.source-code-editor-window')),
        url: window.location.href,
      }));
      throw new Error(
        `Monaco did not mount: ${JSON.stringify({ diagnostics, errors: session.errors() })}`,
      );
    }

    const editorContent = hasMonaco
      ? await page
          .waitForFunction(() => document.querySelectorAll('.view-line').length > 0, {
            timeout: 30_000,
          })
          .then(() => true)
          .catch(() => false)
      : false;
    assert(suite, editorContent, 'editor has content');

    // ── 3. Verify source contains robot XML ──
    const sourceText = await page.evaluate(() => {
      const el =
        document.querySelector('.monaco-editor') ?? document.querySelector('[data-mode-id]');
      if (!el) return '';
      return el.textContent ?? '';
    });
    assert(
      suite,
      sourceText.includes('robot') || sourceText.includes('link') || sourceText.includes('joint'),
      'source contains robot XML elements',
    );

    // Imported URDF source remains editable even if scene/property editing is
    // independently locked. Save must update both RobotData and its owned draft.
    await page.evaluate(() => {
      window.__URDF_STUDIO_DEBUG__?.__uiStore__?.setState?.({ sourceCodeAutoApply: false });
    });
    const importedTarget = await page.evaluate(() => {
      const workspace = window.__URDF_STUDIO_DEBUG__?.__workspaceStore__?.getState?.().workspace;
      const component = workspace ? Object.values(workspace.components ?? {})[0] : undefined;
      return component ? { componentId: component.id, robotName: component.robot.name } : null;
    });
    assert(suite, Boolean(importedTarget), 'imported URDF component resolved');
    if (importedTarget) {
      await page.evaluate((componentId) => {
        const workspaceStore = window.__URDF_STUDIO_DEBUG__?.__workspaceStore__;
        workspaceStore?.getState?.().setComponentEditorLocked(componentId, true);
      }, importedTarget.componentId);
      await delay(100);
      const importedEditorState = await page.evaluate(() => ({
        hasReadOnlyBadge: [...document.querySelectorAll('.source-code-editor-window *')].some(
          (element) => /^read-only$/i.test(element.textContent?.trim() ?? ''),
        ),
        hasSaveButton: Boolean(document.querySelector('[data-testid="source-code-save"]')),
      }));
      assert(
        suite,
        !importedEditorState.hasReadOnlyBadge,
        'imported URDF stays editable while component is scene-locked',
      );
      assert(suite, importedEditorState.hasSaveButton, 'imported URDF exposes Save');

      const importedSource = await getSourceEditorText(page);
      const originalNameAttribute = `name="${importedTarget.robotName}"`;
      const savedRobotName = `${importedTarget.robotName}_source_saved`;
      assert(
        suite,
        importedSource.includes(originalNameAttribute),
        'imported URDF source contains canonical robot name',
      );
      await replaceSourceEditorText(
        page,
        importedSource.replace(originalNameAttribute, `name="${savedRobotName}"`),
      );
      await saveSourceEditor(page);
      await page.waitForFunction(
        (componentId, expectedName) =>
          window.__URDF_STUDIO_DEBUG__?.__workspaceStore__?.getState?.()
            .workspace?.components?.[componentId]?.robot?.name === expectedName,
        { timeout: 30_000 },
        importedTarget.componentId,
        savedRobotName,
      );
      const importedDraftSaved = await page.evaluate(
        (componentId, expectedName) => {
          const draft = window.__URDF_STUDIO_DEBUG__?.__assetsStore__?.getState?.()
            .componentSourceDrafts?.[componentId];
          return draft?.content?.includes(`name="${expectedName}"`) ?? false;
        },
        importedTarget.componentId,
        savedRobotName,
      );
      assert(suite, importedDraftSaved, 'imported URDF save updates owned source draft');
      await page.evaluate((componentId) => {
        window.__URDF_STUDIO_DEBUG__?.__workspaceStore__?.getState?.()
          .setComponentEditorLocked(componentId, false);
      }, importedTarget.componentId);
    }

    // Repeatedly remount the editor while every late feature-module request is
    // still forced to fail. This covers the frequent open/close workflow that
    // exposed rejected React.lazy promises in long-lived development tabs.
    let repeatedOpenSucceeded = true;
    for (let cycle = 0; cycle < 10; cycle += 1) {
      await closeSourceEditor(page);
      const reopenButton = await page
        .waitForSelector('[data-testid="source-code-open"]:not([disabled])', {
          timeout: 10_000,
        })
        .catch(() => null);
      if (!reopenButton) {
        repeatedOpenSucceeded = false;
        break;
      }
      await reopenButton.click();
      const reopened = await page
        .waitForSelector('.monaco-editor', { timeout: 10_000 })
        .then(() => true)
        .catch(() => false);
      if (!reopened) {
        repeatedOpenSucceeded = false;
        break;
      }
    }
    assert(suite, repeatedOpenSucceeded, 'source editor survives 10 repeated open/close cycles');
    assert(
      suite,
      lateEditorModuleRequests.length === 0,
      'repeated source editor opens perform no late feature-module fetches',
    );

    // ── 4. Verify property change reflects in store ──
    const hipJoint = topo.joints.find((j) => j.type === 'revolute');
    if (hipJoint) {
      await store.updateJoint(page, hipJoint.id, {
        limit: { lower: -1.0, upper: 1.0, effort: 50, velocity: 10 },
      });
      await delay(300);

      const updated = await getTopology(page);
      const updatedJoint = updated.joints.find((j) => j.id === hipJoint.id);
      assertEqual(suite, updatedJoint?.limit?.lower, -1.0, 'joint limit updated via store');
    }

    // ── 5. Undo changes ──
    if (hipJoint) {
      await store.undo(page);
      await delay(200);
      const restored = await getTopology(page);
      assertEqual(suite, restored.linkCount, topo.linkCount, 'topology intact after undo');
    }

    // ── 6. Re-import restores original state ──
    await closeSourceEditor(page);
    await importModel(page, MODEL.dir, MODEL.file);
    await waitForReady(page);
    const reimported = await getTopology(page);
    assertEqual(suite, reimported.linkCount, topo.linkCount, 'reimport restores link count');
    assertEqual(suite, reimported.jointCount, topo.jointCount, 'reimport restores joint count');

    // ── 7. A source-less default workspace is still a real editable document ──
    await page.evaluate(() => {
      window.__URDF_STUDIO_DEBUG__?.__workspaceStore__?.getState?.().resetWorkspace(
        'editable_default',
      );
      window.__URDF_STUDIO_DEBUG__?.__assetsStore__?.getState?.().clearComponentSourceDrafts();
      window.__URDF_STUDIO_DEBUG__?.__uiStore__?.setState?.({ sourceCodeAutoApply: false });
    });
    await openSourceEditor(page);
    const defaultEditorState = await page.evaluate(() => ({
      hasReadOnlyBadge: [...document.querySelectorAll('.source-code-editor-window *')].some(
        (element) => /^read-only$/i.test(element.textContent?.trim() ?? ''),
      ),
      hasSaveButton: Boolean(document.querySelector('[data-testid="source-code-save"]')),
    }));
    assert(suite, !defaultEditorState.hasReadOnlyBadge, 'default workspace source is not read-only');
    assert(suite, defaultEditorState.hasSaveButton, 'default workspace source exposes Save');

    const defaultSource = await getSourceEditorText(page);
    assert(suite, defaultSource.includes('editable_default'), 'default source reflects RobotData');
    await replaceSourceEditorText(
      page,
      defaultSource.replace('editable_default', 'editable_default_saved'),
    );
    await saveSourceEditor(page);
    await page.waitForFunction(
      () => {
        const workspace = window.__URDF_STUDIO_DEBUG__?.__workspaceStore__?.getState?.().workspace;
        return workspace?.components?.component_1?.robot?.name === 'editable_default_saved';
      },
      { timeout: 30_000 },
    );
    const savedDefaultDraft = await page.evaluate(
      () => window.__URDF_STUDIO_DEBUG__?.__assetsStore__?.getState?.()
        .componentSourceDrafts?.component_1?.content ?? '',
    );
    assert(
      suite,
      savedDefaultDraft.includes('editable_default_saved'),
      'first save bootstraps an editable component source draft',
    );

    const errs = session.errors();
    assert(suite, errs.page.length === 0, 'no page errors');
  } finally {
    await session.cleanup();
  }

  await writeReport('urdf_source_editor', {});
  process.exitCode = printSummary(suite) ? 0 : 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
