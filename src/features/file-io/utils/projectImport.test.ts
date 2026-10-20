import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import JSZip from 'jszip';
import { JSDOM } from 'jsdom';

import { generateURDF, parseMJCF, parseSDF, parseURDF, parseXacro } from '@/core/parsers';
import {
  createComponentSourceDraft,
  createSingleComponentWorkspace,
  createSourceSemanticRobotHash,
} from '@/core/robot';
import {
  DEFAULT_JOINT,
  DEFAULT_LINK,
  GeometryType,
  JointType,
  type AssemblyState,
  type ComponentSourceDraft,
  type ComponentSourceFormat,
  type RobotData,
  type UsdPreparedExportCache,
  type WorkspaceHistory,
} from '@/types';
import {
  buildLibraryArchivePath,
  PROJECT_ASSET_MANIFEST_FILE,
  PROJECT_COMPONENT_SOURCE_DRAFTS_FILE,
  PROJECT_MANIFEST_FILE,
  PROJECT_WORKSPACE_HISTORY_FILE,
  PROJECT_WORKSPACE_STATE_FILE,
} from './projectArchive';
import { exportProject, type ExportProjectParams } from './projectExport';
import { importProject, readImportedProjectArchive } from './projectImport';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.DOMParser = dom.window.DOMParser as typeof DOMParser;
globalThis.XMLSerializer = dom.window.XMLSerializer as typeof XMLSerializer;

function createRobot(name: string): RobotData {
  const rootLinkId = `${name}_base_link`;
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

function parseRobotData(source: string): RobotData {
  const parsed = parseURDF(source);
  assert.ok(parsed);
  const { selection: _selection, ...robot } = parsed;
  return robot;
}

function parseTextDraftRobot(format: ComponentSourceFormat, source: string): RobotData {
  const parsed = format === 'urdf'
    ? parseURDF(source)
    : format === 'mjcf'
      ? parseMJCF(source)
      : format === 'sdf'
        ? parseSDF(source)
        : format === 'xacro'
          ? parseXacro(source)
          : null;
  assert.ok(parsed);
  const { selection: _selection, ...robot } = parsed;
  return robot;
}

function createWorkspace(): AssemblyState {
  const workspace = createSingleComponentWorkspace(createRobot('left'), {
    workspaceName: 'assembly_project',
    componentId: 'left',
    componentName: 'Left instance',
    sourceFile: 'robots/left.urdf',
  });
  workspace.components.right = createSingleComponentWorkspace(createRobot('right'), {
    componentId: 'right',
    componentName: 'Right instance',
    sourceFile: 'robots/right.urdf',
    componentTransform: {
      position: { x: 1, y: 0, z: 0 },
      rotation: { r: 0, p: 0, y: 0 },
    },
  }).components.right;
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
    },
  };
  return workspace;
}

function createSameLocalIdWorkspace(): AssemblyState {
  const createBaseLinkRobot = (name: string): RobotData => ({
    name,
    rootLinkId: 'base_link',
    links: {
      base_link: {
        ...DEFAULT_LINK,
        id: 'base_link',
        name: 'base_link',
        visible: true,
      },
    },
    joints: {},
  });
  const workspace = createSingleComponentWorkspace(createBaseLinkRobot('left'), {
    workspaceName: 'same_local_ids',
    componentId: 'left',
    sourceFile: 'robots/left.urdf',
  });
  workspace.components.right = createSingleComponentWorkspace(createBaseLinkRobot('right'), {
    componentId: 'right',
    sourceFile: 'robots/right.urdf',
  }).components.right;
  workspace.bridges.mount = {
    id: 'mount',
    name: 'mount',
    parentComponentId: 'left',
    parentLinkId: 'base_link',
    childComponentId: 'right',
    childLinkId: 'base_link',
    joint: {
      ...DEFAULT_JOINT,
      id: 'mount',
      name: 'mount_joint',
      type: JointType.FIXED,
      parentLinkId: 'base_link',
      childLinkId: 'base_link',
    },
  };
  return workspace;
}

function createHistory(workspace: AssemblyState): WorkspaceHistory {
  const past = structuredClone(workspace);
  past.name = 'before_rename';
  return {
    past: [past],
    future: [],
    activity: [{
      id: 'rename_1',
      timestamp: '2026-07-09T12:00:00.000Z',
      label: 'Renamed workspace',
    }],
  };
}

function createParams(
  workspace: AssemblyState,
  options: {
    assetUrls?: Record<string, string>;
    availableFiles?: ExportProjectParams['assets']['availableFiles'];
    derivedCaches?: ExportProjectParams['derivedCaches'];
    componentSourceDrafts?: Record<string, ComponentSourceDraft>;
    workspaceHistory?: WorkspaceHistory;
  } = {},
): ExportProjectParams {
  const source = '<robot name="robot"><link name="base_link" /></robot>';
  const availableFiles = options.availableFiles ?? [
    { name: 'robots/left.urdf', format: 'urdf', content: source },
    { name: 'robots/right.urdf', format: 'urdf', content: source },
  ];
  const allFileContents = Object.fromEntries(
    availableFiles.filter((file) => file.content).map((file) => [file.name, file.content]),
  );
  return {
    name: workspace.name,
    lang: 'en',
    workspace,
    workspaceHistory: options.workspaceHistory ?? createHistory(workspace),
    componentSourceDrafts: options.componentSourceDrafts,
    assets: {
      availableFiles,
      assetUrls: options.assetUrls ?? {},
      allFileContents,
      motorLibrary: {},
      selectedFileName: availableFiles[0]?.name ?? null,
    },
    derivedCaches: options.derivedCaches ?? { usdPreparedExportCaches: {} },
  };
}

