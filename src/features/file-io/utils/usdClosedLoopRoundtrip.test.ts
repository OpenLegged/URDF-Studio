import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';
import { Euler, Quaternion } from 'three';

import { parseMJCF } from '@/core/parsers/mjcf/mjcfParser';
import { createSingleComponentWorkspace } from '@/core/robot/canonicalWorkspace';
import { computeLinkWorldMatrices } from '@/core/robot/kinematics';
import { DEFAULT_JOINT, DEFAULT_LINK, JointType } from '@/types';
import type { RobotClosedLoopConstraint, RobotData, RobotState } from '@/types';
import { adaptUsdViewerSnapshotToRobotData } from '@/lib/robot-parser/usd';
import { ThreeRenderDelegateCore } from '@/features/urdf-viewer/runtime/hydra/render-delegate/ThreeRenderDelegateCore.js';
import { exportRobotToUsd } from './usdExport';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.DOMParser = dom.window.DOMParser as typeof DOMParser;
globalThis.XMLSerializer = dom.window.XMLSerializer as typeof XMLSerializer;
globalThis.ProgressEvent = dom.window.ProgressEvent as typeof ProgressEvent;

const CLOSED_LOOP_USD_FIXTURES = [
  {
    name: 'agility_cassie',
    path: 'test/mujoco_menagerie-main/agility_cassie/cassie.xml',
    expectedClosedLoopCount: 4,
  },
  {
    name: 'robotiq_2f85',
    path: 'test/mujoco_menagerie-main/robotiq_2f85/2f85.xml',
    expectedClosedLoopCount: 2,
  },
] as const;

function assertVectorAlmostEqual(
  actual: { x: number; y: number; z: number },
  expected: { x: number; y: number; z: number },
  message: string,
): void {
  assert.ok(Math.abs(actual.x - expected.x) <= 1e-6, `${message} (x)`);
  assert.ok(Math.abs(actual.y - expected.y) <= 1e-6, `${message} (y)`);
  assert.ok(Math.abs(actual.z - expected.z) <= 1e-6, `${message} (z)`);
}

function assertClosedLoopConstraintsMatch(
  actualConstraints: RobotClosedLoopConstraint[] | undefined,
  expectedConstraints: RobotClosedLoopConstraint[] | undefined,
  fixtureName: string,
): void {
  const actualEntries = [...(actualConstraints || [])].sort((left, right) =>
    left.id.localeCompare(right.id),
  );
  const expectedEntries = [...(expectedConstraints || [])].sort((left, right) =>
    left.id.localeCompare(right.id),
  );

  assert.equal(
    actualEntries.length,
    expectedEntries.length,
    `expected ${fixtureName} to preserve closed-loop constraint count`,
  );

  const actualById = new Map(actualEntries.map((constraint) => [constraint.id, constraint]));
  const normalizeLinkId = (value: string) => value.replace(/[^\w]+/g, '_');
  for (const expectedConstraint of expectedEntries) {
    const actualConstraint = actualById.get(expectedConstraint.id);
    assert.ok(
      actualConstraint,
      `expected ${fixtureName} USD roundtrip to preserve ${expectedConstraint.id}`,
    );
    if (!actualConstraint) {
      continue;
    }

    assert.equal(actualConstraint.type, expectedConstraint.type);
    assert.equal(
      normalizeLinkId(actualConstraint.linkAId),
      normalizeLinkId(expectedConstraint.linkAId),
    );
    assert.equal(
      normalizeLinkId(actualConstraint.linkBId),
      normalizeLinkId(expectedConstraint.linkBId),
    );
    assertVectorAlmostEqual(
      actualConstraint.anchorLocalA,
      expectedConstraint.anchorLocalA,
      `${fixtureName} ${expectedConstraint.id} anchorLocalA`,
    );
    assertVectorAlmostEqual(
      actualConstraint.anchorLocalB,
      expectedConstraint.anchorLocalB,
      `${fixtureName} ${expectedConstraint.id} anchorLocalB`,
    );
    assertVectorAlmostEqual(
      actualConstraint.anchorWorld,
      expectedConstraint.anchorWorld,
      `${fixtureName} ${expectedConstraint.id} anchorWorld`,
    );
  }
}

