import assert from 'node:assert/strict';
import test from 'node:test';

import JSZip from 'jszip';
import { JSDOM } from 'jsdom';

import { parseMJCF, parseURDF } from '@/core/parsers';
import {
  createComponentSourceDraft,
  createDefaultWorkspace,
  createSingleComponentWorkspace,
} from '@/core/robot';
import {
  DEFAULT_JOINT,
  DEFAULT_LINK,
  GeometryType,
  JointType,
  type AssemblyState,
  type ComponentSourceDraft,
  type RobotData,
  type WorkspaceHistory,
} from '@/types';
import {
  PROJECT_ASSET_MANIFEST_FILE,
  PROJECT_COMPONENT_SOURCE_DRAFTS_FILE,
  PROJECT_MANIFEST_FILE,
  PROJECT_VERSION,
  PROJECT_WORKSPACE_HISTORY_FILE,
  PROJECT_WORKSPACE_STATE_FILE,
} from './projectArchive';
import {
  exportProject,
  type ExportProjectParams,
  type ProjectExportProgress,
} from './projectExport';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.DOMParser = dom.window.DOMParser as typeof DOMParser;
globalThis.XMLSerializer = dom.window.XMLSerializer as typeof XMLSerializer;
globalThis.ProgressEvent = dom.window.ProgressEvent as typeof ProgressEvent;

function createRobot(name = 'demo', rootLinkId = 'base_link'): RobotData {
  return {
    name,
    rootLinkId,
    links: {
      [rootLinkId]: {
        ...DEFAULT_LINK,
        id: rootLinkId,
        name: rootLinkId,
        visible: true,
      },
    },
    joints: {},
  };
}

function createHistory(overrides: Partial<WorkspaceHistory> = {}): WorkspaceHistory {
  return {
    past: [],
    future: [],
    activity: [],
    ...overrides,
  };
}

function createExportParams({
  workspace,
  sourceFiles = {},
  assetUrls = {},
  workspaceHistory = createHistory(),
  componentSourceDrafts,
  onProgress,
}: {
  workspace: AssemblyState;
  sourceFiles?: Record<string, string>;
  assetUrls?: Record<string, string>;
  workspaceHistory?: WorkspaceHistory;
  componentSourceDrafts?: Record<string, ComponentSourceDraft>;
  onProgress?: (progress: ProjectExportProgress) => void;
}): ExportProjectParams {
  const availableFiles = Object.entries(sourceFiles).map(([name, content]) => ({
    name,
    content,
    format: 'urdf' as const,
  }));
  const selectedFileName = availableFiles[0]?.name ?? null;
  return {
    name: workspace.name,
    lang: 'en',
    workspace,
    workspaceHistory,
    componentSourceDrafts,
    assets: {
      availableFiles,
      assetUrls,
      allFileContents: { ...sourceFiles },
      motorLibrary: {},
      selectedFileName,
    },
    derivedCaches: { usdPreparedExportCaches: {} },
    onProgress,
  };
}

async function exportToZip(params: ExportProjectParams): Promise<JSZip> {
  const result = await exportProject(params);
  assert.equal(result.partial, false);
  assert.deepEqual(result.warnings, []);
  return JSZip.loadAsync(await result.blob.arrayBuffer());
}

