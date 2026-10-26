import test from 'node:test';
import assert from 'node:assert/strict';

import { JSDOM } from 'jsdom';

import {
  parseCompilerSettings,
  parseMJCFDefaults,
  parseHfieldAssets,
  parseMaterialAssets,
  parseMeshAssets,
  parseOrientationAsQuat,
  parseTextureAssets,
  resolveDefaultClassQName,
  resolveElementAttributes,
} from './mjcfUtils.ts';

function parseXmlDocument(xml: string): Document {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { contentType: 'text/html' });
  const parser = new dom.window.DOMParser();
  return parser.parseFromString(xml, 'text/xml');
}

function assertCloseArray(
  actual: number[] | undefined,
  expected: number[],
  tolerance: number = 1e-6,
): void {
  assert.ok(actual, 'expected array to be defined');
  assert.equal(actual.length, expected.length);
  actual.forEach((value, index) => {
    assert.ok(
      Math.abs(value - expected[index]!) <= tolerance,
      `index ${index}: expected ${expected[index]}, got ${value}`,
    );
  });
}

test('treats top-level main defaults as active root defaults', () => {
  const doc = parseXmlDocument(`
        <mujoco model="main-defaults">
          <default class="main">
            <geom group="1" contype="0" conaffinity="1" mass="0" />
          </default>
          <worldbody>
            <body name="base">
              <geom type="box" size="0.1 0.1 0.1" />
            </body>
          </worldbody>
        </mujoco>
    `);

  const defaults = parseMJCFDefaults(doc);
  const geomElement = doc.querySelector('worldbody body geom');

  assert.ok(geomElement);
  const resolved = resolveElementAttributes(defaults, 'geom', geomElement);

  assert.equal(resolved.group, '1');
  assert.equal(resolved.contype, '0');
  assert.equal(resolved.conaffinity, '1');
  assert.equal(resolved.mass, '0');
});

test('does not leak sibling class defaults through active childclass scope', () => {
  const doc = parseXmlDocument(`
        <mujoco model="sibling-defaults">
          <default class="cassie">
            <geom material="cassie" group="1" contype="0" conaffinity="1" />
          </default>
          <default class="collision">
            <geom group="3" contype="1" conaffinity="0" />
          </default>
          <worldbody>
            <body name="pelvis" childclass="cassie">
              <geom class="collision" type="box" size="0.1 0.1 0.1" />
            </body>
          </worldbody>
        </mujoco>
    `);

  const defaults = parseMJCFDefaults(doc);
  const bodyElement = doc.querySelector('worldbody body');
  const geomElement = doc.querySelector('worldbody body geom');

  assert.ok(bodyElement);
  assert.ok(geomElement);

  const activeClassQName = resolveDefaultClassQName(
    defaults,
    bodyElement.getAttribute('childclass'),
  );
  const resolved = resolveElementAttributes(defaults, 'geom', geomElement, activeClassQName);

  assert.equal(resolved.material, undefined);
  assert.equal(resolved.group, '3');
  assert.equal(resolved.contype, '1');
  assert.equal(resolved.conaffinity, '0');
});

test('keeps inherited defaults when explicit class is nested under the active class', () => {
  const doc = parseXmlDocument(`
        <mujoco model="nested-defaults">
          <default class="main">
            <geom material="visual" group="1" contype="0" conaffinity="1" />
            <default class="collision">
              <geom group="3" />
            </default>
          </default>
          <worldbody>
            <body name="pelvis" childclass="main">
              <geom class="collision" type="box" size="0.1 0.1 0.1" />
            </body>
          </worldbody>
        </mujoco>
    `);

  const defaults = parseMJCFDefaults(doc);
  const bodyElement = doc.querySelector('worldbody body');
  const geomElement = doc.querySelector('worldbody body geom');

  assert.ok(bodyElement);
  assert.ok(geomElement);

  const activeClassQName = resolveDefaultClassQName(
    defaults,
    bodyElement.getAttribute('childclass'),
  );
  const resolved = resolveElementAttributes(defaults, 'geom', geomElement, activeClassQName);

  assert.equal(resolved.material, 'visual');
  assert.equal(resolved.group, '3');
  assert.equal(resolved.contype, '0');
  assert.equal(resolved.conaffinity, '1');
});

