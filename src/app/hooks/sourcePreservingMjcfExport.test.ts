import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';

import { generateMujocoXML, parseMJCF } from '@/core/parsers';
import { resolveSourcePreservingExportContent } from './sourcePreservingExportUtils';

const dom = new JSDOM();
globalThis.DOMParser = dom.window.DOMParser as typeof DOMParser;
globalThis.XMLSerializer = dom.window.XMLSerializer as typeof XMLSerializer;

function fixture() {
  const robot = parseMJCF(`<mujoco model="furniture"><worldbody>
    <body name="bed"><freejoint name="free"/>
      <geom type="box" size="1 1 .2"/>
    </body></worldbody></mujoco>`);
  assert.ok(robot);
  const source = generateMujocoXML(robot, {
    includeSceneHelpers: false, preserveNumericPrecision: true, preserveInertialData: true,
  }).replace('<worldbody>', `<option timestep="0.008"/>
  <!-- scene metadata remains source-owned -->
  <custom><text name="scene_metadata" data="room"/></custom>
  <worldbody>`);
  return { robot, source };
}

for (const rename of [false, true]) {
  test(`model download applies inferred inertia despite a matching source snapshot${rename ? ' after renaming' : ''}`, () => {
    const { robot, source } = fixture();
    const currentRobot = { ...robot, name: rename ? 'renamed_furniture' : robot.name };
    const generatedContent = generateMujocoXML(currentRobot, {
      includeSceneHelpers: false, preserveNumericPrecision: true, densityKgM3: 375,
    });
    const options = {
      format: 'mjcf' as const, currentRobot, generatedContent,
      sourceFile: { name: 'scene.xml', format: 'mjcf' as const, content: source },
    };
    // The default remains source-preserving for editable/native callers.
    const native = resolveSourcePreservingExportContent(options);
    assert.match(native.content, /<inertial[^>]*mass="0"[^>]*diaginertia="0 0 0"/);

    const exported = resolveSourcePreservingExportContent({ ...options, mjcfModelSections: 'generated' });
    const document = new DOMParser().parseFromString(exported.content, 'text/xml');
    const body = document.querySelector('body[name="bed"]');
    assert.ok(body);
    assert.equal(body.querySelector('inertial'), null);
    assert.equal(body.querySelector('geom[group="3"]')?.getAttribute('density'), '375');
    assert.equal(document.querySelector('compiler')?.getAttribute('inertiafromgeom'), 'auto');
    assert.equal(document.querySelector('option')?.getAttribute('timestep'), '0.008');
    assert.equal(document.querySelector('custom text')?.getAttribute('data'), 'room');
    assert.match(exported.content, /scene metadata remains source-owned/);
    assert.equal(document.documentElement.getAttribute('model'), currentRobot.name);
    assert.equal(robot.links.bed!.inertial.mass, 0);
  });
}

test('model download retains authored positive inertia while replacing prepared model sections', () => {
  const { robot } = fixture();
  robot.links.bed!.inertial = {
    mass: 9, inertia: { ixx: 1, iyy: 2, izz: 3, ixy: 0, ixz: 0, iyz: 0 },
  };
  const generatedContent = generateMujocoXML(robot, { includeSceneHelpers: false });
  const result = resolveSourcePreservingExportContent({
    format: 'mjcf', currentRobot: robot, generatedContent, mjcfModelSections: 'generated',
    sourceFile: { name: 'scene.xml', format: 'mjcf', content: generatedContent },
  });
  const document = new DOMParser().parseFromString(result.content, 'text/xml');
  assert.equal(document.querySelector('body[name="bed"] > inertial')?.getAttribute('mass'), '9');
  assert.equal(document.querySelector('body[name="bed"] > inertial')?.getAttribute('diaginertia'), '1 2 3');
});