test('exportProject writes only the canonical .usp 3.0 workspace timeline', async () => {
  const sourcePath = 'robots/demo.urdf';
  const sourceContent = '<robot name="demo"><link name="base_link" /></robot>';
  const workspace = createSingleComponentWorkspace(createRobot(), {
    workspaceName: 'demo_project',
    componentId: 'robot_1',
    sourceFile: sourcePath,
  });
  const pastWorkspace = structuredClone(workspace);
  pastWorkspace.name = 'before_rename';
  const workspaceHistory = createHistory({
    past: [pastWorkspace],
    activity: [{
      id: 'rename_1',
      timestamp: '2026-07-09T12:00:00.000Z',
      label: 'Renamed workspace',
    }],
  });

  const zip = await exportToZip(createExportParams({
    workspace,
    sourceFiles: { [sourcePath]: sourceContent },
    workspaceHistory,
  }));

  assert.ok(zip.file(PROJECT_MANIFEST_FILE));
  assert.ok(zip.file(PROJECT_WORKSPACE_STATE_FILE));
  assert.ok(zip.file(PROJECT_WORKSPACE_HISTORY_FILE));
  assert.ok(zip.file(PROJECT_ASSET_MANIFEST_FILE));
  assert.equal(zip.file('project.json'), null);
  assert.equal(zip.file('history/robot.json'), null);
  assert.equal(zip.file('history/assembly.json'), null);

  const manifest = JSON.parse(await zip.file(PROJECT_MANIFEST_FILE)!.async('string'));
  assert.deepEqual(Object.keys(manifest).sort(), ['entries', 'metadata', 'version']);
  assert.equal(manifest.version, PROJECT_VERSION);
  assert.equal(manifest.entries.workspace, PROJECT_WORKSPACE_STATE_FILE);
  assert.equal(manifest.entries.workspaceHistory, PROJECT_WORKSPACE_HISTORY_FILE);
  assert.equal('ui' in manifest, false);
  assert.equal('assembly' in manifest, false);
  assert.equal('robot' in manifest, false);

  const archivedWorkspace = JSON.parse(
    await zip.file(PROJECT_WORKSPACE_STATE_FILE)!.async('string'),
  );
  const archivedHistory = JSON.parse(
    await zip.file(PROJECT_WORKSPACE_HISTORY_FILE)!.async('string'),
  );
  assert.deepEqual(archivedWorkspace, workspace);
  assert.deepEqual(archivedHistory, workspaceHistory);
  assert.equal('present' in archivedHistory, false);
});

test('exportProject accepts the canonical source-less blank workspace', async () => {
  const workspace = createDefaultWorkspace('blank_project');
  const zip = await exportToZip(createExportParams({ workspace }));

  const archivedWorkspace = JSON.parse(
    await zip.file(PROJECT_WORKSPACE_STATE_FILE)!.async('string'),
  );
  assert.equal(archivedWorkspace.components.component_1.sourceFile, null);
  assert.ok(zip.file('components/component_1/state.json'));
  assert.ok(zip.file('output/blank_project.urdf'));
});

test('exportProject preserves MJCF ball and free joints without requiring derived URDF files', async () => {
  const source = `<mujoco model="ball_robot"><worldbody>
    <body name="base_link"><freejoint name="root_free" />
      <geom type="box" size="0.1 0.1 0.1" />
      <body name="tool_link" pos="0 0 1"><joint name="ball_joint" type="ball" />
        <geom type="sphere" size="0.1" />
      </body>
    </body>
  </worldbody></mujoco>`;
  const parsed = parseMJCF(source);
  assert.ok(parsed);
  const { selection: _selection, ...robot } = parsed;
  const workspace = createSingleComponentWorkspace(robot, {
    componentId: 'ball_robot',
    sourceFile: 'robots/ball_robot.xml',
  });
  const draft = createComponentSourceDraft({
    componentId: 'ball_robot',
    format: 'mjcf',
    content: source,
    robot: workspace.components.ball_robot.robot,
  });
  const progress: ProjectExportProgress[] = [];
  const zip = await exportToZip(createExportParams({
    workspace,
    componentSourceDrafts: { ball_robot: draft },
    onProgress: (update) => progress.push(update),
  }));

  const archivedWorkspace = JSON.parse(
    await zip.file(PROJECT_WORKSPACE_STATE_FILE)!.async('string'),
  );
  assert.deepEqual(archivedWorkspace, JSON.parse(JSON.stringify(workspace)));
  assert.equal(archivedWorkspace.components.ball_robot.robot.joints.ball_joint.type, JointType.BALL);
  assert.equal(archivedWorkspace.components.ball_robot.robot.joints.root_free.type, JointType.FLOATING);
  assert.ok(zip.file(PROJECT_COMPONENT_SOURCE_DRAFTS_FILE));
  assert.equal(zip.file('output/ball_robot.urdf'), null);
  assert.equal(zip.file('output/ball_robot_extended.urdf'), null);
  const output = await zip.file('output/ball_robot.xml')?.async('string');
  assert.ok(output);
  const exportedRobot = parseMJCF(output);
  assert.ok(exportedRobot);
  assert.equal(exportedRobot.joints.ball_joint.type, JointType.BALL);
  assert.equal(exportedRobot.joints.root_free.type, JointType.FLOATING);
  const lastOutputProgress = progress.filter(({ phase }) => phase === 'output').at(-1);
  assert.ok(lastOutputProgress);
  assert.equal(lastOutputProgress.completed, lastOutputProgress.total);
});

