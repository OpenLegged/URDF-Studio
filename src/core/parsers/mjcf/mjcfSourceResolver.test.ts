import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { JSDOM } from 'jsdom';
import type { RobotFile } from '@/types';

import {
  MJCF_COMPILER_ANGLE_SCOPE_ATTR,
  MJCF_COMPILER_EULERSEQ_SCOPE_ATTR,
} from './mjcfCompilerScope.ts';
import { parseMJCFModel } from './mjcfModel.ts';
import { createCanonicalSnapshotFromParsedModel, diffCanonicalSnapshots } from './mjcfSnapshot.ts';
import { prefixMJCFSourceIdentifiers, resolveMJCFSource } from './mjcfSourceResolver.ts';

function installDomGlobals(): void {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { contentType: 'text/html' });
  globalThis.window = dom.window as any;
  globalThis.document = dom.window.document as any;
  globalThis.DOMParser = dom.window.DOMParser as any;
  globalThis.XMLSerializer = dom.window.XMLSerializer as any;
  globalThis.Node = dom.window.Node as any;
  globalThis.Element = dom.window.Element as any;
  globalThis.Document = dom.window.Document as any;
}

function assertQuaternionClose(
  actual: [number, number, number, number] | undefined,
  expected: [number, number, number, number],
  tolerance = 1e-5,
): void {
  assert.ok(actual, 'expected quaternion to be defined');
  const direct = actual.every((value, index) => Math.abs(value - expected[index]!) <= tolerance);
  const negated = actual.every((value, index) => Math.abs(value + expected[index]!) <= tolerance);
  assert.ok(
    direct || negated,
    `expected quaternion ${expected.join(', ')}, got ${actual.join(', ')}`,
  );
}

test('resolveMJCFSource scopes attached compiler settings to the imported subtree', () => {
  installDomGlobals();

  const files: RobotFile[] = [
    {
      name: '/tmp/mjcf-scoped/scene.xml',
      format: 'mjcf',
      content: `
        <mujoco model="scene">
          <asset>
            <model name="child_model" file="attached.xml" />
          </asset>
          <worldbody>
            <geom name="host_geom" type="box" size="0.1 0.1 0.1" euler="90 0 0" />
            <attach model="child_model" body="subtree" prefix="child/" />
          </worldbody>
        </mujoco>
      `,
    },
    {
      name: '/tmp/mjcf-scoped/attached.xml',
      format: 'mjcf',
      content: `
        <mujoco model="attached">
          <compiler angle="radian" eulerseq="xyz" />
          <worldbody>
            <body name="subtree" euler="1.5707963267948966 0 0">
              <geom name="child_geom" type="box" size="0.1 0.1 0.1" />
            </body>
          </worldbody>
        </mujoco>
      `,
    },
  ];

  const resolved = resolveMJCFSource(files[0]!, files);
  const resolvedDoc = new DOMParser().parseFromString(resolved.content, 'text/xml');
  const importedBody = resolvedDoc.querySelector('worldbody > body[name="child/subtree"]');

  assert.ok(importedBody);
  assert.equal(resolvedDoc.querySelectorAll('mujoco > compiler').length, 0);
  assert.equal(importedBody.getAttribute(MJCF_COMPILER_ANGLE_SCOPE_ATTR), 'radian');
  assert.equal(importedBody.getAttribute(MJCF_COMPILER_EULERSEQ_SCOPE_ATTR), 'xyz');

  const parsedModel = parseMJCFModel(resolved.content);
  assert.ok(parsedModel);

  const hostGeom = parsedModel.worldBody.geoms.find((geom) => geom.sourceName === 'host_geom');
  const childBody = parsedModel.worldBody.children.find(
    (body) => body.sourceName === 'child/subtree',
  );

  assert.ok(hostGeom);
  assert.ok(childBody);
  assertQuaternionClose(hostGeom.quat, [0.70710678, 0.70710678, 0, 0]);
  assertQuaternionClose(childBody.quat, [0.70710678, 0.70710678, 0, 0]);
});

