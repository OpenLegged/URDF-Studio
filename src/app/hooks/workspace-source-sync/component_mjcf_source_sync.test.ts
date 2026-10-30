import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test, { type TestContext } from 'node:test';
import JSZip from 'jszip';
import { JSDOM } from 'jsdom';

import { parseEditableRobotSource } from '@/app/utils/parseEditableRobotSource';
import { resolveRobotFileDataAsync } from '@/core/parsers/importRobotFile';
import { rewriteRobotMeshPathsForSource } from '@/core/parsers/meshPathUtils';
import { resolveMJCFSource } from '@/core/parsers/mjcf/mjcfSourceResolver';
import { validateMJCFImportExternalAssets } from '@/core/parsers/mjcf/mjcfImportValidation';
import {
  createComponentSourceDraft,
  createSingleComponentWorkspace,
  createSourceSemanticRobotHash,
} from '@/core/robot';
import { exportProject } from '@/features/file-io/utils/projectExport';
import { importProject } from '@/features/file-io/utils/projectImport';
import { PROJECT_COMPONENT_SOURCE_DRAFTS_FILE } from '@/features/file-io/utils/projectArchive';
import { useAssetsStore } from '@/store/assetsStore';
import { useWorkspaceStore } from '@/store/workspaceStore';
import type { RobotData, RobotFile } from '@/types';
import { synchronizeComponentSourceAfterMutation } from './component_source_commands';

const dom = new JSDOM();
globalThis.DOMParser = dom.window.DOMParser as typeof DOMParser;
globalThis.XMLSerializer = dom.window.XMLSerializer as typeof XMLSerializer;

const COMPONENT_ID = 'scene-instance';
const FURNITURE = ['bed', 'nightstand-left', 'nightstand-right', 'wardrobe'];
const OBJ = 'v 0 0 0\nv 1 0 0\nv 0 1 0\nv 0 0 1\nf 1 3 2\nf 1 2 4\nf 2 3 4\nf 3 1 4\n';
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
  'base64',
);

interface SceneFiles {
  files: RobotFile[];
  assetBytes: Record<string, Uint8Array>;
}

function fixture(): SceneFiles {
  const files: RobotFile[] = [{
    name: 'scene.xml', format: 'mjcf', content: `<mujoco model="room">
  <compiler angle="radian"/>
  <asset>
    <texture name="ground-checker" type="2d" builtin="checker" mark="edge"
      rgb1="0.2 0.3 0.4" rgb2="0.1 0.2 0.3" markrgb="0.8 0.8 0.8" width="300" height="300"/>
    <material name="ground-material" texture="ground-checker" texuniform="true" texrepeat="5 5"/>
    ${FURNITURE.map((name) => `<model name="${name}" file="parts/${name}/model.xml"/>`).join('')}
  </asset>
  <worldbody>
    <geom name="ground" type="box" size="500 500 .05" pos="0 0 -.05" material="ground-material"/>
    <body name="floor" pos="0 0 -.05"><geom name="floor_geom" type="box" size="2.4 2.4 .05"/></body>
    ${FURNITURE.map((name, index) => `<frame pos="${index} 0 0"><attach model="${name}" prefix="${name}__"/></frame>`).join('')}
  </worldbody>
</mujoco>`,
  }];
  const assetBytes: Record<string, Uint8Array> = {};
  for (const name of FURNITURE) {
    files.push({
      name: `parts/${name}/model.xml`, format: 'mjcf', content: `<mujoco>
  <compiler meshdir="meshes" texturedir="textures"/>
  <asset><mesh name="visual" file="root.obj"/><texture name="color" type="2d" file="root.png"/>
    <material name="surface" texture="color"/></asset>
  <worldbody><body name="root"><freejoint name="free"/>
    <inertial mass="2" pos="0 0 0" diaginertia="1 1 1"/>
    <geom name="visual" type="mesh" mesh="visual" material="surface"/>
  </body></worldbody>
</mujoco>`,
    });
    assetBytes[`parts/${name}/meshes/root.obj`] = new TextEncoder().encode(OBJ);
    assetBytes[`parts/${name}/textures/root.png`] = PIXEL;
  }
  return { files, assetBytes };
}

