import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';

import { parseMJCF } from '@/core/parsers';
import type { RobotState } from '@/types';
import {
  reconcileMJCFEditableSource,
  type ReconcileMJCFEditableSourceResult,
} from './mjcfEditableSourceReconciler.ts';

const { window } = new JSDOM();
globalThis.DOMParser = window.DOMParser as typeof DOMParser;
globalThis.XMLSerializer = window.XMLSerializer as typeof XMLSerializer;

const SOURCE = `<mujoco model="demo">
  <compiler angle="radian" autolimits="true" />
  <default>
    <joint damping="0.1" frictionloss="0.02" />
  </default>
  <asset>
    <!-- keep unused authored asset -->
    <mesh name="unused_mesh" file="vendor/unused.stl" />
  </asset>
  <worldbody>
    <!-- keep worldbody comment -->
    <body name="base">
      <geom name="base_geom" type="box" size="0.5 0.5 0.1" />
      <body name="arm" pos="0 0 0.2">
        <!-- keep arm-local extension until entity widening -->
        <joint name="shoulder" type="hinge" axis="0 0 1" range="-1 1" />
        <inertial pos="0 0 0.1" mass="2" diaginertia="0.2 0.3 0.4" />
        <geom name="arm_geom" type="box" size="0.1 0.2 0.3" />
        <body name="tool" pos="0 0 0.6">
          <joint name="wrist" type="hinge" axis="0 1 0" range="-0.5 0.5" />
          <geom name="tool_geom" type="sphere" size="0.08" />
        </body>
      </body>
      <body name="sibling" pos="0.4 0 0">
        <geom name="sibling_geom" type="sphere" size="0.05" />
      </body>
    </body>
  </worldbody>
  <actuator>
    <motor name="shoulder_motor" joint="shoulder" gear="5" />
  </actuator>
  <tendon>
    <fixed name="authored_cable"><joint joint="shoulder" coef="1" /></fixed>
  </tendon>
  <sensor>
    <jointpos name="shoulder_position" joint="shoulder" />
  </sensor>
  <custom>
    <numeric name="vendor_extension" data="1 2 3" />
  </custom>
</mujoco>
`;

function parseRobot(source = SOURCE): RobotState {
  const parsed = parseMJCF(source);
  assert.ok(parsed, 'expected MJCF fixture to parse');
  return parsed;
}

function requirePatched(result: ReconcileMJCFEditableSourceResult) {
  assert.equal(result.status, 'patched', result.status === 'unsafe' ? result.reason : undefined);
  return result;
}

function assertUnchangedSections(content: string): void {
  assert.match(content, /<compiler angle="radian" autolimits="true" \/>/);
  assert.match(content, /<!-- keep unused authored asset -->/);
  assert.match(content, /<mesh name="unused_mesh" file="vendor\/unused\.stl" \/>/);
  assert.match(content, /<fixed name="authored_cable"><joint joint="shoulder" coef="1" \/><\/fixed>/);
  assert.match(content, /<jointpos name="shoulder_position" joint="shoulder" \/>/);
  assert.match(content, /<numeric name="vendor_extension" data="1 2 3" \/>/);
}

test('reconcileMJCFEditableSource stops at attribute patches for names and joint limits', () => {
  const beforeRobot = parseRobot();
  const afterRobot = structuredClone(beforeRobot);
  afterRobot.name = 'demo_attributes';
  afterRobot.joints.shoulder.limit = {
    ...afterRobot.joints.shoulder.limit,
    lower: -0.75,
    upper: 0.9,
  };

  const result = requirePatched(reconcileMJCFEditableSource({
    sourceContent: SOURCE,
    beforeRobot,
    afterRobot,
    sourceFileName: 'robots/demo.xml',
  }));

  assert.equal(result.level, 'attribute');
  assert.match(result.content, /<mujoco model="demo_attributes">/);
  assert.match(result.content, /<joint name="shoulder"[^>]*range="-0\.75 0\.9"/);
  assert.match(result.content, /keep arm-local extension/);
  assertUnchangedSections(result.content);
});