function buildLinkPaths(robot: RobotState, rootPrimName: string): Map<string, string> {
  const childJointsByParent = new Map<string, (typeof robot.joints)[string][]>();
  Object.values(robot.joints).forEach((joint) => {
    const entries = childJointsByParent.get(joint.parentLinkId) || [];
    entries.push(joint);
    childJointsByParent.set(joint.parentLinkId, entries);
  });

  const linkPathById = new Map<string, string>();
  const visit = (linkId: string, parentPath: string | null) => {
    const link = robot.links[linkId];
    assert.ok(link, `expected link "${linkId}" to exist`);

    const linkPath = parentPath ? `${parentPath}/${link.name}` : `/${rootPrimName}/${link.name}`;
    linkPathById.set(linkId, linkPath);

    for (const joint of childJointsByParent.get(linkId) || []) {
      visit(joint.childLinkId, linkPath);
    }
  };

  visit(robot.rootLinkId, null);
  return linkPathById;
}

function getArchiveText(archiveFiles: Map<string, Blob>, suffix: string): Promise<string> {
  const entry = Array.from(archiveFiles.entries()).find(([filePath]) => filePath.endsWith(suffix));
  assert.ok(entry, `expected USD archive to include ${suffix}`);
  return entry?.[1].text() ?? Promise.resolve('');
}

function createRoundtripMetadataSnapshot(
  robot: RobotState,
  stageSourcePath: string,
  layers: {
    rootLayer: string;
    baseLayer: string;
    physicsLayer: string;
    sensorLayer: string;
  },
) {
  const previousWindow = globalThis.window;
  globalThis.window = { driver: null } as Window & typeof globalThis;

  try {
    const rootPrimMatch = layers.rootLayer.match(/defaultPrim = "([^"]+)"/);
    assert.ok(rootPrimMatch, 'expected USD root layer to declare defaultPrim');
    const rootPrimName = rootPrimMatch[1];

    const fakeMeshes = Object.fromEntries(
      Array.from(buildLinkPaths(robot, rootPrimName).values(), (linkPath) => [
        `${linkPath}/visuals.proto_mesh_id0`,
        {},
      ]),
    );
    const delegate = Object.create(ThreeRenderDelegateCore.prototype) as ThreeRenderDelegateCore & {
      meshes: Record<string, object>;
      getStage: () => {
        GetRootLayer(): { ExportToString(): string };
        GetUsedLayers(): Array<{ ExportToString(): string }>;
      };
    };

    delegate.meshes = fakeMeshes;
    delegate._protoMeshMetadataByMeshId = new Map();
    delegate._robotMetadataSnapshotByStageSource = new Map();
    delegate._robotMetadataBuildPromisesByStageSource = new Map();
    delegate._nowPerfMs = () => 1234;
    delegate.getNormalizedStageSourcePath = () => stageSourcePath;
    delegate.getStage = () => ({
      GetRootLayer() {
        return {
          ExportToString() {
            return layers.rootLayer;
          },
        };
      },
      GetUsedLayers() {
        return [
          {
            ExportToString() {
              return layers.baseLayer;
            },
          },
          {
            ExportToString() {
              return layers.physicsLayer;
            },
          },
          {
            ExportToString() {
              return layers.sensorLayer;
            },
          },
        ];
      },
    });

    return delegate.buildRobotMetadataSnapshotForStage(stageSourcePath, null);
  } finally {
    globalThis.window = previousWindow;
  }
}

function toRobotState(robot: RobotData | RobotState): RobotState {
  if ('selection' in robot) {
    return robot;
  }

  return {
    ...robot,
    selection: { type: null, id: null },
  };
}