test('native saves skip lossy planar MJCF while keeping URDF, BOM, and canonical joints', async context => {
  const warn = context.mock.method(console, 'warn', () => {});
  const error = context.mock.method(console, 'error', () => {});
  const robot = createRobot('planar_robot');
  robot.links.child = { ...structuredClone(DEFAULT_LINK), id: 'child', name: 'child' };
  robot.joints.planar = {
    ...structuredClone(DEFAULT_JOINT),
    id: 'planar', name: 'planar', type: JointType.PLANAR,
    parentLinkId: 'base_link', childLinkId: 'child',
  };
  const workspace = createSingleComponentWorkspace(robot, { componentId: 'robot' });

  const zip = await exportToZip(createExportParams({ workspace }));

  assert.equal(zip.file('output/planar_robot.xml'), null);
  assert.ok(zip.file('output/planar_robot.urdf'));
  assert.ok(zip.file('output/planar_robot_extended.urdf'));
  assert.ok(zip.file('output/bom.csv'));
  const archived = JSON.parse(await zip.file(PROJECT_WORKSPACE_STATE_FILE)!.async('string'));
  assert.equal(archived.components.robot.robot.joints.planar.type, JointType.PLANAR);
  assert.equal(warn.mock.callCount(), 0);
  assert.equal(error.mock.callCount(), 0);
});

for (const type of [GeometryType.PLANE, GeometryType.ELLIPSOID, GeometryType.MESH]) {
  test(`native saves preserve ${type} geometry without requiring a lossy URDF artifact`, async context => {
    const warn = context.mock.method(console, 'warn', () => {});
    const error = context.mock.method(console, 'error', () => {});
    const robot = createRobot('geometry_robot');
    robot.links.base_link.visual = { ...structuredClone(DEFAULT_LINK.visual), type };
    const workspace = createSingleComponentWorkspace(robot, { componentId: 'robot' });

    const zip = await exportToZip(createExportParams({ workspace }));

    assert.equal(zip.file('output/geometry_robot.urdf'), null);
    assert.equal(zip.file('output/geometry_robot_extended.urdf'), null);
    const mjcf = await zip.file('output/geometry_robot.xml')?.async('string');
    if (type === GeometryType.MESH) {
      assert.equal(mjcf, undefined);
    } else {
      assert.ok(mjcf);
      assert.match(mjcf, new RegExp(`type="${type}"`));
    }
    assert.ok(zip.file('output/bom.csv'));
    const archived = JSON.parse(await zip.file(PROJECT_WORKSPACE_STATE_FILE)!.async('string'));
    assert.equal(archived.components.robot.robot.links.base_link.visual.type, type);
    assert.equal(warn.mock.callCount(), 0);
    assert.equal(error.mock.callCount(), 0);
  });
}

