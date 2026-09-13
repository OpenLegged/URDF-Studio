import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { JSDOM } from 'jsdom';

import { parseMJCF } from '@/core/parsers';
import { createComponentSourceDraft, createSingleComponentWorkspace } from '@/core/robot';
import { DEFAULT_JOINT, DEFAULT_LINK, GeometryType, JointType, type RobotData } from '@/types';
import { buildCanonicalWorkspaceSourceDocuments } from './sourceCodeDocuments';

const dom = new JSDOM();
const previousDOMParser = globalThis.DOMParser;
globalThis.DOMParser = dom.window.DOMParser;
after(() => {
  globalThis.DOMParser = previousDOMParser;
  dom.window.close();
});

function ballRobot(): RobotData {
  const robot = parseMJCF(`<mujoco model="ball_robot"><worldbody>
    <body name="base"><geom type="box" size="0.2 0.2 0.1"/>
      <body name="tip" pos="0 0 0.3">
        <joint name="spherical" type="ball"/>
        <geom type="sphere" size="0.1"/>
      </body>
    </body>
  </worldbody></mujoco>`);
  assert.ok(robot);
  const { selection: _selection, ...robotData } = robot;
  return robotData;
}

function baseRobot(): RobotData {
  return {
    name: 'base_robot',
    rootLinkId: 'base',
    links: { base: { ...structuredClone(DEFAULT_LINK), id: 'base', name: 'base' } },
    joints: {},
  };
}

test('MJCF collision edits remain serializable without an owned source draft', () => {
  const workspace = createSingleComponentWorkspace(ballRobot(), {
    componentId: 'ball',
    sourceFile: 'ball.xml',
  });
  const robot = workspace.components.ball.robot;
  robot.links.tip.collision = {
    ...structuredClone(DEFAULT_LINK.collision),
    type: GeometryType.BOX,
    dimensions: { x: 0.3, y: 0.4, z: 0.5 },
  };
  const before = structuredClone(workspace);
  const source = buildCanonicalWorkspaceSourceDocuments({
    workspace,
    activeComponentId: 'ball',
    componentSourceDrafts: {},
    availableFiles: [],
    allFileContents: {},
  });

  assert.equal(source.documentFlavor, 'mjcf');
  assert.match(source.fileName, /\.xml$/);
  assert.equal(source.documents[0].readOnly, false);
  const target = source.documents[0].changeTarget;
  assert.equal(target?.kind, 'component');
  if (target?.kind === 'component') assert.equal(target.format, 'mjcf');
  const parsed = parseMJCF(source.content);
  assert.ok(parsed);
  assert.equal(parsed.joints.spherical.type, JointType.BALL);
  assert.deepEqual(parsed.links.tip.collision.dimensions, { x: 0.3, y: 0.4, z: 0.5 });
  assert.deepEqual(workspace, before);
});

for (const ballLocation of ['bridge', 'component'] as const) {
  test(`a ball ${ballLocation} in a bridged group preserves its joints in the source view`, () => {
    const workspace = createSingleComponentWorkspace(baseRobot(), { componentId: 'left' });
    workspace.components.right = createSingleComponentWorkspace(
      ballLocation === 'component' ? ballRobot() : baseRobot(),
      { componentId: 'right' },
    ).components.right;
    workspace.bridges.mount = {
      id: 'mount',
      name: 'mount',
      parentComponentId: 'left',
      parentLinkId: 'base',
      childComponentId: 'right',
      childLinkId: workspace.components.right.robot.rootLinkId,
      joint: {
        ...structuredClone(DEFAULT_JOINT),
        id: 'mount',
        name: 'bridge_1787644167475',
        type: ballLocation === 'bridge' ? JointType.BALL : JointType.FIXED,
        parentLinkId: 'base',
        childLinkId: workspace.components.right.robot.rootLinkId,
      },
    };
    const before = structuredClone(workspace);
    const source = buildCanonicalWorkspaceSourceDocuments({
      workspace,
      activeComponentId: 'right',
      componentSourceDrafts: {
        left: createComponentSourceDraft({
          componentId: 'left',
          robot: workspace.components.left.robot,
          format: 'urdf',
          content: '<robot name="base_robot"><link name="base"/></robot>',
        }),
      },
      availableFiles: [],
      allFileContents: {},
    });

    assert.equal(source.mode, 'assembly');
    assert.equal(source.documentFlavor, 'mjcf');
    assert.equal(source.documents.length, 1);
    assert.equal(source.documents[0].readOnly, true);
    assert.equal(source.documents[0].changeTarget, undefined);
    assert.match(source.fileName, /\.xml$/);
    const parsed = parseMJCF(source.content);
    assert.ok(parsed);
    assert.equal(Object.values(parsed.joints).filter(joint => joint.type === JointType.BALL).length, 1);
    assert.deepEqual(workspace, before);
  });
}

test('an unfinished mesh collision does not block editing and source recovers when completed', () => {
  const workspace = createSingleComponentWorkspace(ballRobot(), { componentId: 'ball' });
  const link = workspace.components.ball.robot.links.tip;
  link.collision = { ...link.collision, type: GeometryType.MESH, meshPath: '' };
  const params = {
    workspace,
    activeComponentId: 'ball',
    componentSourceDrafts: {},
    availableFiles: [],
    allFileContents: {},
  };
  const before = structuredClone(workspace);
  const pending = buildCanonicalWorkspaceSourceDocuments(params);
  assert.equal(pending.content, '');
  assert.equal(pending.documents[0].readOnly, true);
  assert.equal(pending.documents[0].changeTarget, undefined);
  assert.deepEqual(workspace, before);

  link.collision.type = GeometryType.BOX;
  const recovered = buildCanonicalWorkspaceSourceDocuments(params);
  assert.equal(recovered.documents[0].readOnly, false);
  assert.equal(parseMJCF(recovered.content)?.joints.spherical.type, JointType.BALL);
});

for (const [format, type] of [['mjcf', JointType.PLANAR], ['sdf', JointType.FLOATING]] as const) {
  test(`${format} source views cannot drop or change a ${type} joint`, () => {
    const workspace = createSingleComponentWorkspace(ballRobot(), { componentId: 'ball' });
    workspace.components.ball.robot.inspectionContext = { sourceFormat: format };
    workspace.components.ball.robot.joints.spherical.type = type;
    const before = structuredClone(workspace);
    const source = buildCanonicalWorkspaceSourceDocuments({
      workspace,
      activeComponentId: 'ball',
      componentSourceDrafts: {},
      availableFiles: [],
      allFileContents: {},
    });
    assert.equal(source.content, '');
    assert.equal(source.documents[0].readOnly, true);
    assert.deepEqual(workspace, before);
  });
}