test('resolveMJCFSource keeps the selected file even when a sibling scene includes it', () => {
  installDomGlobals();

  const files: RobotFile[] = [
    {
      name: '/tmp/mjcf-selected/robot.xml',
      format: 'mjcf',
      content: `
        <mujoco model="robot">
          <actuator>
            <motor name="joint_motor" joint="joint" />
          </actuator>
        </mujoco>
      `,
    },
    {
      name: '/tmp/mjcf-selected/scene.xml',
      format: 'mjcf',
      content: `
        <mujoco model="scene">
          <include file="robot.xml" />
          <worldbody>
            <geom name="floor" type="plane" size="0 0 1" />
          </worldbody>
        </mujoco>
      `,
    },
  ];

  const resolved = resolveMJCFSource(files[0]!, files);

  assert.equal(resolved.sourceFile.name, '/tmp/mjcf-selected/robot.xml');
  assert.equal(resolved.effectiveFile.name, '/tmp/mjcf-selected/robot.xml');
  assert.match(resolved.content, /joint_motor/);
  assert.doesNotMatch(resolved.content, /name="floor"/);
});

test('resolveMJCFSource does not resolve includes through ambiguous basename matches', () => {
  installDomGlobals();

  const files: RobotFile[] = [
    {
      name: '/tmp/mjcf-ambiguous/wrapper.xml',
      format: 'mjcf',
      content: `
        <mujoco model="wrapper">
          <include file="model.xml" />
          <worldbody>
            <geom name="floor" type="plane" size="0 0 1" />
          </worldbody>
        </mujoco>
      `,
    },
    {
      name: '/tmp/mjcf-ambiguous/left/model.xml',
      format: 'mjcf',
      content: `
        <mujoco model="left">
          <worldbody>
            <body name="left_root" />
          </worldbody>
        </mujoco>
      `,
    },
    {
      name: '/tmp/mjcf-ambiguous/right/model.xml',
      format: 'mjcf',
      content: `
        <mujoco model="right">
          <worldbody>
            <body name="right_root" />
          </worldbody>
        </mujoco>
      `,
    },
  ];

  const resolved = resolveMJCFSource(files[0]!, files);

  assert.equal(resolved.effectiveFile.name, '/tmp/mjcf-ambiguous/wrapper.xml');
  assert.match(resolved.content, /name="floor"/);
  assert.doesNotMatch(resolved.content, /left_root/);
  assert.doesNotMatch(resolved.content, /right_root/);
});

test('resolveMJCFSource resolves attached model assets through compiler assetdir', () => {
  installDomGlobals();

  const files: RobotFile[] = [
    {
      name: '/tmp/mjcf-assetdir/scene.xml',
      format: 'mjcf',
      content: `
        <mujoco model="scene">
          <compiler assetdir="assets" />
          <asset>
            <model name="child_model" file="attached.xml" />
          </asset>
          <worldbody>
            <attach model="child_model" body="child_root" prefix="child/" />
          </worldbody>
        </mujoco>
      `,
    },
    {
      name: '/tmp/mjcf-assetdir/assets/attached.xml',
      format: 'mjcf',
      content: `
        <mujoco model="attached">
          <worldbody>
            <body name="child_root">
              <geom name="child_geom" type="box" size="0.1 0.1 0.1" />
            </body>
          </worldbody>
        </mujoco>
      `,
    },
  ];

  const resolved = resolveMJCFSource(files[0]!, files);

  assert.match(resolved.content, /name="child\/child_root"/);
  assert.match(resolved.content, /name="child\/child_geom"/);
});

