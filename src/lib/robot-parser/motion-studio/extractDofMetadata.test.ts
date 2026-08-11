import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { parseURDF, toRobotData, extractDofMetadata } from '@/lib/robot-parser';
import { JointType } from '@/types/robot';

function installDomGlobals(): void {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { contentType: 'text/html' });
  globalThis.DOMParser = dom.window.DOMParser as unknown as typeof DOMParser;
}

test('extractDofMetadata skips fixed joints and records only finite lower<upper limits', () => {
  installDomGlobals();
  const urdf = `<robot name="t">
    <link name="base"/>
    <link name="l1"/>
    <link name="l2"/>
    <joint name="fixed1" type="fixed"><parent link="base"/><child link="l1"/></joint>
    <joint name="rev" type="revolute"><parent link="base"/><child link="l2"/><limit lower="-1.5" upper="1.5"/></joint>
    <joint name="cont" type="continuous"><parent link="l2"/><child link="base"/><limit effort="10" velocity="1"/></joint>
  </robot>`;
  const robot = parseURDF(urdf);
  assert.ok(robot);
  const meta = extractDofMetadata(toRobotData(robot!));

  // fixed1 excluded; rev and cont are non-fixed; cont has no lower/upper.
  assert.deepEqual(meta.jointNames, ['rev', 'cont']);
  assert.deepEqual(meta.dofNames, ['rev', 'cont']);
  assert.deepEqual(meta.jointLimits, { rev: { lower: -1.5, upper: 1.5 } });
  assert.deepEqual(meta.linkNames, ['base', 'l1', 'l2']);
});

test('extractDofMetadata flattens multi-axis joints and excludes dependent mimic joints', () => {
  installDomGlobals();
  const robot = parseURDF(
    '<robot name="multi"><link name="base"/><link name="tip"/><joint name="seed" type="continuous"><parent link="base"/><child link="tip"/></joint></robot>',
  );
  assert.ok(robot);
  const robotData = toRobotData(robot!);
  const seed = robotData.joints.seed;
  robotData.joints = {
    planar: { ...seed, id: 'planar', name: 'planar', type: JointType.PLANAR },
    floating: { ...seed, id: 'floating', name: 'floating', type: JointType.FLOATING },
    ball: { ...seed, id: 'ball', name: 'ball', type: JointType.BALL },
    mimic: {
      ...seed,
      id: 'mimic',
      name: 'mimic',
      mimic: { joint: 'planar', multiplier: 1, offset: 0 },
    },
  };

  const meta = extractDofMetadata(robotData);
  assert.deepEqual(meta.jointNames, ['planar', 'floating', 'ball']);
  assert.deepEqual(meta.dofNames, [
    'planar/x',
    'planar/y',
    'planar/theta',
    'floating/x',
    'floating/y',
    'floating/z',
    'floating/roll',
    'floating/pitch',
    'floating/yaw',
    'ball/qx',
    'ball/qy',
    'ball/qz',
    'ball/qw',
  ]);
});

test('extractDofMetadata omits limit when lower >= upper', () => {
  installDomGlobals();
  const urdf = `<robot name="t">
    <link name="base"/><link name="l1"/>
    <joint name="bad" type="revolute"><parent link="base"/><child link="l1"/><limit lower="5" upper="1"/></joint>
  </robot>`;
  const robot = parseURDF(urdf);
  const meta = extractDofMetadata(toRobotData(robot!));
  assert.deepEqual(meta.dofNames, ['bad']);
  assert.deepEqual(meta.jointLimits, {});
});
