import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { JSDOM } from 'jsdom';
import { Vector3 } from 'three';

import { buildCanonicalExportContext } from '@/app/hooks/file-export/canonicalExportContext';
import { buildCanonicalWorkspaceSourceDocuments } from '@/app/utils/sourceCodeDocuments';
import { createSingleComponentWorkspace } from '@/core/robot/canonicalWorkspace';
import { createComponentSourceDraft } from '@/core/robot/componentSourceDraft';
import { computeLinkWorldMatrices } from '@/core/robot/kinematics';
import { prepareMjcfExport } from '@/features/file-io/utils/mjcfExport';
import { DEFAULT_JOINT, JointType, type AssemblyState, type RobotData } from '@/types';
import { generateMujocoXML } from './mjcfGenerator';
import { parseMJCFModel } from './mjcfModel';
import { parseMJCF } from './mjcfParser';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.DOMParser = dom.window.DOMParser;
after(() => dom.window.close());

function source(name: string, floating = false, physical = true): string {
  return `<mujoco model="${name}"><compiler angle="radian"/><worldbody>
    <body name="${name}" pos="0.1 0.2 0.3" euler="0.1 -0.2 0.3">
      ${floating ? '<freejoint name="floating_base"/>' : ''}
      ${physical ? '<inertial pos="0 0 0" mass="1" diaginertia="0.0067 0.0067 0.0067"/>' : ''}
      <geom name="box" type="box" size="0.1 0.1 0.1" ${physical ? '' : 'group="1" contype="0" conaffinity="0"'}/>
    </body>
  </worldbody></mujoco>`;
}

function parseRobot(xml: string): RobotData {
  const robot = parseMJCF(xml);
  assert.ok(robot, 'fixture/export must parse into a robot');
  const { selection: _selection, ...robotData } = robot;
  return robotData;
}

function makeWorkspace(connected: boolean, floating = false): AssemblyState {
  const workspace = createSingleComponentWorkspace(parseRobot(source('box_a', floating)), {
    componentId: 'left', sourceFile: 'left.xml',
  });
  workspace.components.right = createSingleComponentWorkspace(parseRobot(source('box_b', floating)), {
    componentId: 'right', sourceFile: 'right.xml',
  }).components.right!;
  workspace.transform = {
    position: { x: 2, y: -1, z: 0.5 }, rotation: { r: 0.2, p: -0.4, y: 0.7 },
  };
  workspace.components.left!.transform = {
    position: { x: 0.5, y: 0.25, z: 1 }, rotation: { r: -0.3, p: 0.2, y: -0.6 },
  };
  workspace.components.right!.transform = {
    position: { x: -0.2, y: 0.8, z: 0.4 }, rotation: { r: 0.5, p: -0.1, y: 0.2 },
  };
  if (connected) {
    workspace.bridges.mount = {
      id: 'mount', name: 'mount',
      parentComponentId: 'left', parentLinkId: 'box_a',
      childComponentId: 'right', childLinkId: 'box_b',
      joint: {
        ...structuredClone(DEFAULT_JOINT), id: 'mount_joint', name: 'mount_joint',
        type: JointType.FIXED, parentLinkId: 'box_a', childLinkId: 'box_b',
        origin: { xyz: { x: 0.4, y: -0.2, z: 0.1 }, rpy: { r: 0.3, p: -0.2, y: 0.4 } },
      },
    };
  }
  return workspace;
}

