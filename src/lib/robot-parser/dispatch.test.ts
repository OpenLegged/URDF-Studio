import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { parseRobotDefinition, parseRobotDefinitionAsync } from '@/lib/robot-parser';
import { GeometryType } from '@/types';

function installDomGlobals(): void {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { contentType: 'text/html' });
  globalThis.DOMParser = dom.window.DOMParser as unknown as typeof DOMParser;
}

const URDF = `<robot name="test">
  <link name="base"><collision><geometry><box size="1 1 1"/></geometry></collision></link>
  <link name="link1"/>
  <joint name="j1" type="revolute"><parent link="base"/><child link="link1"/><limit lower="-1" upper="1"/></joint>
</robot>`;

const MJCF = `<mujoco model="test">
  <worldbody><body name="base"><body name="link1"><joint name="j1" type="hinge" range="-1 1"/></body></body></worldbody>
</mujoco>`;

const SDF = `<?xml version="1.0"?>
<sdf version="1.6"><model name="test"><link name="base"/></model></sdf>`;

const XACRO = `<robot name="test" xmlns:xacro="http://ros.org/wiki/xacro">
  <xacro:property name="width" value="1"/>
  <link name="base"/>
</robot>`;

test('parseRobotDefinition parses URDF by extension', () => {
  installDomGlobals();
  const result = parseRobotDefinition(URDF, 'robot.urdf');
  assert.equal(result.status, 'ready');
  if (result.status === 'ready') {
    assert.equal(result.format, 'urdf');
    assert.ok(Object.keys(result.robotData.links).length > 0);
  }
});

test('parseRobotDefinition parses MJCF via content detection on .xml', () => {
  installDomGlobals();
  const result = parseRobotDefinition(MJCF, 'robot.xml');
  assert.equal(result.status, 'ready');
  if (result.status === 'ready') assert.equal(result.format, 'mjcf');
});

test('parseRobotDefinitionAsync resolves mesh-backed MJCF collision primitives', async () => {
  installDomGlobals();
  const result = await parseRobotDefinitionAsync(
    `<mujoco model="physical">
      <compiler fitaabb="true"/>
      <asset>
        <mesh name="fit" vertex="-0.1 -0.2 -0.5 -0.1 -0.2 0.5 -0.1 0.2 -0.5 -0.1 0.2 0.5 0.1 -0.2 -0.5 0.1 -0.2 0.5 0.1 0.2 -0.5 0.1 0.2 0.5"/>
      </asset>
      <worldbody><body name="base"><geom type="capsule" mesh="fit" group="3"/></body></worldbody>
    </mujoco>`,
    'robot.xml',
  );

  assert.equal(result.status, 'ready');
  if (result.status !== 'ready') return;
  const collision = result.robotData.links.base?.collision;
  assert.equal(collision?.type, GeometryType.CAPSULE);
  assert.ok(Math.abs((collision?.dimensions.x ?? 0) - 0.2) <= 1e-6);
  assert.ok(Math.abs((collision?.dimensions.y ?? 0) - 0.6) <= 1e-6);
  assert.equal(collision?.meshPath, undefined);
});

test('parseRobotDefinition parses SDF by extension', () => {
  installDomGlobals();
  const result = parseRobotDefinition(SDF, 'model.sdf');
  assert.equal(result.status, 'ready');
  if (result.status === 'ready') assert.equal(result.format, 'sdf');
});

test('parseRobotDefinition parses Xacro by extension', () => {
  installDomGlobals();
  const result = parseRobotDefinition(XACRO, 'robot.xacro');
  assert.equal(result.status, 'ready');
  if (result.status === 'ready') assert.equal(result.format, 'xacro');
});

test('parseRobotDefinition returns needs_usd_runtime for USD', () => {
  installDomGlobals();
  const result = parseRobotDefinition('#usda 1.0\n', 'robot.usd');
  assert.equal(result.status, 'needs_usd_runtime');
});

test('parseRobotDefinition errors on unknown format', () => {
  installDomGlobals();
  const result = parseRobotDefinition('hello world', 'note.txt');
  assert.equal(result.status, 'error');
  if (result.status === 'error') assert.equal(result.format, null);
});
