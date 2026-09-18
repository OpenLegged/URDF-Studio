import assert from 'node:assert/strict';
import test from 'node:test';

import { JSDOM } from 'jsdom';
import React, { act, useLayoutEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import * as THREE from 'three';

import type { InteractionSelection } from '@/types/index';
import { usePointerInteractionTargets } from './usePointerInteractionTargets';

function installDom() {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const originalHTMLElement = globalThis.HTMLElement;
  const originalActEnvironment = (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
    .IS_REACT_ACT_ENVIRONMENT;
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');

  Object.defineProperty(globalThis, 'window', { configurable: true, value: dom.window });
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: dom.window.document,
  });
  Object.defineProperty(globalThis, 'HTMLElement', {
    configurable: true,
    value: dom.window.HTMLElement,
  });
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
    configurable: true,
    value: true,
  });

  return {
    rootElement: dom.window.document.getElementById('root') as HTMLElement,
    restore() {
      dom.window.close();
      Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow });
      Object.defineProperty(globalThis, 'document', {
        configurable: true,
        value: originalDocument,
      });
      Object.defineProperty(globalThis, 'HTMLElement', {
        configurable: true,
        value: originalHTMLElement,
      });
      Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
        configurable: true,
        value: originalActEnvironment,
      });
    },
  };
}

function createGizmo(name: string) {
  const gizmo = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  gizmo.name = name;
  gizmo.userData.isGizmo = true;
  return gizmo;
}

test('gizmo target callback stays stable and sees selection changes before passive effects', async () => {
  const dom = installDom();
  const root = createRoot(dom.rootElement);
  const scene = new THREE.Scene();
  const firstGizmo = createGizmo('first');
  const secondGizmo = createGizmo('second');
  scene.add(firstGizmo);

  const callbackIdentities: Array<() => THREE.Object3D[]> = [];
  const targetSnapshots: THREE.Object3D[][] = [];

  function Harness({ selection }: { selection: InteractionSelection }) {
    const linkMeshMapRef = useRef(new Map<string, THREE.Mesh[]>());
    const { getGizmoTargets } = usePointerInteractionTargets({
      robot: null,
      robotVersion: 0,
      scene,
      toolMode: 'select',
      mode: 'editor',
      selection,
      showCollision: false,
      showVisual: true,
      showCollisionAlwaysOnTop: false,
      linkMeshMapRef,
    });

    callbackIdentities.push(getGizmoTargets);
    useLayoutEffect(() => {
      targetSnapshots.push(getGizmoTargets());
    }, [getGizmoTargets, selection]);
    return null;
  }

  try {
    await act(async () => {
      root.render(<Harness selection={{ type: null, id: null }} />);
    });
    assert.deepEqual(targetSnapshots.at(-1), [firstGizmo]);

    scene.remove(firstGizmo);
    scene.add(secondGizmo);
    await act(async () => {
      root.render(<Harness selection={{ type: 'link', id: 'arm' }} />);
    });

    assert.equal(callbackIdentities[1], callbackIdentities[0]);
    assert.deepEqual(
      targetSnapshots.at(-1),
      [secondGizmo],
      'the layout phase must not observe the previous selection cache key',
    );
  } finally {
    await act(async () => root.unmount());
    firstGizmo.geometry.dispose();
    (firstGizmo.material as THREE.Material).dispose();
    secondGizmo.geometry.dispose();
    (secondGizmo.material as THREE.Material).dispose();
    dom.restore();
  }
});
