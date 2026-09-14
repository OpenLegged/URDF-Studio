import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveIkGeometrySelectionState } from './ikGeometrySelectionState';

test('IK geometry selection activates for draggable link geometry', () => {
  const result = resolveIkGeometrySelectionState({
    toolMode: 'select',
    hitType: 'link',
    hitSubType: 'visual',
    linkId: 'tool_tip',
    fallbackId: 'tool_tip',
    resolveDirectIkHandleLink: (linkId) => (linkId === 'tool_tip' ? 'tool_tip' : null),
  });

  assert.deepEqual(result, {
    geometryIkSelectionActive: true,
    preferredIkHandleLinkId: 'tool_tip',
  });
});

test('IK geometry selection stays active for unsupported links so direct joint drag stays suppressed', () => {
  const result = resolveIkGeometrySelectionState({
    toolMode: 'select',
    hitType: 'link',
    hitSubType: 'visual',
    linkId: 'base_link',
    fallbackId: 'base_link',
    resolveDirectIkHandleLink: () => null,
  });

  assert.deepEqual(result, {
    geometryIkSelectionActive: true,
    preferredIkHandleLinkId: null,
  });
});

test('measure mode never activates IK geometry selection', () => {
  const result = resolveIkGeometrySelectionState({
    toolMode: 'measure',
    hitType: 'link',
    hitSubType: 'visual',
    linkId: 'tool_tip',
    fallbackId: 'tool_tip',
    resolveDirectIkHandleLink: () => 'tool_tip',
  });

  assert.deepEqual(result, {
    geometryIkSelectionActive: false,
    preferredIkHandleLinkId: null,
  });
});