async function setUp(context: TestContext, scene = fixture()) {
  const previousWorkspace = useWorkspaceStore.getState();
  const previousAssets = useAssetsStore.getState();
  const assetUrls = Object.fromEntries(Object.entries(scene.assetBytes).map(([name, bytes]) => [
    name, URL.createObjectURL(new Blob([Uint8Array.from(bytes).buffer])),
  ]));
  context.after(() => {
    useWorkspaceStore.setState(previousWorkspace);
    useAssetsStore.setState(previousAssets);
    Object.values(assetUrls).forEach((url) => URL.revokeObjectURL(url));
  });
  const source = scene.files.find((file) => file.name === 'scene.xml');
  assert.ok(source);
  const imported = await resolveRobotFileDataAsync(source, {
    availableFiles: scene.files, assets: assetUrls,
  });
  assert.equal(imported.status, 'ready');
  const workspace = createSingleComponentWorkspace(imported.robotData, {
    componentId: COMPONENT_ID, sourceFile: source.name,
  });
  useWorkspaceStore.getState().replaceWorkspace(workspace, { resetHistory: true });
  useAssetsStore.setState({
    assets: assetUrls,
    availableFiles: scene.files,
    allFileContents: Object.fromEntries(scene.files.map((file) => [file.name, file.content])),
    componentSourceDrafts: {
      [COMPONENT_ID]: createComponentSourceDraft({
        componentId: COMPONENT_ID, format: 'mjcf', content: source.content,
        robot: workspace.components[COMPONENT_ID]!.robot,
      }),
    },
  });
  const warnings = context.mock.method(console, 'warn', () => {});
  context.mock.method(console, 'info', () => {});
  return { ...scene, source, assetUrls, warnings };
}

function currentRobot(): RobotData {
  return useWorkspaceStore.getState().workspace.components[COMPONENT_ID]!.robot;
}

function mutate(mutation: (robot: RobotData) => void) {
  const previousRobot = currentRobot();
  const nextRobot = structuredClone(previousRobot);
  mutation(nextRobot);
  useWorkspaceStore.getState().replaceComponentRobot(COMPONENT_ID, nextRobot);
  return synchronizeComponentSourceAfterMutation({ componentId: COMPONENT_ID, previousRobot });
}

function parseCurrentDraft(files: RobotFile[]) {
  const draft = useAssetsStore.getState().componentSourceDrafts[COMPONENT_ID]!;
  assert.equal(draft.robotSnapshotHash, createSourceSemanticRobotHash(currentRobot()));
  const parsed = parseEditableRobotSource({
    file: { name: 'scene.xml', format: 'mjcf' }, content: draft.content, availableFiles: files,
  });
  assert.ok(parsed);
  for (const name of FURNITURE) assert.ok(parsed.links[`${name}__root`]);
  const sourceFile: RobotFile = { name: 'scene.xml', format: 'mjcf', content: draft.content };
  const resolved = resolveMJCFSource(sourceFile, files);
  assert.deepEqual(resolved.issues, []);
  assert.deepEqual(validateMJCFImportExternalAssets(
    sourceFile.name, resolved.validationContent, files, useAssetsStore.getState().assets,
  ), []);
  const normalized = rewriteRobotMeshPathsForSource(parsed, sourceFile.name);
  for (const name of FURNITURE) {
    const id = `${name}__root`;
    assert.equal(normalized.links[id]!.visual.meshPath, currentRobot().links[id]!.visual.meshPath);
    assert.equal(normalized.links[id]!.collision.meshPath, currentRobot().links[id]!.collision.meshPath);
    assert.equal(normalized.materials?.[id]?.texture, currentRobot().materials?.[id]?.texture);
  }
  return normalized;
}

test('MJCF attachment display toggles preserve authored source and emit no missing-model warnings', async (context) => {
  const { source, files, warnings } = await setUp(context);
  const before = structuredClone(currentRobot());
  for (const visible of [false, true, false]) {
    mutate((robot) => { robot.links[robot.rootLinkId]!.visual.visible = visible; });
    assert.equal(useAssetsStore.getState().componentSourceDrafts[COMPONENT_ID]!.content, source.content);
    assert.equal(createSourceSemanticRobotHash(currentRobot()), createSourceSemanticRobotHash(before));
    parseCurrentDraft(files);
  }
  assert.equal(warnings.mock.callCount(), 0);
});

test('editing a host MJCF geometry keeps its four authored attachments and immutable library', async (context) => {
  const { files, warnings } = await setUp(context);
  const originalFiles = structuredClone(files);
  mutate((robot) => {
    robot.links.floor!.visual.dimensions.x = 4.5;
    robot.links.floor!.collision.dimensions.x = 4.5;
  });
  const draft = useAssetsStore.getState().componentSourceDrafts[COMPONENT_ID]!;
  assert.equal(new DOMParser().parseFromString(draft.content, 'text/xml').querySelectorAll('attach').length, 4);
  assert.equal(parseCurrentDraft(files).links.floor!.visual.dimensions.x, 4.5);
  assert.deepEqual(useAssetsStore.getState().availableFiles, originalFiles);
  assert.equal(warnings.mock.callCount(), 0);
});