test('parses intrinsic euler and xyaxes orientations using compiler settings', () => {
  const doc = parseXmlDocument(`
        <mujoco model="orientation">
          <compiler eulerseq="zyx" />
        </mujoco>
    `);

  const settings = parseCompilerSettings(doc);
  const eulerQuat = parseOrientationAsQuat({ euler: '0 0 90' }, settings);
  const xyaxesQuat = parseOrientationAsQuat({ xyaxes: '0 0 -1 0 1 0' }, settings);

  assertCloseArray(eulerQuat, [0.70710678, 0.70710678, 0, 0], 1e-5);
  assertCloseArray(xyaxesQuat, [0.70710678, 0, 0.70710678, 0], 1e-5);
});

test('parses extrinsic uppercase euler sequences using MuJoCo semantics', () => {
  const doc = parseXmlDocument(`
        <mujoco model="orientation">
          <compiler eulerseq="ZYX" angle="degree" />
        </mujoco>
    `);

  const settings = parseCompilerSettings(doc);
  const quat = parseOrientationAsQuat({ euler: '90 0 0' }, settings);

  assertCloseArray(quat, [0.70710678, 0, 0, 0.70710678], 1e-5);
});

test('inherits texture-backed material defaults from asset declarations', () => {
  const doc = parseXmlDocument(`
        <mujoco model="materials">
          <compiler texturedir="assets" />
          <default>
            <material specular="0" shininess="0.25" />
          </default>
          <asset>
            <texture name="base" type="2d" file="base.png" />
            <material name="paint" texture="base" texrepeat="2 3" texuniform="true" />
          </asset>
        </mujoco>
    `);

  const defaults = parseMJCFDefaults(doc);
  const compiler = parseCompilerSettings(doc);
  const materials = parseMaterialAssets(doc, defaults);
  const textures = parseTextureAssets(doc, compiler, defaults);

  assert.deepEqual(textures.get('base'), {
    name: 'base',
    file: 'assets/base.png',
    type: '2d',
    builtin: undefined,
  });
  assert.deepEqual(materials.get('paint'), {
    name: 'paint',
    rgba: undefined,
    shininess: 0.25,
    specular: 0,
    reflectance: undefined,
    emission: undefined,
    texture: 'base',
    texrepeat: [2, 3],
    texuniform: true,
  });
});

test('parses builtin texture metadata needed for MuJoCo scene materials', () => {
  const doc = parseXmlDocument(`
        <mujoco model="builtin-texture">
          <asset>
            <texture
              name="groundplane"
              type="2d"
              builtin="checker"
              rgb1="0.2 0.3 0.4"
              rgb2="0.1 0.2 0.3"
              mark="edge"
              markrgb="0.8 0.8 0.8"
              width="300"
              height="300"
            />
          </asset>
        </mujoco>
    `);

  const textures = parseTextureAssets(doc);

  assert.deepEqual(textures.get('groundplane'), {
    name: 'groundplane',
    type: '2d',
    builtin: 'checker',
    rgb1: [0.2, 0.3, 0.4],
    rgb2: [0.1, 0.2, 0.3],
    mark: 'edge',
    markrgb: [0.8, 0.8, 0.8],
    width: 300,
    height: 300,
  });
});

test('parses mesh asset refquat and refpos metadata', () => {
  const doc = parseXmlDocument(`
        <mujoco model="mesh-refs">
          <asset>
            <mesh name="finger" file="finger.stl" refpos="1 2 3" refquat="0 0 0 1" />
          </asset>
        </mujoco>
    `);

  const meshes = parseMeshAssets(doc);

  assert.deepEqual(meshes.get('finger'), {
    name: 'finger',
    file: 'finger.stl',
    vertices: undefined,
    scale: undefined,
    refpos: [1, 2, 3],
    refquat: [0, 0, 0, 1],
    inertia: undefined,
  });
});

test('parses inline mesh assets without external files', () => {
  const doc = parseXmlDocument(`
        <mujoco model="inline-mesh">
          <asset>
            <mesh
              name="pyramid"
              vertex="0 6 0  0 -6 0  0.5 6 0  0.5 -6 0  0.5 6 0.5  0.5 -6 0.5"
            />
          </asset>
        </mujoco>
    `);

  const meshes = parseMeshAssets(doc);

  assert.deepEqual(meshes.get('pyramid'), {
    name: 'pyramid',
    file: undefined,
    vertices: [0, 6, 0, 0, -6, 0, 0.5, 6, 0, 0.5, -6, 0, 0.5, 6, 0.5, 0.5, -6, 0.5],
    scale: undefined,
    refpos: undefined,
    refquat: undefined,
    inertia: undefined,
  });
});

