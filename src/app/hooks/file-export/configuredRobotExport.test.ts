import assert from 'node:assert/strict';
import test from 'node:test';
import JSZip from 'jszip';
import { JSDOM } from 'jsdom';

import { DEFAULT_CONFIG } from '@/features/file-io/components/ExportDialog/config';
import { translations } from '@/shared/i18n';
import { DEFAULT_JOINT, DEFAULT_LINK, JointType, type RobotState } from '@/types';
import { reportExportDiagnostics } from '@/app/utils/exportDiagnostics';
import { generateMujocoXML, parseMJCF } from '@/core/parsers';
import { parseMJCFModel } from '@/core/parsers/mjcf/mjcfModel';
import { createSingleComponentWorkspace } from '@/core/robot/canonicalWorkspace';
import { resolveSourcePreservingExportContent } from '../sourcePreservingExportUtils';
import { buildCanonicalExportContext } from './canonicalExportContext';
import { executeConfiguredRobotExport } from './configuredRobotExport.ts';

function createRobot(type: JointType): RobotState {
  return {
    name: 'warnings',
    rootLinkId: 'base',
    links: {
      base: { ...structuredClone(DEFAULT_LINK), id: 'base', name: 'base' },
      tip: { ...structuredClone(DEFAULT_LINK), id: 'tip', name: 'tip' },
      tool: { ...structuredClone(DEFAULT_LINK), id: 'tool', name: 'tool' },
    },
    joints: {
      joint: { ...structuredClone(DEFAULT_JOINT), id: 'joint', name: 'joint', parentLinkId: 'base', childLinkId: 'tip', type },
      second: { ...structuredClone(DEFAULT_JOINT), id: 'second', name: 'second', parentLinkId: 'tip', childLinkId: 'tool', type },
    },
    selection: { type: null, id: null },
  };
}

test('configured MJCF download uses generated physics while preserving scene metadata', async (context) => {
  const dom = new JSDOM();
  const originalParser = globalThis.DOMParser;
  const originalSerializer = globalThis.XMLSerializer;
  globalThis.DOMParser = dom.window.DOMParser as typeof DOMParser;
  globalThis.XMLSerializer = dom.window.XMLSerializer as typeof XMLSerializer;
  context.after(() => {
    globalThis.DOMParser = originalParser;
    globalThis.XMLSerializer = originalSerializer;
    dom.window.close();
  });
  const robot = parseMJCF(`<mujoco model="furniture"><worldbody>
    <body name="bed"><freejoint name="free"/><geom type="box" size="1 1 .2"/></body>
  </worldbody></mujoco>`);
  assert.ok(robot);
  const before = structuredClone(robot);
  const source = generateMujocoXML(robot, { preserveInertialData: true, preserveNumericPrecision: true })
    .replace('<worldbody>', '<custom><text name="scene_metadata" data="room"/></custom><worldbody>');
  const config = structuredClone(DEFAULT_CONFIG);
  config.mjcf.includeMeshes = false;
  config.mjcf.densityKgM3 = 375;
  const zip = new JSZip();
  await executeConfiguredRobotExport({
    config, assets: {}, boxFaceFallbackWarningLabels: { urdf: '', sdf: '', xacro: '' },
    buildBomCsv: () => '',
    buildSourcePreservingExportContent: (options) => {
      assert.equal(options.mjcfModelSections, 'generated');
      return resolveSourcePreservingExportContent({
        ...options, sourceFile: { name: 'scene.xml', format: 'mjcf', content: source },
      }).content;
    },
    createProgressReporter: () => () => {}, createZip: async () => zip,
    downloadBlob: () => {}, generateZipBlobWithProgress: async () => new Blob(),
    markCurrentTargetSaved: () => {}, normalizedAssemblyState: null, options: {},
    prepareMjcfMeshExportAssets: async () => ({
      archiveFiles: new Map(), meshPathOverrides: new Map(), visualMeshVariants: new Map(), convertedSourceMeshPaths: new Set(),
    }),
    addMeshesToZip: async () => { throw new Error('Mesh packaging should not run'); },
    resolveExportContext: async () => ({ robot, exportName: 'scene' }),
    resolveLibraryExportContext: async () => { throw new Error('Library resolution should not run'); },
    t: translations.en, target: { type: 'current' },
    throwForAssetPackagingFailures: failures => assert.deepEqual(failures, []),
  });
  const document = new DOMParser().parseFromString(await zip.file('scene/scene.xml')!.async('string'), 'text/xml');
  assert.equal(document.querySelector('body[name="bed"] > inertial'), null);
  assert.equal(document.querySelector('body[name="bed"] > geom[group="3"]')?.getAttribute('density'), '375');
  assert.equal(document.querySelector('custom text')?.getAttribute('data'), 'room');
  assert.deepEqual(robot, before);
});