async function editAndRoundtrip(context: TestContext, scene?: SceneFiles): Promise<void> {
  const { files, assetUrls, warnings } = await setUp(context, scene);
  const originalFiles = structuredClone(files);
  const before = structuredClone(currentRobot());
  const mass = before.links.bed__root!.inertial.mass + 1;
  mutate((robot) => { robot.links.bed__root!.inertial.mass = mass; });
  assert.equal(currentRobot().links.bed__root!.inertial.mass, mass);
  assert.equal(parseCurrentDraft(files).links.bed__root!.inertial.mass, mass);
  assert.deepEqual(useAssetsStore.getState().availableFiles, originalFiles);
  assert.equal(warnings.mock.callCount(), 0);

  const workspace = useWorkspaceStore.getState().workspace;
  const assets = useAssetsStore.getState();
  const exported = await exportProject({
    name: workspace.name, lang: 'en', workspace,
    workspaceHistory: { past: [], future: [], activity: [] },
    componentSourceDrafts: assets.componentSourceDrafts,
    assets: {
      availableFiles: files, assetUrls, allFileContents: assets.allFileContents,
      motorLibrary: {}, selectedFileName: 'scene.xml',
    },
  });
  assert.equal(exported.partial, false);
  assert.deepEqual(exported.warnings, []);
  const restored = await importProject(await exported.blob.arrayBuffer());
  context.after(() => Object.values(restored.assets.assetUrls).forEach((url) => URL.revokeObjectURL(url)));
  // Project state is JSON: undefined fields and negative zero have no distinct encoding.
  assert.deepEqual(restored.workspace, JSON.parse(JSON.stringify(workspace)));
  assert.deepEqual(restored.componentSourceDrafts, assets.componentSourceDrafts);
  const restoredRobot = restored.workspace.components[COMPONENT_ID]!.robot;
  // Display fixes must retain both coincident ground surfaces in the project,
  // including their physical geometry and authored texture scale.
  for (const [id, link] of Object.entries(before.links)) {
    if (FURNITURE.some((name) => id === `${name}__root`)) continue;
    assert.deepEqual(restoredRobot.links[id], JSON.parse(JSON.stringify(link)));
  }
  for (const name of FURNITURE) {
    const original = before.links[`${name}__root`]!;
    const link = restored.workspace.components[COMPONENT_ID]!.robot.links[`${name}__root`]!;
    assert.equal(link.visual.meshPath, original.visual.meshPath);
    assert.deepEqual(link.visual.authoredMaterials, original.visual.authoredMaterials);
    assert.equal(
      restored.workspace.components[COMPONENT_ID]!.robot.materials?.[`${name}__root`]?.texture,
      before.materials?.[`${name}__root`]?.texture,
    );
  }
  for (const [name, bytes] of Object.entries(scene?.assetBytes ?? fixture().assetBytes)) {
    const url = restored.assets.assetUrls[name];
    assert.ok(url, `missing packed asset ${name}`);
    assert.deepEqual(new Uint8Array(await (await fetch(url)).arrayBuffer()), Uint8Array.from(bytes));
  }
  assert.equal(warnings.mock.callCount(), 0);
  if (!scene) {
    const zip = await JSZip.loadAsync(await exported.blob.arrayBuffer());
    const manifest = JSON.parse(await zip.file(PROJECT_COMPONENT_SOURCE_DRAFTS_FILE)!.async('string'));
    const entry = manifest.drafts[0];
    const content = await zip.file(entry.contentPath)!.async('string');
    for (const [selector, attribute, value] of [
      ['body[name="bed__root"] inertial', 'mass', '99'],
      ['body[name="bed__root"]', 'pos', '9 9 9'],
      ['asset mesh', 'file', 'parts/wardrobe/meshes/root.obj'],
    ]) {
      const document = new DOMParser().parseFromString(content, 'text/xml');
      const element = document.querySelector(selector!);
      assert.ok(element, selector);
      element.setAttribute(attribute!, value!);
      zip.file(entry.contentPath, new XMLSerializer().serializeToString(document));
      await assert.rejects(
        importProject(await zip.generateAsync({ type: 'arraybuffer' })),
        /component source draft content hash mismatch/i,
      );
    }
    zip.file(entry.contentPath, content);
    entry.robotSnapshotHash = 'robot-semantic-v1:corrupt';
    zip.file(PROJECT_COMPONENT_SOURCE_DRAFTS_FILE, JSON.stringify(manifest));
    await assert.rejects(
      importProject(await zip.generateAsync({ type: 'arraybuffer' })),
      /component source draft hash mismatch/i,
    );
  }
}

test('attached furniture edits survive project save and reopen with every mesh and texture', async (context) => {
  await editAndRoundtrip(context);
});

const originalZip = process.env.MJCF_SCENE_REGRESSION_ZIP;
test('original scene ZIP preserves edited furniture and resources through project save and reopen', {
  skip: !originalZip,
}, async (context) => {
  const bytes = await readFile(originalZip!);
  assert.equal(createHash('sha256').update(bytes).digest('hex'),
    '67c6d2ca0508d15ece94a72f75ca5307f28340db8511bef35c965e9cb6163412');
  const zip = await JSZip.loadAsync(bytes, { checkCRC32: true });
  const scene: SceneFiles = { files: [], assetBytes: {} };
  for (const entry of Object.values(zip.files)) {
    if (entry.dir) continue;
    scene.assetBytes[entry.name] = await entry.async('uint8array');
    if (entry.name.endsWith('.xml')) {
      scene.files.push({ name: entry.name, format: 'mjcf', content: await entry.async('string') });
    }
  }
  await editAndRoundtrip(context, scene);
});
