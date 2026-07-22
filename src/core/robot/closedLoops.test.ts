import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { JSDOM } from 'jsdom';
import * as THREE from 'three';

import { GeometryType, JointType, type RobotState, type UrdfJoint, type UrdfVisual } from '@/types';
import { parseMJCF } from '@/core/parsers/mjcf/mjcfParser.ts';
import { computeLinkWorldMatrices } from '@/core/robot/kinematics.ts';

import {
  resolveClosedLoopDrivenJointMotion,
  resolveClosedLoopJointMotionCompensation,
  resolveClosedLoopJointAngleCompensation,
  resolveClosedLoopJointOriginCompensation,
  resolveClosedLoopJointOriginCompensationDetailed,
  solveClosedLoopMotionCompensation,
} from './closedLoops.ts';
import { resolveMimicJointAngleTargets } from './mimic.ts';

function installDomGlobals(): void {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { contentType: 'text/html' });
  globalThis.window = dom.window as any;
  globalThis.document = dom.window.document as any;
  globalThis.DOMParser = dom.window.DOMParser as any;
  globalThis.XMLSerializer = dom.window.XMLSerializer as any;
  globalThis.Node = dom.window.Node as any;
  globalThis.Element = dom.window.Element as any;
  globalThis.Document = dom.window.Document as any;
}

function createNoneVisual(): UrdfVisual {
  return {
    type: GeometryType.NONE,
    dimensions: { x: 0, y: 0, z: 0 },
    color: '#000000',
    origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
  };
}

const MENAGERIE_ROOT = 'test/mujoco_menagerie-main';
const EXPECTED_MENAGERIE_CLOSED_LOOP_FIXTURE_PATHS = [
  'test/mujoco_menagerie-main/agility_cassie/cassie.xml',
  'test/mujoco_menagerie-main/iit_softfoot/softfoot.xml',
  'test/mujoco_menagerie-main/robotiq_2f85/2f85.xml',
  'test/mujoco_menagerie-main/robotiq_2f85_v4/2f85.xml',
  'test/mujoco_menagerie-main/robotiq_2f85_v4/mjx_2f85.xml',
  'test/mujoco_menagerie-main/stanford_tidybot/tidybot.xml',
  'test/mujoco_menagerie-main/ufactory_xarm7/hand.xml',
  'test/mujoco_menagerie-main/ufactory_xarm7/xarm7.xml',
] as const satisfies readonly string[];

function collectXmlFixturePaths(dirPath: string): string[] {
  return fs
    .readdirSync(dirPath, { withFileTypes: true })
    .flatMap((entry) => {
      const nextPath = `${dirPath}/${entry.name}`;
      if (entry.isDirectory()) {
        return collectXmlFixturePaths(nextPath);
      }

      return entry.isFile() && nextPath.endsWith('.xml') ? [nextPath] : [];
    })
    .sort();
}

function sortFixturePaths(paths: readonly string[]): string[] {
  return [...paths].sort((left, right) => left.localeCompare(right));
}

function hasWorldBody(xml: string): boolean {
  return /<worldbody\b/i.test(xml);
}

function isDrivenJointCandidate(joint: RobotState['joints'][string] | undefined): boolean {
  const jointType = String(joint?.type ?? '').toLowerCase();
  return jointType === 'revolute' || jointType === 'continuous' || jointType === 'prismatic';
}

function buildParentJointEntries(
  robot: Pick<RobotState, 'joints'>,
): Map<string, { jointId: string; joint: RobotState['joints'][string] }> {
  const parentJointEntries = new Map<
    string,
    { jointId: string; joint: RobotState['joints'][string] }
  >();

  Object.entries(robot.joints).forEach(([jointId, joint]) => {
    parentJointEntries.set(joint.childLinkId, { jointId, joint });
  });

  return parentJointEntries;
}

function findNearestDrivenJointCandidate(
  linkId: string,
  parentJointEntries: Map<string, { jointId: string; joint: RobotState['joints'][string] }>,
): string | null {
  const visitedLinkIds = new Set<string>();
  let currentLinkId: string | null = linkId;

  while (currentLinkId && !visitedLinkIds.has(currentLinkId)) {
    visitedLinkIds.add(currentLinkId);
    const parentJointEntry = parentJointEntries.get(currentLinkId);
    if (!parentJointEntry) {
      return null;
    }

    if (isDrivenJointCandidate(parentJointEntry.joint)) {
      return parentJointEntry.jointId;
    }

    currentLinkId = parentJointEntry.joint.parentLinkId;
  }

  return null;
}