async function withSuppressedUsdAssetWarnings<T>(run: () => Promise<T>): Promise<T> {
  const originalLog = console.log;
  const originalInfo = console.info;
  const originalWarn = console.warn;
  const shouldSuppress = (args: unknown[]) =>
    String(args[0] || '').includes('[USD export] Mesh asset not found');

  console.log = (...args: unknown[]) => {
    if (!shouldSuppress(args)) {
      originalLog(...args);
    }
  };
  console.info = (...args: unknown[]) => {
    if (!shouldSuppress(args)) {
      originalInfo(...args);
    }
  };
  console.warn = (...args: unknown[]) => {
    const message = String(args[0] || '');
    if (message.includes('[USD export] Mesh asset not found')) {
      return;
    }
    originalWarn(...args);
  };

  try {
    return await run();
  } finally {
    console.log = originalLog;
    console.info = originalInfo;
    console.warn = originalWarn;
  }
}

for (const fixture of CLOSED_LOOP_USD_FIXTURES) {
  test(`USD roundtrip preserves closed-loop constraints for ${fixture.name}`, async () => {
    const xml = fs.readFileSync(fixture.path, 'utf8');
    const robot = parseMJCF(xml);

    assert.ok(robot, `expected ${fixture.name} MJCF fixture to parse`);
    assert.equal(
      robot?.closedLoopConstraints?.length,
      fixture.expectedClosedLoopCount,
      `expected ${fixture.name} fixture to expose closed loops before USD export`,
    );
    if (!robot) {
      return;
    }

    const payload = await withSuppressedUsdAssetWarnings(() =>
      exportRobotToUsd({
        robot,
        exportName: fixture.name,
        assets: {},
      }),
    );

    const rootLayerText = await payload.archiveFiles.get(payload.rootLayerPath)?.text();
    const baseLayerText = await getArchiveText(payload.archiveFiles, '_base.usd');
    const physicsLayerText = await getArchiveText(payload.archiveFiles, '_physics.usd');
    const sensorLayerText = await getArchiveText(payload.archiveFiles, '_sensor.usd');

    assert.ok(rootLayerText, 'expected USD root layer to exist');
    assert.match(physicsLayerText, /urdf:closedLoopType = "connect"/);

    const stageSourcePath = `/${payload.rootLayerPath}`;
    const metadata = createRoundtripMetadataSnapshot(robot, stageSourcePath, {
      rootLayer: rootLayerText || '',
      baseLayer: baseLayerText,
      physicsLayer: physicsLayerText,
      sensorLayer: sensorLayerText,
    });

    assert.equal(metadata.source, 'usd-stage');
    assert.equal(
      metadata.closedLoopConstraintEntries?.length,
      fixture.expectedClosedLoopCount,
      `expected ${fixture.name} USD metadata snapshot to preserve closed-loop entries`,
    );

    const rootPrimMatch = rootLayerText?.match(/defaultPrim = "([^"]+)"/);
    assert.ok(rootPrimMatch, 'expected USD root layer to declare defaultPrim');

    const adapted = adaptUsdViewerSnapshotToRobotData({
      stageSourcePath,
      stage: { defaultPrimPath: `/${rootPrimMatch?.[1]}` },
      robotMetadataSnapshot: metadata,
      robotTree: {
        linkParentPairs: metadata.linkParentPairs,
        jointCatalogEntries: metadata.jointCatalogEntries,
        rootLinkPaths: [],
      },
      physics: {
        linkDynamicsEntries: metadata.linkDynamicsEntries,
      },
      render: {
        meshDescriptors: [],
        materials: [],
      },
    });

    assert.ok(adapted, `expected ${fixture.name} USD snapshot to adapt back into robot data`);
    if (!adapted) {
      return;
    }

    assert.equal(
      adapted.robotData.closedLoopConstraints?.length,
      fixture.expectedClosedLoopCount,
      `expected ${fixture.name} USD roundtrip to preserve closed-loop count`,
    );
    assertClosedLoopConstraintsMatch(
      toRobotState(adapted.robotData).closedLoopConstraints,
      robot.closedLoopConstraints,
      fixture.name,
    );
  });
}

