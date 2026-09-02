import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';

import { generateURDF } from '@/core/parsers';
import {
  createSingleComponentWorkspace,
  createSourceSemanticRobotHash,
} from '@/core/robot';
import { useAssetsStore } from '@/store/assetsStore';
import { useWorkspaceStore } from '@/store/workspaceStore';
import { DEFAULT_LINK, type RobotData } from '@/types';
import { applyAIUrdfModification } from './applyAIUrdfModification.ts';

globalThis.DOMParser = new JSDOM().window.DOMParser as typeof DOMParser;

function createRobot(name: string): RobotData {
  return {
    name,
    rootLinkId: 'body',
    links: {
      body: {
        ...structuredClone(DEFAULT_LINK),
        id: 'body',
        name: 'body',
      },
    },
    joints: {},
  };
}

test('AI apply returns the canonical live robot used by post-apply verification', () => {
  const initialWorkspaceState = useWorkspaceStore.getState();
  const initialAssetsState = useAssetsStore.getState();
  try {
    useWorkspaceStore.getState().replaceWorkspace(
      createSingleComponentWorkspace(createRobot('before'), { componentId: 'car' }),
      { resetHistory: true },
    );
    useAssetsStore.setState({ componentSourceDrafts: {} });

    const proposedRobot = createRobot('four-wheel-car');
    proposedRobot.links.body.visual.dimensions = { x: 1.2, y: 0.8, z: 0.25 };
    const proposedUrdf = generateURDF({
      ...proposedRobot,
      selection: { type: null, id: null },
    });

    const result = applyAIUrdfModification('car', proposedUrdf);
    if (!result.ok) assert.fail(`unexpected apply failure: ${result.reason}`);
    assert.equal(result.ok, true);

    const canonicalRobot = useWorkspaceStore.getState().workspace.components.car?.robot;
    assert.ok(canonicalRobot);
    assert.equal(canonicalRobot.name, 'four-wheel-car');
    assert.equal(canonicalRobot.links.body?.visual.dimensions.x, 1.2);
    assert.deepEqual(result.liveRobot, canonicalRobot);
    assert.notEqual(result.liveRobot, canonicalRobot, 'verification receives an immutable readback copy');
    assert.equal(result.liveRobotHash, createSourceSemanticRobotHash(canonicalRobot));
    assert.equal(
      useAssetsStore.getState().componentSourceDrafts.car?.content,
      proposedUrdf,
    );
  } finally {
    useWorkspaceStore.setState(initialWorkspaceState);
    useAssetsStore.setState(initialAssetsState);
  }
});
