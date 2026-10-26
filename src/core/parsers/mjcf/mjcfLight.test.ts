import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import * as THREE from 'three';
import { parseMJCFModel, normalizeMultiJointBodies } from './mjcfModel';
import { parseMJCFModelLightAttributes } from './mjcfLight';

const dom = new JSDOM('');
Object.defineProperty(globalThis, 'DOMParser', { value: dom.window.DOMParser, configurable: true });

function parse(source: string) {
  const result = parseMJCFModel(source);
  assert.ok(result);
  return result;
}

function near(actual: readonly number[], expected: readonly number[]) {
  assert.equal(actual.length, expected.length);
  actual.forEach((value, index) => assert.ok(Math.abs(value - expected[index]) < 1e-12));
}

test('native explicit lights retain defaults, inactive flags, and legacy directional precedence', () => {
  const model = parse(`<mujoco><compiler angle="radian"/><worldbody>
    <geom size="1"/><light name="default"/><light name="off" active="false" castshadow="false"/>
    <light name="legacy" directional="true"/><light name="override" type="spot" directional="true" cutoff="25"/>
    <light name="future" type="image" mode="futuremode" target="body"/>
  </worldbody></mujoco>`);
  const [defaultLight, off, legacy, override, future] = model.worldBody.lights ?? [];
  assert.deepEqual(defaultLight, {
    name: 'default', type: 'spot', mode: 'fixed', target: undefined,
    active: true, castshadow: true, pos: [0, 0, 0], dir: [0, 0, -1],
    ambient: [0, 0, 0], diffuse: [0.7, 0.7, 0.7], specular: [0.3, 0.3, 0.3],
    attenuation: [1, 0, 0], cutoff: 45, exponent: 10,
    className: undefined, classQName: undefined,
  });
  assert.equal(off.active, false);
  assert.equal(off.castshadow, false);
  assert.equal(legacy.type, 'directional');
  assert.equal(override.type, 'spot');
  assert.equal(override.cutoff, 25, 'cutoff stays degrees under compiler.angle=radian');
  assert.equal(future.type, 'image');
  assert.equal(future.mode, 'futuremode');
  assert.equal(future.target, 'body');
  assert.deepEqual(model.recoveryDiagnostics, []);
});

test('light defaults inherit through body childclass, frame childclass, and explicit class', () => {
  const model = parse(`<mujoco>
    <default><light ambient="0.1 0.2 0.3"/>
      <default class="outer"><light diffuse="0.2 0.4 0.6"/>
        <default class="inner"><light specular="0.6 0.3 0.1" type="directional"/></default>
      </default>
    </default>
    <worldbody><light name="root"/><body childclass="outer"><geom size="1"/>
      <light name="outer"/><light name="explicit" class="inner" diffuse="1 0 0"/>
      <frame childclass="inner"><light name="frame"/></frame>
    </body></worldbody>
  </mujoco>`);
  assert.deepEqual(model.worldBody.lights?.[0].ambient, [0.1, 0.2, 0.3]);
  const [outer, explicit, frame] = model.worldBody.children[0].lights ?? [];
  assert.equal(outer.classQName, 'outer');
  assert.deepEqual(outer.diffuse, [0.2, 0.4, 0.6]);
  assert.equal(explicit.classQName, 'outer/inner');
  assert.deepEqual(explicit.diffuse, [1, 0, 0]);
  assert.deepEqual(explicit.ambient, [0.1, 0.2, 0.3]);
  assert.equal(frame.type, 'directional');
  assert.deepEqual(frame.specular, [0.6, 0.3, 0.1]);
});