for (const connected of [false, true]) {
  test(`configured assembly MJCF ZIP retains frame provenance with fixed bridge=${connected}`, async (testContext) => {
    const dom = new JSDOM();
    const originalParser = globalThis.DOMParser;
    const originalSerializer = globalThis.XMLSerializer;
    globalThis.DOMParser = dom.window.DOMParser;
    globalThis.XMLSerializer = dom.window.XMLSerializer;
    testContext.after(() => {
      globalThis.DOMParser = originalParser;
      globalThis.XMLSerializer = originalSerializer;
      dom.window.close();
    });
    const parsed = parseMJCF(`<mujoco model="box"><worldbody><body name="box" pos="0 0 0.2">
      <inertial pos="0 0 0" mass="1" diaginertia="0.0067 0.0067 0.0067"/>
      <geom type="box" size="0.1 0.1 0.1"/>
    </body></worldbody></mujoco>`);
    assert.ok(parsed);
    const { selection: _selection, ...robotData } = parsed;
    const workspace = createSingleComponentWorkspace(robotData, {
      componentId: 'left', sourceFile: 'box.xml', workspaceName: 'joined_boxes',
    });
    workspace.components.right = createSingleComponentWorkspace(robotData, {
      componentId: 'right', sourceFile: 'box.xml',
    }).components.right!;
    workspace.components.right.transform.position.x = 0.5;
    if (connected) {
      workspace.bridges.mount = {
        id: 'mount', name: 'mount', parentComponentId: 'left', parentLinkId: 'box',
        childComponentId: 'right', childLinkId: 'box',
        joint: {
          ...structuredClone(DEFAULT_JOINT), id: 'mount_joint', name: 'mount_joint',
          type: JointType.FIXED, parentLinkId: 'box', childLinkId: 'box',
          origin: { xyz: { x: 0.5, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
      };
    }
    const before = structuredClone(workspace);
    const exportContext = buildCanonicalExportContext({ workspace, componentSourceDrafts: {} });
    assert.ok(exportContext.mjcfFrameLinkIds?.size);
    const sourceFile = exportContext.sourceFile;
    assert.equal(sourceFile, null, 'multi-component export must generate an assembled source');
    const downloads: Array<{ blob: Blob; name: string }> = [];
    const config = structuredClone(DEFAULT_CONFIG);
    config.format = 'mjcf';
    config.includeSkeleton = false;
    config.mjcf.addFloatBase = true;
    config.mjcf.includeMeshes = false;
    const result = await executeConfiguredRobotExport({
      config, assets: {}, boxFaceFallbackWarningLabels: { urdf: '', sdf: '', xacro: '' },
      buildBomCsv: () => '',
      buildSourcePreservingExportContent: (options) => resolveSourcePreservingExportContent({
        ...options, sourceFile,
      }).content,
      createProgressReporter: () => () => {},
      createZip: async () => new JSZip(),
      downloadBlob: (blob, name) => { downloads.push({ blob, name }); },
      generateZipBlobWithProgress: async (zip) => new Blob([await zip.generateAsync({ type: 'uint8array' })]),
      markCurrentTargetSaved: () => {}, normalizedAssemblyState: workspace, options: {},
      prepareMjcfMeshExportAssets: async () => ({
        archiveFiles: new Map(), meshPathOverrides: new Map(), visualMeshVariants: new Map(), convertedSourceMeshPaths: new Set(),
      }),
      addMeshesToZip: async () => { throw new Error('No mesh assets exist in the fixture'); },
      resolveExportContext: async () => exportContext,
      resolveLibraryExportContext: async () => { throw new Error('Current workspace export must not resolve a library item'); },
      t: translations.en, target: { type: 'current' },
      throwForAssetPackagingFailures: failures => assert.deepEqual(failures, []),
    });

    assert.equal(result.partial, false);
    assert.deepEqual(result.warnings, []);
    assert.equal(downloads.length, 1);
    assert.equal(downloads[0]!.name, 'joined_boxes_mjcf.zip');
    const archive = await JSZip.loadAsync(await downloads[0]!.blob.arrayBuffer());
    const entry = archive.file('joined_boxes/joined_boxes.xml');
    assert.ok(entry, 'the actual downloaded ZIP must contain the assembled MJCF');
    const xml = await entry.async('string');
    const model = parseMJCFModel(xml);
    assert.ok(model);
    assert.deepEqual(model.recoveryDiagnostics, []);
    assert.equal(model.worldBody.children.length, connected ? 1 : 2);
    const document = new DOMParser().parseFromString(xml, 'text/xml');
    assert.equal(document.querySelectorAll('freejoint').length, connected ? 1 : 2);
    for (const id of exportContext.mjcfFrameLinkIds ?? []) {
      assert.equal(
        Array.from(document.querySelectorAll('body')).some((body) => body.getAttribute('name') === exportContext.robot.links[id]!.name),
        false,
        'configuration orchestration must preserve frame metadata through ZIP serialization',
      );
    }
    assert.deepEqual(workspace, before);
  });
}

for (const [format, type, expectedWarning, entry, outputPattern] of [
  ['mjcf', JointType.PLANAR, /\[MJCF export\].*planar/, 'warnings.xml', /<freejoint\b/],
  ['sdf', JointType.FLOATING, /\[SDF export\].*floating/, 'model.sdf', /<sdf\b/],
] as const) {
  test(`${format} export returns compatibility warnings after producing the archive without changing the workspace`, async context => {
    const warn = context.mock.method(console, 'warn', () => {});
    const robot = createRobot(type);
    const before = structuredClone(robot);
    const zip = new JSZip();
    const downloads: string[] = [];
    const config = structuredClone(DEFAULT_CONFIG);
    config.format = format;
    config[format].includeMeshes = false;
    const result = await executeConfiguredRobotExport({
      config,
      assets: {},
      boxFaceFallbackWarningLabels: { urdf: '', sdf: '', xacro: '' },
      buildBomCsv: () => '',
      buildSourcePreservingExportContent: () => null,
      createProgressReporter: () => () => {},
      createZip: async () => zip,
      downloadBlob: (_blob, name) => { downloads.push(name); },
      generateZipBlobWithProgress: async archive => new Blob([await archive.generateAsync({ type: 'uint8array' })]),
      markCurrentTargetSaved: () => {},
      normalizedAssemblyState: null,
      options: {},
      prepareMjcfMeshExportAssets: async () => ({
        archiveFiles: new Map(), meshPathOverrides: new Map(), visualMeshVariants: new Map(), convertedSourceMeshPaths: new Set(),
      }),
      addMeshesToZip: async () => { throw new Error('Mesh packaging should not run'); },
      resolveExportContext: async () => ({ robot, exportName: 'warnings' }),
      resolveLibraryExportContext: async () => { throw new Error('Library resolution should not run'); },
      t: translations.en,
      target: { type: 'current' },
      throwForAssetPackagingFailures: failures => assert.deepEqual(failures, []),
    });

    assert.equal(result.partial, true);
    assert.equal(result.warnings.length, 2);
    assert.match(result.warnings[0], expectedWarning);
    assert.match(result.warnings[1], expectedWarning);
    assert.match(result.warnings[0], /"joint"/);
    assert.match(result.warnings[1], /"second"/);
    assert.deepEqual(downloads, [`warnings_${format}.zip`]);
    assert.match(await zip.file(`warnings/${entry}`)!.async('string'), outputPattern);
    assert.equal(warn.mock.callCount(), 0);
    reportExportDiagnostics({ ...result, warnings: [...result.warnings, result.warnings[0]] });
    assert.equal(warn.mock.callCount(), 1);
    const [message] = warn.mock.calls[0].arguments;
    assert.match(message, /"joint"/);
    assert.match(message, /"second"/);
    assert.equal(message.match(/"joint"/g)?.length, 1);
    assert.deepEqual(robot, before);
  });
}