function assertPhysicalWorldMatrices(sourceRobot: RobotData, xml: string): void {
  const parsed = parseRobot(xml);
  const expected = computeLinkWorldMatrices(sourceRobot);
  const actual = computeLinkWorldMatrices(parsed);
  const physicalLinks = Object.values(sourceRobot.links).filter((link) => (link.inertial?.mass ?? 0) > 0);
  assert.ok(physicalLinks.length > 0);
  for (const link of physicalLinks) {
    const roundtripLink = Object.values(parsed.links).find((candidate) => candidate.name === link.name);
    assert.ok(roundtripLink, `physical link ${link.name} must survive export`);
    const expectedMatrix = expected[link.id];
    const actualMatrix = actual[roundtripLink.id];
    assert.ok(expectedMatrix);
    assert.ok(actualMatrix);
    expectedMatrix.elements.forEach((value, index) => {
      assert.ok(
        Math.abs(value - actualMatrix.elements[index]!) < 1e-8,
        `${link.name}: world matrix element ${index} changed from ${value} to ${actualMatrix.elements[index]}`,
      );
    });
  }
}

for (const connected of [false, true]) {
  for (const authoredFloating of [false, true]) {
    for (const addFloatBase of [false, true]) {
      test(`assembled MJCF preserves poses: connected=${connected}, sourceFree=${authoredFloating}, addFree=${addFloatBase}`, async () => {
        const workspace = makeWorkspace(connected, authoredFloating);
        const before = structuredClone(workspace);
        const context = buildCanonicalExportContext({ workspace, componentSourceDrafts: {} });
        const { xml } = await prepareMjcfExport({
          robot: context.robot, assets: {},
          mujoco: { addFloatBase, frameLinkIds: context.mjcfFrameLinkIds, preserveNumericPrecision: true },
        });
        const model = parseMJCFModel(xml);
        assert.ok(model);
        assert.deepEqual(model.recoveryDiagnostics, [], 'export must not rely on parser recovery');
        const rootCount = connected ? 1 : 2;
        assert.equal(model.worldBody.children.length, rootCount, 'coordinate frames must not become physical roots');
        const document = new DOMParser().parseFromString(xml, 'text/xml');
        assert.equal(document.querySelectorAll('freejoint').length, authoredFloating || addFloatBase ? rootCount : 0);
        for (const body of model.worldBody.children) {
          assert.equal(body.joints.filter((joint) => joint.type === 'free').length, authoredFloating || addFloatBase ? 1 : 0);
        }
        for (const id of context.mjcfFrameLinkIds ?? []) {
          const frameName = context.robot.links[id]!.name;
          assert.equal(
            Array.from(document.querySelectorAll('body')).some((body) => body.getAttribute('name') === frameName),
            false,
            `export-only frame ${frameName} must not receive body inertia or a free joint`,
          );
        }
        assertPhysicalWorldMatrices(context.robot, xml);
        assert.deepEqual(workspace, before, 'export must not rewrite canonical workspace state');
      });
    }
  }
}

test('single transformed MJCF component composes assembly and component frames without a dummy moving root', () => {
  const workspace = makeWorkspace(false);
  delete workspace.components.right;
  const before = structuredClone(workspace);
  const context = buildCanonicalExportContext({ workspace, componentSourceDrafts: {} });
  const xml = generateMujocoXML(context.robot, {
    addFloatBase: true, frameLinkIds: context.mjcfFrameLinkIds, preserveNumericPrecision: true,
  });
  const model = parseMJCFModel(xml);
  assert.ok(model);
  assert.equal(model.worldBody.children.length, 1);
  assert.equal(model.worldBody.children[0]!.joints.filter((joint) => joint.type === 'free').length, 1);
  assert.equal(model.worldBody.children[0]!.inertial?.mass, 1);
  assertPhysicalWorldMatrices(context.robot, xml);
  assert.deepEqual(workspace, before);
});