for (const extension of ['stl', 'obj']) {
  test(`native saves reuse packed ${extension} bytes with matching optional MJCF paths`, async context => {
    const warn = context.mock.method(console, 'warn', () => {});
    const error = context.mock.method(console, 'error', () => {});
    const contents = extension === 'obj' ? 'v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n' : 'solid part\nendsolid part';
    const fetch = context.mock.method(globalThis, 'fetch', async () => {
      if (fetch.mock.callCount() > 1) throw new Error('Optional artifacts must not fetch mesh bytes again.');
      return new Response(contents);
    });
    const robot = createRobot('native_mesh');
    const meshPath = `robot/meshes/part.${extension}`;
    robot.links.base_link.visual = {
      ...structuredClone(DEFAULT_LINK.visual), type: GeometryType.MESH, meshPath,
      dimensions: { x: 2, y: 3, z: 4 },
      origin: { xyz: { x: 0.2, y: 0.3, z: 0.4 }, rpy: { r: 0, p: 0, y: 0 } },
    };
    const workspace = createSingleComponentWorkspace(robot, { componentId: 'robot' });

    const zip = await exportToZip(createExportParams({
      workspace, assetUrls: { [meshPath]: 'blob:packed-mesh' },
    }));

    assert.equal(fetch.mock.callCount(), 1);
    assert.equal(await zip.file(`output/meshes/part.${extension}`)?.async('string'), contents);
    assert.equal(await zip.file(`components/robot/meshes/part.${extension}`)?.async('string'), contents);
    const mjcf = await zip.file('output/native_mesh.xml')?.async('string');
    assert.ok(mjcf);
    const document = new DOMParser().parseFromString(mjcf, 'application/xml');
    assert.equal(document.querySelector('compiler')?.getAttribute('meshdir'), 'meshes/');
    assert.equal(document.querySelector('asset mesh')?.getAttribute('file'), `part.${extension}`);
    assert.equal(document.querySelector('asset mesh')?.getAttribute('scale'), '2 3 4');
    assert.equal(document.querySelector('geom[type="mesh"]')?.getAttribute('pos'), '0.2 0.3 0.4');
    assert.ok(zip.file('output/native_mesh.urdf'));
    assert.equal(warn.mock.callCount(), 0);
    assert.equal(error.mock.callCount(), 0);
  });
}

for (const [fileName, contents] of [
  ['part.dae', '<COLLADA><invalid-mesh-and-missing-texture>'],
  ['part.obj', 'mtllib missing.mtl\nv 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n'],
]) {
  test(`native saves keep ${fileName} without triggering optional conversion or resource diagnostics`, async context => {
    const warn = context.mock.method(console, 'warn', () => {});
    const error = context.mock.method(console, 'error', () => {});
    const fetch = context.mock.method(globalThis, 'fetch', async () => new Response(contents));
    const robot = createRobot('original_assets');
    const meshPath = `meshes/${fileName}`;
    robot.links.base_link.visual = {
      ...structuredClone(DEFAULT_LINK.visual), type: GeometryType.MESH, meshPath,
    };
    const workspace = createSingleComponentWorkspace(robot, { componentId: 'robot' });

    const zip = await exportToZip(createExportParams({ workspace, assetUrls: { [meshPath]: 'blob:original-mesh' } }));

    assert.equal(fetch.mock.callCount(), 1);
    assert.equal(zip.file('output/original_assets.xml'), null);
    assert.ok(zip.file('output/original_assets.urdf'));
    assert.ok(zip.file('output/bom.csv'));
    assert.equal(await zip.file(`components/robot/meshes/${fileName}`)?.async('string'), contents);
    assert.equal(warn.mock.callCount(), 0);
    assert.equal(error.mock.callCount(), 0);
  });
}

test('native saves retain authored mesh materials without optional MJCF material splitting', async context => {
  const warn = context.mock.method(console, 'warn', () => {});
  const error = context.mock.method(console, 'error', () => {});
  const contents = 'v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n';
  context.mock.method(globalThis, 'fetch', async () => new Response(contents));
  const robot = createRobot('authored_materials');
  robot.links.base_link.visual = {
    ...structuredClone(DEFAULT_LINK.visual),
    type: GeometryType.MESH,
    meshPath: 'meshes/part.obj',
    authoredMaterials: [
      { name: 'red', color: '#ff0000' },
      { name: 'blue', color: '#0000ff' },
    ],
  };
  const workspace = createSingleComponentWorkspace(robot, { componentId: 'robot' });

  const zip = await exportToZip(createExportParams({ workspace, assetUrls: { 'meshes/part.obj': 'blob:materials' } }));

  assert.equal(zip.file('output/authored_materials.xml'), null);
  assert.ok(zip.file('output/authored_materials.urdf'));
  assert.ok(zip.file('output/bom.csv'));
  const archived = JSON.parse(await zip.file(PROJECT_WORKSPACE_STATE_FILE)!.async('string'));
  assert.deepEqual(archived.components.robot.robot.links.base_link.visual.authoredMaterials, robot.links.base_link.visual.authoredMaterials);
  assert.equal(warn.mock.callCount(), 0);
  assert.equal(error.mock.callCount(), 0);
});

