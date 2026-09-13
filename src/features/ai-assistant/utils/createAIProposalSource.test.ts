import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';

import { parseMJCF, parseURDF } from '@/core/parsers';
import { createComponentSourceDraft, createJoint, createLink } from '@/core/robot';
import { GeometryType, JointType, type RobotState } from '@/types';
import { createAIProposalSource } from './createAIProposalSource';

globalThis.DOMParser = new JSDOM().window.DOMParser as typeof DOMParser;

function createRobot(type: JointType): RobotState {
  return {
    name: 'proposal',
    rootLinkId: 'base',
    links: { base: createLink({ id: 'base' }), child: createLink({ id: 'child' }) },
    joints: { joint: createJoint({ id: 'joint', parentLinkId: 'base', childLinkId: 'child', type }) },
    selection: { type: null, id: null },
  };
}

for (const type of [JointType.BALL, JointType.FLOATING]) {
  test(`AI proposals preserve ${type} joints in both sides of the source diff`, () => {
    const current = createRobot(type);
    current.inspectionContext = { sourceFormat: 'mjcf' };
    const proposed = { ...current, name: 'edited' };

    const result = createAIProposalSource(current, proposed);

    assert.equal(result.sourceFormat, 'mjcf');
    for (const source of [result.currentUrdf, result.proposedUrdf]) {
      const robot = parseMJCF(source);
      assert.ok(robot);
      assert.ok(Object.values(robot.joints).some(joint => joint.type === type));
    }
  });
}

test('a proposal that changes away from ball still previews the current ball model as MJCF', () => {
  const current = createRobot(JointType.BALL);
  const result = createAIProposalSource(current, createRobot(JointType.FIXED));

  assert.equal(result.sourceFormat, 'mjcf');
  assert.match(result.currentUrdf, /type="ball"/);
  assert.match(result.proposedUrdf, /<mujoco/);
});

test('MJCF drafts retain their format even when their joints also support URDF', () => {
  const current = createRobot(JointType.FIXED);
  const content = '<mujoco model="authored"><worldbody /></mujoco>';
  const draft = createComponentSourceDraft({ componentId: 'robot', format: 'mjcf', content, robot: current });

  const result = createAIProposalSource(current, { ...current, name: 'edited' }, draft);

  assert.equal(result.sourceFormat, 'mjcf');
  assert.equal(result.currentUrdf, content);
});

test('URDF-compatible proposals keep the existing URDF diff', () => {
  const current = createRobot(JointType.FIXED);
  const result = createAIProposalSource(current, { ...current, name: 'edited' });

  assert.equal(result.sourceFormat, 'urdf');
  assert.match(result.currentUrdf, /<robot name="proposal"/);
  assert.match(result.proposedUrdf, /<robot name="edited"/);
});

for (const format of ['mjcf', 'urdf'] as const) {
  test(`AI ${format} comparison derives its current side from the model when the retained draft is stale`, () => {
    const previous = createRobot(JointType.FIXED);
    const draft = createComponentSourceDraft({
      componentId: 'robot', format, robot: previous,
      content: format === 'mjcf'
        ? '<mujoco model="previous"><worldbody /></mujoco>'
        : '<robot name="previous"><link name="base" /></robot>',
    });
    const current = { ...previous, name: 'canonical_current' };

    const result = createAIProposalSource(current, { ...current, name: 'proposed' }, draft);

    assert.equal(result.sourceFormat, format);
    assert.notEqual(result.currentUrdf, draft.content);
    const parsed = format === 'mjcf' ? parseMJCF(result.currentUrdf) : parseURDF(result.currentUrdf);
    assert.ok(parsed);
    assert.equal(parsed.name, 'canonical_current');
    assert.equal(Object.keys(parsed.links).length, Object.keys(current.links).length);
    assert.equal(draft.content.includes('previous'), true);
  });
}

test('unfinished MJCF collision geometry has no source preview and no export warning', context => {
  const warning = context.mock.method(console, 'warn', () => {});
  const current = createRobot(JointType.BALL);
  current.links.child.collision.type = GeometryType.MESH;
  current.links.child.collision.meshPath = undefined;

  const result = createAIProposalSource(current, { ...current, name: 'edited' });

  assert.deepEqual(result, { currentUrdf: '', proposedUrdf: '' });
  assert.equal(warning.mock.callCount(), 0);
});

for (const changedSide of ['current', 'proposed'] as const) {
  test(`AI diff stays optional when its ${changedSide} side contains geometry the source format cannot preserve`, context => {
    const warning = context.mock.method(console, 'warn', () => {});
    const current = createRobot(JointType.FIXED);
    const proposed = { ...structuredClone(current), name: 'edited' };
    const changedRobot = changedSide === 'current' ? current : proposed;
    changedRobot.links.child.visual.type = GeometryType.ELLIPSOID;

    const result = createAIProposalSource(current, proposed);

    assert.deepEqual(result, { currentUrdf: '', proposedUrdf: '' });
    assert.equal(changedRobot.links.child.visual.type, GeometryType.ELLIPSOID);
    assert.equal(warning.mock.callCount(), 0);
  });
}

test('a ball and planar proposal never produces a source that degrades its joints', context => {
  const warning = context.mock.method(console, 'warn', () => {});
  const current = createRobot(JointType.BALL);
  const proposed = structuredClone(current);
  proposed.links.tip = createLink({ id: 'tip' });
  proposed.joints.planar = createJoint({
    id: 'planar', parentLinkId: 'child', childLinkId: 'tip', type: JointType.PLANAR,
  });

  const result = createAIProposalSource(current, proposed);

  assert.deepEqual(result, { currentUrdf: '', proposedUrdf: '' });
  assert.equal(proposed.joints.joint.type, JointType.BALL);
  assert.equal(proposed.joints.planar.type, JointType.PLANAR);
  assert.equal(warning.mock.callCount(), 0);
});