test('parses hfield asset metadata including size and elevation', () => {
  const doc = parseXmlDocument(`
        <mujoco model="hfield-assets">
          <asset>
            <hfield
              name="terrain_patch"
              file="terrain.png"
              content_type="image/png"
              size="2 3 0.4 0.1"
              elevation="0 0.1 0.2 0.3"
            />
          </asset>
        </mujoco>
    `);

  const hfields = parseHfieldAssets(doc);

  assert.deepEqual(hfields.get('terrain_patch'), {
    name: 'terrain_patch',
    file: 'terrain.png',
    contentType: 'image/png',
    nrow: undefined,
    ncol: undefined,
    size: [2, 3, 0.4, 0.1],
    elevation: [0, 0.1, 0.2, 0.3],
  });
});

test('applies compiler assetdir to mesh and texture assets when meshdir/texturedir are omitted', () => {
  const doc = parseXmlDocument(`
        <mujoco model="assetdir-assets">
          <compiler assetdir="assets/common" />
          <asset>
            <mesh name="finger" file="meshes/finger.stl" />
            <texture name="albedo" type="2d" file="textures/finger.png" />
          </asset>
        </mujoco>
    `);

  const settings = parseCompilerSettings(doc);
  const meshes = parseMeshAssets(doc, settings);
  const textures = parseTextureAssets(doc, settings);

  assert.equal(meshes.get('finger')?.file, 'assets/common/meshes/finger.stl');
  assert.equal(textures.get('albedo')?.file, 'assets/common/textures/finger.png');
});

test('parses extended compiler settings used by mjcf import semantics', () => {
  const doc = parseXmlDocument(`
        <mujoco model="compiler-flags">
          <compiler
            assetdir="assets/common"
            autolimits="true"
            fitaabb="true"
            inertiafromgeom="true"
            inertiagrouprange="1 4"
          />
          <compiler texturedir="textures/override" />
        </mujoco>
    `);

  const settings = parseCompilerSettings(doc);

  assert.equal(settings.angleUnit, 'degree');
  assert.equal(settings.assetdir, 'assets/common');
  assert.equal(settings.meshdir, 'assets/common');
  assert.equal(settings.texturedir, 'textures/override');
  assert.equal(settings.autolimits, true);
  assert.equal(settings.fitaabb, true);
  assert.equal(settings.inertiafromgeom, 'true');
  assert.deepEqual(settings.inertiagrouprange, [1, 4]);
});

test('inherits actuator defaults for position-class actuators', () => {
  const doc = parseXmlDocument(`
        <mujoco model="actuator-defaults">
          <default class="main">
            <position kp="100" ctrlrange="-2 2" />
            <default class="servo">
              <position forcerange="-5 5" />
            </default>
          </default>
          <actuator>
            <position name="servo_a" joint="joint_a" class="servo" />
          </actuator>
        </mujoco>
    `);

  const defaults = parseMJCFDefaults(doc);
  const actuatorElement = doc.querySelector('actuator position');

  assert.ok(actuatorElement);
  const resolved = resolveElementAttributes(defaults, 'position', actuatorElement);

  assert.equal(resolved.kp, '100');
  assert.equal(resolved.ctrlrange, '-2 2');
  assert.equal(resolved.forcerange, '-5 5');
});

test('explicit geom size overrides default size without merging missing trailing components', () => {
  const doc = parseXmlDocument(`
        <mujoco model="geom-size-override">
          <default class="pad_box2">
            <geom size="0.01 0.015 0.01875" />
          </default>
          <worldbody>
            <body name="finger">
              <geom class="pad_box2" type="capsule" size="0.009 0.012" />
            </body>
          </worldbody>
        </mujoco>
    `);

  const defaults = parseMJCFDefaults(doc);
  const geomElement = doc.querySelector('worldbody body geom');

  assert.ok(geomElement);
  const resolved = resolveElementAttributes(defaults, 'geom', geomElement);

  assert.equal(resolved.size, '0.009 0.012');
});


test('resolves height field files through compiler meshdir or inherited assetdir', () => {
  for (const attrs of ['assetdir="assets/common"', 'assetdir="ignored" meshdir="assets/common"']) {
    const doc = parseXmlDocument(`<mujoco><compiler ${attrs}/><asset>
      <hfield name="terrain" file="rough.bin" size="2 3 .4 .1"/>
      <hfield name="absolute" file="/rough.bin" size="2 3 .4 .1"/>
      <hfield name="url" file="https://example.invalid/rough.bin" size="2 3 .4 .1"/>
    </asset></mujoco>`);
    const fields = parseHfieldAssets(doc, parseCompilerSettings(doc));
    assert.equal(fields.get('terrain')?.file, 'assets/common/rough.bin');
    assert.equal(fields.get('absolute')?.file, '/rough.bin');
    assert.equal(fields.get('url')?.file, 'https://example.invalid/rough.bin');
  }
});
