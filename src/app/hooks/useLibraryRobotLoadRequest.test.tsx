import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { createDefaultWorkspace } from '@/core/robot';
import type { RobotFile } from '@/types';

import { useLibraryRobotLoadRequest } from './useLibraryRobotLoadRequest.ts';

const selectedFile: RobotFile = {
  name: 'library/shared.urdf',
  format: 'urdf',
  content: '<robot name="shared" />',
};
const loadedComponent = Object.values(createDefaultWorkspace().components)[0]!;

test('directly opening the selected source still reaches the atomic replacement callback', async () => {
  const loadedFiles: RobotFile[] = [];
  let requestLoad: ReturnType<typeof useLibraryRobotLoadRequest> | null = null;

  function Probe() {
    requestLoad = useLibraryRobotLoadRequest({
      handlePreviewFileWithFeedback: () => {
        throw new Error('clean direct open should not preview');
      },
      hasWorkspaceEdits: false,
      onLoadRobot: async (file) => {
        loadedFiles.push(file);
        return { status: 'committed', component: loadedComponent };
      },
      shouldPreviewLibraryRobotLoad: false,
    });
    return null;
  }

  renderToStaticMarkup(React.createElement(Probe));
  assert.ok(requestLoad);
  const invokeRequest = requestLoad as unknown as ReturnType<
    typeof useLibraryRobotLoadRequest
  >;

  const outcome = await invokeRequest(selectedFile, 'direct');

  assert.equal(outcome, 'loaded');
  assert.deepEqual(loadedFiles, [selectedFile]);
});

test('same-source direct open still honors the unsaved source guard', async () => {
  let loadCount = 0;
  let requestLoad: ReturnType<typeof useLibraryRobotLoadRequest> | null = null;

  function Probe() {
    requestLoad = useLibraryRobotLoadRequest({
      handlePreviewFileWithFeedback: () => {},
      hasWorkspaceEdits: true,
      onLoadRobot: async () => {
        loadCount += 1;
        return { status: 'committed', component: loadedComponent };
      },
      shouldPreviewLibraryRobotLoad: false,
    });
    return null;
  }

  renderToStaticMarkup(React.createElement(Probe));
  assert.ok(requestLoad);
  const invokeRequest = requestLoad as unknown as ReturnType<
    typeof useLibraryRobotLoadRequest
  >;

  assert.equal(
    await invokeRequest(selectedFile, 'direct'),
    'needs-preview-or-discard-confirm',
  );
  assert.equal(loadCount, 0);
});
