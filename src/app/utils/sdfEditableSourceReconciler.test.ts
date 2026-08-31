import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';

import { parseSDF } from '@/core/parsers';
import type { RobotData } from '@/types';
import { reconcileSdfEditableSource } from './sdfEditableSourceReconciler';

const { window } = new JSDOM();

if (!globalThis.DOMParser) {
  globalThis.DOMParser = window.DOMParser;
}

const WORLD_SOURCE = `<?xml version="1.0"?>
<sdf version="1.7" xmlns:custom="urn:custom" xmlns:vendor="urn:vendor">
  <world name="default">
    <plugin name="world_keep" filename="libworld_keep.so" />
    <model name="demo">
      <plugin name="model_keep" filename="libmodel_keep.so" />
      <link name="base">
        <visual name="base_visual">
          <geometry><box><size>1 1 1</size></box></geometry>
        </visual>
      </link>
      <link name="tool" custom:keep="yes">
        <!-- keep link comment -->
        <visual name="tool_visual">
          <geometry><box><size>0.2 0.2 0.2</size></box></geometry>
        </visual>
        <collision name="tool_collision">
          <geometry><box><size>0.2 0.2 0.2</size></box></geometry>
        </collision>
      </link>
      <joint name="wrist" type="revolute">
        <parent>base</parent>
        <child>tool</child>
        <axis>
          <xyz>0 0 1</xyz>
          <limit><lower>-1</lower><upper>1</upper><effort>2</effort><velocity>3</velocity></limit>
        </axis>
      </joint>
      <vendor:section value="preserve" />
    </model>
    <model name="unaffected">
      <link name="other" />
    </model>
  </world>
</sdf>
`;

function parseRobot(source: string): RobotData {
  const robot = parseSDF(source, { sourcePath: 'demo/model.sdf' });
  assert.ok(robot, 'expected SDF fixture to parse');
  return robot;
}

function assertIncludesSource(content: string, expectedSource: string): void {
  assert.ok(content.includes(expectedSource));
}

test('reconcileSdfEditableSource patches a changed link while preserving world plugins and unrelated sections', () => {
  const beforeRobot = parseRobot(WORLD_SOURCE);
  const afterRobot = structuredClone(beforeRobot);
  afterRobot.links.tool.visual.dimensions.x = 0.4;
  afterRobot.links.tool.visual.dimensions.y = 0.5;
  afterRobot.links.tool.visual.dimensions.z = 0.6;

  const result = reconcileSdfEditableSource({
    sourceContent: WORLD_SOURCE,
    beforeRobot,
    afterRobot,
    sourceFileName: 'demo/model.sdf',
  });

  assert.equal(result.status, 'patched');
  assert.equal(result.level, 'node');
  assert.match(result.content, /<plugin name="world_keep" filename="libworld_keep\.so" \/>/);
  assert.match(result.content, /<plugin name="model_keep" filename="libmodel_keep\.so" \/>/);
  assert.match(result.content, /<vendor:section value="preserve" \/>/);
  assert.match(result.content, /<model name="unaffected">/);
  assert.match(result.content, /<size>0\.4 0\.5 0\.6<\/size>/);
});

test('reconcileSdfEditableSource patches model attributes inside a world without replacing the world', () => {
  const beforeRobot = parseRobot(WORLD_SOURCE);
  const afterRobot = { ...structuredClone(beforeRobot), name: 'demo_renamed' };

  const result = reconcileSdfEditableSource({
    sourceContent: WORLD_SOURCE,
    beforeRobot,
    afterRobot,
    sourceFileName: 'demo/model.sdf',
  });

  assert.equal(result.status, 'patched');
  assert.equal(result.level, 'attribute');
  assert.match(result.content, /<world name="default">/);
  assert.match(result.content, /<model name="demo_renamed">/);
  assert.match(result.content, /<plugin name="world_keep" filename="libworld_keep\.so" \/>/);
});

