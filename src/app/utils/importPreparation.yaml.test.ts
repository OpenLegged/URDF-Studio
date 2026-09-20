import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { prepareImportPayload } from './importPreparation';
import { ensureWorkerXmlDomApis } from '@/core/utils/ensureWorkerXmlDomApis';

ensureWorkerXmlDomApis(globalThis);

for (const extension of ['yaml', 'yml']) {
  for (const mode of ['loose', 'zip']) {
    test(`${mode} Xacro import retains ${extension} configuration and material colors`, async () => {
      const entries: Record<string, string> = {
        'palette/urdf/robot.xacro': `<robot xmlns:xacro="http://www.ros.org/wiki/xacro" name="palette">
          <xacro:property name="palette" value="\${xacro.load_yaml('../config/colors.${extension}')}"/>
          <link name="base"><visual><geometry><box size="1 1 1"/></geometry>
          <material name="paint"><color rgba="\${' '.join([str(c) for c in palette['rgb']]) + ' 1'}"/></material>
          </visual></link></robot>`,
        [`palette/config/colors.${extension}`]: 'rgb: [1, 0.5, 0.25]',
      };
      const zip = new JSZip();
      for (const [path, content] of Object.entries(entries)) zip.file(path, content);
      const input = mode === 'zip'
        ? [new File([await zip.generateAsync({ type: 'uint8array' })], 'palette.zip')]
        : Object.entries(entries).map(([relativePath, content]) => ({
          file: new File([content], relativePath.split('/').pop()!), relativePath,
        }));
      const result = await prepareImportPayload({ files: input, existingPaths: [] });
      assert.ok(result.textFiles.some(file => file.path.endsWith(`colors.${extension}`) && file.content === 'rgb: [1, 0.5, 0.25]'));
      const imported = result.preResolvedImports.find(entry => entry.format === 'xacro');
      assert.ok(imported?.result.status === 'ready', JSON.stringify(imported));
      assert.deepEqual(imported.result.robotData.links.base.visual.authoredMaterials?.[0].colorRgba, [1, 0.5, 0.25, 1]);
    });
  }
}