async function buildProjectZip(params = createParams(createWorkspace())): Promise<JSZip> {
  const result = await exportProject(params);
  return JSZip.loadAsync(await result.blob.arrayBuffer());
}

async function toProjectFile(zip: JSZip): Promise<File> {
  return await zip.generateAsync({ type: 'uint8array' }) as unknown as File;
}

const DRAFT_SOURCE_PATH = 'robots/draft.urdf';
const DRAFT_SOURCE_CONTENT = `<?xml version="1.0"?>
<robot name="draft_robot">
  <link name="base_link" />
</robot>`;

function createDraftProjectParams(): ExportProjectParams {
  const workspace = createSingleComponentWorkspace(parseRobotData(DRAFT_SOURCE_CONTENT), {
    workspaceName: 'draft_project',
    componentId: 'draft-instance',
    sourceFile: DRAFT_SOURCE_PATH,
  });
  return createParams(workspace, {
    availableFiles: [{
      name: DRAFT_SOURCE_PATH,
      format: 'urdf',
      content: DRAFT_SOURCE_CONTENT,
    }],
    componentSourceDrafts: {
      'draft-instance': createComponentSourceDraft({
        componentId: 'draft-instance',
        format: 'urdf',
        content: DRAFT_SOURCE_CONTENT,
        robot: workspace.components['draft-instance'].robot,
      }),
    },
  });
}

const TEXT_DRAFT_CASES = [
  {
    format: 'mjcf' as const,
    extension: 'xml',
    content: '<mujoco model="draft_mjcf"><worldbody><body name="base" /></worldbody></mujoco>',
    corrupt: '<mujoco model="other_mjcf"><worldbody><body name="other" /></worldbody></mujoco>',
  },
  {
    format: 'sdf' as const,
    extension: 'sdf',
    content: '<sdf version="1.9"><model name="draft_sdf"><link name="base" /></model></sdf>',
    corrupt: '<sdf version="1.9"><model name="other_sdf"><link name="other" /></model></sdf>',
  },
  {
    format: 'xacro' as const,
    extension: 'xacro',
    content: '<robot xmlns:xacro="http://www.ros.org/wiki/xacro" name="draft_xacro"><link name="base" /></robot>',
    corrupt: '<robot xmlns:xacro="http://www.ros.org/wiki/xacro" name="other_xacro"><link name="other" /></robot>',
  },
];

function createTextDraftProjectParams(
  draftCase: (typeof TEXT_DRAFT_CASES)[number],
): ExportProjectParams {
  const sourcePath = `robots/draft.${draftCase.extension}`;
  const componentId = `${draftCase.format}-instance`;
  const workspace = createSingleComponentWorkspace(
    parseTextDraftRobot(draftCase.format, draftCase.content),
    { componentId, sourceFile: sourcePath },
  );
  return createParams(workspace, {
    availableFiles: [{
      name: sourcePath,
      format: draftCase.format,
      content: draftCase.content,
    }],
    componentSourceDrafts: {
      [componentId]: createComponentSourceDraft({
        componentId,
        format: draftCase.format,
        content: draftCase.content,
        robot: workspace.components[componentId].robot,
      }),
    },
  });
}

async function readDraftManifest(zip: JSZip) {
  return JSON.parse(await zip.file(PROJECT_COMPONENT_SOURCE_DRAFTS_FILE)!.async('string')) as {
    drafts: Array<{
      componentId: string;
      format: string;
      robotSnapshotHash: string;
      contentPath: string;
    }>;
  };
}

test('importProject roundtrips the canonical workspace, history, and asset metadata', async () => {
  const workspace = createWorkspace();
  const workspaceHistory = createHistory(workspace);
  const imported = await importProject(
    await toProjectFile(await buildProjectZip(createParams(workspace, { workspaceHistory }))),
  );

  assert.deepEqual(imported.workspace, workspace);
  assert.deepEqual(imported.workspaceHistory, workspaceHistory);
  assert.equal(imported.assets.selectedFileName, 'robots/left.urdf');
  assert.equal(imported.assets.availableFiles.length, 2);
  assert.deepEqual(imported.warnings, []);
  assert.equal('robotState' in imported, false);
  assert.equal('robotHistory' in imported, false);
  assert.equal('assemblyState' in imported, false);
  assert.equal('assemblyHistory' in imported, false);
});

test('USP3 workspace JSON normalizes typed USD material arrays for roundtrip', async () => {
  const workspace = createWorkspace();
  workspace.components.left!.robot.materials = {
    body: {
      usdMaterial: {
        color: new Float32Array([0.125, 0.25, 0.5]),
      },
    },
  };

  const imported = await importProject(
    await toProjectFile(await buildProjectZip(createParams(workspace))),
  );

  assert.deepEqual(
    imported.workspace.components.left!.robot.materials!.body!.usdMaterial!.color,
    [0.125, 0.25, 0.5],
  );
});