test('USD roundtrip preserves a movable joint closed-loop constraint with joint semantics', async () => {
  const links: RobotData['links'] = {
    base_link: { ...structuredClone(DEFAULT_LINK), id: 'base_link', name: 'base_link' },
    arm_link: { ...structuredClone(DEFAULT_LINK), id: 'arm_link', name: 'arm_link' },
    tool_link: { ...structuredClone(DEFAULT_LINK), id: 'tool_link', name: 'tool_link' },
  };
  const joints: RobotData['joints'] = {
    arm_joint: {
      ...structuredClone(DEFAULT_JOINT),
      id: 'arm_joint',
      name: 'arm_joint',
      type: JointType.REVOLUTE,
      parentLinkId: 'base_link',
      childLinkId: 'arm_link',
      origin: { xyz: { x: 0, y: 0, z: 0.1 }, rpy: { r: 0, p: 0, y: 0 } },
      axis: { x: 0, y: 1, z: 0 },
      limit: { lower: -1, upper: 1, effort: 10, velocity: 5 },
    },
    tool_joint: {
      ...structuredClone(DEFAULT_JOINT),
      id: 'tool_joint',
      name: 'tool_joint',
      type: JointType.FIXED,
      parentLinkId: 'arm_link',
      childLinkId: 'tool_link',
      origin: { xyz: { x: 0, y: 0, z: 0.4 }, rpy: { r: 0, p: 0, y: 0 } },
    },
  };
  const robot: RobotData = {
    name: 'movable_loop',
    links,
    joints,
    rootLinkId: 'base_link',
    closedLoopConstraints: [
      {
        id: 'tool_loop',
        type: 'joint',
        jointType: JointType.REVOLUTE,
        linkAId: 'base_link',
        linkBId: 'tool_link',
        anchorLocalA: { x: 0.25, y: 0, z: 0.05 },
        anchorLocalB: { x: 0, y: 0, z: 0 },
        anchorWorld: { x: 0.25, y: 0, z: 0.05 },
        axis: { x: 0, y: 0, z: 1 },
        limit: { lower: -0.5, upper: 0.5, effort: 8, velocity: 2 },
        origin: { xyz: { x: 0.25, y: 0, z: 0.05 }, rpy: { r: 0, p: 1.5, y: 0 } },
      },
    ],
  };

  const payload = await withSuppressedUsdAssetWarnings(() =>
    exportRobotToUsd({
      robot: toRobotState(robot),
      exportName: 'movable_loop',
      assets: {},
    }),
  );

  const rootLayerText = await payload.archiveFiles.get(payload.rootLayerPath)?.text();
  const baseLayerText = await getArchiveText(payload.archiveFiles, '_base.usd');
  const physicsLayerText = await getArchiveText(payload.archiveFiles, '_physics.usd');
  const sensorLayerText = await getArchiveText(payload.archiveFiles, '_sensor.usd');

  assert.ok(rootLayerText, 'expected USD root layer to exist');
  assert.match(physicsLayerText, /def PhysicsRevoluteJoint "tool_loop"/);
  assert.match(physicsLayerText, /urdf:closedLoopType = "joint"/);
  assert.match(physicsLayerText, /urdf:jointType = "revolute"/);
  assert.match(physicsLayerText, /urdf:axisLocal = \(0, 0, 1\)/);
  assert.match(physicsLayerText, /urdf:closedLoopId = "tool_loop"/);

  const stageSourcePath = `/${payload.rootLayerPath}`;
  const metadata = createRoundtripMetadataSnapshot(toRobotState(robot), stageSourcePath, {
    rootLayer: rootLayerText || '',
    baseLayer: baseLayerText,
    physicsLayer: physicsLayerText,
    sensorLayer: sensorLayerText,
  });

  assert.equal(
    metadata.closedLoopConstraintEntries?.length,
    1,
    'expected the movable joint closed-loop entry to survive the metadata snapshot',
  );
  const entry = metadata.closedLoopConstraintEntries?.[0];
  assert.equal(entry?.constraintType, 'joint');
  assert.equal(entry?.jointType, 'revolute');

  const rootPrimMatch = rootLayerText?.match(/defaultPrim = "([^"]+)"/);
  assert.ok(rootPrimMatch, 'expected USD root layer to declare defaultPrim');

  const adapted = adaptUsdViewerSnapshotToRobotData({
    stageSourcePath,
    stage: { defaultPrimPath: `/${rootPrimMatch?.[1]}` },
    robotMetadataSnapshot: metadata,
    robotTree: {
      linkParentPairs: metadata.linkParentPairs,
      jointCatalogEntries: metadata.jointCatalogEntries,
      rootLinkPaths: [],
    },
    physics: {
      linkDynamicsEntries: metadata.linkDynamicsEntries,
    },
    render: {
      meshDescriptors: [],
      materials: [],
    },
  });
  assert.ok(adapted, 'expected the movable-loop USD snapshot to adapt back into robot data');
  if (!adapted) {
    return;
  }

  const roundtripped = adapted.robotData.closedLoopConstraints?.[0];
  assert.doesNotThrow(() => createSingleComponentWorkspace(adapted.robotData));
  assert.ok(roundtripped, 'expected the movable joint closed-loop constraint to roundtrip');
  if (!roundtripped) {
    return;
  }
  assert.equal(roundtripped.type, 'joint');
  assert.equal(roundtripped.jointType, 'revolute');
  assert.equal(roundtripped.id, 'tool_loop');
  assert.deepEqual(roundtripped.anchorLocalA, { x: 0.25, y: 0, z: 0.05 });
  assert.deepEqual(roundtripped.anchorLocalB, { x: 0, y: 0, z: 0 });
  assert.ok(
    Math.abs((roundtripped.axis?.x ?? 0) - 0) <= 1e-6 &&
      Math.abs((roundtripped.axis?.y ?? 0) - 0) <= 1e-6 &&
      Math.abs((roundtripped.axis?.z ?? 0) - 1) <= 1e-6,
    'expected the roundtripped axis to stay (0, 0, 1)',
  );
  const lower = roundtripped.limit?.lower;
  const upper = roundtripped.limit?.upper;
  assert.ok(
    typeof lower === 'number' && Math.abs(lower - -0.5) <= 1e-3,
    `expected roundtripped lower limit near -0.5 rad, got ${lower}`,
  );
  assert.ok(
    typeof upper === 'number' && Math.abs(upper - 0.5) <= 1e-3,
    `expected roundtripped upper limit near 0.5 rad, got ${upper}`,
  );
  assert.ok(
    Math.abs((roundtripped.origin?.rpy.p ?? 0) - 1.5) <= 1e-3,
    `expected roundtripped origin pitch near 1.5, got ${roundtripped.origin?.rpy.p}`,
  );
});

