import assert from 'node:assert/strict';
import test from 'node:test';
import { Euler, Quaternion, Vector3 } from 'three';

import { DEFAULT_JOINT, JointType, type RobotClosedLoopJointConstraint } from '@/types';
import { serializeClosedLoopConstraintDefinition, serializeJointDefinition } from './usdJointSerializer';

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

function readQuaternion(content: string, attribute: string): Quaternion {
  const match = content.match(new RegExp(`quatf ${attribute} = \\(([^)]+)\\)`));
  assert.ok(match, `expected ${attribute}`);
  const [w, x, y, z] = match[1].split(',').map(Number);
  return new Quaternion(x, y, z, w);
}

for (const axis of [{ x: 0, y: 0, z: -1 }, { x: 1, y: -2, z: 3 }]) {
  for (const jointType of [JointType.REVOLUTE, JointType.CONTINUOUS, JointType.PRISMATIC]) {
    test(`USD ${jointType} closed-loop physics preserves rotated axis ${JSON.stringify(axis)}`, () => {
      const constraint: RobotClosedLoopJointConstraint = {
        id: 'loop', type: 'joint', jointType, axis,
        linkAId: 'parent', linkBId: 'child',
        anchorLocalA: { x: 1, y: 2, z: 3 },
        anchorLocalB: { x: 0.1, y: 0.2, z: 0.3 },
        anchorWorld: { x: 1, y: 2, z: 3 },
        origin: { xyz: { x: 9, y: 8, z: 7 }, rpy: { r: 0.3, p: 0.7, y: -0.4 } },
        limit: { lower: -0.5, upper: 0.8, effort: 2, velocity: 3 },
      };
      const lines: string[] = [];
      serializeClosedLoopConstraintDefinition(
        constraint, new Map([['parent', '/parent'], ['child', '/child']]), lines, 0,
      );
      const content = lines.join('\n');
      const tokenMatch = content.match(/physics:axis = "([XYZ])"/);
      assert.ok(tokenMatch);
      const tokenAxis = new Vector3(
        Number(tokenMatch[1] === 'X'), Number(tokenMatch[1] === 'Y'), Number(tokenMatch[1] === 'Z'),
      );
      const originRotation = new Quaternion().setFromEuler(new Euler(0.3, 0.7, -0.4, 'ZYX'));
      const expectedAxisB = new Vector3(axis.x, axis.y, axis.z).normalize();
      const localRot0 = readQuaternion(content, 'physics:localRot0');
      const localRot1 = readQuaternion(content, 'physics:localRot1');
      assert.ok(tokenAxis.clone().applyQuaternion(localRot1).distanceTo(expectedAxisB) < 1e-12);
      assert.ok(tokenAxis.applyQuaternion(localRot0).distanceTo(expectedAxisB.applyQuaternion(originRotation)) < 1e-12);
      assert.ok(localRot0.multiply(localRot1.invert()).angleTo(originRotation) < 1e-7);
      assert.match(content, /physics:localPos0 = \(1, 2, 3\)/);
      assert.match(content, /physics:localPos1 = \(0.1, 0.2, 0.3\)/);
      if (jointType === JointType.CONTINUOUS) {
        assert.doesNotMatch(content, /physics:(lower|upper)Limit/);
      } else if (jointType === JointType.PRISMATIC) {
        assertScalar(content, 'physics:lowerLimit', -0.5);
        assertScalar(content, 'physics:upperLimit', 0.8);
      }
    });
  }
}

test('USD fixed closed-loop physics preserves quaternion orientation and both anchors', () => {
  const rotation = new Quaternion().setFromEuler(new Euler(0.2, 0.5, -0.6, 'ZYX'));
  const constraint: RobotClosedLoopJointConstraint = {
    id: 'weld', type: 'joint', jointType: JointType.FIXED,
    linkAId: 'parent', linkBId: 'child',
    anchorLocalA: { x: 1, y: 2, z: 3 }, anchorLocalB: { x: 4, y: 5, z: 6 },
    anchorWorld: { x: 1, y: 2, z: 3 },
    origin: {
      xyz: { x: 9, y: 8, z: 7 }, rpy: { r: 0, p: 0, y: 0 },
      quatXyzw: { x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w },
    },
  };
  const lines: string[] = [];
  serializeClosedLoopConstraintDefinition(
    constraint, new Map([['parent', '/parent'], ['child', '/child']]), lines, 0,
  );
  const content = lines.join('\n');
  assert.match(content, /def PhysicsFixedJoint "weld"/);
  assert.doesNotMatch(content, /physics:axis/);
  assert.match(content, /physics:localPos0 = \(1, 2, 3\)/);
  assert.match(content, /physics:localPos1 = \(4, 5, 6\)/);
  assert.ok(readQuaternion(content, 'physics:localRot0').angleTo(rotation) < 1e-7);
  assert.ok(readQuaternion(content, 'physics:localRot1').angleTo(new Quaternion()) < 1e-7);
});