test(
  'export/import roundtrips identical source-local IDs across components',
  async () => {
    const workspace = createSameLocalIdWorkspace();
    const imported = await importProject(
      await toProjectFile(await buildProjectZip(createParams(workspace))),
    );
    assert.deepEqual(imported.workspace, workspace);
  },
);

test('importProject roundtrips fresh component-owned source drafts', async () => {
  const params = createDraftProjectParams();
  const imported = await importProject(await toProjectFile(await buildProjectZip(params)));
  assert.deepEqual(imported.componentSourceDrafts, params.componentSourceDrafts);
  assert.equal(
    imported.assets.availableFiles[0]?.content,
    DRAFT_SOURCE_CONTENT,
  );
});

for (const sourceFile of [null, DRAFT_SOURCE_PATH] as const) {
  test(`importProject roundtrips an owned draft with ${sourceFile === null ? 'sourceFile=null' : 'a missing library template'}`, async () => {
    const workspace = createSingleComponentWorkspace(parseRobotData(DRAFT_SOURCE_CONTENT), {
      workspaceName: 'owned_draft_project',
      componentId: 'owned-instance',
      sourceFile,
    });
    const draft = createComponentSourceDraft({
      componentId: 'owned-instance',
      format: 'urdf',
      content: DRAFT_SOURCE_CONTENT,
      robot: workspace.components['owned-instance'].robot,
    });
    const params = createParams(workspace, {
      availableFiles: [],
      componentSourceDrafts: { 'owned-instance': draft },
    });

    const imported = await importProject(await toProjectFile(await buildProjectZip(params)));
    assert.deepEqual(imported.componentSourceDrafts, { 'owned-instance': draft });
    assert.equal(imported.workspace.components['owned-instance'].sourceFile, sourceFile);
    assert.deepEqual(imported.assets.availableFiles, []);
  });
}

for (const draftCase of TEXT_DRAFT_CASES) {
  test(`importProject parses and roundtrips ${draftCase.format.toUpperCase()} component drafts`, async () => {
    const params = createTextDraftProjectParams(draftCase);
    const imported = await importProject(await toProjectFile(await buildProjectZip(params)));
    assert.deepEqual(imported.componentSourceDrafts, params.componentSourceDrafts);
  });

  test(`importProject rejects semantically corrupt ${draftCase.format.toUpperCase()} draft content`, async () => {
    const zip = await buildProjectZip(createTextDraftProjectParams(draftCase));
    const manifest = await readDraftManifest(zip);
    zip.file(manifest.drafts[0].contentPath, draftCase.corrupt);
    await assert.rejects(
      importProject(await toProjectFile(zip)),
      /component source draft content hash mismatch/i,
    );
  });
}

test('importProject rejects corrupt component source draft hash and content', async () => {
  const corruptHashZip = await buildProjectZip(createDraftProjectParams());
  const corruptHashManifest = await readDraftManifest(corruptHashZip);
  corruptHashManifest.drafts[0].robotSnapshotHash = 'robot-semantic-v1:corrupt';
  corruptHashZip.file(
    PROJECT_COMPONENT_SOURCE_DRAFTS_FILE,
    JSON.stringify(corruptHashManifest),
  );
  await assert.rejects(
    importProject(await toProjectFile(corruptHashZip)),
    /component source draft hash mismatch/i,
  );

  const corruptContentZip = await buildProjectZip(createDraftProjectParams());
  const corruptContentManifest = await readDraftManifest(corruptContentZip);
  corruptContentZip.file(
    corruptContentManifest.drafts[0].contentPath,
    '<robot name="different"><link name="other" /></robot>',
  );
  await assert.rejects(
    importProject(await toProjectFile(corruptContentZip)),
    /component source draft content hash mismatch/i,
  );
});

