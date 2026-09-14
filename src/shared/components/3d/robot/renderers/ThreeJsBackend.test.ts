import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import type { Object3D } from 'three';

import { DEFAULT_JOINT, DEFAULT_LINK, GeometryType, JointType, type RobotData } from '../../../../../types/index';
import { ThreeJsBackend, resolveThreeJsBackendSourceFileDirectory } from './ThreeJsBackend';

const rendererSourceDirUrl = new URL('./', import.meta.url);

async function listRendererSourceFiles(dirUrl: URL): Promise<URL[]> {
  const entries = await readdir(dirUrl, { withFileTypes: true });
  const files: URL[] = [];

  for (const entry of entries) {
    const entryUrl = new URL(entry.name, dirUrl);
    if (entry.isDirectory()) {
      const childFiles = await listRendererSourceFiles(new URL(`${entry.name}/`, dirUrl));
      files.push(...childFiles);
      continue;
    }

    if (
      (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) &&
      !entry.name.endsWith('.test.ts') &&
      !entry.name.endsWith('.test.tsx')
    ) {
      files.push(entryUrl);
    }
  }

  return files;
}

const dom = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.DOMParser = dom.window.DOMParser as typeof DOMParser;
globalThis.Document = dom.window.Document as typeof Document;
globalThis.Element = dom.window.Element as typeof Element;

function createReferencedJointRobotData(): RobotData {
  return {
    name: 'referenced_joint_robot',
    rootLinkId: 'base_link',
    links: {
      base_link: {
        ...DEFAULT_LINK,
        id: 'base_link',
        name: 'base_link',
      },
      child_link: {
        ...DEFAULT_LINK,
        id: 'child_link',
        name: 'child_link',
      },
    },
    joints: {
      hip_joint: {
        ...DEFAULT_JOINT,
        id: 'hip_joint',
        name: 'hip_joint',
        type: JointType.REVOLUTE,
        parentLinkId: 'base_link',
        childLinkId: 'child_link',
        axis: { x: 0, y: 0, z: 1 },
        referencePosition: Math.PI / 4,
        angle: Math.PI / 4,
      },
    },
  };
}

function getRuntimeJointValue(robot: Object3D | null, jointId: string): number {
  const joint = (robot as { joints?: Record<string, { jointValue?: number[] }> } | null)?.joints?.[
    jointId
  ];
  return joint?.jointValue?.[0] ?? Number.NaN;
}

function countRuntimeCollisionGroups(robot: Object3D | null): number {
  let count = 0;
  robot?.traverse((child) => {
    if ((child as { isURDFCollider?: boolean }).isURDFCollider === true) {
      count += 1;
    }
  });
  return count;
}

test('resolveThreeJsBackendSourceFileDirectory falls back to RobotFile name for virtual sources', () => {
  assert.equal(
    resolveThreeJsBackendSourceFileDirectory({
      name: 'robots/demo/demo.usd',
      content: '',
      format: 'urdf',
    }),
    'robots/demo/',
  );
});

test('resolveThreeJsBackendSourceFileDirectory prefers explicit path when present', () => {
  assert.equal(
    resolveThreeJsBackendSourceFileDirectory({
      name: 'demo.usd',
      path: 'packages/robot/demo.usd',
    }),
    'packages/robot/',
  );
});

test('ThreeJsBackend normalizes USD ASCII format to the USD backend', () => {
  const backend = new ThreeJsBackend(
    {
      name: 'demo.usda',
      content: '#usda 1.0',
      format: 'usda',
    },
    {},
  );

  assert.equal(backend.format, 'usd');
});

test('shared renderer sources do not import feature urdf-viewer modules', async () => {
  const rendererSourceFiles = await listRendererSourceFiles(rendererSourceDirUrl);

  for (const fileUrl of rendererSourceFiles) {
    const source = await readFile(fileUrl, 'utf8');
    assert.doesNotMatch(
      source,
      /(?:@\/features\/urdf-viewer|features\/urdf-viewer\/)/,
      fileUrl.pathname,
    );
  }
});

test('ThreeJsBackend waits for external URDF meshes before returning the pick map', async () => {
  const urdfContent = `<?xml version="1.0"?>
<robot name="async_mesh_robot">
  <link name="base_link">
    <visual>
      <geometry>
        <mesh filename="meshes/base.obj" />
      </geometry>
    </visual>
  </link>
</robot>`;
  const objContent = [
    'v -0.5 -0.5 0',
    'v 0.5 -0.5 0',
    'v 0 0.5 0',
    'f 1 2 3',
  ].join('\n');
  const assets = {
    'meshes/base.obj': `data:text/plain;charset=utf-8,${encodeURIComponent(objContent)}`,
  };
  const sourceFile = {
    id: 'async-mesh.urdf',
    name: 'async-mesh.urdf',
    content: urdfContent,
    format: 'urdf' as const,
  };

  const backend = new ThreeJsBackend(sourceFile, assets);
  const sceneGraph = await backend.load({
    sourceFile,
    assets,
    showVisual: true,
    showCollision: false,
    showCollisionAlwaysOnTop: true,
    allowUrdfXmlFallback: true,
  });

  const visualMeshes = sceneGraph.linkMeshMap.get('base_link:visual') ?? [];
  assert.equal(visualMeshes.length, 1);
  assert.equal(visualMeshes[0].userData.parentLinkName, 'base_link');
  assert.equal(visualMeshes[0].userData.isVisualMesh, true);
});

