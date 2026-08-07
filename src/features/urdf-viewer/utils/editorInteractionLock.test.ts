import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_JOINT, DEFAULT_LINK } from '@/types';
import { isRuntimeInteractionEditorLocked } from './editorInteractionLock.ts';

const links = {
  base_link: { ...structuredClone(DEFAULT_LINK), id: 'base_link', name: 'base_link' },
  arm_link: {
    ...structuredClone(DEFAULT_LINK),
    id: 'arm_link',
    name: 'arm_link',
    editorLocked: true,
  },
};
const joints = {
  shoulder: {
    ...structuredClone(DEFAULT_JOINT),
    id: 'shoulder',
    name: 'shoulder',
    parentLinkId: 'base_link',
    childLinkId: 'arm_link',
  },
};

test('runtime editor lock filters link geometry and attached joints', () => {
  assert.equal(
    isRuntimeInteractionEditorLocked(
      { type: 'link', id: 'arm_link', linkId: 'arm_link' },
      links,
      joints,
    ),
    true,
  );
  assert.equal(
    isRuntimeInteractionEditorLocked(
      { type: 'joint', id: 'shoulder' },
      links,
      joints,
    ),
    true,
  );
  assert.equal(
    isRuntimeInteractionEditorLocked(
      { type: 'link', id: 'base_link', linkId: 'base_link' },
      links,
      joints,
    ),
    false,
  );
});