test('importProject rejects foreign, duplicate, and unsafe component source drafts', async () => {
  const foreignZip = await buildProjectZip(createDraftProjectParams());
  const foreignManifest = await readDraftManifest(foreignZip);
  foreignManifest.drafts[0].componentId = 'foreign-component';
  foreignZip.file(PROJECT_COMPONENT_SOURCE_DRAFTS_FILE, JSON.stringify(foreignManifest));
  await assert.rejects(
    importProject(await toProjectFile(foreignZip)),
    /references foreign component "foreign-component"/i,
  );

  const duplicateZip = await buildProjectZip(createDraftProjectParams());
  const duplicateManifest = await readDraftManifest(duplicateZip);
  duplicateManifest.drafts.push({ ...duplicateManifest.drafts[0] });
  duplicateZip.file(PROJECT_COMPONENT_SOURCE_DRAFTS_FILE, JSON.stringify(duplicateManifest));
  await assert.rejects(
    importProject(await toProjectFile(duplicateZip)),
    /duplicate component source draft/i,
  );

  const duplicatePathParams = createDraftProjectParams();
  duplicatePathParams.workspace.components.second = createSingleComponentWorkspace(
    parseRobotData(DRAFT_SOURCE_CONTENT),
    { componentId: 'second', sourceFile: DRAFT_SOURCE_PATH },
  ).components.second;
  duplicatePathParams.componentSourceDrafts!.second = createComponentSourceDraft({
    componentId: 'second',
    format: 'urdf',
    content: DRAFT_SOURCE_CONTENT,
    robot: duplicatePathParams.workspace.components.second.robot,
  });
  const duplicatePathZip = await buildProjectZip(duplicatePathParams);
  const duplicatePathManifest = await readDraftManifest(duplicatePathZip);
  duplicatePathManifest.drafts[1].contentPath = duplicatePathManifest.drafts[0].contentPath;
  duplicatePathZip.file(
    PROJECT_COMPONENT_SOURCE_DRAFTS_FILE,
    JSON.stringify(duplicatePathManifest),
  );
  await assert.rejects(
    importProject(await toProjectFile(duplicatePathZip)),
    /duplicate component source draft content path/i,
  );

  const traversalZip = await buildProjectZip(createDraftProjectParams());
  const traversalManifest = await readDraftManifest(traversalZip);
  traversalManifest.drafts[0].contentPath = 'workspace/source-drafts/%252e%252e/secret.txt';
  traversalZip.file(PROJECT_COMPONENT_SOURCE_DRAFTS_FILE, JSON.stringify(traversalManifest));
  await assert.rejects(
    importProject(await toProjectFile(traversalZip)),
    /contentPath path.*invalid/i,
  );
});

test('importProject rejects semantically invalid draft formats and unexpected manifest fields', async () => {
  const formatZip = await buildProjectZip(createDraftProjectParams());
  const formatManifest = await readDraftManifest(formatZip);
  formatManifest.drafts[0].format = 'mjcf';
  formatZip.file(PROJECT_COMPONENT_SOURCE_DRAFTS_FILE, JSON.stringify(formatManifest));
  await assert.rejects(
    importProject(await toProjectFile(formatZip)),
    /failed to parse component source draft/i,
  );

  const unexpectedFieldZip = await buildProjectZip(createDraftProjectParams());
  const manifest = JSON.parse(
    await unexpectedFieldZip.file(PROJECT_MANIFEST_FILE)!.async('string'),
  );
  manifest.entries.unexpectedEntry = 'workspace/unexpected.txt';
  unexpectedFieldZip.file(PROJECT_MANIFEST_FILE, JSON.stringify(manifest));
  await assert.rejects(
    importProject(await toProjectFile(unexpectedFieldZip)),
    /manifest\.entries has invalid fields.*unexpected unexpectedEntry/i,
  );
});

test('importProject roundtrips blob-backed USD files and prepared caches as derived data', async () => {
  const workspace = createSingleComponentWorkspace(createRobot('usd_robot'), {
    workspaceName: 'usd_project',
    componentId: 'usd_1',
    sourceFile: 'robots/demo.usd',
  });
  const preparedCache: UsdPreparedExportCache = {
    stageSourcePath: '/robots/demo.usd',
    robotData: createRobot('usd_robot'),
    meshFiles: {
      'mesh.obj': new Blob(['o mesh\nv 0 0 0\n'], { type: 'text/plain' }),
    },
  };
  const params = createParams(workspace, {
    availableFiles: [{ name: 'robots/demo.usd', format: 'usd', content: '' }],
    assetUrls: {
      'robots/demo.usd': 'data:application/octet-stream;base64,VVNE',
    },
    derivedCaches: {
      usdPreparedExportCaches: { 'robots/demo.usd': preparedCache },
    },
  });
  params.componentSourceDrafts = {
    usd_1: createComponentSourceDraft({
      componentId: 'usd_1',
      format: 'usd',
      content: '',
      robot: workspace.components.usd_1.robot,
    }),
  };

  const zip = await buildProjectZip(params);
  const manifest = JSON.parse(await zip.file(PROJECT_MANIFEST_FILE)!.async('string'));
  assert.equal(manifest.entries.componentSourceDrafts, undefined);
  const imported = await importProject(await toProjectFile(zip));
  assert.match(imported.assets.assetUrls['robots/demo.usd'] ?? '', /^blob:/);
  assert.match(imported.assets.availableFiles[0]?.blobUrl ?? '', /^blob:/);
  const restoredCache = imported.derivedCaches.usdPreparedExportCaches['robots/demo.usd'];
  assert.ok(restoredCache);
  assert.equal(await restoredCache.meshFiles['mesh.obj'].text(), 'o mesh\nv 0 0 0\n');
});

test('importProject rejects unsupported project versions', async () => {
  const zip = await buildProjectZip();
  const manifest = JSON.parse(await zip.file(PROJECT_MANIFEST_FILE)!.async('string'));
  manifest.version = '99.0';
  zip.file(PROJECT_MANIFEST_FILE, JSON.stringify(manifest));

  await assert.rejects(
    importProject(await toProjectFile(zip)),
    /Unsupported project version: expected 3\.0, received 99\.0/,
  );
});

test('importProject rejects missing library sources and workspace history', async () => {
  const missingSource = await buildProjectZip();
  missingSource.remove(buildLibraryArchivePath('robots/left.urdf'));
  await assert.rejects(
    importProject(await toProjectFile(missingSource)),
    /missing required library source file "robots\/left\.urdf"/i,
  );

  const missingHistory = await buildProjectZip();
  missingHistory.remove(PROJECT_WORKSPACE_HISTORY_FILE);
  await assert.rejects(
    importProject(await toProjectFile(missingHistory)),
    /missing required workspace history/i,
  );
});

