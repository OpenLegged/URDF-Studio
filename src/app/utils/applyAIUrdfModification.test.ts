import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';

import { generateMujocoXML, generateURDF, parseMJCF } from '@/core/parsers';
import {
  createSingleComponentWorkspace,
  createSourceSemanticRobotHash,
  createJoint,
  createLink,
} from '@/core/robot';
import { useAssetsStore } from '@/store/assetsStore';
import { useWorkspaceStore } from '@/store/workspaceStore';
import { DEFAULT_LINK, GeometryType, JointType, type RobotData } from '@/types';
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

test('canonical AI apply preserves unfinished geometry and mixed joints independently of preview text', () => {
  const initialWorkspaceState = useWorkspaceStore.getState();
  const initialAssetsState = useAssetsStore.getState();
  try {
    const robot = createRobot('before');
    robot.links.child = createLink({ id: 'child' });
    robot.links.tip = createLink({ id: 'tip' });
    robot.joints.ball = createJoint({ id: 'ball', parentLinkId: 'body', childLinkId: 'child', type: JointType.BALL });
    robot.joints.planar = createJoint({ id: 'planar', parentLinkId: 'child', childLinkId: 'tip', type: JointType.PLANAR });
    robot.links.child.collision.type = GeometryType.MESH;
    robot.links.child.collision.meshPath = undefined;
    useWorkspaceStore.getState().replaceWorkspace(
      createSingleComponentWorkspace(robot, { componentId: 'model' }),
      { resetHistory: true },
    );
    useAssetsStore.setState({ componentSourceDrafts: {} });
    const proposed = { ...structuredClone(robot), name: 'edited' };

    const result = applyAIUrdfModification('model', '<preview-is-not-the-model/>', 'mjcf', proposed);

    if (!result.ok) assert.fail(`unexpected apply failure: ${result.reason}`);
    assert.equal(result.liveRobot.name, 'edited');
    assert.equal(result.liveRobot.joints.ball.type, JointType.BALL);
    assert.equal(result.liveRobot.joints.planar.type, JointType.PLANAR);
    assert.equal(result.liveRobot.links.child.collision.type, GeometryType.MESH);
    assert.equal(result.liveRobot.links.child.collision.meshPath, undefined);
    assert.equal(useAssetsStore.getState().componentSourceDrafts.model, undefined);
    useWorkspaceStore.getState().undo();
    assert.equal(useWorkspaceStore.getState().workspace.components.model.robot.name, 'before');
  } finally {
    useWorkspaceStore.setState(initialWorkspaceState);
    useAssetsStore.setState(initialAssetsState);
  }
});

test('canonical AI apply rejects invalid topology without falling back to preview text', () => {
  const robot = createRobot('invalid');
  robot.rootLinkId = 'missing';

  assert.deepEqual(applyAIUrdfModification('model', '', undefined, robot), {
    ok: false,
    reason: 'invalid-robot',
  });
});

test('AI MJCF apply keeps ball and free joints and remains undoable', () => {
  const initialWorkspaceState = useWorkspaceStore.getState();
  const initialAssetsState = useAssetsStore.getState();
  try {
    const parsed = parseMJCF(`<mujoco model="before"><worldbody>
      <body name="base"><freejoint name="free_base"/><geom type="sphere" size="0.2"/>
        <body name="child" pos="0 0 1"><joint name="ball_joint" type="ball"/>
          <geom type="sphere" size="0.1"/>
        </body>
      </body>
    </worldbody></mujoco>`);
    assert.ok(parsed);
    const { selection: _selection, ...robot } = parsed;
    useWorkspaceStore.getState().replaceWorkspace(
      createSingleComponentWorkspace(robot, { componentId: 'mjcf' }),
      { resetHistory: true },
    );
    useAssetsStore.setState({ componentSourceDrafts: {} });
    const proposed = structuredClone(parsed);
    const child = Object.values(proposed.links).find(link => link.name === 'child');
    assert.ok(child);
    child.collision.type = GeometryType.BOX;
    child.collision.dimensions = { x: 0.4, y: 0.6, z: 0.8 };
    const source = generateMujocoXML({ ...proposed, name: 'edited' });

    const result = applyAIUrdfModification('mjcf', source, 'mjcf');

    if (!result.ok) assert.fail(`unexpected apply failure: ${result.reason}`);
    assert.equal(result.liveRobot.name, 'edited');
    const types = Object.values(result.liveRobot.joints).map(joint => joint.type);
    assert.ok(types.includes(JointType.BALL));
    assert.ok(types.includes(JointType.FLOATING));
    const appliedChild = Object.values(result.liveRobot.links).find(link => link.name === 'child');
    assert.equal(appliedChild?.collision.type, GeometryType.BOX);
    assert.deepEqual(appliedChild?.collision.dimensions, { x: 0.4, y: 0.6, z: 0.8 });
    assert.equal(useAssetsStore.getState().componentSourceDrafts.mjcf?.format, 'mjcf');
    assert.equal(useAssetsStore.getState().componentSourceDrafts.mjcf?.content, source);
    useWorkspaceStore.getState().undo();
    assert.equal(useWorkspaceStore.getState().workspace.components.mjcf.robot.name, 'before');
  } finally {
    useWorkspaceStore.setState(initialWorkspaceState);
    useAssetsStore.setState(initialAssetsState);
  }
});
