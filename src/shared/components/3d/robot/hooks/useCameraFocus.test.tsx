import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { context as r3fContext, type RenderCallback, type RootState } from '@react-three/fiber';
import { createWithEqualityFn } from 'zustand/traditional';
import * as THREE from 'three';
import { OrbitControls } from 'three-stdlib';
import { computeCameraFrame } from '../utils/cameraFrame';
import { useCameraFocus } from './useCameraFocus';

function createFocusHarness(context: TestContext, size: number, maxDistance = Infinity) {
  const dom = new JSDOM('<div id="root"></div>');
  const globals = { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true };
  const descriptors = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries(globals)) {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  }
  const container = dom.window.document.getElementById('root');
  assert.ok(container);
  const root = createRoot(container);
  const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 100000);
  camera.position.set(2.6, -2.6, 4.6);
  const controls = new OrbitControls(camera);
  controls.enableDamping = false;
  controls.maxDistance = maxDistance;
  const robot = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(size, size, size), new THREE.MeshBasicMaterial());
  mesh.name = 'target';
  robot.add(mesh);
  const desired = computeCameraFrame(mesh, camera, controls.target);
  assert.ok(desired);
  const callbacks = new Set<React.RefObject<RenderCallback>>();
  let invalidations = 0;
  let active = true;
  // The hook only consumes these R3F fields; no WebGL renderer is needed to
  // exercise its real frame subscription and the real OrbitControls limits.
  const store = createWithEqualityFn<RootState>(() => ({
    camera,
    controls,
    invalidate: () => { invalidations += 1; },
    internal: {
      subscribe: (callback: React.RefObject<RenderCallback>) => {
        callbacks.add(callback);
        return () => callbacks.delete(callback);
      },
    },
  } as RootState));
  function Probe() {
    useCameraFocus({ robot, focusTarget: 'target', active });
    return null;
  }
  const render = () => act(() => root.render(
    <r3fContext.Provider value={store}><Probe /></r3fContext.Provider>,
  ));
  context.after(() => {
    act(() => root.unmount());
    controls.dispose();
    mesh.geometry.dispose();
    mesh.material.dispose();
    dom.window.close();
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  });
  render();
  return {
    camera, controls, desired,
    get invalidations() { return invalidations; },
    advance(frames = 1, delta = 1 / 60) {
      for (let frame = 0; frame < frames; frame += 1) {
        callbacks.forEach((callback) => callback.current(store.getState(), delta));
      }
    },
    deactivate() { active = false; render(); },
  };
}

test('reachable camera focus keeps the existing target and settles', (context) => {
  const harness = createFocusHarness(context, 2);
  harness.advance(600);
  assert.ok(harness.camera.position.distanceTo(harness.desired.cameraPosition) < 0.01);
  const before = harness.invalidations;
  harness.advance(60);
  assert.equal(harness.invalidations, before);
});

test('focus stops at the orbit distance limit instead of redrawing an unchanged pose', (context) => {
  const harness = createFocusHarness(context, 2000, 2000);
  harness.advance(600);
  assert.ok(Math.abs(harness.camera.position.distanceTo(harness.controls.target) - 2000) < 1e-8);
  assert.ok(harness.camera.position.distanceTo(harness.desired.cameraPosition) > 1000);
  const before = harness.invalidations;
  const position = harness.camera.position.clone();
  harness.advance(60);
  assert.equal(harness.invalidations, before);
  assert.deepEqual(harness.camera.position, position);
});

test('a zero-delta frame does not cancel camera focus', (context) => {
  const harness = createFocusHarness(context, 2000, 2000);
  harness.advance(1, 0);
  const position = harness.camera.position.clone();
  harness.advance(10);
  assert.ok(harness.camera.position.distanceTo(position) > 1);
});

test('user interaction and deactivation still cancel camera focus', (context) => {
  const harness = createFocusHarness(context, 2000, 2000);
  harness.advance(3);
  harness.controls.dispatchEvent({ type: 'start' });
  const before = harness.invalidations;
  harness.advance(60);
  assert.equal(harness.invalidations, before);
  harness.deactivate();
  harness.advance(60);
  assert.equal(harness.invalidations, before);
});
