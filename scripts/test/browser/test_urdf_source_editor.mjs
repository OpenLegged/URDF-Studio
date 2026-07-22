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

    // Once the application is ready, opening the source editor must not depend
    // on another Vite feature-module fetch. A stale page can keep working across
    // a dev-server/HMR restart only when this dependency graph is already loaded.
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
    const sourceEditorButton = await page
      .waitForSelector('[data-testid="source-code-open"]:not([disabled])', { timeout: 30_000 })
      .catch(() => null);
    assert(suite, Boolean(sourceEditorButton), 'source editor button found');
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