test('resolveMJCFSource expands mujocoinclude fragments through relative parent paths', () => {
  installDomGlobals();

  const files: RobotFile[] = [
    {
      name: '/tmp/myosuite/furniture_sim/bin.xml',
      format: 'mjcf',
      content: `
        <mujoco model="bin_scene">
          <include file="../furniture_sim/bin/bin_asset.xml" />
          <worldbody>
            <include file="../furniture_sim/bin/bin_body.xml" />
          </worldbody>
        </mujoco>
      `,
    },
    {
      name: '/tmp/myosuite/furniture_sim/bin/bin_asset.xml',
      format: 'mjcf',
      content: `
        <mujocoinclude>
          <asset>
            <mesh name="bin_mesh" file="meshes/bin.stl" />
          </asset>
        </mujocoinclude>
      `,
    },
    {
      name: '/tmp/myosuite/furniture_sim/bin/bin_body.xml',
      format: 'mjcf',
      content: `
        <mujocoinclude>
          <body name="bin_body">
            <geom name="bin_geom" type="mesh" mesh="bin_mesh" />
          </body>
        </mujocoinclude>
      `,
    },
  ];

  const resolved = resolveMJCFSource(files[0]!, files);

  assert.match(resolved.content, /name="bin_mesh"/);
  assert.match(resolved.content, /name="bin_body"/);
  assert.match(resolved.content, /name="bin_geom"/);
});

test('resolveMJCFSource strips source annotations without reparsing expanded content', () => {
  installDomGlobals();

  const NativeDOMParser = globalThis.DOMParser;
  let parseCount = 0;
  globalThis.DOMParser = class CountingDOMParser extends NativeDOMParser {
    parseFromString(...args: Parameters<DOMParser['parseFromString']>): Document {
      parseCount += 1;
      return super.parseFromString(...args);
    }
  } as typeof DOMParser;

  try {
    const files: RobotFile[] = [
      {
        name: '/tmp/mjcf-strip/wrapper.xml',
        format: 'mjcf',
        content: `
          <mujoco model="wrapper">
            <include file="body.xml" />
            <worldbody />
          </mujoco>
        `,
      },
      {
        name: '/tmp/mjcf-strip/body.xml',
        format: 'mjcf',
        content: `
          <mujocoinclude>
            <body name="included_body">
              <geom name="included_geom" type="box" size="0.1 0.1 0.1" />
            </body>
          </mujocoinclude>
        `,
      },
    ];

    const resolved = resolveMJCFSource(files[0]!, files);

    assert.match(resolved.validationContent, /data-urdf-studio-source-file=/);
    assert.doesNotMatch(resolved.content, /data-urdf-studio-source-file=/);
    assert.equal(parseCount, 2);
  } finally {
    globalThis.DOMParser = NativeDOMParser;
  }
});

test('resolveMJCFSource reuses resolved source cache across equivalent file arrays', () => {
  installDomGlobals();

  const NativeDOMParser = globalThis.DOMParser;
  let parseCount = 0;
  globalThis.DOMParser = class CountingDOMParser extends NativeDOMParser {
    parseFromString(...args: Parameters<DOMParser['parseFromString']>): Document {
      parseCount += 1;
      return super.parseFromString(...args);
    }
  } as typeof DOMParser;

  try {
    const firstFiles: RobotFile[] = [
      {
        name: '/tmp/mjcf-cache/wrapper.xml',
        format: 'mjcf',
        content: `
          <mujoco model="wrapper">
            <include file="body.xml" />
            <worldbody />
          </mujoco>
        `,
      },
      {
        name: '/tmp/mjcf-cache/body.xml',
        format: 'mjcf',
        content: `
          <mujocoinclude>
            <body name="cached_body">
              <geom name="cached_geom" type="box" size="0.1 0.1 0.1" />
            </body>
          </mujocoinclude>
        `,
      },
    ];
    const secondFiles = firstFiles.map((file) => ({ ...file }));

    const firstResolved = resolveMJCFSource(firstFiles[0]!, firstFiles);
    const parseCountAfterFirstResolve = parseCount;
    const secondResolved = resolveMJCFSource(secondFiles[0]!, secondFiles);

    assert.equal(secondResolved.content, firstResolved.content);
    assert.equal(parseCount, parseCountAfterFirstResolve);
  } finally {
    globalThis.DOMParser = NativeDOMParser;
  }
});

