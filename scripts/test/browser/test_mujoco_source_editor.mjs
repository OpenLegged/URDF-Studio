#!/usr/bin/env node

/**
 * MuJoCo Source Editor browser regression test.
 *
 * Covers: importing an MJCF fixture, opening the real source/code UI,
 * verifying Monaco content, and confirming edits can be made while the
 * source editor remains mounted.
 */

import { setTimeout as delay } from 'node:timers/promises';
import {
  createSession, createTestSuite, assert, assertEqual, assertGreaterThan,
  importModel, waitForReady, getTopology, openSourceEditor,
  store, writeReport, printSummary,
} from './helpers/mjcf-helpers.mjs';

const MODEL = { dir: 'unitree_go2', file: 'go2.xml' };

async function getSourceEditorDebugText(page) {
  await page.waitForFunction(
    () => Boolean(window.__URDF_STUDIO_DEBUG__?.__sourceEditor?.getValue),
    { timeout: 45_000 },
  );
  return page.evaluate(() => window.__URDF_STUDIO_DEBUG__.__sourceEditor.getValue());
}

async function readSourceEditor(page) {
  const text = await getSourceEditorDebugText(page);
  return page.evaluate(() => {
    const monacoEditors = window.monaco?.editor?.getEditors?.() ?? [];
    const saveButton = [...document.querySelectorAll('button')].find(
      (candidate) => candidate.textContent?.trim().toLowerCase() === 'save',
    );
    const visibleText = document.body?.innerText ?? '';
    return {
      hasMonacoModel: false,
      hasMonacoEditor: Boolean(monacoEditors.length) || Boolean(document.querySelector('.monaco-editor')),
      languageId: window.monaco?.editor?.getModels?.()[0]?.getLanguageId?.() ?? null,
      hasMjcfLabel: /MJCF\/XML/i.test(visibleText),
      saveDisabled: saveButton instanceof HTMLButtonElement ? saveButton.disabled : null,
      modifiedVisible: /\bModified\b/i.test(visibleText),
    };
  }).then((metadata) => ({ ...metadata, hasMonacoModel: text.length > 0, text }));
}

async function waitForSourceEditorText(page, expectedText, timeout = 10_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeout) {
    const text = await getSourceEditorDebugText(page);
    if (text.includes(expectedText)) {
      return;
    }
    await delay(100);
  }
  throw new Error(`Timed out waiting for source editor text: ${expectedText}`);
}

async function readSelectedSourceState(page) {
  return page.evaluate(() => {
    const assets = window.__URDF_STUDIO_DEBUG__?.__assetsStore__?.getState?.() ?? null;
    const workspace = window.__URDF_STUDIO_DEBUG__?.__workspaceStore__?.getState?.() ?? null;
    const selectedFile = assets?.selectedFile ?? null;
    const allFileContents = assets?.allFileContents ?? {};
    const selectedAvailableFile = assets?.availableFiles?.find?.(
      (file) => file?.name === selectedFile?.name,
    ) ?? null;

    return {
      fileName: selectedFile?.name ?? null,
      draftContent:
        assets?.componentSourceDrafts?.[workspace?.activeComponentId]?.content ?? '',
      selectedContent: selectedFile?.content ?? '',
      availableContent: selectedAvailableFile?.content ?? '',
      allFileContent: selectedFile?.name ? (allFileContents[selectedFile.name] ?? '') : '',
    };
  });
}