test('exportProject preserves ball bridges when component robots can each generate URDF', async () => {
  const workspace = createSingleComponentWorkspace(createRobot('left', 'left_base_link'), {
    workspaceName: 'ball_bridge',
    componentId: 'left',
  });
  workspace.components.right = createSingleComponentWorkspace(
    createRobot('right', 'right_base_link'),
    { componentId: 'right' },
  ).components.right;
  workspace.bridges.mount = {
    id: 'mount',
    name: 'mount',
    parentComponentId: 'left',
    parentLinkId: 'left_base_link',
    childComponentId: 'right',
    childLinkId: 'right_base_link',
    joint: {
      ...DEFAULT_JOINT,
      id: 'mount',
      name: 'mount',
      type: JointType.BALL,
      parentLinkId: 'left_base_link',
      childLinkId: 'right_base_link',
    },
  };
  const zip = await exportToZip(createExportParams({ workspace }));

  const archivedWorkspace = JSON.parse(
    await zip.file(PROJECT_WORKSPACE_STATE_FILE)!.async('string'),
  );
  assert.deepEqual(archivedWorkspace, workspace);
  assert.equal(zip.file('output/ball_bridge.urdf'), null);
  assert.equal(zip.file('output/ball_bridge_extended.urdf'), null);
  const bridgeXml = await zip.file('bridges/bridge.xml')?.async('string');
  assert.ok(bridgeXml);
  assert.match(bridgeXml, /type="ball"/);
  const output = await zip.file('output/ball_bridge.xml')?.async('string');
  assert.ok(output);
  const exportedRobot = parseMJCF(output);
  assert.ok(exportedRobot);
  assert.equal(exportedRobot.joints.mount.type, JointType.BALL);
});

test('exportProject saves an unfinished mesh collision without requiring optional MJCF outputs', async () => {
  const robot = createRobot('pending_mesh');
  robot.links.tip = { ...structuredClone(DEFAULT_LINK), id: 'tip', name: 'tip' };
  robot.joints.mount = {
    ...structuredClone(DEFAULT_JOINT),
    id: 'mount',
    name: 'mount',
    type: JointType.BALL,
    parentLinkId: 'base_link',
    childLinkId: 'tip',
  };
  const workspace = createSingleComponentWorkspace(robot, { componentId: 'pending_mesh' });
  const beforeMeshSelection = structuredClone(workspace);
  workspace.components.pending_mesh.robot.links.tip.collision = {
    ...structuredClone(DEFAULT_LINK.collision),
    type: GeometryType.MESH,
    meshPath: '',
  };
  const progress: ProjectExportProgress[] = [];
  const zip = await exportToZip(createExportParams({
    workspace,
    workspaceHistory: createHistory({ past: [beforeMeshSelection] }),
    assetUrls: { 'textures/kept.png': 'data:text/plain;base64,a2VwdA==' },
    onProgress: (update) => progress.push(update),
  }));

  const archivedWorkspace = JSON.parse(
    await zip.file(PROJECT_WORKSPACE_STATE_FILE)!.async('string'),
  );
  assert.deepEqual(archivedWorkspace, workspace);
  assert.equal(archivedWorkspace.components.pending_mesh.robot.joints.mount.type, JointType.BALL);
  assert.equal(archivedWorkspace.components.pending_mesh.robot.links.tip.collision.type, GeometryType.MESH);
  const archivedHistory = JSON.parse(
    await zip.file(PROJECT_WORKSPACE_HISTORY_FILE)!.async('string'),
  );
  assert.deepEqual(archivedHistory.past, [beforeMeshSelection]);
  assert.ok(zip.file('components/pending_mesh/state.json'));
  const archivedAssets = JSON.parse(await zip.file(PROJECT_ASSET_MANIFEST_FILE)!.async('string'));
  assert.equal(archivedAssets.packedFiles[0].logicalPath, 'textures/kept.png');
  assert.equal(await zip.file(archivedAssets.packedFiles[0].archivePath)!.async('string'), 'kept');
  assert.equal(zip.file('output/pending_mesh.xml'), null);
  assert.equal(zip.file('output/pending_mesh.urdf'), null);
  const lastOutputProgress = progress.filter(({ phase }) => phase === 'output').at(-1);
  assert.ok(lastOutputProgress);
  assert.equal(lastOutputProgress.completed, lastOutputProgress.total);
});

