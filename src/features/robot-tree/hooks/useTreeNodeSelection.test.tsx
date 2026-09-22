import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';

import { useSelectionStore } from '@/store/selectionStore';
import { DEFAULT_JOINT, type WorkspaceSelection } from '@/types';
import { useTreeAncestorAttention, useTreeNodeSelection } from './useTreeNodeSelection';

test('tree subscriptions ignore unrelated entities while keeping child branches and geometry indices', async () => {
  const dom = new JSDOM('<html><body><div id="root"></div></body></html>');
  Object.defineProperties(globalThis, {
    window: { configurable: true, value: dom.window },
    document: { configurable: true, value: dom.window.document },
    IS_REACT_ACT_ENVIRONMENT: { configurable: true, value: true },
  });
  const container = dom.window.document.getElementById('root');
  assert.ok(container);
  const root = createRoot(container);
  const joint = {
    ...structuredClone(DEFAULT_JOINT),
    id: 'hinge',
    parentLinkId: 'base',
    childLinkId: 'tip',
  };
  const childJoints = [joint];
  const joints = { hinge: joint };
  const renders = { branch: 0, geometry: 0, ancestor: 0 };
  let branch: ReturnType<typeof useTreeNodeSelection> | undefined;
  let geometry: ReturnType<typeof useTreeNodeSelection> | undefined;
  let ancestor = false;
  function BranchProbe() {
    branch = useTreeNodeSelection('left', 'base', childJoints);
    renders.branch += 1;
    return null;
  }
  function GeometryProbe() {
    geometry = useTreeNodeSelection('left', 'tip');
    renders.geometry += 1;
    return null;
  }
  function AncestorProbe() {
    ancestor = useTreeAncestorAttention('left', 'base', joints);
    renders.ancestor += 1;
    return null;
  }
  const hover = async (selection: WorkspaceSelection) => {
    await act(async () => useSelectionStore.getState().setHoveredSelection(selection));
  };
  const resetCounts = () => { renders.branch = 0; renders.geometry = 0; renders.ancestor = 0; };
  useSelectionStore.getState().clearSelection();
  useSelectionStore.getState().clearHover();
  useSelectionStore.getState().clearAttentionSelection();
  try {
    await act(async () => root.render(<><BranchProbe /><GeometryProbe /><AncestorProbe /></>));
    resetCounts();
    await hover({ entity: { type: 'link', componentId: 'right', entityId: 'tip' } });
    await hover({ entity: { type: 'link', componentId: 'left', entityId: 'unrelated' } });
    assert.deepEqual(renders, { branch: 0, geometry: 0, ancestor: 0 });

    const tipVisual: WorkspaceSelection = {
      entity: { type: 'link', componentId: 'left', entityId: 'tip' },
      subType: 'visual',
      objectIndex: 1,
    };
    await hover(tipVisual);
    assert.deepEqual(branch?.hoveredSelection, tipVisual);
    assert.deepEqual(geometry?.hoveredSelection, tipVisual);
    assert.deepEqual(renders, { branch: 1, geometry: 1, ancestor: 0 });
    await hover({ ...tipVisual, objectIndex: 2 });
    assert.equal(geometry?.hoveredSelection?.objectIndex, 2);

    resetCounts();
    await hover({ entity: { type: 'joint', componentId: 'left', entityId: 'hinge' } });
    assert.equal(branch?.hoveredSelection?.entity.type, 'joint');
    assert.equal(geometry?.hoveredSelection, null);
    assert.deepEqual(renders, { branch: 1, geometry: 1, ancestor: 0 });
    await act(async () => useSelectionStore.getState().setAttentionSelection(tipVisual));
    assert.equal(ancestor, true);
    assert.deepEqual(geometry?.attentionSelection, tipVisual);

    resetCounts();
    await act(async () => useSelectionStore.getState().setSelection({
      entity: { type: 'link', componentId: 'right', entityId: 'tip' },
    }));
    assert.deepEqual(renders, { branch: 0, geometry: 0, ancestor: 0 });
    await act(async () => useSelectionStore.getState().clearAttentionSelection());
    assert.equal(ancestor, false);
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
  }
});
