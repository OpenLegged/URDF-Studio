import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { parseMJCF } from '@/core/parsers/mjcf/mjcfParser';
import { computeLinkWorldMatrices } from '@/core/robot/kinematics';
import { JointType, type RobotData, type RobotState } from '@/types';
import { adaptUsdViewerSnapshotToRobotData } from '@/lib/robot-parser/usd';
import { ThreeRenderDelegateCore } from '@/features/urdf-viewer/runtime/hydra/render-delegate/ThreeRenderDelegateCore.js';
import { exportRobotToUsd } from './usdExport';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.DOMParser = dom.window.DOMParser as typeof DOMParser;
globalThis.XMLSerializer = dom.window.XMLSerializer as typeof XMLSerializer;
globalThis.ProgressEvent = dom.window.ProgressEvent as typeof ProgressEvent;

function createFloatingRootRobot(): RobotState {
  const robot = parseMJCF(`
    <mujoco model="floating-root-roundtrip">
      <worldbody>
        <body name="base_link" pos="0 0 0.5">
          <joint name="floating_base_joint" type="free" limited="false" />
          <geom name="base_geom" type="box" size="0.1 0.1 0.1" rgba="0.8 0.8 0.8 1" />
          <body name="child_link" pos="0 0.1 0.2">
            <joint name="child_joint" type="hinge" axis="0 1 0" range="-1 1" />
            <geom name="child_geom" type="capsule" fromto="0 0 0 0 0 0.2" size="0.03" rgba="0.2 0.4 0.8 1" />
          </body>
        </body>
      </worldbody>
    </mujoco>
  `);

  assert.ok(robot, 'expected floating-root MJCF to parse');
  return robot;
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

function buildWorldMatricesByLinkName(robot: RobotState): Record<string, number[]> {
  const linkWorldMatrices = computeLinkWorldMatrices(robot);
  return Object.fromEntries(
    Object.values(robot.links)
      .slice()
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((link) => {
        const matrix = linkWorldMatrices[link.id];
        assert.ok(matrix, `expected world matrix for link "${link.name}"`);
        return [link.name, matrix.elements.slice()];
      }),
  );
}

function assertWorldTransformsMatch(source: RobotState, target: RobotState) {
  const sourceMatrices = buildWorldMatricesByLinkName(source);
  const targetMatrices = buildWorldMatricesByLinkName(target);

  assert.deepEqual(Object.keys(targetMatrices), Object.keys(sourceMatrices));
  for (const [linkName, sourceElements] of Object.entries(sourceMatrices)) {
    const targetElements = targetMatrices[linkName];
    assert.ok(targetElements, `expected world transform for ${linkName}`);
    const maxDelta = sourceElements.reduce((currentMax, sourceValue, index) => {
      return Math.max(currentMax, Math.abs(sourceValue - (targetElements[index] ?? 0)));
    }, 0);
    assert.ok(
      maxDelta <= 1e-5,
      `expected world transform for ${linkName} to roundtrip (max delta ${maxDelta})`,
    );
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

test('USD roundtrip preserves floating-root joint semantics for MJCF free joints', async () => {
  const robot = createFloatingRootRobot();
  const payload = await exportRobotToUsd({
    robot,
    exportName: 'floating_root_robot',
    assets: {},
  });

  const physicsLayerPath =
    'floating_root_robot/usd/configuration/floating_root_robot_description_physics.usd';
  const rootLayerText = await payload.archiveFiles.get(payload.rootLayerPath)?.text();
  const baseLayerText = await payload.archiveFiles
    .get('floating_root_robot/usd/configuration/floating_root_robot_description_base.usd')
    ?.text();
  const physicsLayerText = await payload.archiveFiles.get(physicsLayerPath)?.text();
  const sensorLayerText = await payload.archiveFiles
    .get('floating_root_robot/usd/configuration/floating_root_robot_description_sensor.usd')
    ?.text();

  assert.ok(rootLayerText, 'expected USD root layer to exist');
  assert.ok(baseLayerText, 'expected USD base layer to exist');
  assert.ok(physicsLayerText, 'expected USD physics layer to exist');
  assert.ok(sensorLayerText, 'expected USD sensor layer to exist');
  assert.match(physicsLayerText, /custom string urdf:jointType = "floating"/);

  const stageSourcePath = `/${payload.rootLayerPath}`;
  const metadata = createRoundtripMetadataSnapshot(robot, stageSourcePath, {
    rootLayer: rootLayerText,
    baseLayer: baseLayerText,
    physicsLayer: physicsLayerText,
    sensorLayer: sensorLayerText,
  });

  assert.equal(metadata.source, 'usd-stage');
  const floatingJointEntry = metadata.jointCatalogEntries.find(
    (entry: { jointName?: string }) => entry.jointName === 'floating_base_joint',
  );
  assert.ok(
    floatingJointEntry,
    'expected floating_base_joint metadata to survive exported USD parsing',
  );
  assert.equal(floatingJointEntry.jointType, 'floating');
  assert.equal(floatingJointEntry.jointTypeName, 'floating');

  const rootPrimMatch = rootLayerText.match(/defaultPrim = "([^"]+)"/);
  assert.ok(rootPrimMatch, 'expected USD root layer to declare defaultPrim');

  const adapted = adaptUsdViewerSnapshotToRobotData({
    stageSourcePath,
    stage: { defaultPrimPath: `/${rootPrimMatch[1]}` },
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

  assert.ok(adapted, 'expected floating-root USD snapshot to adapt back into robot data');
  if (!adapted) {
    return;
  }

  const floatingJoint = Object.values(
    adapted.robotData.joints as Record<string, { name: string; type: JointType }>,
  ).find(
    (joint) => joint.name === 'floating_base_joint',
  );
  assert.ok(floatingJoint, 'expected floating_base_joint to survive USD reload');
  assert.equal(floatingJoint?.type, JointType.FLOATING);
  assertWorldTransformsMatch(robot, toRobotState(adapted.robotData));
});

test('USD roundtrip preserves official drive damping and maxForce for supported joints', async () => {
  const robot = createFloatingRootRobot();
  robot.joints.child_joint.dynamics.damping = 0.35;
  assert.ok(robot.joints.child_joint.limit);
  robot.joints.child_joint.limit.effort = 9;

  const payload = await exportRobotToUsd({
    robot,
    exportName: 'floating_root_robot_drives',
    assets: {},
  });

  const physicsLayerPath =
    'floating_root_robot_drives/usd/configuration/floating_root_robot_drives_description_physics.usd';
  const rootLayerText = await payload.archiveFiles.get(payload.rootLayerPath)?.text();
  const baseLayerText = await payload.archiveFiles
    .get(
      'floating_root_robot_drives/usd/configuration/floating_root_robot_drives_description_base.usd',
    )
    ?.text();
  const physicsLayerText = await payload.archiveFiles.get(physicsLayerPath)?.text();
  const sensorLayerText = await payload.archiveFiles
    .get(
      'floating_root_robot_drives/usd/configuration/floating_root_robot_drives_description_sensor.usd',
    )
    ?.text();

  assert.ok(rootLayerText);
  assert.ok(baseLayerText);
  assert.ok(physicsLayerText);
  assert.ok(sensorLayerText);
  assert.match(physicsLayerText, /float drive:angular:physics:damping = 0\.35/);
  assert.match(physicsLayerText, /float drive:angular:physics:maxForce = 9/);

  const stageSourcePath = `/${payload.rootLayerPath}`;
  const metadata = createRoundtripMetadataSnapshot(robot, stageSourcePath, {
    rootLayer: rootLayerText,
    baseLayer: baseLayerText,
    physicsLayer: physicsLayerText,
    sensorLayer: sensorLayerText,
  });

  const childJointEntry = metadata.jointCatalogEntries.find(
    (entry: { jointName?: string }) => entry.jointName === 'child_joint',
  );
  assert.ok(childJointEntry, 'expected child_joint metadata to survive exported USD parsing');
  assert.equal(childJointEntry?.driveDamping, 0.35);
  assert.equal(childJointEntry?.driveMaxForce, 9);

  const rootPrimMatch = rootLayerText.match(/defaultPrim = "([^"]+)"/);
  assert.ok(rootPrimMatch, 'expected USD root layer to declare defaultPrim');

  const adapted = adaptUsdViewerSnapshotToRobotData({
    stageSourcePath,
    stage: { defaultPrimPath: `/${rootPrimMatch[1]}` },
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

  assert.ok(adapted, 'expected driven USD snapshot to adapt back into robot data');
  if (!adapted) {
    return;
  }

  const childJoint = Object.values(
    adapted.robotData.joints as Record<
      string,
      { name: string; dynamics: { damping?: number }; limit?: { effort?: number } }
    >,
  ).find(
    (joint) => joint.name === 'child_joint',
  );
  assert.ok(childJoint, 'expected child_joint to survive USD reload');
  assert.equal(childJoint?.dynamics.damping, 0.35);
  assert.ok(childJoint.limit);
  assert.equal(childJoint.limit.effort, 9);
});
