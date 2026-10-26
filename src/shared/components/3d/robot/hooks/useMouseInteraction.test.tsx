import assert from 'node:assert/strict';
import test from 'node:test';

import { context as r3fContext } from '@react-three/fiber';
import { JSDOM } from 'jsdom';
import React, { act, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import * as THREE from 'three';
import { create } from 'zustand';

import type { InteractionSelection } from '@/types/index';
import { useMouseInteraction } from './useMouseInteraction';

function installDom() {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const originalHTMLElement = globalThis.HTMLElement;
  const originalActEnvironment = (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
    .IS_REACT_ACT_ENVIRONMENT;
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    pretendToBeVisual: true,
  });

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

const rayIntersectsBoundingBox = () => true;
const highlightGeometry = () => {};

test('selection and unrelated rerenders do not reinstall the pointer interaction lifecycle', async () => {
  const dom = installDom();
  const root = createRoot(dom.rootElement);
  const canvas = dom.rootElement.ownerDocument.createElement('canvas');
  Object.defineProperties(canvas, {
    clientWidth: { configurable: true, value: 200 },
    clientHeight: { configurable: true, value: 200 },
  });

  let mouseDownAdds = 0;
  let mouseDownRemoves = 0;
  const originalAddEventListener = canvas.addEventListener.bind(canvas);
  const originalRemoveEventListener = canvas.removeEventListener.bind(canvas);
  Object.defineProperty(canvas, 'addEventListener', {
    configurable: true,
    value: ((
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | AddEventListenerOptions,
    ) => {
      if (type === 'mousedown') mouseDownAdds += 1;
      originalAddEventListener(type, listener, options);
    }) satisfies typeof canvas.addEventListener,
  });
  Object.defineProperty(canvas, 'removeEventListener', {
    configurable: true,
    value: ((
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | EventListenerOptions,
    ) => {
      if (type === 'mousedown') mouseDownRemoves += 1;
      originalRemoveEventListener(type, listener, options);
    }) satisfies typeof canvas.removeEventListener,
  });

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  const controls = { enabled: true };
  const r3fStore = create(() => ({
    camera,
    controls,
    gl: { domElement: canvas },
    invalidate: () => {},
    scene,
  }));

  function Harness({
    selection,
    renderToken,
  }: {
    selection: InteractionSelection;
    renderToken: number;
  }) {
    const linkMeshMapRef = useRef(new Map<string, THREE.Mesh[]>());
    void renderToken;
    useMouseInteraction({
      robot: null,
      robotVersion: 0,
      toolMode: 'select',
      mode: 'editor',
      showCollision: false,
      showVisual: true,
      showCollisionAlwaysOnTop: false,
      linkMeshMapRef,
      selection,
      rayIntersectsBoundingBox,
      highlightGeometry,
    });
    return null;
  }

  const render = async (selection: InteractionSelection, renderToken: number) => {
    await act(async () => {
      root.render(
        <r3fContext.Provider value={r3fStore as unknown as React.ContextType<typeof r3fContext>}>
          <Harness selection={selection} renderToken={renderToken} />
        </r3fContext.Provider>,
      );
    });
  };

  try {
    await render({ type: null, id: null }, 0);
    assert.equal(mouseDownAdds, 1);
    assert.equal(mouseDownRemoves, 0);

    await render({ type: 'link', id: 'arm' }, 1);
    await render({ type: 'link', id: 'arm' }, 2);

    assert.equal(mouseDownAdds, 1, 'the main interaction effect should remain mounted');
    assert.equal(mouseDownRemoves, 0, 'active drag state must not be disposed by rerenders');
  } finally {
    await act(async () => root.unmount());
    dom.restore();
  }
});

type InteractionCallbacks = Pick<
  Parameters<typeof useMouseInteraction>[0],
  'onSelect' | 'onHover' | 'onMeshSelect' | 'onPaintFace'
>;

/** Real geometry hits exercise the native pointer lifecycle and its final commit. */
async function mountDirectDragHarness() {
  const dom = installDom();
  const root = createRoot(dom.rootElement);
  const canvas = document.createElement('canvas');
  document.body.appendChild(canvas);
  Object.defineProperties(canvas, {
    clientWidth: { value: 200 },
    clientHeight: { value: 200 },
  });
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-2, 2, 2, -2, 0.1, 100);
  camera.position.z = 5;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  const robot = new THREE.Group();
  const joint = Object.assign(new THREE.Group(), {
    name: 'joint_a',
    isURDFJoint: true,
    jointType: 'revolute',
    angle: 0,
    axis: new THREE.Vector3(0, 0, 1),
    limit: { lower: -Math.PI, upper: Math.PI },
    setJointValue(angle: number) {
      joint.angle = angle;
      joint.rotation.z = angle;
      joint.updateMatrixWorld(true);
    },
  });
  const link = Object.assign(new THREE.Group(), { name: 'link_a', isURDFLink: true });
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 0.25, 0.25),
    new THREE.MeshBasicMaterial(),
  );
  mesh.position.x = 0.6;
  link.add(mesh);
  joint.add(link);
  robot.add(joint);
  scene.add(robot);
  scene.updateMatrixWorld(true);
  const linkMeshMapRef = { current: new Map([['link_a:visual', [mesh]]]) };
  const previews: Array<[string, number]> = [];
  const commits: Array<[string, number]> = [];
  const onJointChange = (name: string, angle: number) => { previews.push([name, angle]); };
  const onJointChangeCommit = (name: string, angle: number) => { commits.push([name, angle]); };
  const r3fStore = create(() => ({
    camera,
    controls: { enabled: true },
    gl: { domElement: canvas },
    invalidate: () => {},
    scene,
  }));
  let interaction: ReturnType<typeof useMouseInteraction> | undefined;
  let unmounted = false;

  function Harness({
    callbacks,
    toolMode,
  }: {
    callbacks: InteractionCallbacks;
    toolMode: Parameters<typeof useMouseInteraction>[0]['toolMode'];
  }) {
    interaction = useMouseInteraction({
      robot,
      robotVersion: 0,
      toolMode,
      mode: 'editor',
      showCollision: false,
      showVisual: true,
      showCollisionAlwaysOnTop: false,
      linkMeshMapRef,
      rayIntersectsBoundingBox,
      highlightGeometry,
      onJointChange,
      onJointChangeCommit,
      ...callbacks,
    });
    return null;
  }

  return {
    joint,
    previews,
    commits,
    interaction() {
      assert.ok(interaction, 'interaction hook should be mounted');
      return interaction;
    },
    async render(
      callbacks: InteractionCallbacks,
      toolMode: Parameters<typeof useMouseInteraction>[0]['toolMode'] = 'select',
    ) {
      await act(async () => {
        root.render(
          <r3fContext.Provider value={r3fStore as unknown as React.ContextType<typeof r3fContext>}>
            <Harness callbacks={callbacks} toolMode={toolMode} />
          </r3fContext.Provider>,
        );
      });
    },
    async dispatch(type: string, x = 130, y = 100) {
      await act(async () => {
        const event = new window.MouseEvent(type, {
          bubbles: true,
          clientX: x,
          clientY: y,
          button: 0,
          buttons: type === 'mouseup' ? 0 : 1,
        });
        Object.defineProperties(event, { offsetX: { value: x }, offsetY: { value: y } });
        canvas.dispatchEvent(event);
      });
    },
    async unmount() {
      if (!unmounted) {
        await act(async () => root.unmount());
        unmounted = true;
      }
    },
    async dispose() {
      if (!unmounted) await act(async () => root.unmount());
      mesh.geometry.dispose();
      mesh.material.dispose();
      dom.restore();
    },
  };
}

