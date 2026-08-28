#!/usr/bin/env node

/**
 * SDF Model Import browser regression test.
 *
 * Verifies import and basic topology for SDF model fixtures
 * from test/gazebo_models/.
 */

import {
  createSession, createTestSuite, assert, assertGreaterThan,
  importModel, waitForReady, getTopology, openSourceEditor,
  getSourceEditorText, replaceSourceEditorText, saveSourceEditor, store,
  writeReport, printSummary,
} from './helpers/sdf-helpers.mjs';

const MODELS = [
  { dir: 'demo_joint_friction', file: 'model.sdf' },
  { dir: 'r2_description', file: 'model.sdf' },
];

async function main() {
  const suite = createTestSuite('SDF Model Import');
  const session = await createSession();
  const results = [];

  try {
    for (const { dir, file } of MODELS) {
      console.log(`\n── ${dir}/${file} ──`);

      try {
        const loadedName = await importModel(session.page, dir, file);
        await waitForReady(session.page);
        const topo = await getTopology(session.page);

        assertGreaterThan(suite, topo.linkCount, 0, `${dir}: links > 0 (${topo.linkCount})`);
        assertGreaterThan(suite, topo.jointCount, 0, `${dir}: joints > 0 (${topo.jointCount})`);

        const loadState = await session.page.evaluate(() =>
          window.__URDF_STUDIO_DEBUG__?.getDocumentLoadState?.());
        assert(suite, loadState?.fileName === loadedName, `${dir}: document state tracks loaded file`);

        if (dir === MODELS[0].dir) {
          await session.page.evaluate(() => {
            window.__URDF_STUDIO_DEBUG__?.__uiStore__?.setState?.({
              sourceCodeAutoApply: false,
            });
          });
          await openSourceEditor(session.page);
          const sdfEditorState = await session.page.evaluate(() => ({
            hasReadOnlyBadge: [...document.querySelectorAll('.source-code-editor-window *')].some(
              (element) => /^read-only$/i.test(element.textContent?.trim() ?? ''),
            ),
            hasSaveButton: Boolean(document.querySelector('[data-testid="source-code-save"]')),
            componentId:
              window.__URDF_STUDIO_DEBUG__?.__workspaceStore__?.getState?.().activeComponentId
              ?? null,
          }));
          assert(suite, !sdfEditorState.hasReadOnlyBadge, `${dir}: SDF source is editable`);
          assert(suite, sdfEditorState.hasSaveButton, `${dir}: SDF source exposes Save`);
          assert(suite, Boolean(sdfEditorState.componentId), `${dir}: active SDF component resolved`);

          const propertyEditedName = 'sdf_property_edited';
          await store.setName(session.page, propertyEditedName);
          await session.page.waitForFunction(
            (expectedName) =>
              window.__URDF_STUDIO_DEBUG__?.__sourceEditor?.getValue?.()
                ?.includes(expectedName) ?? false,
            { timeout: 30_000 },
            propertyEditedName,
          ).catch(async (error) => {
            const diagnostics = await session.page.evaluate((componentId) => {
              const workspace = window.__URDF_STUDIO_DEBUG__?.__workspaceStore__?.getState?.()
                .workspace;
              const draft = window.__URDF_STUDIO_DEBUG__?.__assetsStore__?.getState?.()
                .componentSourceDrafts?.[componentId];
              return {
                robotName: workspace?.components?.[componentId]?.robot?.name ?? null,
                draftFormat: draft?.format ?? null,
                draftHasEditedName: draft?.content?.includes('sdf_property_edited') ?? false,
                editorHasEditedName:
                  window.__URDF_STUDIO_DEBUG__?.__sourceEditor?.getValue?.()
                    ?.includes('sdf_property_edited') ?? false,
              };
            }, sdfEditorState.componentId);
            throw new Error(`${error.message}; diagnostics=${JSON.stringify(diagnostics)}`);
          });
          const propertyEditedSource = await getSourceEditorText(session.page);
          assert(
            suite,
            propertyEditedSource.includes(propertyEditedName),
            `${dir}: property edit incrementally updates SDF source`,
          );

          const sourceEditedName = 'sdf_source_saved';
          const sourceEditedText = propertyEditedSource.replace(
            /(<model\b[^>]*\bname\s*=\s*['"])sdf_property_edited(['"])/,
            `$1${sourceEditedName}$2`,
          );
          assert(
            suite,
            sourceEditedText !== propertyEditedSource,
            `${dir}: SDF model name is editable in source text`,
          );
          await replaceSourceEditorText(
            session.page,
            sourceEditedText,
          );
          await saveSourceEditor(session.page);
          await session.page.waitForFunction(
            (componentId, expectedName) =>
              window.__URDF_STUDIO_DEBUG__?.__workspaceStore__?.getState?.()
                .workspace?.components?.[componentId]?.robot?.name === expectedName,
            { timeout: 30_000 },
            sdfEditorState.componentId,
            sourceEditedName,
          );
          const savedDraft = await session.page.evaluate((componentId) => {
            const draft = window.__URDF_STUDIO_DEBUG__?.__assetsStore__?.getState?.()
              .componentSourceDrafts?.[componentId];
            return { content: draft?.content ?? '', format: draft?.format ?? null };
          }, sdfEditorState.componentId);
          assert(suite, savedDraft.format === 'sdf', `${dir}: saved draft keeps SDF format`);
          assert(
            suite,
            savedDraft.content.includes(sourceEditedName),
            `${dir}: source save updates SDF draft and RobotData`,
          );

          await session.page.evaluate(() => {
            const controls = document.querySelectorAll(
              '.source-code-editor-window button[data-window-control]',
            );
            const closeButton = controls.item(controls.length - 1);
            if (closeButton instanceof HTMLButtonElement) closeButton.click();
          });
        }

        results.push({ model: dir, status: 'ok', linkCount: topo.linkCount, jointCount: topo.jointCount });
      } catch (err) {
        assert(suite, false, `${dir}: import succeeded — ${err.message}`);
        results.push({ model: dir, status: 'error', error: err.message });
      }
    }

    const errs = session.errors();
    assert(suite, errs.page.length === 0, `no page errors (${errs.page.length})`);
  } finally {
    await session.cleanup();
  }

  await writeReport('sdf_model_import', { results });
  process.exitCode = printSummary(suite) ? 0 : 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
