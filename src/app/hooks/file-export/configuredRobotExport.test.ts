import assert from 'node:assert/strict';
import test from 'node:test';
import JSZip from 'jszip';

import { DEFAULT_CONFIG } from '@/features/file-io/components/ExportDialog/config';
import { translations } from '@/shared/i18n';
import { DEFAULT_JOINT, DEFAULT_LINK, JointType, type RobotState } from '@/types';
import { reportExportDiagnostics } from '@/app/utils/exportDiagnostics';
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
