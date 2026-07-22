import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { JSDOM } from 'jsdom';

import {
  assertCanonicalRobotData,
  createDefaultWorkspace,
} from '@/core/robot/canonicalWorkspace';
import { useWorkspaceStore } from '@/store/workspaceStore';
import type { RobotFile } from '@/types';

import { resolveRobotFileData } from './importRobotFile';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.DOMParser = dom.window.DOMParser as typeof DOMParser;

function createUrdfFile(content: string): RobotFile {
  return {
    name: 'fixtures/recovery.urdf',
    format: 'urdf',
    content,
  };
}

test('ready imports express omitted continuous bounds without non-finite values', () => {
  const result = resolveRobotFileData(
    createUrdfFile(`
      <robot name="continuous_bounds">
        <link name="base" />
        <link name="wheel" />
        <joint name="wheel_joint" type="continuous">
          <parent link="base" />
          <child link="wheel" />
          <limit effort="12" velocity="8" />
        </joint>
      </robot>
    `),
  );

  assert.equal(result.status, 'ready');
  if (result.status !== 'ready') return;

  assert.doesNotThrow(() => assertCanonicalRobotData(result.robotData, 'robot'));
  assert.deepEqual(result.robotData.joints.wheel_joint?.limit, {
    effort: 12,
    velocity: 8,
  });
});

test('ready imports recover malformed optional numeric payloads locally', () => {
  const result = resolveRobotFileData(
    createUrdfFile(`
      <robot name="malformed_optional_values">
        <link name="base">
          <visual>
            <geometry><cylinder radius="bad" length="1" /></geometry>
          </visual>
          <inertial>
            <mass value="bad" />
            <inertia ixx="1" ixy="0" ixz="0" iyy="1" iyz="0" izz="1" />
          </inertial>
        </link>
      </robot>
    `),
  );

  assert.equal(result.status, 'ready');
  if (result.status !== 'ready') return;

  assert.doesNotThrow(() => assertCanonicalRobotData(result.robotData, 'robot'));
  assert.equal(result.robotData.links.base?.inertial, undefined);
  assert.equal(result.robotData.links.base?.visual.type, 'none');
  assert.ok((result.robotData.inspectionContext?.recovery?.recoveredItemCount ?? 0) >= 2);
});

test('ready imports omit dangling joints and unresolved mimic metadata', () => {
  const result = resolveRobotFileData(
    createUrdfFile(`
      <robot name="recoverable_references">
        <link name="base" />
        <link name="arm" />
        <joint name="arm_joint" type="revolute">
          <parent link="base" />
          <child link="arm" />
          <limit lower="-1" upper="1" effort="4" velocity="2" />
          <mimic joint="missing_joint" />
        </joint>
        <joint name="dangling_joint" type="fixed">
          <parent link="base" />
          <child link="missing_link" />
        </joint>
      </robot>
    `),
  );

  assert.equal(result.status, 'ready');
  if (result.status !== 'ready') return;

  assert.doesNotThrow(() => assertCanonicalRobotData(result.robotData, 'robot'));
  assert.equal(result.robotData.joints.dangling_joint, undefined);
  assert.equal(result.robotData.joints.arm_joint?.mimic, undefined);
});

test('ambiguous duplicate-parent topology remains a hard import error', () => {
  const result = resolveRobotFileData(
    createUrdfFile(`
      <robot name="duplicate_parent">
        <link name="base" />
        <link name="other" />
        <link name="child" />
        <joint name="first" type="fixed">
          <parent link="base" />
          <child link="child" />
        </joint>
        <joint name="second" type="fixed">
          <parent link="other" />
          <child link="child" />
        </joint>
      </robot>
    `),
  );

  assert.equal(result.status, 'error');
  if (result.status !== 'error') return;
  assert.match(result.message ?? '', /duplicate|parent/i);
});

test('duplicate source link identities remain a hard import error', () => {
  const result = resolveRobotFileData(
    createUrdfFile(`
      <robot name="duplicate_link_identity">
        <link name="base" />
        <link name="base" />
      </robot>
    `),
  );

  assert.equal(result.status, 'error');
  if (result.status !== 'error') return;
  assert.match(result.message ?? '', /duplicate.*link|ambiguous source identities/i);
});

for (const [model, relativePath] of [
  ['aliengo', 'aliengo_description/urdf/aliengo.urdf'],
  ['b2w', 'b2w_description/urdf/b2w_description.urdf'],
  ['go2w', 'go2w_description/urdf/go2w_description.urdf'],
] as const) {
  test(`Unitree ${model} resolves and appends as a canonical component`, () => {
    const sourcePath = `test/unitree_ros/robots/${relativePath}`;
    const result = resolveRobotFileData({
      name: `unitree_ros/robots/${relativePath}`,
      format: 'urdf',
      content: fs.readFileSync(sourcePath, 'utf8'),
    });

    assert.equal(result.status, 'ready');
    if (result.status !== 'ready') return;
    assert.doesNotThrow(() => assertCanonicalRobotData(result.robotData, 'robot'));

    useWorkspaceStore.getState().replaceWorkspace(createDefaultWorkspace('fixture'), {
      resetHistory: true,
    });
    const component = useWorkspaceStore.getState().appendComponent({
      id: `component_${model}`,
      name: model,
      sourceFile: sourcePath,
      robot: result.robotData,
    });

    assert.equal(component.robot.name, result.robotData.name);
    assert.equal(
      Object.keys(component.robot.joints).length,
      Object.keys(result.robotData.joints).length,
    );
  });
}
