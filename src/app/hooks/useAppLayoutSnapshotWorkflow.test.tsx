import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';

import { DEFAULT_LINK, type RobotData } from '@/types';
import {
  useAppLayoutSnapshotWorkflow,
  type AppLayoutSnapshotWorkflow,
} from './useAppLayoutSnapshotWorkflow.ts';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost',
});
globalThis.window = dom.window as unknown as Window & typeof globalThis;
globalThis.document = dom.window.document;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function robot(): RobotData {
  return {
    name: 'snapshot-arm',
    rootLinkId: 'base',
    links: { base: { ...structuredClone(DEFAULT_LINK), id: 'base', name: 'base' } },
    joints: {},
  };
}

test('snapshot workflow owns dialog session open and close state', async () => {
  const container = document.createElement('div');
  const root = createRoot(container);
  const rendered: { workflow: AppLayoutSnapshotWorkflow | null } = { workflow: null };
  const getWorkflow = () => {
    assert.ok(rendered.workflow);
    return rendered.workflow;
  };

  function Probe() {
    rendered.workflow = useAppLayoutSnapshotWorkflow({
      availableFiles: [
        {
          name: 'snapshot-arm.urdf',
          format: 'urdf',
          content: '<robot name="snapshot-arm" />',
        },
      ],
      groundPlaneOffset: 0,
      jointAngleState: {},
      jointMotionState: {},
      selectedFileFormat: 'urdf',
      theme: 'light',
      urdfContentForViewer: '<robot name="snapshot-arm" />',
      viewerAssets: {},
      viewerDocumentReady: true,
      viewerReloadKey: 1,
      viewerRobot: robot(),
      viewerShowVisual: true,
      viewerSourceFile: null,
      viewerSourceFilePath: 'snapshot-arm.urdf',
      viewerSourceFormat: 'urdf',
      showToast: () => undefined,
      snapshotFailedMessage: 'Snapshot failed',
    });
    return null;
  }

  await act(async () => root.render(<Probe />));
  assert.equal(getWorkflow().isDialogOpen, false);
  assert.equal(getWorkflow().previewSession, null);

  await act(async () => getWorkflow().handleSnapshot());
  assert.equal(getWorkflow().isDialogOpen, true);
  assert.equal(getWorkflow().previewSession?.robotName, 'snapshot-arm');

  await act(async () => getWorkflow().handleCloseSnapshotDialog());
  assert.equal(getWorkflow().isDialogOpen, false);
  assert.equal(getWorkflow().previewSession, null);

  await act(async () => root.unmount());
});