test('exportProject preserves committed joint motion in workspace and undo history', async () => {
  const robot = createRobot('motion_robot');
  robot.links.tool_link = {
    ...DEFAULT_LINK,
    id: 'tool_link',
    name: 'tool_link',
    visible: true,
  };
  robot.joints.hinge = {
    ...DEFAULT_JOINT,
    id: 'hinge',
    name: 'hinge',
    type: JointType.REVOLUTE,
    parentLinkId: 'base_link',
    childLinkId: 'tool_link',
    angle: 0.75,
    quaternion: { x: 0, y: 0, z: 0.1, w: 0.995 },
  };
  const workspace = createSingleComponentWorkspace(robot, {
    workspaceName: 'motion_project',
    componentId: 'motion',
  });
  const past = structuredClone(workspace);
  past.components.motion.robot.joints.hinge.angle = -0.25;
  const future = structuredClone(workspace);
  future.components.motion.robot.joints.hinge.angle = 1.25;
  const zip = await exportToZip(createExportParams({
    workspace,
    workspaceHistory: createHistory({ past: [past], future: [future] }),
  }));

  const archivedWorkspace = JSON.parse(
    await zip.file(PROJECT_WORKSPACE_STATE_FILE)!.async('string'),
  );
  const archivedHistory = JSON.parse(
    await zip.file(PROJECT_WORKSPACE_HISTORY_FILE)!.async('string'),
  );
  assert.equal(archivedWorkspace.components.motion.robot.joints.hinge.angle, 0.75);
  assert.deepEqual(
    archivedWorkspace.components.motion.robot.joints.hinge.quaternion,
    robot.joints.hinge.quaternion,
  );
  assert.equal(archivedHistory.past[0].components.motion.robot.joints.hinge.angle, -0.25);
  assert.equal(archivedHistory.future[0].components.motion.robot.joints.hinge.angle, 1.25);
});

test('exportProject validates canonical state before attempting asset IO', async () => {
  const invalidWorkspace = createDefaultWorkspace('invalid');
  invalidWorkspace.components = {};

  await assert.rejects(
    exportProject(createExportParams({
      workspace: invalidWorkspace,
      assetUrls: { 'missing.png': 'blob:missing' },
    })),
    /canonical workspace.*components.*at least one component/i,
  );
});

test('exportProject rejects session state instead of archiving it', async () => {
  const workspace = createDefaultWorkspace('session_leak');
  (workspace as unknown as Record<string, unknown>).activeComponentId = 'component_1';

  await assert.rejects(
    exportProject(createExportParams({ workspace })),
    /activeComponentId.*(?:session state|canonical workspace field)/i,
  );
});

test('exportProject fails fast when a packed asset cannot be fetched', async () => {
  const workspace = createDefaultWorkspace('broken_asset_project');

  await assert.rejects(
    exportProject(createExportParams({
      workspace,
      assetUrls: { 'textures/missing.png': 'blob:missing-project-asset' },
    })),
    /Failed to pack asset "textures\/missing\.png"/,
  );
});

