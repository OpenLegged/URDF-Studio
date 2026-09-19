import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { DEFAULT_JOINT, JointType, type UrdfJoint } from '@/types';
import {
  createDirectJointDragJointResolver,
  type DraggableRuntimeJoint,
} from './directJointDragJointResolver';

function createRuntimeJoint(
  name: string,
  jointType = 'revolute',
  hardPassiveSpring = false,
): DraggableRuntimeJoint {
  const joint: DraggableRuntimeJoint = new THREE.Object3D();
  joint.name = name;
  joint.isURDFJoint = true;
  joint.jointType = jointType;
  joint.userData.mjcfHardPassiveSpringJoint = hardPassiveSpring;
  return joint;
}

function attachChain(...objects: THREE.Object3D[]): void {
  for (let index = 1; index < objects.length; index += 1) {
    objects[index - 1].add(objects[index]);
  }
}

function createResolver(robot: THREE.Object3D, robotJoints?: Record<string, UrdfJoint>) {
  return createDirectJointDragJointResolver({ robot, robotJoints });
}

test('standalone passive spring joints remain directly draggable', () => {
  const robot = new THREE.Group();
  const spring = createRuntimeJoint('spring', 'revolute', true);
  const link = new THREE.Group();
  attachChain(robot, new THREE.Group(), spring, new THREE.Group(), link);
  const resolver = createResolver(robot);

  assert.equal(resolver.findParentJoint(link), spring);
  assert.equal(resolver.resolveJointObject(spring), spring);
});

test('an entirely passive chain selects the spring closest to the dragged link', () => {
  const robot = new THREE.Group();
  const hinge = createRuntimeJoint('hinge', 'revolute', true);
  const hingedLink = new THREE.Group();
  const slider = createRuntimeJoint('slider', 'prismatic', true);
  const slidingLink = new THREE.Group();
  attachChain(robot, hinge, hingedLink, slider, slidingLink);
  const resolver = createResolver(robot);

  assert.equal(resolver.findParentJoint(hingedLink), hinge);
  assert.equal(resolver.findParentJoint(slidingLink), slider);
  assert.equal(resolver.resolveJointObject(slider), slider);
});

test('passive spring chains still prefer a non-passive upstream control joint', () => {
  const robot = new THREE.Group();
  const controlJoint = createRuntimeJoint('control');
  const firstSpring = createRuntimeJoint('first_spring', 'revolute', true);
  const secondSpring = createRuntimeJoint('second_spring', 'prismatic', true);
  const link = new THREE.Group();
  attachChain(
    robot,
    controlJoint,
    new THREE.Group(),
    firstSpring,
    new THREE.Group(),
    secondSpring,
    link,
  );
  const resolver = createResolver(robot);

  assert.equal(resolver.findParentJoint(link), controlJoint);
  assert.equal(resolver.resolveJointObject(secondSpring), controlJoint);
});

test('canonical spring metadata provides the same fallback and actuator preference', () => {
  const robot = new THREE.Group();
  const upstream = createRuntimeJoint('upstream');
  const spring = createRuntimeJoint('spring', 'prismatic');
  const link = new THREE.Group();
  attachChain(robot, upstream, new THREE.Group(), spring, link);
  const robotJoints: Record<string, UrdfJoint> = {
    upstream: {
      ...DEFAULT_JOINT,
      id: 'upstream',
      name: 'upstream',
      dynamics: { damping: 0, friction: 0, stiffness: 4 },
      limit: { lower: 0, upper: 2 },
    },
    spring: {
      ...DEFAULT_JOINT,
      id: 'spring',
      name: 'spring',
      type: JointType.PRISMATIC,
      dynamics: { damping: 0, friction: 0, stiffness: 900 },
      limit: { lower: 0, upper: 0.03 },
    },
  };

  assert.equal(createResolver(robot, robotJoints).findParentJoint(link), spring);
  const actuatedJoints = {
    ...robotJoints,
    upstream: { ...robotJoints.upstream, limit: { effort: 12 } },
  };
  assert.equal(createResolver(robot, actuatedJoints).findParentJoint(link), upstream);
});

test('fixed descendants and intermediate runtime groups preserve the movable ancestor', () => {
  const robot = new THREE.Group();
  const spring = createRuntimeJoint('spring', 'revolute', true);
  const fixed = createRuntimeJoint('fixed', 'fixed');
  const link = new THREE.Group();
  attachChain(robot, spring, new THREE.Group(), fixed, new THREE.Group(), link);
  const resolver = createResolver(robot);

  assert.equal(resolver.findParentJoint(link), spring);
  assert.equal(resolver.resolveJointObject(fixed), spring);
});

test('ordinary movable descendants take precedence over upstream joints', () => {
  const robot = new THREE.Group();
  const upstream = createRuntimeJoint('upstream');
  const local = createRuntimeJoint('local');
  const link = new THREE.Group();
  attachChain(robot, upstream, new THREE.Group(), local, link);

  assert.equal(createResolver(robot).findParentJoint(link), local);
});

test('a chain without a single-degree-of-freedom joint has no drag target', () => {
  const robot = new THREE.Group();
  const floating = createRuntimeJoint('floating', 'floating');
  const fixed = createRuntimeJoint('fixed', 'fixed');
  const link = new THREE.Group();
  attachChain(robot, floating, new THREE.Group(), fixed, link);
  const resolver = createResolver(robot);

  assert.equal(resolver.findParentJoint(link), null);
  assert.equal(resolver.resolveJointObject(fixed), null);
  assert.equal(resolver.resolveJointObject(link), null);
  assert.equal(resolver.findParentJoint(null), null);
});

test('passive fallback stays inside the current robot', () => {
  const externalJoint = createRuntimeJoint('external');
  const robot = new THREE.Group();
  const spring = createRuntimeJoint('spring', 'revolute', true);
  const link = new THREE.Group();
  attachChain(externalJoint, robot, spring, link);

  assert.equal(createResolver(robot).findParentJoint(link), spring);
});

test('malformed parent cycles terminate while preserving the nearest passive fallback', () => {
  const robot = new THREE.Group();
  const spring = createRuntimeJoint('spring', 'revolute', true);
  const link = new THREE.Group();
  const ancestor = new THREE.Group();
  attachChain(robot, ancestor, spring, link);
  ancestor.parent = spring;

  assert.equal(createResolver(robot).findParentJoint(link), spring);
  spring.jointType = 'fixed';
  assert.equal(createResolver(robot).findParentJoint(link), null);
});