test('importProject rejects corrupt canonical state and nullable history snapshots', async () => {
  const emptyWorkspaceZip = await buildProjectZip();
  const workspace = JSON.parse(
    await emptyWorkspaceZip.file(PROJECT_WORKSPACE_STATE_FILE)!.async('string'),
  );
  workspace.components = {};
  emptyWorkspaceZip.file(PROJECT_WORKSPACE_STATE_FILE, JSON.stringify(workspace));
  await assert.rejects(
    importProject(await toProjectFile(emptyWorkspaceZip)),
    /workspace.*components.*at least one component/i,
  );

  const nullHistoryZip = await buildProjectZip();
  const history = JSON.parse(
    await nullHistoryZip.file(PROJECT_WORKSPACE_HISTORY_FILE)!.async('string'),
  );
  history.future = [null];
  nullHistoryZip.file(PROJECT_WORKSPACE_HISTORY_FILE, JSON.stringify(history));
  await assert.rejects(
    importProject(await toProjectFile(nullHistoryZip)),
    /workspace history future\[0\].*canonical workspace/i,
  );
});

test('importProject fails fast on incomplete component geometry and bridge joints', async () => {
  const missingGeometryZip = await buildProjectZip(createDraftProjectParams());
  const missingGeometryWorkspace = JSON.parse(
    await missingGeometryZip.file(PROJECT_WORKSPACE_STATE_FILE)!.async('string'),
  );
  delete missingGeometryWorkspace.components['draft-instance'].robot.links.base_link.visual;
  missingGeometryZip.file(
    PROJECT_WORKSPACE_STATE_FILE,
    JSON.stringify(missingGeometryWorkspace),
  );
  await assert.rejects(
    importProject(await toProjectFile(missingGeometryZip)),
    /links\.base_link\.visual.*visual geometry object/i,
  );

  const missingJointOriginZip = await buildProjectZip();
  const missingJointOriginWorkspace = JSON.parse(
    await missingJointOriginZip.file(PROJECT_WORKSPACE_STATE_FILE)!.async('string'),
  );
  delete missingJointOriginWorkspace.bridges.mount.joint.origin;
  missingJointOriginZip.file(
    PROJECT_WORKSPACE_STATE_FILE,
    JSON.stringify(missingJointOriginWorkspace),
  );
  await assert.rejects(
    importProject(await toProjectFile(missingJointOriginZip)),
    /bridges\.mount\.joint\.origin.*complete origin/i,
  );
});

test('importProject rejects damaged nested runtime collections before committing USP3', async () => {
  const invalidMaterialsZip = await buildProjectZip();
  const invalidMaterialsWorkspace = JSON.parse(
    await invalidMaterialsZip.file(PROJECT_WORKSPACE_STATE_FILE)!.async('string'),
  );
  invalidMaterialsWorkspace.components.left.robot.links.left_base_link.visual.authoredMaterials = {};
  invalidMaterialsZip.file(
    PROJECT_WORKSPACE_STATE_FILE,
    JSON.stringify(invalidMaterialsWorkspace),
  );
  await assert.rejects(
    importProject(await toProjectFile(invalidMaterialsZip)),
    /links\.left_base_link\.visual\.authoredMaterials.*array/i,
  );

  const invalidInspectionZip = await buildProjectZip();
  const invalidInspectionWorkspace = JSON.parse(
    await invalidInspectionZip.file(PROJECT_WORKSPACE_STATE_FILE)!.async('string'),
  );
  invalidInspectionWorkspace.components.left.robot.inspectionContext = {
    sourceFormat: 'urdf',
    urdf: {
      diagnostics: {},
      diagnosticCounts: { info: 0, warning: 0, error: 0 },
      facts: {
        linkCount: 1,
        jointCount: 0,
        visualCount: 0,
        collisionCount: 0,
        inertialCount: 0,
        materialCount: 0,
        meshCount: 0,
        syntheticParentLinkCount: 0,
        disconnectedRootCount: 0,
      },
    },
  };
  invalidInspectionZip.file(
    PROJECT_WORKSPACE_STATE_FILE,
    JSON.stringify(invalidInspectionWorkspace),
  );
  await assert.rejects(
    importProject(await toProjectFile(invalidInspectionZip)),
    /inspectionContext\.urdf\.diagnostics.*array/i,
  );
});

test('readImportedProjectArchive rejects session fields and unsafe manifest paths', async () => {
  const sessionZip = await buildProjectZip();
  const workspace = JSON.parse(
    await sessionZip.file(PROJECT_WORKSPACE_STATE_FILE)!.async('string'),
  );
  workspace.activeComponentId = 'left';
  sessionZip.file(PROJECT_WORKSPACE_STATE_FILE, JSON.stringify(workspace));
  await assert.rejects(
    readImportedProjectArchive(await toProjectFile(sessionZip)),
    /activeComponentId.*(?:session state|canonical workspace field)/i,
  );

  const traversalZip = await buildProjectZip();
  const manifest = JSON.parse(await traversalZip.file(PROJECT_MANIFEST_FILE)!.async('string'));
  manifest.entries.workspace = 'workspace/%252e%252e/secret.json';
  traversalZip.file(PROJECT_MANIFEST_FILE, JSON.stringify(manifest));
  await assert.rejects(
    readImportedProjectArchive(await toProjectFile(traversalZip)),
    /manifest\.entries\.workspace path.*invalid/i,
  );
});