for (const callbackName of ['onSelect', 'onHover', 'onMeshSelect', 'onPaintFace'] as const) {
  test(`replacing ${callbackName} during a direct joint drag preserves its final commit`, async () => {
    const harness = await mountDirectDragHarness();
    try {
      await harness.render({ [callbackName]: () => {} });
      await harness.dispatch('mousedown');
      assert.equal(harness.interaction().isDraggingJoint.current, true);
      await harness.dispatch('pointermove', 130, 90);
      assert.ok(harness.previews.length > 0, 'real pointer movement should publish a preview');
      assert.ok(Math.abs(harness.joint.angle) > 0.01);
      assert.equal(harness.commits.length, 0, 'preview must not prematurely commit');

      await harness.render({ [callbackName]: () => {} });
      assert.equal(
        harness.interaction().isDraggingJoint.current,
        true,
        'callback replacement must not dispose the active gesture',
      );
      await harness.dispatch('pointermove', 130, 85);
      await harness.dispatch('mouseup', 130, 85);
      assert.equal(harness.commits.length, 1, 'pointerup should commit exactly once');
      assert.equal(harness.commits[0]?.[0], 'joint_a');
      assert.ok(Math.abs(harness.commits[0]![1] - harness.joint.angle) < 1e-6);
      assert.equal(harness.interaction().isDraggingJoint.current, false);
    } finally {
      await harness.dispose();
    }
  });
}

for (const callbackName of ['onSelect', 'onHover', 'onMeshSelect', 'onPaintFace'] as const) {
  test(`native pointer handlers use the latest ${callbackName}`, async () => {
    const harness = await mountDirectDragHarness();
    let oldCalls = 0;
    let latestCalls = 0;
    const toolMode = callbackName === 'onPaintFace' ? 'paint' : 'select';
    try {
      await harness.render({ [callbackName]: () => { oldCalls += 1; } }, toolMode);
      await harness.render({ [callbackName]: () => { latestCalls += 1; } }, toolMode);
      if (callbackName === 'onHover') {
        harness.interaction().hoveredLinkRef.current = 'link_a';
        await harness.dispatch('mouseleave');
      } else {
        await harness.dispatch('mousedown');
        await harness.dispatch('mouseup');
      }
      assert.equal(oldCalls, 0);
      assert.ok(latestCalls > 0, 'the replacement callback should receive the next native event');
    } finally {
      await harness.dispose();
    }
  });
}

test('removing onMeshSelect preserves the onSelect fallback for geometry selection', async () => {
  const harness = await mountDirectDragHarness();
  let meshSelections = 0;
  let fallbackSelections = 0;
  const onSelect = () => { fallbackSelections += 1; };
  try {
    await harness.render({ onSelect, onMeshSelect: () => { meshSelections += 1; } });
    await harness.dispatch('mousedown');
    await harness.dispatch('mouseup');
    assert.equal(meshSelections, 1);
    assert.equal(fallbackSelections, 0);
    await harness.render({ onSelect });
    await harness.dispatch('mousedown');
    await harness.dispatch('mouseup');
    assert.equal(meshSelections, 1);
    assert.equal(fallbackSelections, 1);
  } finally {
    await harness.dispose();
  }
});

test('unmounting an active direct joint drag does not commit it into a different document', async () => {
  const harness = await mountDirectDragHarness();
  try {
    await harness.render({});
    await harness.dispatch('mousedown');
    await harness.dispatch('pointermove', 130, 90);
    assert.ok(harness.previews.length > 0);
    assert.equal(harness.interaction().isDraggingJoint.current, true);
    await harness.unmount();
    assert.equal(harness.interaction().isDraggingJoint.current, false);
    await harness.dispatch('mouseup', 130, 90);
    assert.equal(harness.commits.length, 0);
  } finally {
    await harness.dispose();
  }
});
