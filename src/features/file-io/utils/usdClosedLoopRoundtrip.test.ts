import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';

import { parseMJCF } from '@/core/parsers/mjcf/mjcfParser';
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