test('exportProject still rejects missing bytes for an explicitly referenced component mesh', async () => {
  const robot = createRobot('missing_component_mesh');
  robot.links.base_link.collision = {
    ...structuredClone(DEFAULT_LINK.collision),
    type: GeometryType.MESH,
    meshPath: 'meshes/missing.stl',
  };
  const workspace = createSingleComponentWorkspace(robot, { componentId: 'missing_mesh' });

  await assert.rejects(
    exportProject(createExportParams({ workspace })),
    /Missing component mesh asset "meshes\/missing\.stl" for missing_mesh/,
  );
});

test('exportProject applies workspace and component transforms to generated output', async () => {
  const sourcePath = 'robots/arm.urdf';
  const sourceContent = '<robot name="arm"><link name="base_link" /></robot>';
  const workspace = createSingleComponentWorkspace(createRobot('arm'), {
    workspaceName: 'transformed_workspace',
    componentId: 'arm_1',
    sourceFile: sourcePath,
    workspaceTransform: {
      position: { x: 1, y: 2, z: 3 },
      rotation: { r: 0.1, p: -0.2, y: 0.3 },
    },
    componentTransform: {
      position: { x: -0.5, y: 0.25, z: 0.75 },
      rotation: { r: -0.15, p: 0.35, y: -0.45 },
    },
  });
  const zip = await exportToZip(createExportParams({
    workspace,
    sourceFiles: { [sourcePath]: sourceContent },
  }));

  const output = await zip.file('output/arm.urdf')?.async('string');
  assert.ok(output);
  const robot = parseURDF(output);
  assert.ok(robot);
  const workspaceRootJoint = Object.values(robot.joints).find(
    (joint) => joint.parentLinkId === robot.rootLinkId,
  );
  const componentRootJoint = Object.values(robot.joints).find(
    (joint) => joint.childLinkId === 'base_link',
  );
  assert.deepEqual(workspaceRootJoint?.origin.xyz, workspace.transform.position);
  assert.deepEqual(
    componentRootJoint?.origin.xyz,
    workspace.components.arm_1.transform.position,
  );
});

test('exportProject keeps bridge quaternion metadata as a derived artifact', async () => {
  const leftSource = 'robots/left.urdf';
  const rightSource = 'robots/right.urdf';
  const workspace = createSingleComponentWorkspace(createRobot('left', 'left_base_link'), {
    workspaceName: 'bridge_workspace',
    componentId: 'left',
    sourceFile: leftSource,
  });
  workspace.components.right = createSingleComponentWorkspace(
    createRobot('right', 'right_base_link'), {
    componentId: 'right',
    sourceFile: rightSource,
    },
  ).components.right;
  workspace.bridges.mount = {
    id: 'mount',
    name: 'mount',
    parentComponentId: 'left',
    parentLinkId: 'left_base_link',
    childComponentId: 'right',
    childLinkId: 'right_base_link',
    joint: {
      ...DEFAULT_JOINT,
      id: 'mount',
      name: 'mount_joint',
      type: JointType.FIXED,
      parentLinkId: 'left_base_link',
      childLinkId: 'right_base_link',
      origin: {
        xyz: { x: 1.25, y: -2.5, z: 3.75 },
        rpy: { r: 0.1, p: -0.2, y: 0.3 },
        quatXyzw: { x: 0, y: 0, z: 0.70710678, w: 0.70710678 },
      },
    },
  };
  const source = '<robot name="robot"><link name="base_link" /></robot>';
  const zip = await exportToZip(createExportParams({
    workspace,
    sourceFiles: { [leftSource]: source, [rightSource]: source },
  }));

  const bridgeXml = await zip.file('bridges/bridge.xml')?.async('string');
  assert.ok(bridgeXml);
  assert.match(bridgeXml, /xyz="1\.25 -2\.5 3\.75"/);
  assert.match(bridgeXml, /rpy="0\.1 -0\.2 0\.3"/);
  assert.match(bridgeXml, /quat_xyzw="0 0 0\.70710678 0\.70710678"/);

  const output = await zip.file('output/bridge_workspace.urdf')?.async('string');
  assert.ok(output);
  const exportedRobot = parseURDF(output);
  assert.ok(exportedRobot);
  const exportedBridge = Object.values(exportedRobot.joints).find(
    (joint) => joint.name === workspace.bridges.mount.id,
  );
  assert.ok(exportedBridge);
  assert.deepEqual(exportedBridge.origin.xyz, workspace.bridges.mount.joint.origin.xyz);
  assert.deepEqual(exportedBridge.origin.rpy, workspace.bridges.mount.joint.origin.rpy);
});

