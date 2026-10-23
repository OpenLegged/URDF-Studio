import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveLibraryRobotLoadAction } from './libraryRobotLoadPolicy.ts';

test('resolveLibraryRobotLoadAction keeps direct library model clicks as loads when the current state can be replaced directly', () => {
  assert.equal(
    resolveLibraryRobotLoadAction({
      shouldPreviewCurrentState: false,
      hasWorkspaceEdits: false,
      intent: 'direct',
    }),
    'load',
  );
});

test('resolveLibraryRobotLoadAction previews direct library model clicks when the current workspace has meaningful edits', () => {
  assert.equal(
    resolveLibraryRobotLoadAction({
      shouldPreviewCurrentState: true,
      hasWorkspaceEdits: false,
      intent: 'direct',
    }),
    'preview',
  );
});

test('resolveLibraryRobotLoadAction previews from the unsaved-edit confirmation without switching files', () => {
  assert.equal(
    resolveLibraryRobotLoadAction({
      shouldPreviewCurrentState: false,
      hasWorkspaceEdits: true,
      intent: 'preview',
    }),
    'preview',
  );
});

test('resolveLibraryRobotLoadAction reloads the already selected model when replacement is safe', () => {
  assert.equal(
    resolveLibraryRobotLoadAction({
      shouldPreviewCurrentState: true,
      hasWorkspaceEdits: false,
      intent: 'direct',
    }),
    'preview',
  );
});

test('resolveLibraryRobotLoadAction reloads the already selected model directly when clean', () => {
  assert.equal(
    resolveLibraryRobotLoadAction({
      shouldPreviewCurrentState: false,
      hasWorkspaceEdits: false,
      intent: 'direct',
    }),
    'load',
  );
});

test('resolveLibraryRobotLoadAction still guards same-source replacement with unsaved edits', () => {
  assert.equal(
    resolveLibraryRobotLoadAction({
      shouldPreviewCurrentState: false,
      hasWorkspaceEdits: true,
      intent: 'direct',
    }),
    'needs-preview-or-discard-confirm',
  );
});

test('resolveLibraryRobotLoadAction asks for preview or discard before replacing unsaved source edits', () => {
  assert.equal(
    resolveLibraryRobotLoadAction({
      shouldPreviewCurrentState: false,
      hasWorkspaceEdits: true,
      intent: 'direct',
    }),
    'needs-preview-or-discard-confirm',
  );
});

test('resolveLibraryRobotLoadAction discards unsaved source edits when requested', () => {
  assert.equal(
    resolveLibraryRobotLoadAction({
      shouldPreviewCurrentState: false,
      hasWorkspaceEdits: true,
      intent: 'discard',
    }),
    'load',
  );
});