function chooseDrivenJointTestAngle(joint: RobotState['joints'][string]): number {
  const authoredLower = joint.limit?.lower;
  const authoredUpper = joint.limit?.upper;
  const lower = typeof authoredLower === 'number' && Number.isFinite(authoredLower)
    ? authoredLower
    : -1;
  const upper = typeof authoredUpper === 'number' && Number.isFinite(authoredUpper)
    ? authoredUpper
    : 1;
  const current = Number.isFinite(joint.angle) ? joint.angle! : 0;
  const span = upper - lower;
  const step = Math.min(0.3, Math.abs(span) > 1e-6 ? Math.max(0.05, Math.abs(span) * 0.12) : 0.1);

  let selectedAngle = current + step;
  if (selectedAngle > upper) {
    selectedAngle = current - step;
  }
  if (selectedAngle < lower) {
    selectedAngle = (lower + upper) / 2;
  }
  if (Math.abs(selectedAngle - current) <= 1e-9 && upper > current) {
    selectedAngle = Math.min(upper, current + 0.05);
  }
  if (Math.abs(selectedAngle - current) <= 1e-9 && lower < current) {
    selectedAngle = Math.max(lower, current - 0.05);
  }

  return selectedAngle;
}

function discoverClosedLoopMenagerieFixtures() {
  return collectXmlFixturePaths(MENAGERIE_ROOT)
    .flatMap((fixturePath) => {
      const xml = fs.readFileSync(fixturePath, 'utf8');
      if (!hasWorldBody(xml)) {
        return [];
      }

      const robot = parseMJCF(xml);
      return robot?.closedLoopConstraints?.length ? [{ fixturePath, robot }] : [];
    })
    .sort((left, right) => left.fixturePath.localeCompare(right.fixturePath));
}

function pickDrivenJointSolveCase(
  robot: RobotState,
  fixturePath: string,
): {
  selectedJointId: string;
  selectedAngle: number;
  drivenMotion: ReturnType<typeof resolveMimicJointAngleTargets>;
  solution: ReturnType<typeof solveClosedLoopMotionCompensation>;
} {
  const parentJointEntries = buildParentJointEntries(robot);
  const candidateJointIds = [
    ...new Set(
      (robot.closedLoopConstraints ?? []).flatMap((constraint) => [
        findNearestDrivenJointCandidate(constraint.linkAId, parentJointEntries),
        findNearestDrivenJointCandidate(constraint.linkBId, parentJointEntries),
      ]),
    ),
  ].filter((jointId): jointId is string => Boolean(jointId));

  const attemptedJointIds: string[] = [];

  for (const selectedJointId of candidateJointIds) {
    const joint = robot.joints[selectedJointId];
    if (!joint) {
      continue;
    }

    attemptedJointIds.push(selectedJointId);
    const selectedAngle = chooseDrivenJointTestAngle(joint);
    const drivenMotion = resolveMimicJointAngleTargets(robot, selectedJointId, selectedAngle);
    const solution = solveClosedLoopMotionCompensation(robot, {
      angles: drivenMotion.angles,
      lockedJointIds: drivenMotion.lockedJointIds,
    });
    const compensationCount =
      Object.keys(solution.angles).length + Object.keys(solution.quaternions).length;

    if (solution.converged && compensationCount > 0) {
      return {
        selectedJointId,
        selectedAngle,
        drivenMotion,
        solution,
      };
    }
  }

  assert.fail(
    `expected ${fixturePath} to expose a loop-relevant driven joint candidate, attempted=${attemptedJointIds.join(', ') || 'none'}`,
  );
}