for (const name of ['__workspace_scene_root__', '__assembly_root', '__assembly_component_root_left']) {
  test(`authored link ${name} stays physical despite a reserved-looking name`, () => {
    const parsed = parseRobot(source(name));
    // Use the physical link as the actual root, matching an ordinary URDF root.
    const robot: RobotData = {
      ...parsed, rootLinkId: name, links: { [name]: parsed.links[name]! }, joints: {},
    };
    const workspace = createSingleComponentWorkspace(robot, { componentId: 'left' });
    workspace.components.left!.transform.position.x = 0.5;
    workspace.transform.rotation.y = 0.4;
    const before = structuredClone(workspace);
    const context = buildCanonicalExportContext({ workspace, componentSourceDrafts: {} });
    assert.equal(context.mjcfFrameLinkIds?.has(name), false, 'authored root must not acquire synthetic provenance');
    const xml = generateMujocoXML(context.robot, {
      addFloatBase: true, frameLinkIds: context.mjcfFrameLinkIds, preserveNumericPrecision: true,
    });
    const model = parseMJCFModel(xml);
    assert.ok(model);
    assert.equal(model.worldBody.children.length, 1);
    assert.equal(model.worldBody.children[0]!.name, name);
    assert.equal(model.worldBody.children[0]!.inertial?.mass, 1);
    assert.equal(model.worldBody.children[0]!.joints.filter((joint) => joint.type === 'free').length, 1);
    assertPhysicalWorldMatrices(context.robot, xml);
    assert.deepEqual(workspace, before);
  });
}

test('a real moving body without collision or inertia is still rejected inside assembly frames', () => {
  const workspace = makeWorkspace(false);
  workspace.components.right!.robot = parseRobot(source('invalid_body', true, false));
  const before = structuredClone(workspace);
  const context = buildCanonicalExportContext({ workspace, componentSourceDrafts: {} });
  for (const addFloatBase of [false, true]) {
    assert.throws(
      () => generateMujocoXML(context.robot, { addFloatBase, frameLinkIds: context.mjcfFrameLinkIds }),
      /invalid_body: missing collision geometry for mass\/inertia estimation/,
    );
  }
  assert.deepEqual(workspace, before);
});

for (const jointType of ['hinge', 'slide'] as const) {
  test(`rerooted source-world ${jointType} is rejected instead of silently dropping its joint`, () => {
    const workspace = makeWorkspace(true);
    workspace.components.right!.robot = parseRobot(source('box_b').replace(
      '<inertial',
      `<joint name="base_joint" type="${jointType}" axis="0 0 1"/><inertial`,
    ));
    const before = structuredClone(workspace);
    const context = buildCanonicalExportContext({ workspace, componentSourceDrafts: {} });
    for (const addFloatBase of [false, true]) {
      for (const includeActuators of [false, true]) {
        assert.throws(
          () => generateMujocoXML(context.robot, {
            frameLinkIds: context.mjcfFrameLinkIds, addFloatBase, includeActuators,
          }),
          /Coordinate frame "right_world" has a moving joint and cannot be flattened/,
          'non-free joints must not disappear or leave dangling actuator targets',
        );
      }
    }
    assert.deepEqual(workspace, before);
  });
}

test('source world planes and sites survive frame export with their composed world placement', () => {
  const workspace = makeWorkspace(false);
  workspace.components.left!.robot = parseRobot(source('box_a').replace(
    '<worldbody>',
    '<worldbody><geom name="ground" type="plane" size="2 2 0.1"/><site name="beacon" pos="0.2 0.4 0.6" size="0.01"/>',
  ));
  const before = structuredClone(workspace);
  const context = buildCanonicalExportContext({ workspace, componentSourceDrafts: {} });
  const frame = Object.values(context.robot.links).find((link) => link.mjcfSites?.some((site) => site.name.includes('beacon')));
  assert.ok(frame);
  assert.ok(context.mjcfFrameLinkIds?.has(frame.id));
  const xml = generateMujocoXML(context.robot, {
    addFloatBase: true, frameLinkIds: context.mjcfFrameLinkIds, preserveNumericPrecision: true,
  });
  const model = parseMJCFModel(xml);
  assert.ok(model);
  assert.deepEqual(model.recoveryDiagnostics, []);
  assert.equal(model.worldBody.children.length, 2);
  assert.ok(model.worldBody.geoms.some((geom) => geom.type === 'plane'), 'world plane must remain world geometry');
  const exportedSite = model.worldBody.sites.find((site) => site.name.includes('beacon'));
  assert.ok(exportedSite?.pos, 'source world site must not disappear when its owner becomes a frame');
  const frameMatrix = computeLinkWorldMatrices(context.robot)[frame.id];
  assert.ok(frameMatrix);
  const expected = new Vector3(0.2, 0.4, 0.6).applyMatrix4(frameMatrix).toArray();
  expected.forEach((value, index) => assert.ok(Math.abs(value - exportedSite.pos![index]!) < 1e-8));
  assertPhysicalWorldMatrices(context.robot, xml);
  assert.deepEqual(workspace, before);
});