test('resolveMJCFSource verifies cache signatures before reusing content-hash matches', () => {
  installDomGlobals();

  const firstFile: RobotFile = {
    name: '/tmp/mjcf-cache-collision/robot.xml',
    format: 'mjcf',
    content:
      '<mujoco model="OHGlQbe5uZ"><worldbody><body name="OHGlQbe5uZ" /></worldbody></mujoco>',
  };
  const secondFile: RobotFile = {
    name: '/tmp/mjcf-cache-collision/robot.xml',
    format: 'mjcf',
    content:
      '<mujoco model="sVelSjcx2V"><worldbody><body name="sVelSjcx2V" /></worldbody></mujoco>',
  };

  const firstResolved = resolveMJCFSource(firstFile, [firstFile]);
  const secondResolved = resolveMJCFSource(secondFile, [secondFile]);

  assert.match(firstResolved.content, /OHGlQbe5uZ/);
  assert.match(secondResolved.content, /sVelSjcx2V/);
  assert.doesNotMatch(secondResolved.content, /OHGlQbe5uZ/);
});

test('resolveMJCFSource preserves absolute base paths for deep myosuite includes', () => {
  installDomGlobals();

  const files: RobotFile[] = [
    {
      name: '/tmp/myosuite/myosuite/envs/myo/assets/hand/myohand_tabletop.xml',
      format: 'mjcf',
      content: `
        <mujoco model="tabletop">
          <include file="../../../../simhive/myo_sim/hand/assets/myohand_assets.xml" />
          <worldbody>
            <include file="../../../../simhive/myo_sim/hand/assets/myohand_body.xml" />
          </worldbody>
        </mujoco>
      `,
    },
    {
      name: '/tmp/myosuite/myosuite/simhive/myo_sim/hand/assets/myohand_assets.xml',
      format: 'mjcf',
      content: `
        <mujocoinclude>
          <asset>
            <mesh name="hand_mesh" file="../mesh/hand.stl" />
          </asset>
        </mujocoinclude>
      `,
    },
    {
      name: '/tmp/myosuite/myosuite/simhive/myo_sim/hand/assets/myohand_body.xml',
      format: 'mjcf',
      content: `
        <mujocoinclude>
          <body name="hand_root">
            <geom name="hand_geom" type="mesh" mesh="hand_mesh" />
          </body>
        </mujocoinclude>
      `,
    },
  ];

  const resolved = resolveMJCFSource(files[0]!, files);

  assert.equal(resolved.basePath, '/tmp/myosuite/myosuite/envs/myo/assets/hand');
  assert.match(resolved.content, /name="hand_mesh"/);
  assert.match(resolved.content, /name="hand_root"/);
  assert.match(resolved.content, /name="hand_geom"/);
});

test('resolveMJCFSource reports unresolved MyoSuite template placeholders explicitly', () => {
  installDomGlobals();

  const file: RobotFile = {
    name: '/tmp/myosuite/myosuite/envs/myo/assets/hand/myohand_object.xml',
    format: 'mjcf',
    content: `
      <mujoco model="hand-object-template">
        <include file="../../../../simhive/object_sim/OBJECT_NAME/assets.xml" />
        <worldbody />
      </mujoco>
    `,
  };

  const resolved = resolveMJCFSource(file, [file]);

  assert.equal(resolved.issues.length, 1);
  assert.equal(resolved.issues[0]?.kind, 'unresolved_template_placeholder');
  assert.match(resolved.issues[0]?.detail ?? '', /OBJECT_NAME/);
  assert.match(
    resolved.issues[0]?.detail ?? '',
    /Replace "OBJECT_NAME" with a concrete object directory/,
  );
});