test('importProject performs all validation before creating asset URLs', async () => {
  const zip = await buildProjectZip(createParams(createWorkspace(), {
    assetUrls: { 'textures/packed.png': 'data:text/plain;base64,cGFja2Vk' },
  }));
  const history = JSON.parse(await zip.file(PROJECT_WORKSPACE_HISTORY_FILE)!.async('string'));
  history.present = createWorkspace();
  zip.file(PROJECT_WORKSPACE_HISTORY_FILE, JSON.stringify(history));

  const originalCreateObjectUrl = URL.createObjectURL;
  let createObjectUrlCalls = 0;
  URL.createObjectURL = ((blob: Blob) => {
    createObjectUrlCalls += 1;
    return originalCreateObjectUrl(blob);
  }) as typeof URL.createObjectURL;
  try {
    await assert.rejects(
      importProject(await toProjectFile(zip)),
      /workspace history has invalid fields.*unexpected present/i,
    );
    assert.equal(createObjectUrlCalls, 0);
  } finally {
    URL.createObjectURL = originalCreateObjectUrl;
  }
});

test('readImportedProjectArchive rejects oversized asset manifests', async () => {
  const zip = await buildProjectZip();
  const assetManifest = JSON.parse(
    await zip.file(PROJECT_ASSET_MANIFEST_FILE)!.async('string'),
  );
  assetManifest.availableFiles = Array.from({ length: 10_001 }, (_, index) => ({
    name: `robots/demo-${index}.urdf`,
    format: 'urdf',
  }));
  zip.file(PROJECT_ASSET_MANIFEST_FILE, JSON.stringify(assetManifest));

  await assert.rejects(
    readImportedProjectArchive(await toProjectFile(zip)),
    /asset manifest contains too many entries/i,
  );
});


const EDITED_PROJECT_FIXTURE = new URL(
  '../../../../test/project-fixtures/edited-component-source-draft.usp',
  import.meta.url,
);

test('importProject restores an existing edited project without changing canonical state or source', async () => {
  const bytes = await readFile(EDITED_PROJECT_FIXTURE);
  const zip = await JSZip.loadAsync(bytes);
  const workspace = JSON.parse(await zip.file(PROJECT_WORKSPACE_STATE_FILE)!.async('string'));
  const history = JSON.parse(await zip.file(PROJECT_WORKSPACE_HISTORY_FILE)!.async('string'));
  const manifest = await readDraftManifest(zip);
  const entry = manifest.drafts[0]!;
  const content = await zip.file(entry.contentPath)!.async('string');
  const imported = await readImportedProjectArchive(bytes);

  assert.deepEqual(imported.workspace, workspace);
  assert.deepEqual(imported.workspaceHistory, history);
  assert.deepEqual(imported.componentSourceDrafts, {
    [entry.componentId]: {
      componentId: entry.componentId,
      format: entry.format,
      robotSnapshotHash: entry.robotSnapshotHash,
      content,
    },
  });
  assert.deepEqual(imported.warnings, []);
});

function generateDraftSource(robot: RobotData): string {
  return generateURDF(
    { ...robot, selection: { type: null, id: null } },
    { includeHardware: 'auto', preserveMeshPaths: true, preserveNumericPrecision: true },
  );
}

function createGeneratedDraftProjectParams(
  workspace: AssemblyState,
  format: 'urdf' | 'xacro',
  workspaceHistory: WorkspaceHistory,
): ExportProjectParams {
  const component = workspace.components['edited-instance']!;
  return createParams(workspace, {
    availableFiles: [],
    workspaceHistory,
    componentSourceDrafts: {
      [component.id]: createComponentSourceDraft({
        componentId: component.id,
        format,
        content: generateDraftSource(component.robot),
        robot: component.robot,
      }),
    },
  });
}

async function assertRepeatedProjectRoundtrip(params: ExportProjectParams): Promise<void> {
  let nextParams = params;
  for (let iteration = 0; iteration < 2; iteration += 1) {
    const imported = await importProject(await toProjectFile(await buildProjectZip(nextParams)));
    assert.deepEqual(imported.workspace, params.workspace);
    assert.deepEqual(imported.workspaceHistory, params.workspaceHistory);
    assert.deepEqual(imported.componentSourceDrafts, params.componentSourceDrafts);
    assert.deepEqual(imported.warnings, []);
    nextParams = {
      ...nextParams,
      workspace: imported.workspace,
      workspaceHistory: imported.workspaceHistory,
      componentSourceDrafts: imported.componentSourceDrafts,
      assets: imported.assets,
    };
  }
}

