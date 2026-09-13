import assert from 'node:assert/strict';
import test from 'node:test';
import { Quaternion, Vector3 } from 'three';

import { DEFAULT_JOINT, JointType } from '@/types';
import { serializeJointDefinition } from './usdJointSerializer';

function jointContent(layoutProfile: 'legacy' | 'isaacsim'): string {
  const joint = structuredClone(DEFAULT_JOINT);
  joint.type = JointType.PRISMATIC;
  joint.parentLinkId = 'parent';
  joint.childLinkId = 'child';
  joint.dynamics = { stiffness: 1e-12, damping: 2e-12, friction: 3e-12 };
  joint.limit = { lower: -1, upper: 1, effort: 4e-12, velocity: 5e-12 };
  joint.hardware.armature = 6e-12;
  const lines: string[] = [];
  serializeJointDefinition(joint, new Map([['parent', '/parent'], ['child', '/child']]), lines, 0, {
    layoutProfile,
  });
  return lines.join('\n');
}

function assertScalar(content: string, attribute: string, expected: number): void {
  const match = content.match(new RegExp(`${attribute} = ([^\\s]+)`));
  assert.ok(match, `expected ${attribute} to be authored`);
  assert.equal(Number(match[1]), expected);
}

test('USD joint serialization retains small nonzero authored drive gains and effort', () => {
  const content = jointContent('legacy');
  assertScalar(content, 'drive:linear:physics:stiffness', 1e-12);
  assertScalar(content, 'drive:linear:physics:damping', 2e-12);
  assertScalar(content, 'drive:linear:physics:maxForce', 4e-12);
});

test('Isaac USD joint serialization retains small velocity, friction and armature values', () => {
  const content = jointContent('isaacsim');
  assertScalar(content, 'physxJoint:maxJointVelocity', 5e-12);
  assertScalar(content, 'physxJoint:jointFriction', 3e-12);
  assertScalar(content, 'physxJoint:armature', 6e-12);
  assertScalar(content, 'drive:linear:physics:maxForce', 4e-12);
});

for (const magnitude of [1e-20, 1e-200, 1e200]) {
  test(`USD physics preserves joint axis direction for magnitude ${magnitude}`, () => {
    const joint = structuredClone(DEFAULT_JOINT);
    joint.type = JointType.REVOLUTE;
    joint.parentLinkId = 'parent';
    joint.childLinkId = 'child';
    joint.axis = { x: 0, y: magnitude, z: magnitude };
    const lines: string[] = [];
    serializeJointDefinition(joint, new Map([['parent', '/parent'], ['child', '/child']]), lines, 0);
    const content = lines.join('\n');
    assert.match(content, /uniform token physics:axis = "Y"/);
    const match = content.match(/quatf physics:localRot1 = \(([^)]+)\)/);
    assert.ok(match);
    const [w, x, y, z] = match[1].split(',').map(Number);
    const exportedAxis = new Vector3(0, 1, 0).applyQuaternion(new Quaternion(x, y, z, w));
    assert.ok(exportedAxis.distanceTo(new Vector3(0, Math.SQRT1_2, Math.SQRT1_2)) < 1e-12);
  });
}