test('reconcileSdfEditableSource patches joint limit attributes without touching sibling links', () => {
  const beforeRobot = parseRobot(WORLD_SOURCE);
  const afterRobot = structuredClone(beforeRobot);
  afterRobot.joints.wrist.limit = {
    ...afterRobot.joints.wrist.limit,
    upper: 2,
    effort: 5,
  };

  const result = reconcileSdfEditableSource({
    sourceContent: WORLD_SOURCE,
    beforeRobot,
    afterRobot,
    sourceFileName: 'demo/model.sdf',
  });

  assert.equal(result.status, 'patched');
  assert.equal(result.level, 'attribute');
  assert.match(result.content, /<link name="tool" custom:keep="yes">/);
  assert.match(result.content, /<upper>2<\/upper>/);
  assert.match(result.content, /<effort>5<\/effort>/);
});

test('reconcileSdfEditableSource preserves the authored SDF schema version', () => {
  const source = WORLD_SOURCE.replace('version="1.7"', 'version="1.9"');
  const beforeRobot = parseRobot(source);
  const afterRobot = structuredClone(beforeRobot);
  afterRobot.joints.wrist.limit = {
    ...afterRobot.joints.wrist.limit,
    upper: 1.75,
  };

  const result = reconcileSdfEditableSource({
    sourceContent: source,
    beforeRobot,
    afterRobot,
    sourceFileName: 'demo/model.sdf',
  });

  if (result.status !== 'patched') assert.fail(result.reason);

  assert.equal(result.level, 'attribute');
  assert.match(result.content, /<sdf version="1\.9"/);
  assert.match(result.content, /<upper>1\.75<\/upper>/);
  assert.match(result.content, /<plugin name="world_keep"/);
});

test('reconcileSdfEditableSource falls back to joint entity replacement for type changes', () => {
  const beforeRobot = parseRobot(WORLD_SOURCE);
  const afterRobot = structuredClone(beforeRobot);
  afterRobot.joints.wrist.type = 'fixed';
  afterRobot.joints.wrist.axis = undefined;
  afterRobot.joints.wrist.limit = undefined;

  const result = reconcileSdfEditableSource({
    sourceContent: WORLD_SOURCE,
    beforeRobot,
    afterRobot,
    sourceFileName: 'demo/model.sdf',
  });

  assert.equal(result.status, 'patched');
  assert.equal(result.level, 'entity');
  assert.match(result.content, /<joint name="wrist" type="fixed">/);
  assert.doesNotMatch(result.content, /<axis>/);
  assert.match(result.content, /<plugin name="model_keep" filename="libmodel_keep\.so" \/>/);
});

test('reconcileSdfEditableSource falls back to controlled model sections without replacing plugins', () => {
  const source = `<?xml version="1.0"?>
<sdf version="1.7">
  <model name="demo">
    <pose>0 0 0.5 0 0 0</pose>
    <plugin name="model_keep" filename="libmodel_keep.so" />
    <link name="base">
      <visual name="base_visual">
        <geometry><box><size>1 1 1</size></box></geometry>
      </visual>
    </link>
  </model>
</sdf>
`;
  const beforeRobot = parseRobot(source);
  const afterRobot = {
    name: 'demo',
    rootLinkId: 'base',
    links: { base: structuredClone(beforeRobot.links.base) },
    joints: {},
  };

  const result = reconcileSdfEditableSource({
    sourceContent: source,
    beforeRobot,
    afterRobot,
    sourceFileName: 'demo/model.sdf',
  });

  assert.equal(result.status, 'patched');
  assert.equal(result.level, 'section');
  assert.doesNotMatch(result.content, /<pose>0 0 0\.5 0 0 0<\/pose>/);
  assert.match(result.content, /<plugin name="model_keep" filename="libmodel_keep\.so" \/>/);
  assert.match(result.content, /<link name="base">/);
});

