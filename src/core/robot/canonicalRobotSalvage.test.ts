import test from 'node:test';
import assert from 'node:assert/strict';

import type { RobotData } from '@/types';

import { salvageCanonicalRobotData } from './canonicalRobotSalvage.ts';
import { createDefaultWorkspace, validateCanonicalRobotData } from './canonicalWorkspace.ts';

const PATH = 'robot';

function createSingleLinkRobot(name: string): RobotData {
  const workspace = createDefaultWorkspace(name);
  return structuredClone(Object.values(workspace.components)[0].robot);
}

function createRobotWithChildLink(): RobotData {
  const robot = createSingleLinkRobot('salvage_fixture');
  const rootLinkId = robot.rootLinkId;
  const childLinkId = 'child_link';
  robot.links[childLinkId] = { ...structuredClone(robot.links[rootLinkId]), id: childLinkId, name: childLinkId };
  robot.joints.child_joint = {
    id: 'child_joint',
    name: 'child_joint',
    type: 'fixed',
    parentLinkId: rootLinkId,
    childLinkId,
    origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
    dynamics: { damping: 0, friction: 0 },
    hardware: { armature: 0, brand: '', motorType: 'None', motorId: '', motorDirection: 1 },
  } as RobotData['joints'][string];
  return robot;
}

function salvageInvalid(robot: RobotData) {
  const result = validateCanonicalRobotData(robot, PATH);
  assert.equal(result.valid, false, 'fixture must actually be invalid');
  return salvageCanonicalRobotData(robot, result.issues, PATH);
}

test('a link the canonical model cannot express is dropped so the rest still imports', () => {
  const robot = createRobotWithChildLink();
  // A non-boolean `visible` is a field-level defect recovery cannot repair.
  (robot.links.child_link as unknown as Record<string, unknown>).visible = 'yes';

  const salvage = salvageInvalid(robot);

  assert.ok(salvage);
  assert.equal(salvage.robotData.links.child_link, undefined);
  assert.ok(salvage.robotData.links[robot.rootLinkId]);
  assert.ok(
    salvage.diagnostics.some((diagnostic) => diagnostic.code === 'invalid_link_omitted'),
  );
});

test('dropping the root link re-anchors the tree on a surviving link', () => {
  const robot = createRobotWithChildLink();
  (robot.links[robot.rootLinkId] as unknown as Record<string, unknown>).visible = 'yes';

  const salvage = salvageInvalid(robot);

  assert.ok(salvage);
  assert.equal(salvage.robotData.links[robot.rootLinkId], undefined);
  assert.equal(salvage.robotData.rootLinkId, 'child_link');
  assert.ok(
    salvage.diagnostics.some((diagnostic) => diagnostic.code === 'invalid_root_link_reassigned'),
  );
});

test('ids containing dots resolve to the entity that owns the issue', () => {
  const robot = createRobotWithChildLink();
  robot.links['wheel.left'] = {
    ...structuredClone(robot.links.child_link),
    id: 'wheel.left',
    name: 'wheel.left',
  };
  (robot.links['wheel.left'] as unknown as Record<string, unknown>).visible = 'yes';

  const salvage = salvageInvalid(robot);

  assert.ok(salvage);
  assert.equal(salvage.robotData.links['wheel.left'], undefined);
  assert.ok(salvage.robotData.links.child_link, 'sibling links must survive');
});

test('issues without a droppable owner keep the import failure', () => {
  const robot = createRobotWithChildLink();
  (robot as unknown as Record<string, unknown>).notAField = true;

  assert.equal(salvageInvalid(robot), null);
});

test('salvage refuses to invent a robot when no link survives', () => {
  const robot = createSingleLinkRobot('single_link');
  (robot.links[robot.rootLinkId] as unknown as Record<string, unknown>).visible = 'yes';

  assert.equal(salvageInvalid(robot), null);
});

test('salvage leaves the caller-owned input untouched', () => {
  const robot = createRobotWithChildLink();
  (robot.links.child_link as unknown as Record<string, unknown>).visible = 'yes';

  salvageInvalid(robot);

  assert.ok(robot.links.child_link, 'input must not be mutated');
});
