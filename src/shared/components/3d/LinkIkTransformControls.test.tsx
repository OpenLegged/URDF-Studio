import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { advance, createRoot, type RootStore } from '@react-three/fiber';
import { JSDOM } from 'jsdom';
import * as THREE from 'three';

import { LinkIkTransformControls } from './LinkIkTransformControls';

test('disabled IK controls leave the R3F scene renderer running', async (context) => {
  const dom = new JSDOM('<canvas></canvas>');
  const canvas = dom.window.document.querySelector('canvas');
  assert.ok(canvas);
  const previousActEnvironment = Object.getOwnPropertyDescriptor(
    globalThis,
    'IS_REACT_ACT_ENVIRONMENT',
  );
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
    value: true,
    configurable: true,
    writable: true,
  });

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  const geometry = new THREE.BoxGeometry();
  const material = new THREE.MeshBasicMaterial();
  const mesh = new THREE.Mesh(geometry, material);
  const render = context.mock.fn((_scene: THREE.Scene, _camera: THREE.Camera) => undefined);
  // Use the real R3F reconciler, subscriptions and frame loop. Only the WebGL
  // renderer is replaced so this test can observe which scene gets drawn.
  const renderer = {
    render,
    setSize: () => undefined,
    setPixelRatio: () => undefined,
  };
  const root = createRoot(canvas);
  const rendered: { store: RootStore | null } = { store: null };

  try {
    await root.configure({
      gl: renderer,
      scene,
      camera,
      frameloop: 'never',
      size: { width: 640, height: 480, top: 0, left: 0 },
    });
    await act(async () => {
      rendered.store = root.render(<primitive object={mesh} />);
    });
    assert.ok(rendered.store);
    advance(0, false, rendered.store.getState());
    assert.equal(render.mock.callCount(), 1, 'the scene renders before mounting IK controls');
    assert.ok(scene.children.includes(mesh));

    await act(async () => {
      root.render(
        <>
          <primitive object={mesh} />
          <LinkIkTransformControls
            enabled={false}
            selectedLinkId={null}
            selectedHandle={null}
            coordinateRoot={null}
            ikRobotState={null}
          />
        </>,
      );
    });
    render.mock.resetCalls();
    advance(1 / 60, false, rendered.store.getState());

    assert.equal(render.mock.callCount(), 1, 'disabled controls must not suppress the canvas draw');
    assert.equal(render.mock.calls[0]!.arguments[0], scene);
    assert.equal(render.mock.calls[0]!.arguments[1], camera);

    await act(async () => {
      root.render(<primitive object={mesh} />);
    });
    render.mock.resetCalls();
    advance(2 / 60, false, rendered.store.getState());
    assert.equal(render.mock.callCount(), 1, 'the scene keeps rendering after controls unmount');
  } finally {
    await act(async () => root.unmount());
    geometry.dispose();
    material.dispose();
    dom.window.close();
    if (previousActEnvironment) {
      Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', previousActEnvironment);
    } else {
      Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
    }
  }
});
