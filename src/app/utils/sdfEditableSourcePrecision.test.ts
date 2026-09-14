import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';

import { parseSDF } from '@/core/parsers';
import { generateEditableRobotSource } from './generateEditableRobotSource';
import { reconcileSdfEditableSource } from './sdfEditableSourceReconciler';

globalThis.DOMParser = new JSDOM().window.DOMParser;

const SOURCE = `<sdf version="1.7" xmlns:vendor="urn:vendor"><model name="precision">
  <plugin name="keep_plugin" filename="keep.so"/>
  <link name="base"><visual name="base_visual"><geometry><box><size>1 1 1</size></box></geometry></visual></link>
  <link name="tip" vendor:keep="yes">
    <!-- keep tip comment -->
    <visual name="tip_visual"><geometry><box><size>0.12345678901234568 1 1</size></box></geometry></visual>
  </link>
  <joint name="joint" type="revolute"><parent>base</parent><child>tip</child><axis><xyz>0 0 1</xyz>
    <limit><lower>-1</lower><upper>1</upper><effort>1</effort><velocity>1</velocity></limit>
  </axis></joint>
</model></sdf>`;

function parseRobot(content = SOURCE) {
  const robot = parseSDF(content, { sourcePath: 'precision/model.sdf' });
  assert.ok(robot, 'expected a valid SDF fixture');
  return robot;
}

test('SDF source preserves consecutive precise joint, geometry and inertia edits without section fallback', () => {
  let content = SOURCE;
  let beforeRobot = parseRobot(content);

  for (let index = 1; index <= 5; index += 1) {
    const afterRobot = structuredClone(beforeRobot);
    afterRobot.joints.joint.origin = {
      xyz: { x: index * 0.12345678901234568, y: 1e-17, z: 1.0000000000000002 },
      rpy: { r: index * Math.PI / 12, p: 0.23456789012345678, y: 1.3456789012345678 },
    };
    afterRobot.links.tip.visual.dimensions.x = index * 0.23456789012345678;
    assert.ok(afterRobot.links.tip.inertial, 'expected the parsed tip to have default inertia');
    afterRobot.links.tip.inertial.mass = index * 0.3456789012345678;
    afterRobot.links.tip.inertial.inertia.ixy = 1e-17;

    const result = reconcileSdfEditableSource({
      sourceContent: content, beforeRobot, afterRobot, sourceFileName: 'precision/model.sdf',
    });

    if (result.status !== 'patched') assert.fail(result.reason);
    assert.equal(result.level, 'node');
    assert.match(result.content, /vendor:keep="yes"/);
    assert.match(result.content, /<!-- keep tip comment -->/);
    assert.match(result.content, /<plugin name="keep_plugin"/);
    const parsed = parseRobot(result.content);
    assert.deepEqual(parsed.joints.joint.origin, afterRobot.joints.joint.origin);
    assert.deepEqual(parsed.links.tip.visual.dimensions, afterRobot.links.tip.visual.dimensions);
    assert.deepEqual(parsed.links.tip.inertial, afterRobot.links.tip.inertial);
    content = result.content;
    beforeRobot = afterRobot;
  }
});

test('SDF source still rejects stale high-precision values', () => {
  const beforeRobot = parseRobot();
  const afterRobot = structuredClone(beforeRobot);
  afterRobot.name = 'renamed';
  const result = reconcileSdfEditableSource({
    sourceContent: SOURCE.replace('0.12345678901234568', '0.12345678901234569'),
    beforeRobot, afterRobot, sourceFileName: 'precision/model.sdf',
  });

  assert.equal(result.status, 'unsafe');
  assert.match(result.reason, /no longer matches/);
});

test('SDF joint edits can insert a precise pose into an empty self-closing child link', () => {
  const source = SOURCE.replace(/<link name="tip"[\s\S]*?<\/link>/, '<link name="tip" vendor:keep="yes"/>');
  const beforeRobot = parseRobot(source);
  const afterRobot = structuredClone(beforeRobot);
  afterRobot.joints.joint.origin.xyz.x = 0.12345678901234568;
  afterRobot.joints.joint.origin.rpy = { r: Math.PI / 6, p: 0, y: 0 };
  const result = reconcileSdfEditableSource({
    sourceContent: source, beforeRobot, afterRobot, sourceFileName: 'precision/model.sdf',
  });

  if (result.status !== 'patched') assert.fail(result.reason);
  assert.equal(result.level, 'node');
  assert.match(result.content, /vendor:keep="yes"/);
  assert.deepEqual(parseRobot(result.content).joints.joint.origin, afterRobot.joints.joint.origin);
});