test('reconcileMJCFEditableSource widens to the tendon section for inspection edits', () => {
  const beforeRobot = parseRobot();
  const afterRobot = structuredClone(beforeRobot);
  const tendon = afterRobot.inspectionContext?.mjcf?.tendons[0];
  assert.ok(tendon);
  tendon.width = 0.02;
  tendon.rgba = [1, 0.25, 0, 1];

  const result = requirePatched(reconcileMJCFEditableSource({
    sourceContent: SOURCE,
    beforeRobot,
    afterRobot,
    sourceFileName: 'robots/demo.xml',
  }));

  assert.equal(result.level, 'section');
  assert.match(
    result.content,
    /<fixed name="authored_cable" width="0\.02" rgba="1 0\.25 0 1">/,
  );
  assert.match(result.content, /<joint joint="shoulder" coef="1" \/>/);
  assert.match(result.content, /<motor name="shoulder_motor" joint="shoulder" gear="5" \/>/);
  assert.match(result.content, /<jointpos name="shoulder_position" joint="shoulder" \/>/);
  assert.match(result.content, /<numeric name="vendor_extension" data="1 2 3" \/>/);
});

test('reconcileMJCFEditableSource widens to a node for inertial changes', () => {
  const beforeRobot = parseRobot();
  const afterRobot = structuredClone(beforeRobot);
  afterRobot.links.arm.inertial = {
    ...afterRobot.links.arm.inertial!,
    mass: 3.25,
  };

  const result = requirePatched(reconcileMJCFEditableSource({
    sourceContent: SOURCE,
    beforeRobot,
    afterRobot,
    sourceFileName: 'robots/demo.xml',
  }));

  assert.equal(result.level, 'node');
  assert.match(result.content, /<inertial[^>]*mass="3\.25"/);
  assert.match(result.content, /keep arm-local extension/);
  assertUnchangedSections(result.content);
});

test('reconcileMJCFEditableSource widens to a body entity for shared geom changes', () => {
  const beforeRobot = parseRobot();
  const afterRobot = structuredClone(beforeRobot);
  afterRobot.links.arm.visual.dimensions = { x: 0.6, y: 0.8, z: 1 };

  const result = requirePatched(reconcileMJCFEditableSource({
    sourceContent: SOURCE,
    beforeRobot,
    afterRobot,
    sourceFileName: 'robots/demo.xml',
  }));

  assert.equal(result.level, 'entity');
  assert.match(result.content, /<body name="arm"/);
  assert.match(result.content, /<geom[^>]*type="box"[^>]*size="0\.3 0\.4 0\.5"/);
  assert.match(result.content, /<body name="sibling" pos="0\.4 0 0">/);
  assertUnchangedSections(result.content);
});

test('reconcileMJCFEditableSource widens to worldbody section for reparenting', () => {
  const beforeRobot = parseRobot();
  const afterRobot = structuredClone(beforeRobot);
  afterRobot.joints.wrist.parentLinkId = 'base';

  const result = requirePatched(reconcileMJCFEditableSource({
    sourceContent: SOURCE,
    beforeRobot,
    afterRobot,
    sourceFileName: 'robots/demo.xml',
  }));

  assert.equal(result.level, 'section');
  const armClose = result.content.indexOf('</body>', result.content.indexOf('<body name="arm"'));
  const toolStart = result.content.indexOf('<body name="tool"');
  assert.ok(toolStart > armClose, 'expected tool to move outside the arm body');
  assertUnchangedSections(result.content);
});

test('reconcileMJCFEditableSource returns unsafe for stale, invalid, and include sources', () => {
  const beforeRobot = parseRobot();
  const stale = reconcileMJCFEditableSource({
    sourceContent: SOURCE,
    beforeRobot: { ...beforeRobot, name: 'stale' },
    afterRobot: beforeRobot,
    sourceFileName: 'robots/demo.xml',
  });
  assert.equal(stale.status, 'unsafe');

  const invalid = reconcileMJCFEditableSource({
    sourceContent: '<mujoco><worldbody><body name="broken"></worldbody></mujoco>',
    beforeRobot,
    afterRobot: beforeRobot,
    sourceFileName: 'robots/broken.xml',
  });
  assert.equal(invalid.status, 'unsafe');

  const withInclude = reconcileMJCFEditableSource({
    sourceContent: '<mujoco model="demo"><include file="robot.xml" /></mujoco>',
    beforeRobot,
    afterRobot: beforeRobot,
    sourceFileName: 'robots/scene.xml',
  });
  assert.equal(withInclude.status, 'unsafe');

  const encodingMetadataRobot = structuredClone(beforeRobot);
  encodingMetadataRobot.links.arm.visual.name = 'renamed_authored_geom';
  const encodingMetadata = reconcileMJCFEditableSource({
    sourceContent: SOURCE,
    beforeRobot,
    afterRobot: encodingMetadataRobot,
    sourceFileName: 'robots/demo.xml',
  });
  assert.equal(encodingMetadata.status, 'unsafe');
});