async function main() {
  const suite = createTestSuite('MuJoCo Source Editor');
  let session = null;
  const report = { model: MODEL, steps: [] };

  try {
    session = await createSession();
    const { page } = session;

    await importModel(page, MODEL.dir, MODEL.file);
    await waitForReady(page);
    const baseline = await getTopology(page);
    report.baseline = { name: baseline.name, links: baseline.linkCount, joints: baseline.jointCount };

    assertGreaterThan(suite, baseline.linkCount, 10, 'Go2 MJCF links loaded');
    assertGreaterThan(suite, baseline.jointCount, 10, 'Go2 MJCF joints loaded');
    assertEqual(suite, baseline.name, 'go2', 'baseline MJCF model name');

    await openSourceEditor(page);
    assert(suite, true, 'source/code UI opens with Monaco');

    const editor = await readSourceEditor(page);
    report.editor = {
      hasMonacoModel: editor.hasMonacoModel,
      languageId: editor.languageId,
      hasMjcfLabel: editor.hasMjcfLabel,
      saveDisabled: editor.saveDisabled,
      sourceLength: editor.text.length,
    };
    assert(suite, editor.hasMonacoEditor, 'Monaco editor container present');
    assert(suite, editor.hasMonacoModel, 'Monaco text model present');
    assert(suite, editor.hasMjcfLabel, 'MJCF/XML document label visible');
    assert(suite, editor.text.includes('<mujoco model="go2"'), 'source contains MJCF root');
    assert(suite, editor.text.includes('<worldbody>'), 'source contains worldbody');
    assert(suite, editor.text.includes('FL_hip_joint'), 'source contains Go2 joint');
    assert(suite, editor.text.includes('foot.obj'), 'source contains mesh asset references');

    await store.setName(page, 'go2_source_editor_regression');
    await waitForSourceEditorText(
      page,
      '<mujoco model="go2_source_editor_regression"',
    );
    const renamed = await getTopology(page);
    assertEqual(suite, renamed.name, 'go2_source_editor_regression', 'robot can be edited while source editor is open');
    assertEqual(suite, renamed.linkCount, baseline.linkCount, 'store edit preserves link count');
    assertEqual(suite, renamed.jointCount, baseline.jointCount, 'store edit preserves joint count');
    const generatedEditor = await readSourceEditor(page);
    assert(
      suite,
      generatedEditor.text.includes('<mujoco model="go2_source_editor_regression"'),
      'source editor reflects robot-state edits as patched MJCF',
    );
    assertEqual(
      suite,
      generatedEditor.text.length - editor.text.length,
      'go2_source_editor_regression'.length - 'go2'.length,
      'MJCF source rename only changes the root model attribute text',
    );
    assert(
      suite,
      generatedEditor.text.includes('<compiler angle="radian" meshdir="assets" autolimits="true"/>'),
      'source editor preserves imported compiler settings while patching',
    );
    assert(
      suite,
      generatedEditor.text.includes('impratio="100"'),
      'source editor preserves imported MJCF top-level option while patching',
    );
    const sourceState = await readSelectedSourceState(page);
    report.sourceStateAfterRename = {
      fileName: sourceState.fileName,
      draftLength: sourceState.draftContent.length,
      selectedLength: sourceState.selectedContent.length,
      availableLength: sourceState.availableContent.length,
      allFileLength: sourceState.allFileContent.length,
    };
    assert(
      suite,
      sourceState.draftContent.includes('<mujoco model="go2_source_editor_regression"'),
      'component-owned MJCF draft reflects robot-state edits',
    );
    assert(
      suite,
      !sourceState.selectedContent.includes('<mujoco model="go2_source_editor_regression"'),
      'selected imported MJCF library source remains immutable',
    );
    assert(
      suite,
      !sourceState.availableContent.includes('<mujoco model="go2_source_editor_regression"'),
      'availableFiles MJCF library source remains immutable',
    );
    assert(
      suite,
      !sourceState.allFileContent.includes('<mujoco model="go2_source_editor_regression"'),
      'allFileContents MJCF library source remains immutable',
    );

    await store.undo(page);
    await delay(300);
    const afterUndo = await getTopology(page);
    assertEqual(suite, afterUndo.linkCount, baseline.linkCount, 'undo keeps topology intact after source save');

    const errs = session.errors();
    report.errors = errs;
    assert(suite, errs.page.length === 0, 'no page errors');
  } catch (error) {
    report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
    assert(suite, false, `unexpected error: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    if (session) await session.cleanup();
  }

  await writeReport('mujoco_source_editor', report);
  process.exitCode = printSummary(suite) ? 0 : 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
