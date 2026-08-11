import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { JSDOM } from 'jsdom';

import { parseURDF } from '@/core/parsers/urdf/parser';
import { toRobotData } from '../toRobotData';
import { buildRobotRuntimeFromData, loadRobotRuntime } from './index';

test('loadRobotRuntime prepares mesh-backed MJCF collision physics before building runtime', async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { contentType: 'text/html' });
  const originalDomParser = globalThis.DOMParser;
  globalThis.DOMParser = dom.window.DOMParser as unknown as typeof DOMParser;

  try {
    const runtime = await loadRobotRuntime(
      `<mujoco model="physical">
        <compiler fitaabb="true"/>
        <asset>
          <mesh name="fit" vertex="-0.1 -0.2 -0.5 -0.1 -0.2 0.5 -0.1 0.2 -0.5 -0.1 0.2 0.5 0.1 -0.2 -0.5 0.1 -0.2 0.5 0.1 0.2 -0.5 0.1 0.2 0.5"/>
        </asset>
        <worldbody><body name="base"><geom type="capsule" mesh="fit" group="3"/></body></worldbody>
      </mujoco>`,
      'robot.xml',
      { parseVisual: false, parseCollision: true },
    );

    try {
      const collision = runtime.robotData.links.base?.collision;
      assert.equal(collision?.type, 'capsule');
      assert.ok(Math.abs((collision?.dimensions.x ?? 0) - 0.2) <= 1e-6);
      assert.ok(Math.abs((collision?.dimensions.y ?? 0) - 0.6) <= 1e-6);
      assert.equal(collision?.meshPath, undefined);
    } finally {
      runtime.dispose();
    }
  } finally {
    globalThis.DOMParser = originalDomParser;
    dom.window.close();
  }
});

test('buildRobotRuntimeFromData disposes a constructed graph when completion is aborted', async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { contentType: 'text/html' });
  const originalDomParser = globalThis.DOMParser;
  globalThis.DOMParser = dom.window.DOMParser as unknown as typeof DOMParser;
  const parsed = parseURDF(
    '<robot name="abort"><link name="base"><visual><geometry><box size="1 1 1"/></geometry></visual></link></robot>',
  );
  assert.ok(parsed);

  const controller = new AbortController();
  const originalDispose = THREE.BufferGeometry.prototype.dispose;
  let disposeCount = 0;
  THREE.BufferGeometry.prototype.dispose = function disposeAndCount() {
    disposeCount += 1;
    originalDispose.call(this);
  };

  try {
    await assert.rejects(
      buildRobotRuntimeFromData(toRobotData(parsed), {
        signal: controller.signal,
        onProgress: () => controller.abort(),
      }),
      { name: 'AbortError' },
    );
    assert.ok(disposeCount > 0, 'constructed geometry should be released before rejecting');
  } finally {
    THREE.BufferGeometry.prototype.dispose = originalDispose;
    globalThis.DOMParser = originalDomParser;
    dom.window.close();
  }
});