test('reconcileSdfEditableSource entity fallback preserves nested model source', () => {
  const source = `<?xml version="1.0"?>
<sdf version="1.7">
  <model name="demo">
    <link name="base" />
    <joint name="anchor" type="revolute">
      <parent>base</parent>
      <child>nested::inner</child>
      <axis><xyz>0 0 1</xyz></axis>
    </joint>
    <model name="nested">
      <link name="inner">
        <visual name="inner_visual">
          <geometry><box><size>0.1 0.1 0.1</size></box></geometry>
        </visual>
      </link>
    </model>
  </model>
  </sdf>
`;
  const nestedModelSource = `<model name="nested">
      <link name="inner">
        <visual name="inner_visual">
          <geometry><box><size>0.1 0.1 0.1</size></box></geometry>
        </visual>
      </link>
    </model>`;
  const beforeRobot = parseRobot(source);
  const afterRobot = structuredClone(beforeRobot);
  afterRobot.joints.anchor.type = 'fixed';
  afterRobot.joints.anchor.axis = undefined;
  afterRobot.joints.anchor.limit = undefined;

  const result = reconcileSdfEditableSource({
    sourceContent: source,
    beforeRobot,
    afterRobot,
    sourceFileName: 'demo/model.sdf',
  });

  assert.equal(result.status, 'patched');
  assert.equal(result.level, 'entity');
  assert.match(result.content, /<joint name="anchor" type="fixed">/);
  assertIncludesSource(result.content, nestedModelSource);
  assert.doesNotMatch(result.content, /<link name="nested::inner">/);
});

test('reconcileSdfEditableSource section fallback preserves nested model source', () => {
  const source = `<?xml version="1.0"?>
<sdf version="1.7">
  <model name="demo">
    <pose>0 0 0.5 0 0 0</pose>
    <plugin name="model_keep" filename="libmodel_keep.so" />
    <link name="base">
      <visual name="base_visual">
        <geometry><box><size>1 1 1</size></box></geometry>
      </visual>
    </link>
    <model name="nested">
      <link>
        <visual name="unknown_visual">
          <geometry><box><size>0.1 0.1 0.1</size></box></geometry>
        </visual>
      </link>
    </model>
  </model>
</sdf>
`;
  const nestedModelSource = `<model name="nested">
      <link>
        <visual name="unknown_visual">
          <geometry><box><size>0.1 0.1 0.1</size></box></geometry>
        </visual>
      </link>
    </model>`;
  const beforeRobot = parseRobot(source);
  const afterRobot = {
    name: 'demo',
    rootLinkId: 'base',
    links: { base: structuredClone(beforeRobot.links.base) },
    joints: {},
  };

  const result = reconcileSdfEditableSource({
    sourceContent: source,
    beforeRobot,
    afterRobot,
    sourceFileName: 'demo/model.sdf',
  });

  assert.equal(result.status, 'patched');
  assert.equal(result.level, 'section');
  assert.doesNotMatch(result.content, /<pose>0 0 0\.5 0 0 0<\/pose>/);
  assert.match(result.content, /<plugin name="model_keep" filename="libmodel_keep\.so" \/>/);
  assertIncludesSource(result.content, nestedModelSource);
});

test('reconcileSdfEditableSource returns unsafe when the source no longer matches beforeRobot', () => {
  const beforeRobot = parseRobot(WORLD_SOURCE);
  const afterRobot = structuredClone(beforeRobot);
  afterRobot.name = 'demo_renamed';
  const staleSource = WORLD_SOURCE.replace('<link name="tool"', '<link name="tool_stale"');

  const result = reconcileSdfEditableSource({
    sourceContent: staleSource,
    beforeRobot,
    afterRobot,
    sourceFileName: 'demo/model.sdf',
  });

  assert.equal(result.status, 'unsafe');
  assert.match(result.reason, /no longer matches/);
});

test('reconcileSdfEditableSource returns unsafe for ambiguous sibling models', () => {
  const source = WORLD_SOURCE.replace('model name="demo"', 'model name="not_demo"');
  const beforeRobot = parseRobot(WORLD_SOURCE);
  const afterRobot = { ...structuredClone(beforeRobot), name: 'demo_renamed' };

  const result = reconcileSdfEditableSource({
    sourceContent: source,
    beforeRobot,
    afterRobot,
    sourceFileName: 'demo/model.sdf',
  });

  assert.equal(result.status, 'unsafe');
});
