import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';

import { parseMJCF } from '@/core/parsers';
import { reconcileMJCFEditableSource } from './mjcfEditableSourceReconciler';

const { window } = new JSDOM();
globalThis.DOMParser = window.DOMParser as typeof DOMParser;

const SOURCE = `<mujoco model="precision">
  <compiler angle="radian"/>
  <worldbody><body name="base">
    <geom type="box" size="0.15 0.15 0.1" group="1" contype="0" conaffinity="0"/>
    <body name="tip" pos="0 0 0.2">
      <!-- Source-preserving joint edit regression -->
      <joint name="hinge" type="hinge" range="-2 2" axis="0 1 0"/>
      <inertial pos="0 0 0.1" mass="2" diaginertia="0.2 0.3 0.4"/>
      <geom type="box" size="0.05 0.05 0.3" group="1" contype="0" conaffinity="0"/>
    </body>
  </body></worldbody>
  <custom><numeric name="vendor" data="1 2 3"/></custom>
</mujoco>`;

test('MJCF tiny joint translation only patches the authored body pos attribute', () => {
  const beforeRobot = parseMJCF(SOURCE);
  assert.ok(beforeRobot);
  const afterRobot = structuredClone(beforeRobot);
  afterRobot.joints.hinge.origin.xyz.x = 1e-18;
  const result = reconcileMJCFEditableSource({
    sourceContent: SOURCE, beforeRobot, afterRobot, sourceFileName: 'precision.xml',
  });
  assert.equal(result.status, 'patched');
  if (result.status !== 'patched') return;
  assert.equal(result.level, 'attribute');
  assert.equal(result.content, SOURCE.replace('pos="0 0 0.2"', 'pos="1e-18 0 0.2"'));
});

test('MJCF consecutive XYZ and RPY edits keep body comments and unnamed geoms untouched', () => {
  const initialRobot = parseMJCF(SOURCE);
  assert.ok(initialRobot);
  let beforeRobot = initialRobot;
  let sourceContent = SOURCE;
  for (const angle of [1e-18, 0.123456789123456, -0.23456789123456]) {
    const afterRobot = structuredClone(beforeRobot);
    afterRobot.joints.hinge.origin = {
      xyz: { x: angle, y: -angle / 2, z: 0.2 },
      rpy: { r: angle, p: -angle / 3, y: angle / 2 },
    };
    const result = reconcileMJCFEditableSource({
      sourceContent, beforeRobot, afterRobot, sourceFileName: 'precision.xml',
    });
    assert.equal(result.status, 'patched', result.status === 'unsafe' ? result.reason : undefined);
    if (result.status !== 'patched') return;
    assert.equal(result.level, 'attribute');
    const stripBodyOrigin = (source: string) => source.replace(/<body name="tip"[^>]*>/, '<body name="tip">');
    assert.equal(stripBodyOrigin(result.content), stripBodyOrigin(SOURCE));
    sourceContent = result.content;
    beforeRobot = afterRobot;
  }
});

test('MJCF consecutive translations retain a tiny value after an ordinary value', () => {
  const initialRobot = parseMJCF(SOURCE);
  assert.ok(initialRobot);
  let beforeRobot = initialRobot;
  let sourceContent = SOURCE;
  for (const x of [0.123456789123456, 1e-18, -0.25, 0]) {
    const afterRobot = structuredClone(beforeRobot);
    afterRobot.joints.hinge.origin.xyz.x = x;
    const result = reconcileMJCFEditableSource({
      sourceContent, beforeRobot, afterRobot, sourceFileName: 'precision.xml',
    });
    assert.equal(result.status, 'patched', result.status === 'unsafe' ? result.reason : undefined);
    if (result.status !== 'patched') return;
    assert.equal(result.level, 'attribute');
    assert.equal(result.content, SOURCE.replace('pos="0 0 0.2"', `pos="${x} 0 0.2"`));
    sourceContent = result.content;
    beforeRobot = afterRobot;
  }
});

test('MJCF body position patches retain an authored local joint offset', () => {
  const sourceContent = SOURCE.replace('name="hinge"', 'name="hinge" pos="0.125 0 0"');
  const beforeRobot = parseMJCF(sourceContent);
  assert.ok(beforeRobot);
  const afterRobot = structuredClone(beforeRobot);
  afterRobot.joints.hinge.origin.xyz.x = 0.375;
  const result = reconcileMJCFEditableSource({
    sourceContent, beforeRobot, afterRobot, sourceFileName: 'precision.xml',
  });
  assert.equal(result.status, 'patched', result.status === 'unsafe' ? result.reason : undefined);
  if (result.status !== 'patched') return;
  assert.equal(result.level, 'attribute');
  assert.equal(result.content, sourceContent.replace('pos="0 0 0.2"', 'pos="0.25 0 0.2"'));
});

test('MJCF browser precision sequence retains every authored body child', () => {
  const initialRobot = parseMJCF(SOURCE);
  assert.ok(initialRobot);
  let beforeRobot = initialRobot;
  let sourceContent = SOURCE;
  const edits = [
    ['xyz', 'x', 1e-18],
    ['xyz', 'x', 0.12345678901234568],
    ['xyz', 'y', -1e-18],
    ['xyz', 'z', 1.0000000000000002],
    ['rpy', 'r', 1e-18],
    ['rpy', 'r', 0.12345678901234568],
    ['rpy', 'p', 0.23456789012345678],
    ['rpy', 'y', -0.3456789012345678],
    ['rpy', 'r', 0.5235987755982988],
    ['rpy', 'y', 0],
    ['rpy', 'r', 0.5],
    ['rpy', 'p', 1e-18],
    ['xyz', 'x', 1e-18],
  ] as const;
  for (const [group, axis, value] of edits) {
    const afterRobot = structuredClone(beforeRobot);
    if (group === 'xyz') afterRobot.joints.hinge.origin.xyz[axis] = value;
    else afterRobot.joints.hinge.origin.rpy[axis] = value;
    const result = reconcileMJCFEditableSource({
      sourceContent, beforeRobot, afterRobot, sourceFileName: 'precision.xml',
    });
    const edit = `${group}.${axis}=${value}`;
    assert.equal(result.status, 'patched', `${edit}: ${result.status === 'unsafe' ? result.reason : ''}`);
    if (result.status !== 'patched') return;
    assert.equal(result.level, 'attribute', edit);
    const stripBodyOrigin = (source: string) => source.replace(/<body name="tip"[^>]*>/, '<body name="tip">');
    assert.equal(stripBodyOrigin(result.content), stripBodyOrigin(SOURCE), edit);
    sourceContent = result.content;
    beforeRobot = afterRobot;
  }
});