test('exportProject archives only fresh component-owned source drafts without library fallback', async () => {
  const sourcePath = 'robots/demo.urdf';
  const sourceContent = '<robot name="demo"><link name="base_link" /></robot>';
  const workspace = createSingleComponentWorkspace(createRobot(), {
    componentId: 'demo-instance',
    sourceFile: sourcePath,
  });
  const draft = createComponentSourceDraft({
    componentId: 'demo-instance',
    format: 'urdf',
    content: sourceContent,
    robot: workspace.components['demo-instance'].robot,
  });
  const zip = await exportToZip(createExportParams({
    workspace,
    componentSourceDrafts: { 'demo-instance': draft },
  }));
  const manifest = JSON.parse(await zip.file(PROJECT_MANIFEST_FILE)!.async('string'));
  assert.equal(manifest.entries.componentSourceDrafts, PROJECT_COMPONENT_SOURCE_DRAFTS_FILE);
  const draftManifest = JSON.parse(
    await zip.file(PROJECT_COMPONENT_SOURCE_DRAFTS_FILE)!.async('string'),
  );
  assert.deepEqual(draftManifest.drafts.map((entry: { componentId: string }) => entry.componentId), [
    'demo-instance',
  ]);
  assert.equal(
    await zip.file(draftManifest.drafts[0].contentPath)!.async('string'),
    sourceContent,
  );

  workspace.components['demo-instance'].robot.name = 'semantic-edit';
  const staleZip = await exportToZip(createExportParams({
    workspace,
    componentSourceDrafts: { 'demo-instance': draft },
  }));
  const staleManifest = JSON.parse(
    await staleZip.file(PROJECT_MANIFEST_FILE)!.async('string'),
  );
  assert.equal(staleManifest.entries.componentSourceDrafts, undefined);
  assert.equal(staleZip.file(PROJECT_COMPONENT_SOURCE_DRAFTS_FILE), null);
});

test('exportProject skips USD source drafts because binary source and prepared cache own USD roundtrip', async () => {
  const workspace = createSingleComponentWorkspace(createRobot('usd_robot'), {
    componentId: 'usd-instance',
    sourceFile: 'robots/usd_robot.usd',
  });
  const usdDraft = createComponentSourceDraft({
    componentId: 'usd-instance',
    format: 'usd',
    content: '#usda 1.0',
    robot: workspace.components['usd-instance'].robot,
  });
  const zip = await exportToZip(createExportParams({
    workspace,
    componentSourceDrafts: { 'usd-instance': usdDraft },
  }));
  const manifest = JSON.parse(await zip.file(PROJECT_MANIFEST_FILE)!.async('string'));
  assert.equal(manifest.entries.componentSourceDrafts, undefined);
  assert.equal(zip.file(PROJECT_COMPONENT_SOURCE_DRAFTS_FILE), null);
});

test('exportProject reports all archive phases', async () => {
  const progress: ProjectExportProgress[] = [];
  await exportProject(createExportParams({
    workspace: createDefaultWorkspace('progress_project'),
    assetUrls: { 'textures/progress.png': 'data:text/plain;base64,cHJvZ3Jlc3M=' },
    onProgress: (update) => progress.push(update),
  }));

  const phases = new Set(progress.map((update) => update.phase));
  assert.deepEqual(
    Array.from(phases).sort(),
    ['archive', 'assets', 'components', 'metadata', 'output'],
  );
  assert.ok(progress.every(({ completed, total }) => total > 0 && completed <= total));
});