for (const jointType of [JointType.FIXED, JointType.CONTINUOUS, JointType.PRISMATIC, JointType.BALL]) {
  test(`USD ${jointType} closed loop imports into canonical workspace without moving its tree`, async () => {
    const robot: RobotData = {
      name: 'loop_frames', rootLinkId: 'base_link',
      links: Object.fromEntries(['base_link', 'tool_link'].map((id) => [
        id, { ...structuredClone(DEFAULT_LINK), id, name: id },
      ])),
      joints: {
        tree: {
          ...structuredClone(DEFAULT_JOINT), id: 'tree', name: 'tree', type: JointType.FIXED,
          parentLinkId: 'base_link', childLinkId: 'tool_link',
          origin: { xyz: { x: 0.2, y: 0.3, z: 0.4 }, rpy: { r: 0.1, p: 0.2, y: 0.3 } },
        },
      },
      closedLoopConstraints: [{
        id: 'loop', type: 'joint', jointType,
        linkAId: 'base_link', linkBId: 'tool_link',
        anchorLocalA: { x: 0.5, y: 0.1, z: 0.3 },
        anchorLocalB: { x: 0.2, y: -0.1, z: 0.4 },
        anchorWorld: { x: 0.5, y: 0.1, z: 0.3 },
        axis: { x: -1, y: 2, z: -3 },
        origin: { xyz: { x: 9, y: 8, z: 7 }, rpy: { r: -0.2, p: 0.4, y: -0.6 } },
        limit: { lower: -0.3, upper: 0.7, effort: 2, velocity: 3 },
      }],
    };
    const payload = await exportRobotToUsd({ robot: toRobotState(robot), exportName: robot.name, assets: {} });
    const rootLayer = await payload.archiveFiles.get(payload.rootLayerPath)!.text();
    const physicsLayer = await getArchiveText(payload.archiveFiles, '_physics.usd');
    const metadata = createRoundtripMetadataSnapshot(toRobotState(robot), `/${payload.rootLayerPath}`, {
      rootLayer,
      baseLayer: await getArchiveText(payload.archiveFiles, '_base.usd'),
      physicsLayer,
      sensorLayer: await getArchiveText(payload.archiveFiles, '_sensor.usd'),
    });
    const rootPrimName = rootLayer.match(/defaultPrim = "([^"]+)"/)![1];
    const adapted = adaptUsdViewerSnapshotToRobotData({
      stageSourcePath: `/${payload.rootLayerPath}`,
      stage: { defaultPrimPath: `/${rootPrimName}` },
      robotMetadataSnapshot: metadata,
      robotTree: {
        linkParentPairs: metadata.linkParentPairs,
        jointCatalogEntries: metadata.jointCatalogEntries,
        rootLinkPaths: [],
      },
      physics: { linkDynamicsEntries: metadata.linkDynamicsEntries },
      render: { meshDescriptors: [], materials: [] },
    });
    assert.ok(adapted);
    assert.doesNotThrow(() => createSingleComponentWorkspace(adapted.robotData));
    const roundtripped = adapted.robotData.closedLoopConstraints?.[0];
    assert.ok(roundtripped);
    assert.equal(roundtripped.type, 'joint');
    assert.equal(roundtripped.jointType, jointType);
    assert.deepEqual(roundtripped.anchorLocalA, robot.closedLoopConstraints![0]!.anchorLocalA);
    assert.deepEqual(roundtripped.anchorLocalB, robot.closedLoopConstraints![0]!.anchorLocalB);
    assert.deepEqual(roundtripped.axis, { x: -1, y: 2, z: -3 });
    const actualRotation = new Quaternion().setFromEuler(new Euler(
      roundtripped.origin!.rpy.r, roundtripped.origin!.rpy.p, roundtripped.origin!.rpy.y, 'ZYX',
    ));
    const expectedRotation = new Quaternion().setFromEuler(new Euler(-0.2, 0.4, -0.6, 'ZYX'));
    assert.ok(actualRotation.angleTo(expectedRotation) < 1e-6);
    if (jointType === JointType.PRISMATIC) {
      assert.equal(roundtripped.limit?.lower, -0.3);
      assert.equal(roundtripped.limit?.upper, 0.7);
    } else {
      assert.equal(roundtripped.limit?.lower, undefined);
      assert.equal(roundtripped.limit?.upper, undefined);
    }
    if (jointType === JointType.FIXED) assert.match(physicsLayer, /def PhysicsFixedJoint "loop"/);
    const beforeMatrices = computeLinkWorldMatrices(robot);
    const afterMatrices = computeLinkWorldMatrices(adapted.robotData);
    for (const [linkId, expected] of Object.entries(beforeMatrices)) {
      assert.ok(afterMatrices[linkId], `expected structural link ${linkId}`);
      expected.elements.forEach((value, index) => {
        assert.ok(Math.abs(value - afterMatrices[linkId].elements[index]) < 1e-6,
          `USD closed-loop import moved ${linkId} at matrix index ${index}`);
      });
    }
  });
}