for (const format of ['urdf', 'xacro'] as const) {
  test(`importProject repeatedly roundtrips ${format.toUpperCase()} creation, addition, edits and deletion with stable IDs`, async () => {
    const robot = createRobot('edited_robot');
    const rootId = robot.rootLinkId;
    robot.links[rootId]!.name = 'root_display_name';
    const workspace = createSingleComponentWorkspace(robot, {
      componentId: 'edited-instance',
      sourceFile: `robots/edited.${format}`,
    });
    const current = workspace.components['edited-instance']!.robot;
    const history: WorkspaceHistory = { past: [], future: [], activity: [] };
    await assertRepeatedProjectRoundtrip(
      createGeneratedDraftProjectParams(workspace, format, history),
    );

    history.past.push(structuredClone(workspace));
    current.links['stable-child-id'] = {
      ...structuredClone(DEFAULT_LINK),
      id: 'stable-child-id',
      name: 'child_display_name',
    };
    current.joints['stable-joint-id'] = {
      ...structuredClone(DEFAULT_JOINT),
      id: 'stable-joint-id',
      name: 'joint_display_name',
      type: JointType.REVOLUTE,
      parentLinkId: rootId,
      childLinkId: 'stable-child-id',
    };
    await assertRepeatedProjectRoundtrip(
      createGeneratedDraftProjectParams(workspace, format, history),
    );

    history.past.push(structuredClone(workspace));
    current.name = 'renamed_robot';
    const child = current.links['stable-child-id']!;
    child.name = 'renamed_child';
    child.inertial!.mass = 1.23456789012345;
    child.visual.dimensions.y = 0.617283945061725;
    child.collision.dimensions.y = 0.617283945061725;
    const joint = current.joints['stable-joint-id']!;
    joint.name = 'renamed_joint';
    assert.ok(joint.limit);
    joint.limit.upper = 0.87654321098765;
    joint.dynamics.damping = 0.23456789012345;
    await assertRepeatedProjectRoundtrip(
      createGeneratedDraftProjectParams(workspace, format, history),
    );

    history.past.push(structuredClone(workspace));
    delete current.joints['stable-joint-id'];
    delete current.links['stable-child-id'];
    await assertRepeatedProjectRoundtrip(
      createGeneratedDraftProjectParams(workspace, format, history),
    );
  });
}

const SOURCE_CORRUPTIONS = [
  {
    label: 'mass',
    selector: 'link[name="arm_link"] inertial mass',
    attribute: 'value',
    value: '99',
  },
  {
    label: 'geometry',
    selector: 'link[name="arm_link"] visual geometry box',
    attribute: 'size',
    value: '9 9 9',
  },
  {
    label: 'joint topology',
    selector: 'joint[name="joint_2"] parent',
    attribute: 'link',
    value: 'base_link',
  },
  { label: 'model name', selector: 'robot', attribute: 'name', value: 'corrupt_name' },
  {
    label: 'material',
    selector: 'link[name="base_link"] visual material color',
    attribute: 'rgba',
    value: '1 0 0 1',
  },
];

for (const corruption of SOURCE_CORRUPTIONS) {
  test(`importProject rejects ${corruption.label} corruption in an edited project source`, async () => {
    const zip = await JSZip.loadAsync(await readFile(EDITED_PROJECT_FIXTURE));
    const manifest = await readDraftManifest(zip);
    const contentPath = manifest.drafts[0]!.contentPath;
    const document = new DOMParser().parseFromString(
      await zip.file(contentPath)!.async('string'),
      'text/xml',
    );
    const element = document.querySelector(corruption.selector);
    assert.ok(element, `Fixture must contain ${corruption.selector}`);
    element.setAttribute(corruption.attribute, corruption.value);
    zip.file(contentPath, new XMLSerializer().serializeToString(document));
    await assert.rejects(
      importProject(await toProjectFile(zip)),
      /component source draft content hash mismatch/i,
    );
  });
}

test('importProject keeps the canonical draft hash check for an edited project', async () => {
  const zip = await JSZip.loadAsync(await readFile(EDITED_PROJECT_FIXTURE));
  const manifest = await readDraftManifest(zip);
  manifest.drafts[0]!.robotSnapshotHash = 'robot-semantic-v1:corrupt';
  zip.file(PROJECT_COMPONENT_SOURCE_DRAFTS_FILE, JSON.stringify(manifest));
  await assert.rejects(
    importProject(await toProjectFile(zip)),
    /component source draft hash mismatch/i,
  );
});

for (const unsupported of ['plane geometry', 'ball joint'] as const) {
  test(`importProject does not accept generated URDF approximations of ${unsupported}`, async () => {
    const zip = await JSZip.loadAsync(await readFile(EDITED_PROJECT_FIXTURE));
    const workspace: AssemblyState = JSON.parse(
      await zip.file(PROJECT_WORKSPACE_STATE_FILE)!.async('string'),
    );
    const robot = workspace.components.component_1!.robot;
    const manifest = await readDraftManifest(zip);
    const entry = manifest.drafts[0]!;
    if (unsupported === 'plane geometry') {
      robot.links.arm_link!.visual.type = GeometryType.PLANE;
      // The public URDF exporter can approximate a plane as a thin box.
      // A derived editable source must never use that to claim exact equality.
      zip.file(entry.contentPath, generateDraftSource(robot));
    } else {
      const joint = Object.values(robot.joints).find((value) => value.name === 'joint_2');
      assert.ok(joint);
      joint.type = JointType.BALL;
    }
    entry.robotSnapshotHash = createSourceSemanticRobotHash(robot);
    zip.file(PROJECT_WORKSPACE_STATE_FILE, JSON.stringify(workspace));
    zip.file(PROJECT_COMPONENT_SOURCE_DRAFTS_FILE, JSON.stringify(manifest));
    await assert.rejects(
      importProject(await toProjectFile(zip)),
      /component source draft content hash mismatch/i,
    );
  });
}