test('nested frames transform positions and directions without leaking parent body pose', () => {
  const model = parse(`<mujoco><worldbody>
    <frame pos="1 2 3" euler="0 0 90"><light name="world" pos="1 0 0" dir="1 0 0"/>
      <body name="lampbody" pos="0 2 0" euler="45 0 0"><geom size="1"/>
        <frame pos="0 1 0" euler="90 0 0"><frame pos="1 0 0" euler="0 90 0">
          <light name="local" pos="0 0 1" dir="0 0 -2"/>
        </frame></frame>
      </body>
    </frame>
  </worldbody></mujoco>`);
  const world = model.worldBody.lights?.[0];
  assert.ok(world);
  near(world.pos, [1, 3, 3]);
  near(world.dir, [0, 1, 0]);
  const body = model.worldBody.children[0];
  assert.equal(body.name, 'lampbody');
  near(body.pos, [-1, 2, 3]);
  const light = body.lights?.[0];
  assert.ok(light);
  near(light.pos, [2, 1, 0]);
  near(light.dir, [-2, 0, 0]);
});

test('anonymous bodies keep existing generated names and multi-joint normalization keeps each light once', () => {
  const model = parse(`<mujoco><worldbody><body><joint/><joint axis="1 0 0"/>
    <light name="attached" mode="targetbodycom" target="named"/><geom size="1"/>
    <body name="named"><light name="child"/><geom size="1"/></body>
  </body></worldbody></mujoco>`);
  assert.equal(model.worldBody.children[0].name, 'world_body_0');
  const normalized = normalizeMultiJointBodies(model.worldBody.children[0]);
  assert.equal(normalized.lights, undefined);
  assert.equal(normalized.children[0].lights?.[0].name, 'attached');
  assert.equal(normalized.children[0].children[0].lights?.[0].name, 'child');
});

test('malformed light attributes omit only damaged lights and report recovery diagnostics', () => {
  const model = parse(`<mujoco><worldbody><geom size="1"/>
    <light name="valid"/><light name="bad_pos" pos="1 2 NaN"/>
    <light name="bad_dir" dir="0 0 0"/><light name="bad_arity" diffuse="1 0"/>
    <light name="bad_bool" active="maybe"/><light name="bad_cutoff" cutoff="Infinity"/>
    <light name="bad_attenuation" attenuation="0 NaN 0"/>
  </worldbody></mujoco>`);
  assert.equal(model.worldBody.lights?.length, 1);
  assert.equal(model.recoveryDiagnostics.length, 6);
  assert.ok(model.recoveryDiagnostics.every((diagnostic) => diagnostic.code === 'mjcf_light_omitted'));
  assert.ok(model.recoveryDiagnostics.every((diagnostic) => diagnostic.action === 'omitted'));
  assert.equal(model.worldBody.geoms.length, 1);
  assert.deepEqual(parseMJCFModelLightAttributes({ specular: '-1 0 0' }).specular, [-1, 0, 0]);
  assert.throws(() => parseMJCFModelLightAttributes({ exponent: '1 2' }), /1 finite/);
  assert.throws(() => parseMJCFModelLightAttributes({ attenuation: '1foo 0 0' }), /finite/);
  assert.equal(parseMJCFModelLightAttributes({ cutoff: '-1', exponent: '200' }).cutoff, -1);
  assert.equal(parseMJCFModelLightAttributes({ exponent: '200' }).exponent, 200);
  assert.deepEqual(parseMJCFModelLightAttributes({ attenuation: '0 0 0' }).attenuation, [0, 0, 0]);
});

test('body-attached lights expose a direction that follows the owning body transform', () => {
  const model = parse(`<mujoco><worldbody><body name="rotated" euler="90 0 0">
    <light/><geom size="1"/></body></worldbody></mujoco>`);
  const body = model.worldBody.children[0];
  const light = body.lights?.[0];
  assert.ok(light);
  near(light.dir, [0, 0, -1]);
  assert.ok(body.quat);
  const [w, x, y, z] = body.quat;
  near(new THREE.Vector3(...light.dir).applyQuaternion(new THREE.Quaternion(x, y, z, w)).toArray(), [0, 1, 0]);
});
