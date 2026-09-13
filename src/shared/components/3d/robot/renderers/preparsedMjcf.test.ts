import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { parseRobotDefinitionAsync } from '@/lib/robot-parser';
import { ThreeJsBackend } from './ThreeJsBackend';

test('preparsed MJCF retains the complete public model through scene loading', async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'DOMParser');
  Object.defineProperty(globalThis, 'DOMParser', { value: dom.window.DOMParser, configurable: true });
  const content = `<mujoco model="public-model"><worldbody>
    <geom name="floor" type="box" size="1 1 .01"/>
    <body name="arm"><joint name="hinge" type="hinge" axis="0 1 0"/>
      <geom type="box" size=".1 .1 .3"/><site name="tip" pos="0 0 .3"/>
    </body></worldbody><tendon><fixed name="drive"><joint joint="hinge" coef="1"/></fixed></tendon>
  </mujoco>`;
  const sourceFile = { name: 'model.xml', content, format: 'mjcf' as const };
  const backend = new ThreeJsBackend(sourceFile, {});
  try {
    const result = await parseRobotDefinitionAsync(content, sourceFile.name);
    assert.equal(result.status, 'ready');
    if (result.status !== 'ready') return;
    const robotData = { ...result.robotData, version: 'public-fixture' };
    const scene = await backend.load({ sourceFile, assets: {}, robotData, showCollision: false });
    assert.ok(scene.root);
    assert.equal(scene.robotData?.rootLinkId, robotData.rootLinkId);
    assert.equal(scene.robotData?.links, robotData.links);
    assert.equal(scene.robotData?.joints, robotData.joints);
    assert.equal(scene.robotData?.inspectionContext, robotData.inspectionContext);
    assert.equal(scene.robotData?.inspectionContext?.mjcf?.tendonCount, 1);
    assert.equal(scene.robotData?.sourceDocument, robotData.sourceDocument);
    assert.equal(scene.robotData?.version, 'public-fixture');
  } finally {
    backend.dispose();
    dom.window.close();
    if (previous) Object.defineProperty(globalThis, 'DOMParser', previous);
    else Reflect.deleteProperty(globalThis, 'DOMParser');
  }
});