test('ThreeJsBackend skips collision geometry when collision display is disabled', async () => {
  const robotData: RobotData = {
    name: 'collision_parse_robot',
    rootLinkId: 'base_link',
    links: {
      base_link: {
        ...DEFAULT_LINK,
        id: 'base_link',
        name: 'base_link',
        visual: {
          type: GeometryType.BOX,
          dimensions: { x: 1, y: 1, z: 1 },
          color: '#f2f0e8',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collision: {
          type: GeometryType.BOX,
          dimensions: { x: 2, y: 2, z: 2 },
          color: '#ef4444',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
      },
    },
    joints: {},
  };
  const sourceFile = {
    id: 'collision-parse.urdf',
    name: 'collision-parse.urdf',
    content: '<robot name="collision_parse_robot" />',
    format: 'urdf' as const,
  };

  const hiddenCollisionBackend = new ThreeJsBackend(sourceFile, {});
  const hiddenCollisionScene = await hiddenCollisionBackend.load({
    sourceFile,
    assets: {},
    robotData,
    showVisual: true,
    showCollision: false,
    showCollisionAlwaysOnTop: true,
  });

  assert.equal(hiddenCollisionScene.linkMeshMap.get('base_link:collision'), undefined);
  assert.equal(countRuntimeCollisionGroups(hiddenCollisionScene.root), 0);

  const shownCollisionBackend = new ThreeJsBackend(sourceFile, {});
  const shownCollisionScene = await shownCollisionBackend.load({
    sourceFile,
    assets: {},
    robotData,
    showVisual: true,
    showCollision: true,
    showCollisionAlwaysOnTop: true,
  });

  assert.equal(shownCollisionScene.linkMeshMap.get('base_link:collision')?.length, 1);
  assert.equal(countRuntimeCollisionGroups(shownCollisionScene.root), 1);
});

test('ThreeJsBackend respects disabled URDF XML fallback when structured state is missing', async () => {
  const urdfContent = `<?xml version="1.0"?>
<robot name="pending_structured_state">
  <link name="base_link" />
</robot>`;
  const sourceFile = {
    id: 'pending-structured-state.urdf',
    name: 'pending-structured-state.urdf',
    content: urdfContent,
    format: 'urdf' as const,
  };

  const backend = new ThreeJsBackend(sourceFile, {});
  const loadProps = {
    sourceFile,
    assets: {},
    showVisual: true,
    showCollision: false,
    showCollisionAlwaysOnTop: true,
    allowUrdfXmlFallback: false,
  } satisfies Parameters<ThreeJsBackend['load']>[0];

  await assert.rejects(() => backend.load(loadProps), {
    message: 'Waiting for structured robot state',
  });
});

test('ThreeJsBackend applies initialJointAngles as RobotState actual angles relative to referencePosition', async () => {
  const robotData = createReferencedJointRobotData();
  const sourceFile = {
    id: 'referenced-joint.urdf',
    name: 'referenced-joint.urdf',
    content: '<robot name="referenced_joint_robot" />',
    format: 'urdf' as const,
  };

  const backend = new ThreeJsBackend(sourceFile, {});
  await backend.load({
    sourceFile,
    assets: {},
    robotData,
    showVisual: false,
    showCollision: false,
    showCollisionAlwaysOnTop: true,
    initialJointAngles: {
      hip_joint: Math.PI / 4 + 0.25,
    },
  });

  assert.ok(Math.abs(getRuntimeJointValue(backend.getRobotObject(), 'hip_joint') - 0.25) <= 1e-12);
});

test('ThreeJsBackend updateJointAngles and getJointAngles preserve RobotState actual angle semantics', async () => {
  const robotData = createReferencedJointRobotData();
  const sourceFile = {
    id: 'referenced-joint.urdf',
    name: 'referenced-joint.urdf',
    content: '<robot name="referenced_joint_robot" />',
    format: 'urdf' as const,
  };

  const backend = new ThreeJsBackend(sourceFile, {});
  await backend.load({
    sourceFile,
    assets: {},
    robotData,
    showVisual: false,
    showCollision: false,
    showCollisionAlwaysOnTop: true,
  });

  backend.updateJointAngles({
    hip_joint: Math.PI / 4 + 0.4,
  });

  assert.ok(Math.abs(getRuntimeJointValue(backend.getRobotObject(), 'hip_joint') - 0.4) <= 1e-12);
  assert.ok(Math.abs((backend.getJointAngles().hip_joint ?? Number.NaN) - (Math.PI / 4 + 0.4)) <= 1e-12);
});
