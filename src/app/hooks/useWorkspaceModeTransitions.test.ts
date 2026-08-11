import assert from 'node:assert/strict';
import test from 'node:test';

import React, { createRef } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { createDefaultWorkspace } from '@/core/robot';
import { useWorkspaceStore } from '@/store/workspaceStore';

import type { ProModeRoundtripSession } from '../appLayoutTypes';
import { useWorkspaceModeTransitions } from './useWorkspaceModeTransitions.ts';

test('mode switching derives from workspace projection without reseeding or mutating workspace', () => {
  const workspace = createDefaultWorkspace('canonical');
  useWorkspaceStore.getState().replaceWorkspace(workspace, { resetHistory: true });
  const snapshotBefore = structuredClone(useWorkspaceStore.getState().workspace);
  const sessionRef = createRef<ProModeRoundtripSession | null>();
  sessionRef.current = null;
  let hookValue: ReturnType<typeof useWorkspaceModeTransitions> | null = null;

  function Probe() {
    hookValue = useWorkspaceModeTransitions({
      previewFile: null,
      selectedFile: null,
      availableFiles: [],
      allFileContents: {},
      assets: {},
      getUsdPreparedExportCache: () => null,
      showToast: () => {},
      t: {
        generateWorkspaceUrdfDisconnected: 'disconnected',
        generateWorkspaceUrdfUnavailable: 'unavailable',
      },
      handleClosePreview: () => {},
      proModeRoundtripSessionRef: sessionRef,
    });
    return null;
  }
  renderToStaticMarkup(React.createElement(Probe));
  assert.ok(hookValue);
  const hook = hookValue as ReturnType<typeof useWorkspaceModeTransitions>;
  hook.handleSwitchTreeEditorToProMode();

  const committedSession = sessionRef.current as ProModeRoundtripSession | null;
  assert.ok(committedSession?.baselineSnapshot);
  assert.deepEqual(useWorkspaceStore.getState().workspace, snapshotBefore);
  assert.equal(useWorkspaceStore.getState().history.past.length, 0);
});