test('prefixMJCFSourceIdentifiers rewrites standalone MJCF identifiers without changing body structure', () => {
  installDomGlobals();

  const source = `
    <mujoco model="hand">
      <compiler meshdir="assets" />
      <default>
        <default class="hand">
          <joint />
        </default>
      </default>
      <asset>
        <material name="metallic" />
        <mesh class="hand" name="forearm_mesh" file="forearm.obj" />
      </asset>
      <worldbody>
        <body name="lh_forearm" childclass="hand">
          <geom name="lh_forearm_visual" mesh="forearm_mesh" material="metallic" />
          <body name="lh_wrist">
            <joint name="lh_WRJ2" />
          </body>
        </body>
      </worldbody>
      <contact>
        <exclude body1="lh_wrist" body2="lh_forearm" />
      </contact>
      <actuator>
        <position name="lh_A_WRJ2" joint="lh_WRJ2" />
      </actuator>
    </mujoco>
  `;

  const prefixed = prefixMJCFSourceIdentifiers(source, 'left_hand_');

  assert.match(prefixed, /name="left_hand_lh_forearm"/);
  assert.match(prefixed, /name="left_hand_lh_wrist"/);
  assert.match(prefixed, /name="left_hand_lh_WRJ2"/);
  assert.match(prefixed, /body1="left_hand_lh_wrist"/);
  assert.match(prefixed, /body2="left_hand_lh_forearm"/);
  assert.match(prefixed, /joint="left_hand_lh_WRJ2"/);
  assert.match(prefixed, /class="hand"/);
  assert.match(prefixed, /mesh="forearm_mesh"/);
  assert.match(prefixed, /material="metallic"/);
  assert.match(prefixed, /file="forearm\.obj"/);

  const sourceDoc = new DOMParser().parseFromString(source, 'text/xml');
  const prefixedDoc = new DOMParser().parseFromString(prefixed, 'text/xml');
  assert.equal(
    prefixedDoc.querySelectorAll('worldbody body').length,
    sourceDoc.querySelectorAll('worldbody body').length,
  );
  assert.equal(
    prefixedDoc.querySelectorAll('worldbody geom').length,
    sourceDoc.querySelectorAll('worldbody geom').length,
  );
});

test('resolveMJCFSource matches the MuJoCo-resolved sally scene when full myosuite support files are available', () => {
  installDomGlobals();

  const fixtureRoot = path.join('test', 'myosuite-main', 'myosuite', 'simhive', 'MPL_sim');
  const oracleResolvedXmlPath = path.join('test', 'mjcf_oracles', 'myosuite_sally.resolved.xml');

  const collectMjcfFiles = (rootDir: string): RobotFile[] => {
    const files: RobotFile[] = [];

    const visit = (currentDir: string): void => {
      for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
        const fullPath = path.join(currentDir, entry.name);
        if (entry.isDirectory()) {
          visit(fullPath);
          continue;
        }

        const extension = path.extname(entry.name).toLowerCase();
        if (extension !== '.xml' && extension !== '.mjcf') {
          continue;
        }

        files.push({
          name: fullPath.replace(/\\/g, '/'),
          content: fs.readFileSync(fullPath, 'utf8'),
          format: 'mjcf',
        });
      }
    };

    visit(rootDir);
    return files;
  };

  const availableFiles = collectMjcfFiles(fixtureRoot);
  const sceneFile = availableFiles.find((file) => file.name.endsWith('/scenes/sally.xml'));
  assert.ok(sceneFile, 'Expected the myosuite sally scene fixture to be present');

  const resolved = resolveMJCFSource(sceneFile, availableFiles);
  assert.equal(resolved.issues.length, 0);

  const resolvedModel = parseMJCFModel(resolved.content);
  assert.ok(resolvedModel, 'Expected TS-resolved myosuite sally source to parse');

  const oracleResolvedXml = fs.readFileSync(oracleResolvedXmlPath, 'utf8');
  const oracleModel = parseMJCFModel(oracleResolvedXml);
  assert.ok(oracleModel, 'Expected MuJoCo oracle-resolved sally source to parse');

  const resolvedSnapshot = createCanonicalSnapshotFromParsedModel(resolvedModel, {
    sourceFile: resolved.sourceFile.name,
    effectiveFile: resolved.effectiveFile.name,
  });
  const oracleSnapshot = createCanonicalSnapshotFromParsedModel(oracleModel, {
    sourceFile: resolved.sourceFile.name,
    effectiveFile: resolved.effectiveFile.name,
  });
  const diffs = diffCanonicalSnapshots(oracleSnapshot, resolvedSnapshot);

  assert.deepEqual(diffs, []);
});