const robotWithClosedLoop: RobotState = {
  name: 'closed-loop-test',
  rootLinkId: 'base',
  selection: { type: null, id: null },
  links: {
    base: {
      id: 'base',
      name: 'base',
      visible: true,
      visual: createNoneVisual(),
      collision: createNoneVisual(),
      collisionBodies: [],
      inertial: {
        mass: 0,
        origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        inertia: { ixx: 0, ixy: 0, ixz: 0, iyy: 0, iyz: 0, izz: 0 },
      },
    },
    link_a: {
      id: 'link_a',
      name: 'link_a',
      visible: true,
      visual: createNoneVisual(),
      collision: createNoneVisual(),
      collisionBodies: [],
      inertial: {
        mass: 0,
        origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        inertia: { ixx: 0, ixy: 0, ixz: 0, iyy: 0, iyz: 0, izz: 0 },
      },
    },
    link_b: {
      id: 'link_b',
      name: 'link_b',
      visible: true,
      visual: createNoneVisual(),
      collision: createNoneVisual(),
      collisionBodies: [],
      inertial: {
        mass: 0,
        origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        inertia: { ixx: 0, ixy: 0, ixz: 0, iyy: 0, iyz: 0, izz: 0 },
      },
    },
  },
  joints: {
    joint_a: {
      id: 'joint_a',
      name: 'joint_a',
      type: JointType.REVOLUTE,
      parentLinkId: 'base',
      childLinkId: 'link_a',
      origin: { xyz: { x: 1, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
      axis: { x: 0, y: 0, z: 1 },
      limit: { lower: -1, upper: 1, effort: 1, velocity: 1 },
      dynamics: { damping: 0, friction: 0 },
      hardware: { armature: 0, motorType: '', motorId: '', motorDirection: 1 },
    },
    joint_b: {
      id: 'joint_b',
      name: 'joint_b',
      type: JointType.REVOLUTE,
      parentLinkId: 'base',
      childLinkId: 'link_b',
      origin: { xyz: { x: 1.2, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
      axis: { x: 0, y: 0, z: 1 },
      limit: { lower: -1, upper: 1, effort: 1, velocity: 1 },
      dynamics: { damping: 0, friction: 0 },
      hardware: { armature: 0, motorType: '', motorId: '', motorDirection: 1 },
    },
  },
  closedLoopConstraints: [
    {
      id: 'connect-link-a-link-b',
      type: 'connect',
      linkAId: 'link_a',
      linkBId: 'link_b',
      anchorWorld: { x: 1.2, y: 0, z: 0 },
      anchorLocalA: { x: 0.2, y: 0, z: 0 },
      anchorLocalB: { x: 0, y: 0, z: 0 },
      source: { format: 'mjcf', body1Name: 'link_a', body2Name: 'link_b' },
    },
  ],
};

const robotWithDistanceLoop: RobotState = {
  ...robotWithClosedLoop,
  joints: {
    joint_a: {
      ...robotWithClosedLoop.joints.joint_a,
      type: JointType.PRISMATIC,
      origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
      axis: { x: 1, y: 0, z: 0 },
      limit: { lower: -2, upper: 2, effort: 1, velocity: 1 },
      angle: 0,
    },
    joint_b: {
      ...robotWithClosedLoop.joints.joint_b,
      type: JointType.PRISMATIC,
      origin: { xyz: { x: 1.2, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
      axis: { x: 1, y: 0, z: 0 },
      limit: { lower: -2, upper: 2, effort: 1, velocity: 1 },
      angle: 0,
    },
  },
  closedLoopConstraints: [
    {
      id: 'distance-link-a-link-b',
      type: 'distance',
      linkAId: 'link_a',
      linkBId: 'link_b',
      restDistance: 1.2,
      anchorWorld: { x: 0, y: 0, z: 0 },
      anchorLocalA: { x: 0, y: 0, z: 0 },
      anchorLocalB: { x: 0, y: 0, z: 0 },
      source: { format: 'mjcf', body1Name: 'link_a', body2Name: 'link_b' },
    },
  ],
};

function createPlanarTwoBranchLoopRobot(driverAngle: number, branchSign: 1 | -1): RobotState {
  const passiveElbowAngle = branchSign * (2 * Math.PI) / 3;
  const passiveShoulderAngle = driverAngle - branchSign * Math.PI / 3;

  const createLink = (id: string) => ({
    id,
    name: id,
    visible: true,
    visual: createNoneVisual(),
    collision: createNoneVisual(),
    collisionBodies: [],
    inertial: {
      mass: 0,
      origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
      inertia: { ixx: 0, ixy: 0, ixz: 0, iyy: 0, iyz: 0, izz: 0 },
    },
  });

  const createRevoluteJoint = (
    id: string,
    parentLinkId: string,
    childLinkId: string,
    xyz: { x: number; y: number; z: number },
    angle: number,
  ): UrdfJoint => ({
    id,
    name: id,
    type: JointType.REVOLUTE,
    parentLinkId,
    childLinkId,
    origin: { xyz, rpy: { r: 0, p: 0, y: 0 } },
    axis: { x: 0, y: 0, z: 1 },
    limit: { lower: -Math.PI * 2, upper: Math.PI * 2, effort: 1, velocity: 1 },
    angle,
    dynamics: { damping: 0, friction: 0 },
    hardware: { armature: 0, motorType: '', motorId: '', motorDirection: 1 },
  });

  return {
    name: 'planar-two-branch-loop',
    rootLinkId: 'base',
    selection: { type: null, id: null },
    links: {
      base: createLink('base'),
      driver_link: createLink('driver_link'),
      upper_link: createLink('upper_link'),
      forearm_link: createLink('forearm_link'),
    },
    joints: {
      driver: createRevoluteJoint(
        'driver',
        'base',
        'driver_link',
        { x: 0, y: 0, z: 0 },
        driverAngle,
      ),
      shoulder: createRevoluteJoint(
        'shoulder',
        'base',
        'upper_link',
        { x: 0, y: 0, z: 0 },
        passiveShoulderAngle,
      ),
      elbow: createRevoluteJoint(
        'elbow',
        'upper_link',
        'forearm_link',
        { x: 1, y: 0, z: 0 },
        passiveElbowAngle,
      ),
    },
    closedLoopConstraints: [
      {
        id: 'connect-driver-passive-end',
        type: 'connect',
        linkAId: 'driver_link',
        linkBId: 'forearm_link',
        anchorWorld: { x: 0, y: 0, z: 0 },
        anchorLocalA: { x: 1, y: 0, z: 0 },
        anchorLocalB: { x: 1, y: 0, z: 0 },
        source: { format: 'mjcf', body1Name: 'driver_link', body2Name: 'forearm_link' },
      },
    ],
  };
}

test(
  'resolveClosedLoopJointOriginCompensation moves the opposite branch to preserve a connect loop',
  { concurrency: false },
  () => {
    const compensation = resolveClosedLoopJointOriginCompensation(robotWithClosedLoop, 'joint_a', {
      xyz: { x: 2, y: 0, z: 0 },
      rpy: { r: 0, p: 0, y: 0 },
    });

    assert.deepEqual(compensation, {
      joint_b: {
        xyz: { x: 2.2, y: 0, z: 0 },
        rpy: { r: 0, p: 0, y: 0 },
      },
    });
  },
);

test(
  'resolveClosedLoopJointOriginCompensation moves the opposite branch to preserve a distance loop',
  { concurrency: false },
  () => {
    const compensation = resolveClosedLoopJointOriginCompensation(
      robotWithDistanceLoop,
      'joint_a',
      {
        xyz: { x: 0.3, y: 0, z: 0 },
        rpy: { r: 0, p: 0, y: 0 },
      },
    );

    assert.deepEqual(compensation, {
      joint_b: {
        xyz: { x: 1.5, y: 0, z: 0 },
        rpy: { r: 0, p: 0, y: 0 },
      },
    });
  },
);

test(
  'resolveClosedLoopJointOriginCompensation skips constraints fully inside the dragged subtree',
  { concurrency: false },
  () => {
    const robot: RobotState = {
      ...robotWithClosedLoop,
      links: {
        root: {
          ...robotWithClosedLoop.links.base,
          id: 'root',
          name: 'root',
        },
        ...robotWithClosedLoop.links,
      },
      rootLinkId: 'root',
      joints: {
        root_joint: {
          ...robotWithClosedLoop.joints.joint_a,
          id: 'root_joint',
          name: 'root_joint',
          parentLinkId: 'root',
          childLinkId: 'base',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        ...robotWithClosedLoop.joints,
      },
    };

    const compensation = resolveClosedLoopJointOriginCompensation(robot, 'root_joint', {
      xyz: { x: 0.5, y: 0, z: 0 },
      rpy: { r: 0, p: 0, y: 0 },
    });

    assert.deepEqual(compensation, {});
  },
);

test(
  'resolveClosedLoopJointAngleCompensation solves a distance loop by adjusting the opposite prismatic joint',
  { concurrency: false },
  () => {
    const compensation = resolveClosedLoopJointAngleCompensation(
      robotWithDistanceLoop,
      'joint_a',
      0.3,
    );

    assert.ok(Math.abs((compensation.joint_b ?? 0) - 0.3) < 1e-3);
  },
);

test(
  'resolveClosedLoopJointAngleCompensation still reaches the only feasible branch after a large move',
  { concurrency: false },
  () => {
    const robot: RobotState = {
      ...robotWithDistanceLoop,
      closedLoopConstraints: [
        {
          id: 'connect-prismatic-link-a-link-b',
          type: 'connect',
          linkAId: 'link_a',
          linkBId: 'link_b',
          anchorWorld: { x: 1.2, y: 0, z: 0 },
          anchorLocalA: { x: 1.2, y: 0, z: 0 },
          anchorLocalB: { x: 0, y: 0, z: 0 },
          source: { format: 'mjcf', body1Name: 'link_a', body2Name: 'link_b' },
        },
      ],
    };

    const compensation = resolveClosedLoopJointAngleCompensation(robot, 'joint_a', 1.4);

    assert.ok(
      Math.abs((compensation.joint_b ?? 0) - 1.4) < 1e-3,
      `expected unique prismatic solution to be reached, angle=${compensation.joint_b}`,
    );
  },
);

test(
  'resolveClosedLoopJointAngleCompensation solves a mirrored loop by adjusting the opposite joint angle',
  { concurrency: false },
  () => {
    const robot: RobotState = {
      ...robotWithClosedLoop,
      joints: {
        joint_a: {
          ...robotWithClosedLoop.joints.joint_a,
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          limit: { lower: -Math.PI, upper: Math.PI, effort: 1, velocity: 1 },
          angle: 0,
        },
        joint_b: {
          ...robotWithClosedLoop.joints.joint_b,
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          limit: { lower: -Math.PI, upper: Math.PI, effort: 1, velocity: 1 },
          angle: 0,
        },
      },
      closedLoopConstraints: [
        {
          id: 'connect-rotating-links',
          type: 'connect',
          linkAId: 'link_a',
          linkBId: 'link_b',
          anchorWorld: { x: 1, y: 0, z: 0 },
          anchorLocalA: { x: 1, y: 0, z: 0 },
          anchorLocalB: { x: 1, y: 0, z: 0 },
          source: { format: 'mjcf', body1Name: 'link_a', body2Name: 'link_b' },
        },
      ],
    };

    const compensation = resolveClosedLoopJointAngleCompensation(robot, 'joint_a', 0.42);

    assert.ok(Math.abs((compensation.joint_b ?? 0) - 0.42) < 1e-3);
  },
);

test(
  'resolveClosedLoopDrivenJointMotion keeps an ambiguous loop on the nearest kinematic branch',
  { concurrency: false },
  () => {
    const initialDriverAngle = 0.6;
    const requestedDriverAngle = 2.6;
    const robot = createPlanarTwoBranchLoopRobot(initialDriverAngle, 1);
    const solution = resolveClosedLoopDrivenJointMotion(robot, 'driver', requestedDriverAngle, {
      maxIterations: 48,
      tolerance: 1e-8,
    });

    const finalShoulderAngle = solution.angles.shoulder ?? robot.joints.shoulder.angle ?? 0;
    const finalElbowAngle = solution.angles.elbow ?? robot.joints.elbow.angle ?? 0;

    assert.equal(solution.constrained, false);
    assert.equal(solution.converged, true);
    assert.ok(
      solution.residual < 1e-6,
      `expected branch-preserving solve to close the loop, residual=${solution.residual}`,
    );
    assert.ok(
      Math.abs(finalShoulderAngle - (requestedDriverAngle - Math.PI / 3)) < 1e-4,
      `expected shoulder to stay on the nearest branch, angle=${finalShoulderAngle}`,
    );
    assert.ok(
      Math.abs(finalElbowAngle - (2 * Math.PI) / 3) < 1e-4,
      `expected elbow to stay on the pre-drag branch, angle=${finalElbowAngle}`,
    );
  },
);

test(
  'resolveClosedLoopJointAngleCompensation reduces Cassie plantar loop error and solves passive joints',
  { concurrency: false },
  () => {
    installDomGlobals();

    const xml = fs.readFileSync('test/mujoco_menagerie-main/agility_cassie/cassie.xml', 'utf8');
    const robot = parseMJCF(xml);

    assert.ok(robot);

    const constraint = robot.closedLoopConstraints?.find((entry) =>
      entry.id.includes('left-plantar-rod-left-foot'),
    );

    assert.ok(constraint);

    const computeError = (angleOverrides: Record<string, number>) => {
      const linkWorldMatrices = computeLinkWorldMatrices(robot, { angles: angleOverrides });
      const anchorA = new THREE.Vector3(
        constraint.anchorLocalA.x,
        constraint.anchorLocalA.y,
        constraint.anchorLocalA.z,
      ).applyMatrix4(linkWorldMatrices[constraint.linkAId]);
      const anchorB = new THREE.Vector3(
        constraint.anchorLocalB.x,
        constraint.anchorLocalB.y,
        constraint.anchorLocalB.z,
      ).applyMatrix4(linkWorldMatrices[constraint.linkBId]);
      return anchorA.distanceTo(anchorB);
    };

    const selectedAngles = { 'left-foot': -0.4 };
    const compensation = resolveClosedLoopJointAngleCompensation(robot, 'left-foot', -0.4);

    assert.ok(typeof compensation['left-foot-crank'] === 'number');
    assert.ok(typeof compensation['left-plantar-rod'] === 'number');

    const before = computeError(selectedAngles);
    const after = computeError({ ...selectedAngles, ...compensation });

    assert.ok(
      after < before,
      `expected closed-loop error to decrease, before=${before}, after=${after}`,
    );
  },
);

test(
  'resolveClosedLoopJointMotionCompensation solves Cassie achilles loop with a ball joint quaternion',
  { concurrency: false },
  () => {
    installDomGlobals();

    const xml = fs.readFileSync('test/mujoco_menagerie-main/agility_cassie/cassie.xml', 'utf8');
    const robot = parseMJCF(xml);

    assert.ok(robot);

    const constraint = robot.closedLoopConstraints?.find((entry) =>
      entry.id.includes('left-achilles-rod-left-heel-spring'),
    );

    assert.ok(constraint);

    const computeError = (overrides: {
      angles?: Record<string, number>;
      quaternions?: Record<string, { x: number; y: number; z: number; w: number }>;
    }) => {
      const linkWorldMatrices = computeLinkWorldMatrices(robot, overrides);
      const anchorA = new THREE.Vector3(
        constraint.anchorLocalA.x,
        constraint.anchorLocalA.y,
        constraint.anchorLocalA.z,
      ).applyMatrix4(linkWorldMatrices[constraint.linkAId]);
      const anchorB = new THREE.Vector3(
        constraint.anchorLocalB.x,
        constraint.anchorLocalB.y,
        constraint.anchorLocalB.z,
      ).applyMatrix4(linkWorldMatrices[constraint.linkBId]);
      return anchorA.distanceTo(anchorB);
    };

    const selectedAngles = { 'left-knee': -1.2 };
    const compensation = resolveClosedLoopJointMotionCompensation(robot, 'left-knee', -1.2);

    assert.ok(compensation.quaternions['left-achilles-rod']);
    assert.equal(
      Object.hasOwn(compensation.angles, 'left-shin'),
      false,
      'expected high-stiffness left-shin spring to stay on the nearest visual branch',
    );
    assert.ok(typeof compensation.angles['left-heel-spring'] === 'number');

    const before = computeError({ angles: selectedAngles });
    const after = computeError({
      angles: { ...selectedAngles, ...compensation.angles },
      quaternions: compensation.quaternions,
    });

    assert.ok(
      after < before,
      `expected achilles closed-loop error to decrease, before=${before}, after=${after}`,
    );
    assert.ok(
      after < 1e-4,
      `expected achilles closed-loop error to be nearly closed, after=${after}`,
    );
  },
);

test(
  'resolveClosedLoopJointMotionCompensation keeps Cassie serial joints and opposite leg untouched',
  { concurrency: false },
  () => {
    installDomGlobals();

    const xml = fs.readFileSync('test/mujoco_menagerie-main/agility_cassie/cassie.xml', 'utf8');
    const robot = parseMJCF(xml);

    assert.ok(robot);

    const compensation = resolveClosedLoopJointMotionCompensation(robot, 'left-knee', -1.2);
    const compensatedJointIds = new Set([
      ...Object.keys(compensation.angles),
      ...Object.keys(compensation.quaternions),
    ]);

    [
      'left-hip-roll',
      'left-hip-yaw',
      'left-hip-pitch',
      'right-knee',
      'right-shin',
      'right-tarsus',
      'right-foot-crank',
      'right-plantar-rod',
      'right-achilles-rod',
    ].forEach((jointId) => {
      assert.equal(
        compensatedJointIds.has(jointId),
        false,
        `expected Cassie serial or opposite-leg joint "${jointId}" to stay untouched`,
      );
    });
  },
);

test(
  'resolveClosedLoopDrivenJointMotion keeps Cassie high-stiffness shin springs fixed when another solution exists',
  { concurrency: false },
  () => {
    installDomGlobals();

    const xml = fs.readFileSync('test/mujoco_menagerie-main/agility_cassie/cassie.xml', 'utf8');
    const robot = parseMJCF(xml);

    assert.ok(robot);

    const solution = resolveClosedLoopDrivenJointMotion(robot, 'right-knee', -2.8623399732707004);

    assert.equal(solution.converged, true);
    assert.ok(solution.residual < 1e-5);
    assert.equal(
      Object.hasOwn(solution.angles, 'right-shin'),
      false,
      'expected high-stiffness right-shin spring to remain on the current visual branch',
    );
    assert.ok(typeof solution.angles['right-heel-spring'] === 'number');
    assert.ok(typeof solution.angles['right-tarsus'] === 'number');
  },
);

test(
  'resolveClosedLoopDrivenJointMotion clamps an infeasible Robotiq coupler drag to the closed-loop boundary',
  { concurrency: false },
  () => {
    installDomGlobals();

    const xml = fs.readFileSync('test/mujoco_menagerie-main/robotiq_2f85/2f85.xml', 'utf8');
    const robot = parseMJCF(xml);

    assert.ok(robot);

    const requestedAngle = -1.57;
    const requestedDrivenMotion = resolveMimicJointAngleTargets(
      robot,
      'right_coupler_joint',
      requestedAngle,
    );
    const unconstrainedSolution = solveClosedLoopMotionCompensation(robot, {
      angles: requestedDrivenMotion.angles,
      lockedJointIds: requestedDrivenMotion.lockedJointIds,
    });
    assert.equal(unconstrainedSolution.converged, false);

    const constrained = resolveClosedLoopDrivenJointMotion(
      robot,
      'right_coupler_joint',
      requestedAngle,
    );

    assert.equal(constrained.constrained, true);
    assert.equal(constrained.converged, true);
    assert.ok(
      constrained.residual < 1e-4,
      `expected residual to stay small, residual=${constrained.residual}`,
    );
    assert.ok(
      (constrained.angles.right_coupler_joint ?? 0) > -0.8,
      `expected right_coupler_joint to move materially toward the feasible boundary, angle=${constrained.angles.right_coupler_joint}`,
    );
    assert.ok(
      (constrained.angles.right_coupler_joint ?? 0) < -0.4,
      `expected right_coupler_joint to remain meaningfully closed, angle=${constrained.angles.right_coupler_joint}`,
    );
    assert.ok(
      typeof constrained.angles.right_driver_joint === 'number' &&
        (constrained.angles.right_driver_joint ?? 0) > 0.3 &&
        (constrained.angles.right_driver_joint ?? 0) < 0.8,
      `expected right_driver_joint to be driven by the constrained solution, angle=${constrained.angles.right_driver_joint}`,
    );
    assert.ok(
      Math.abs((constrained.angles.right_follower_joint ?? 0) - 0.872664) < 1e-6,
      `expected right_follower_joint to be pushed onto its upper feasible boundary, angle=${constrained.angles.right_follower_joint}`,
    );
  },
);

test(
  'resolveClosedLoopDrivenJointMotion constrains Robotiq follower drags using the rebased connect anchor',
  { concurrency: false },
  () => {
    installDomGlobals();

    const xml = fs.readFileSync('test/mujoco_menagerie-main/robotiq_2f85/2f85.xml', 'utf8');
    const robot = parseMJCF(xml);

    assert.ok(robot);

    const constrained = resolveClosedLoopDrivenJointMotion(robot, 'right_follower_joint', -0.8);
    assert.equal(constrained.constrained, true);
    assert.equal(constrained.converged, true);
    assert.ok(
      Math.abs(constrained.angles.right_follower_joint ?? 0) < 0.01,
      `expected right_follower_joint to clamp near the feasible boundary, angle=${constrained.angles.right_follower_joint}`,
    );

    const coupled = resolveClosedLoopDrivenJointMotion(robot, 'right_follower_joint', 0.8);
    assert.equal(coupled.converged, true);
    assert.ok(
      Math.abs((coupled.angles.right_follower_joint ?? 0) - 0.8) < 1e-9,
      `expected feasible follower request to be preserved, angle=${coupled.angles.right_follower_joint}`,
    );
    assert.ok(
      typeof coupled.angles.right_coupler_joint === 'number',
      'expected follower drag to drive right_coupler_joint compensation',
    );
    assert.ok(
      typeof coupled.angles.right_driver_joint === 'number',
      'expected follower drag to drive right_driver_joint compensation',
    );
    assert.ok(
      typeof coupled.angles.right_spring_link_joint === 'number',
      'expected follower drag to drive right_spring_link_joint compensation',
    );
  },
);

test(
  'resolveClosedLoopJointOriginCompensationDetailed previews Cassie ball-joint closure during origin drag',
  { concurrency: false },
  () => {
    installDomGlobals();

    const xml = fs.readFileSync('test/mujoco_menagerie-main/agility_cassie/cassie.xml', 'utf8');
    const robot = parseMJCF(xml);

    assert.ok(robot);

    const compensation = resolveClosedLoopJointOriginCompensationDetailed(robot, 'left-knee', {
      xyz: { x: 0.2, y: 0, z: 0.0045 },
      rpy: { r: 0, p: 0, y: -0.9 },
    });

    assert.ok(compensation.origins['left-achilles-rod']);
    assert.ok(compensation.quaternions['left-achilles-rod']);
  },
);

test(
  'solveClosedLoopMotionCompensation solves Cassie bilateral loops in one coupled pass',
  { concurrency: false },
  () => {
    installDomGlobals();

    const xml = fs.readFileSync('test/mujoco_menagerie-main/agility_cassie/cassie.xml', 'utf8');
    const robot = parseMJCF(xml);

    assert.ok(robot);
    assert.ok(robot.closedLoopConstraints);
    assert.equal(robot.closedLoopConstraints.length, 4);

    const solution = solveClosedLoopMotionCompensation(robot, {
      angles: {
        'left-knee': -1.2,
        'right-knee': -1.2,
      },
    });

    assert.ok(solution.quaternions['left-achilles-rod']);
    assert.ok(solution.quaternions['right-achilles-rod']);
    assert.ok(typeof solution.angles['left-shin'] === 'number');
    assert.ok(typeof solution.angles['right-shin'] === 'number');

    assert.ok(solution.constraintErrors['mjcf-connect-left-achilles-rod-left-heel-spring'] < 1e-4);
    assert.ok(
      solution.constraintErrors['mjcf-connect-right-achilles-rod-right-heel-spring'] < 1e-4,
    );
    assert.ok(solution.constraintErrors['mjcf-connect-left-plantar-rod-left-foot'] < 1e-4);
    assert.ok(solution.constraintErrors['mjcf-connect-right-plantar-rod-right-foot'] < 1e-4);
    assert.ok(
      solution.residual < 1e-4,
      `expected coupled residual to be nearly zero, residual=${solution.residual}`,
    );
  },
);

test(
  'parseMJCF discovers every closed-loop menagerie fixture under test/mujoco_menagerie-main',
  { concurrency: false },
  () => {
    installDomGlobals();

    const fixtures = discoverClosedLoopMenagerieFixtures();

    assert.deepEqual(
      fixtures.map(({ fixturePath }) => fixturePath),
      sortFixturePaths(EXPECTED_MENAGERIE_CLOSED_LOOP_FIXTURE_PATHS),
    );
  },
);

test(
  'solveClosedLoopMotionCompensation keeps every discovered menagerie closed-loop model stable and scoped',
  { concurrency: false },
  () => {
    installDomGlobals();

    const fixtures = discoverClosedLoopMenagerieFixtures();
    assert.deepEqual(
      fixtures.map(({ fixturePath }) => fixturePath),
      sortFixturePaths(EXPECTED_MENAGERIE_CLOSED_LOOP_FIXTURE_PATHS),
    );

    fixtures.forEach(({ fixturePath, robot }) => {
      const { selectedJointId, selectedAngle, drivenMotion, solution } = pickDrivenJointSolveCase(
        robot,
        fixturePath,
      );

      assert.ok(
        Math.abs((drivenMotion.angles[selectedJointId] ?? selectedAngle) - selectedAngle) < 1e-9,
        `expected ${fixturePath} to drive the selected loop-relevant joint directly, jointId=${selectedJointId}`,
      );

      assert.ok(solution.converged, `expected ${fixturePath} to converge`);
      assert.ok(
        solution.residual < 1e-4,
        `expected ${fixturePath} residual to stay small, residual=${solution.residual}`,
      );

      Object.entries(solution.constraintErrors).forEach(([constraintId, error]) => {
        assert.ok(
          Number.isFinite(error),
          `expected ${fixturePath}:${constraintId} error to stay finite`,
        );
        assert.ok(
          error < 1e-4,
          `expected ${fixturePath}:${constraintId} error to stay small, error=${error}`,
        );
      });

      const compensationCount =
        Object.keys(solution.angles).length + Object.keys(solution.quaternions).length;
      assert.ok(
        compensationCount > 0,
        `expected ${fixturePath} to emit non-empty closed-loop compensation for jointId=${selectedJointId}`,
      );

      [...Object.keys(solution.angles), ...Object.keys(solution.quaternions)].forEach((jointId) => {
        assert.ok(
          !drivenMotion.lockedJointIds.includes(jointId),
          `expected ${fixturePath} compensation to avoid explicitly driven joints, jointId=${jointId}`,
        );
      });
    });
  },
);

test(
  'solveClosedLoopMotionCompensation remains a no-op for non-closed-loop menagerie models',
  { concurrency: false },
  () => {
    installDomGlobals();

    const robot = parseMJCF(
      fs.readFileSync('test/mujoco_menagerie-main/franka_fr3/fr3.xml', 'utf8'),
    );

    assert.ok(robot);

    const solution = solveClosedLoopMotionCompensation(robot, {
      angles: { joint1: 0.2 },
    });

    assert.equal(solution.residual, 0);
    assert.equal(solution.converged, true);
    assert.deepEqual(solution.constraintErrors, {});
    assert.deepEqual(solution.angles, {});
    assert.deepEqual(solution.quaternions, {});
  },
);