test('fixed equality referencing a source-world frame retains a static named body anchor', () => {
  const workspace = makeWorkspace(false);
  workspace.components.left!.robot.closedLoopConstraints = [{
    id: 'world_weld', type: 'joint', jointType: JointType.FIXED,
    linkAId: 'world', linkBId: 'box_a',
    anchorWorld: { x: 0, y: 0, z: 0 },
    anchorLocalA: { x: 0, y: 0, z: 0 },
    anchorLocalB: { x: 0, y: 0, z: 0 },
  }];
  const before = structuredClone(workspace);
  const context = buildCanonicalExportContext({ workspace, componentSourceDrafts: {} });
  const constraint = context.robot.closedLoopConstraints?.[0];
  assert.ok(constraint);
  assert.ok(context.mjcfFrameLinkIds?.has(constraint.linkAId));
  const frameName = context.robot.links[constraint.linkAId]!.name;
  const xml = generateMujocoXML(context.robot, {
    addFloatBase: true, frameLinkIds: context.mjcfFrameLinkIds, preserveNumericPrecision: true,
  });
  const document = new DOMParser().parseFromString(xml, 'text/xml');
  const anchor = Array.from(document.querySelectorAll('body')).find((body) => body.getAttribute('name') === frameName);
  assert.ok(anchor, 'equality needs a real named body target after source-world flattening');
  assert.equal(anchor.children.length, 0, 'anchor stays static and massless, with no moving children');
  const weld = document.querySelector('equality > weld');
  assert.ok(weld);
  assert.ok([weld.getAttribute('body1'), weld.getAttribute('body2')].includes(frameName));
  for (const name of [weld.getAttribute('body1'), weld.getAttribute('body2')]) {
    assert.ok(Array.from(document.querySelectorAll('body')).some((body) => body.getAttribute('name') === name));
  }
  const model = parseMJCFModel(xml);
  assert.ok(model);
  assert.deepEqual(model.recoveryDiagnostics, []);
  assert.equal(model.weldConstraints.length, 1);
  assertPhysicalWorldMatrices(context.robot, xml);
  assert.deepEqual(workspace, before);
});

test('connected MJCF source remains a read-only merged document', () => {
  const workspace = makeWorkspace(true);
  const before = structuredClone(workspace);
  const componentSourceDrafts = Object.fromEntries(Object.values(workspace.components).map((component) => [
    component.id,
    createComponentSourceDraft({
      componentId: component.id, format: 'mjcf',
      content: source(component.id === 'left' ? 'box_a' : 'box_b'), robot: component.robot,
    }),
  ]));
  const result = buildCanonicalWorkspaceSourceDocuments({
    workspace, activeComponentId: 'left', componentSourceDrafts,
    availableFiles: [], allFileContents: {},
  });
  assert.equal(result.mode, 'assembly');
  assert.equal(result.documents.length, 1);
  assert.equal(result.documents[0]!.documentFlavor, 'mjcf');
  assert.equal(result.documents[0]!.readOnly, true);
  assert.equal(result.documents[0]!.changeTarget, undefined);
  assert.ok(result.documents[0]!.content.includes('<mujoco'));
  assert.deepEqual(workspace, before);
});
