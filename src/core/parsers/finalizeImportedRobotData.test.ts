import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultWorkspace } from '@/core/robot/canonicalWorkspace';
import type { RobotData } from '@/types';

import { finalizeImportedRobotData } from './finalizeImportedRobotData.ts';

function createRobot(name: string): RobotData {
  const workspace = createDefaultWorkspace(name);
  return structuredClone(Object.values(workspace.components)[0].robot);
}

/**
 * A payload that needs both recovery passes: the non-finite origin is repaired
 * by the first pass, while the malformed `visible` can only be dropped by the
 * salvage pass that runs after canonical validation fails.
 */
function createTwoPassRobot(): RobotData {
  const robot = createRobot('two_pass');
  const rootLinkId = robot.rootLinkId;
  robot.links.spare = { ...structuredClone(robot.links[rootLinkId]), id: 'spare', name: 'spare' };
  robot.links[rootLinkId].visual.origin.xyz.x = Number.NaN;
  (robot.links.spare as unknown as Record<string, unknown>).visible = 'yes';
  return robot;
}

test('salvage keeps the first pass repairs in the report it hands to the user', () => {
  const result = finalizeImportedRobotData(createTwoPassRobot(), 'urdf');

  assert.equal(result.status, 'ready');
  if (result.status !== 'ready') return;

  const recovery = result.robotData.inspectionContext?.recovery;
  const codes = new Set(recovery?.diagnostics.map((diagnostic) => diagnostic.code));
  // Losing either code would understate how much of the source was altered.
  assert.ok(codes.has('nonfinite_transform_component_defaulted'), 'first pass repair must survive');
  assert.ok(codes.has('invalid_link_omitted'), 'salvage drop must be reported');
  assert.equal(recovery?.recoveredItemCount, recovery?.diagnostics.length);
});

test('a payload with nothing displayable still fails the import', () => {
  const robot = createRobot('unusable');
  (robot as unknown as Record<string, unknown>).notAField = true;

  const result = finalizeImportedRobotData(robot, 'urdf');

  assert.equal(result.status, 'error');
  if (result.status !== 'error') return;
  assert.equal(result.reason, 'parse_failed');
  assert.match(result.detail, /could not be recovered safely/);
});

test('a clean payload reports no recovery at all', () => {
  const result = finalizeImportedRobotData(createRobot('clean'), 'urdf');

  assert.equal(result.status, 'ready');
  if (result.status !== 'ready') return;
  assert.equal(result.robotData.inspectionContext?.recovery, undefined);
});
