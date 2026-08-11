import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultWorkspace } from '@/core/robot/canonicalWorkspace';
import { JointType, type RobotData, type RobotImportRecoveryDiagnostic } from '@/types';

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

test('parser recovery diagnostics are preserved alongside workflow recovery diagnostics', () => {
  const robot = createRobot('parser_recovery');
  const parserDiagnostic: RobotImportRecoveryDiagnostic = {
    code: 'parser_visual_omitted',
    severity: 'warning',
    category: 'geometry',
    message: 'A malformed visual was omitted by the parser.',
    action: 'omitted',
  };
  const workflowDiagnostic: RobotImportRecoveryDiagnostic = {
    code: 'missing_mesh_asset_omitted',
    severity: 'warning',
    category: 'geometry',
    message: 'A missing mesh asset was omitted by the import workflow.',
    action: 'omitted',
  };
  robot.inspectionContext = {
    sourceFormat: 'urdf',
    recovery: {
      diagnostics: [parserDiagnostic],
      diagnosticCounts: { error: 0, warning: 1, info: 0 },
      recoveredItemCount: 1,
    },
  };

  const result = finalizeImportedRobotData(robot, 'urdf', [workflowDiagnostic]);

  assert.equal(result.status, 'ready');
  if (result.status !== 'ready') return;
  assert.deepEqual(
    result.robotData.inspectionContext?.recovery?.diagnostics.map((diagnostic) => diagnostic.code),
    ['parser_visual_omitted', 'missing_mesh_asset_omitted'],
  );
  assert.equal(result.robotData.inspectionContext?.recovery?.recoveredItemCount, 2);
});

test('parser recovery keeps counts for diagnostics omitted from the retained detail list', () => {
  const robot = createRobot('many_parser_repairs');
  const retainedDiagnostic: RobotImportRecoveryDiagnostic = {
    code: 'parser_visual_omitted',
    severity: 'warning',
    category: 'geometry',
    message: 'A malformed visual was omitted by the parser.',
    action: 'omitted',
  };
  robot.inspectionContext = {
    sourceFormat: 'urdf',
    recovery: {
      diagnostics: [retainedDiagnostic],
      diagnosticCounts: { error: 0, warning: 4, info: 0 },
      recoveredItemCount: 4,
      omittedDiagnosticCount: 3,
    },
  };

  const result = finalizeImportedRobotData(robot, 'urdf');

  assert.equal(result.status, 'ready');
  if (result.status !== 'ready') return;
  assert.equal(result.robotData.inspectionContext?.recovery?.recoveredItemCount, 4);
  assert.equal(result.robotData.inspectionContext?.recovery?.diagnosticCounts.warning, 4);
  assert.equal(result.robotData.inspectionContext?.recovery?.omittedDiagnosticCount, 3);
});

test('SDF world-parent joints produce canonical recovery diagnostics', () => {
  const robot = createRobot('sdf_world_parent');
  const rootLinkId = robot.rootLinkId;
  robot.joints.world_mount = {
    id: 'world_mount',
    name: 'world_mount',
    type: JointType.FIXED,
    parentLinkId: '',
    childLinkId: rootLinkId,
    origin: {
      xyz: { x: 0, y: 0, z: 0 },
      rpy: { r: 0, p: 0, y: 0 },
    },
    dynamics: { damping: 0, friction: 0 },
    hardware: {
      armature: 0,
      brand: '',
      motorType: 'None',
      motorId: '',
      motorDirection: 1,
    },
  };

  const result = finalizeImportedRobotData(robot, 'sdf');

  assert.equal(result.status, 'ready');
  if (result.status !== 'ready') return;
  assert.equal(result.robotData.joints.world_mount, undefined);
  assert.deepEqual(
    result.robotData.inspectionContext?.recovery?.diagnostics[0]?.relatedIds,
    ['world_mount', rootLinkId],
  );
});