function createJointFieldProjectParams(type: JointType, fields: string): ExportProjectParams {
  const content = `<robot name="joint_fields">
    <link name="base"/><link name="tip"/>
    <joint name="joint" type="${type}">
      <parent link="base"/><child link="tip"/>
      <origin xyz="0 0 0" rpy="0 0 0"/>
      ${fields}
    </joint>
  </robot>`;
  const robot: RobotData = JSON.parse(JSON.stringify(parseRobotData(content)));
  const joint = robot.joints.joint!;
  // Editor-owned IDs differ from XML names, so even an unchanged source uses
  // the generated-source comparison rather than the direct snapshot hash.
  robot.links = {
    'base-id': { ...robot.links.base!, id: 'base-id' },
    'tip-id': { ...robot.links.tip!, id: 'tip-id' },
  };
  robot.rootLinkId = 'base-id';
  robot.joints = {
    'joint-id': {
      ...joint,
      id: 'joint-id',
      parentLinkId: 'base-id',
      childLinkId: 'tip-id',
    },
  };
  const workspace = createSingleComponentWorkspace(robot, {
    componentId: 'joint-fields',
    sourceFile: 'joint-fields.urdf',
  });
  return createParams(workspace, {
    availableFiles: [],
    componentSourceDrafts: {
      'joint-fields': createComponentSourceDraft({
        componentId: 'joint-fields',
        format: 'urdf',
        robot: workspace.components['joint-fields']!.robot,
        content,
      }),
    },
  });
}

async function assertEditedDraftRejected(
  params: ExportProjectParams,
  edit: (document: Document) => void,
): Promise<void> {
  const zip = await buildProjectZip(params);
  const manifest = await readDraftManifest(zip);
  const contentPath = manifest.drafts[0]!.contentPath;
  const document = new DOMParser().parseFromString(
    await zip.file(contentPath)!.async('string'),
    'text/xml',
  );
  edit(document);
  zip.file(contentPath, new XMLSerializer().serializeToString(document));
  await assert.rejects(
    importProject(await toProjectFile(zip)),
    /component source draft content hash mismatch/i,
  );
}

const JOINT_DYNAMICS_AND_HARDWARE = `
  <dynamics damping="0.75" friction="0.2"/>
  <hardware>
    <armature>0.3</armature><motorType>special</motorType>
    <motorDirection>-1</motorDirection><hardwareInterface>effort</hardwareInterface>
  </hardware>
`;

for (const type of [JointType.PLANAR, JointType.FIXED, JointType.FLOATING]) {
  const fields = `${type === JointType.PLANAR ? '<axis xyz="0 0 1"/>' : ''}
    ${JOINT_DYNAMICS_AND_HARDWARE}`;
  test(`importProject retains ${type} joint dynamics and hardware during source comparison`, async () => {
    const params = createJointFieldProjectParams(type, fields);
    const joint = params.workspace.components['joint-fields']!.robot.joints['joint-id']!;
    assert.deepEqual(joint.dynamics, { damping: 0.75, friction: 0.2 });
    assert.equal(joint.hardware.armature, 0.3);
    assert.equal(joint.hardware.motorDirection, -1);
    assert.equal(joint.hardware.hardwareInterface, 'effort');
    await assertRepeatedProjectRoundtrip(params);
  });

  for (const tag of ['dynamics', 'hardware']) {
    test(`importProject rejects removing ${type} joint ${tag} from the saved source`, async () => {
      await assertEditedDraftRejected(
        createJointFieldProjectParams(type, fields),
        (document) => {
          const element = document.querySelector(`joint > ${tag}`);
          assert.ok(element);
          element.remove();
        },
      );
    });
  }
}

const CONTINUOUS_JOINT_FIELDS = `
  <axis xyz="0 0 1"/>
  <limit lower="-0.3" upper="0.8" effort="10" velocity="2"/>
`;

test('importProject retains authored continuous joint position limits during source comparison', async () => {
  const params = createJointFieldProjectParams(JointType.CONTINUOUS, CONTINUOUS_JOINT_FIELDS);
  assert.deepEqual(
    params.workspace.components['joint-fields']!.robot.joints['joint-id']!.limit,
    { lower: -0.3, upper: 0.8, effort: 10, velocity: 2 },
  );
  await assertRepeatedProjectRoundtrip(params);
});

test('importProject rejects removing continuous joint position limits from the saved source', async () => {
  await assertEditedDraftRejected(
    createJointFieldProjectParams(JointType.CONTINUOUS, CONTINUOUS_JOINT_FIELDS),
    (document) => {
      const element = document.querySelector('joint > limit');
      assert.ok(element);
      element.removeAttribute('lower');
      element.removeAttribute('upper');
    },
  );
});