test('SDF 1.6 edits keep the schema valid and preserve precise origins beneath an identity parent', () => {
  let content = SOURCE.replace('version="1.7"', 'version="1.6"');
  let beforeRobot = parseRobot(content);
  for (let index = 1; index <= 3; index += 1) {
    const afterRobot = structuredClone(beforeRobot);
    afterRobot.joints.joint.origin.rpy = { r: index * Math.PI / 7, p: Math.PI / 9, y: 0 };
    afterRobot.joints.joint.origin.xyz.x = index * 0.12345678901234568;
    const result = reconcileSdfEditableSource({
      sourceContent: content, beforeRobot, afterRobot, sourceFileName: 'precision/model.sdf',
    });
    if (result.status !== 'patched') assert.fail(result.reason);
    assert.match(result.content, /version="1\.6"/);
    assert.doesNotMatch(result.content, /relative_to=/);
    assert.deepEqual(parseRobot(result.content).joints.joint.origin, afterRobot.joints.joint.origin);
    beforeRobot = afterRobot;
    content = result.content;
  }
});

const LEGACY_CHAIN = SOURCE.replace('version="1.7"', 'version="1.6"')
  .replace('<link name="tip"', '<link name="arm"><pose>0.2 0.3 0.4 0.5 0.6 0.7</pose></link><link name="tip"')
  .replace('<parent>base</parent>', '<parent>arm</parent>')
  .replace('</model>', '<joint name="shoulder" type="fixed"><parent>base</parent><child>arm</child></joint></model>');

test('SDF 1.6 rotated chains validate their exact serialization result across consecutive edits', () => {
  let content = LEGACY_CHAIN;
  let beforeRobot = parseRobot(content);
  for (let index = 1; index <= 3; index += 1) {
    const afterRobot = structuredClone(beforeRobot);
    afterRobot.joints.joint.origin = {
      xyz: { x: index * 0.12345678901234568, y: 0.23456789012345678, z: 0.3456789012345678 },
      rpy: { r: index * Math.PI / 7, p: Math.PI / 9, y: Math.PI / 11 },
    };
    const result = reconcileSdfEditableSource({
      sourceContent: content, beforeRobot, afterRobot, sourceFileName: 'precision/model.sdf',
    });
    if (result.status !== 'patched') assert.fail(result.reason);
    assert.doesNotMatch(result.content, /relative_to=/);
    const represented = parseRobot(generateEditableRobotSource({
      format: 'sdf', robotState: afterRobot, sdfVersion: '1.6',
    }));
    const parsed = parseRobot(result.content);
    assert.deepEqual(parsed.joints.joint.origin, represented.joints.joint.origin);
    assert.deepEqual(parsed.links.tip.visual.dimensions, afterRobot.links.tip.visual.dimensions);
    content = result.content;
    beforeRobot = afterRobot;
  }
});

test('SDF 1.6 predictable conversion does not accept a stale tiny joint translation', () => {
  const source = SOURCE.replace('version="1.7"', 'version="1.6"');
  const beforeRobot = parseRobot(source);
  const afterRobot = structuredClone(beforeRobot);
  afterRobot.name = 'renamed';
  const stale = source.replace('<link name="tip" vendor:keep="yes">', '<link name="tip" vendor:keep="yes"><pose>1e-20 0 0 0 0 0</pose>');
  const result = reconcileSdfEditableSource({
    sourceContent: stale, beforeRobot, afterRobot, sourceFileName: 'precision/model.sdf',
  });

  assert.equal(result.status, 'unsafe');
  assert.match(result.reason, /no longer matches/);
});

test('SDF source indentation and length stay bounded across thirty precise origin edits', () => {
  let content = SOURCE.replace(
    '<!-- keep tip comment -->', '<!-- keep tip comment -->\n    <pose>0 0 0.2 0 0 0</pose>',
  );
  const initialLength = content.length;
  let beforeRobot = parseRobot(content);
  for (let index = 1; index <= 30; index += 1) {
    const afterRobot = structuredClone(beforeRobot);
    afterRobot.joints.joint.origin = {
      xyz: { x: index * 0.12345678901234568, y: -1e-18, z: 1.0000000000000002 },
      rpy: { r: index * Math.PI / 17, p: 0.23456789012345678, y: -0.3456789012345678 },
    };
    const result = reconcileSdfEditableSource({
      sourceContent: content, beforeRobot, afterRobot, sourceFileName: 'precision/model.sdf',
    });
    if (result.status !== 'patched') assert.fail(result.reason);
    assert.ok(result.content.length <= initialLength + 256, `edit ${index} grew the source to ${result.content.length}`);
    assert.match(result.content, /^    <pose relative_to="base">/m);
    assert.match(result.content, /<!-- keep tip comment -->/);
    assert.deepEqual(parseRobot(result.content).joints.joint.origin, afterRobot.joints.joint.origin);
    content = result.content;
    beforeRobot = afterRobot;
  }
});
