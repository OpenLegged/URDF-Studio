import assert from 'node:assert/strict';
import test from 'node:test';

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { JSDOM } from 'jsdom';

import { MeasurePanel } from './MeasurePanel';
import {
  applyMeasurePick,
  clearMeasureState,
  createEmptyMeasureState,
  createMeasureTarget,
} from '../utils/measurements';
import * as THREE from 'three';

function installDom() {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'http://localhost/',
    pretendToBeVisual: true,
  });

  (globalThis as { window?: Window }).window = dom.window as unknown as Window;
  (globalThis as { document?: Document }).document = dom.window.document;
  Object.defineProperty(globalThis, 'navigator', {
    value: dom.window.navigator,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'localStorage', {
    value: dom.window.localStorage,
    configurable: true,
  });

  (globalThis as { HTMLElement?: typeof HTMLElement }).HTMLElement = dom.window.HTMLElement;
  (globalThis as { HTMLInputElement?: typeof HTMLInputElement }).HTMLInputElement =
    dom.window.HTMLInputElement;
  (globalThis as { Node?: typeof Node }).Node = dom.window.Node;
  (globalThis as { Event?: typeof Event }).Event = dom.window.Event;
  (globalThis as { MouseEvent?: typeof MouseEvent }).MouseEvent = dom.window.MouseEvent;
  (globalThis as { PointerEvent?: typeof PointerEvent }).PointerEvent =
    dom.window.PointerEvent ?? dom.window.MouseEvent;
  (globalThis as { getComputedStyle?: typeof getComputedStyle }).getComputedStyle =
    dom.window.getComputedStyle.bind(dom.window);
  (globalThis as { requestAnimationFrame?: typeof requestAnimationFrame }).requestAnimationFrame =
    dom.window.requestAnimationFrame.bind(dom.window);
  (globalThis as { cancelAnimationFrame?: typeof cancelAnimationFrame }).cancelAnimationFrame =
    dom.window.cancelAnimationFrame.bind(dom.window);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

  return dom;
}

function createComponentRoot() {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');

  const root = createRoot(container);
  return { dom, container, root };
}

function createCompletedMeasureState() {
  const firstPose = new THREE.Matrix4().makeTranslation(1, 2, 3);
  const secondPose = new THREE.Matrix4().makeRotationZ(Math.PI / 2).setPosition(4, 6, 3);

  return applyMeasurePick(
    applyMeasurePick(
      createEmptyMeasureState(),
      createMeasureTarget({
        linkName: 'base_link',
        objectType: 'visual',
        objectIndex: 0,
        point: new THREE.Vector3(1, 2, 3),
        poseWorldMatrix: firstPose,
      }),
    ),
    createMeasureTarget({
      linkName: 'tool_link',
      objectType: 'visual',
      objectIndex: 0,
      point: new THREE.Vector3(4, 6, 3),
      poseWorldMatrix: secondPose,
    }),
  );
}

async function renderPanel(
  root: Root,
  measureState = clearMeasureState(),
  measureMode: 'object' | 'point' = 'object',
) {
  await act(async () => {
    root.render(
      React.createElement(MeasurePanel, {
        toolMode: 'measure',
        measurePanelRef: { current: null },
        measurePanelPos: null,
        onMouseDown: () => {},
        onClose: () => {},
        measureState,
        setMeasureState: () => {},
        measureMode,
        setMeasureMode: () => {},
        measureAnchorMode: 'frame',
        setMeasureAnchorMode: () => {},
        showMeasureDecomposition: false,
        setShowMeasureDecomposition: () => {},
        measurePoseRepresentation: 'matrix',
        setMeasurePoseRepresentation: () => {},
        lang: 'zh',
      }),
    );
  });
}

test('MeasurePanel keeps the snap selector compact and drops the verbose helper copy', async () => {
  const { dom, container, root } = createComponentRoot();

  await renderPanel(root);

  assert.equal(
    container.textContent?.includes(
      '可选择吸附到 link frame / TF 原点、质心，或几何中心来测量距离',
    ),
    false,
    'measure panel should not render the old explanatory sentence',
  );
  assert.equal(container.textContent?.includes('锚点'), true);

  const anchorSelect = container.querySelector(
    'select[aria-label="锚点"]',
  ) as HTMLSelectElement | null;
  assert.ok(anchorSelect, 'measure panel should render a compact anchor selector');
  const anchorCombobox = container.querySelector('button[role="combobox"][aria-label="锚点"]');
  assert.ok(anchorCombobox, 'measure panel should render a visible custom combobox trigger');
  assert.deepEqual(
    Array.from(anchorSelect.options).map((option) => option.textContent?.trim()),
    ['原点', '质心', '几何中心'],
  );
  assert.match(
    anchorCombobox.className,
    /h-\[21px\]/,
    'anchor selector should use the shared dense panel select height',
  );
  assert.match(
    anchorCombobox.className,
    /\btext-ui-caption\b/,
    'anchor selector should inherit the shared dense panel select typography',
  );

  await act(async () => {
    root.unmount();
  });
  dom.window.close();
});

test('MeasurePanel renders relative transform representation options for completed measurements', async () => {
  const { dom, container, root } = createComponentRoot();

  await renderPanel(root, createCompletedMeasureState());

  assert.equal(container.textContent?.includes('相对位姿'), true);
  assert.equal(container.textContent?.includes('base_link → tool_link'), true);
  const poseSelect = container.querySelector(
    'select[aria-label="相对位姿"]',
  ) as HTMLSelectElement | null;
  assert.ok(
    poseSelect,
    'relative transform section should render a compact representation selector',
  );
  assert.deepEqual(
    Array.from(poseSelect.options).map((option) => option.textContent?.trim()),
    ['矩阵', 'RPY', '四元数', '轴角'],
  );
  const poseCombobox = container.querySelector('button[role="combobox"][aria-label="相对位姿"]');
  assert.ok(poseCombobox, 'relative transform section should use the shared panel select trigger');
  assert.match(
    poseCombobox.className,
    /\btext-ui-caption\b/,
    'relative transform selector should inherit the shared dense panel select typography',
  );
  assert.equal(container.textContent?.includes('相对平移'), true);

  await act(async () => {
    root.unmount();
  });
  dom.window.close();
});

test('MeasurePanel hides object-only controls in point mode and offers a mode switch', async () => {
  const { dom, container, root } = createComponentRoot();

  await renderPanel(root, clearMeasureState('point'), 'point');

  // Mode switch renders both options.
  assert.equal(container.textContent?.includes('点到点'), true);
  assert.equal(container.textContent?.includes('对象测量'), true);

  // Anchor mode and relative transform are object-only concepts.
  assert.equal(
    container.querySelector('select[aria-label="锚点"]'),
    null,
    'point mode should not render the anchor selector',
  );
  assert.equal(
    container.textContent?.includes('相对位姿'),
    false,
    'point mode should not render the relative transform section',
  );

  // Empty point slots prompt for a viewport surface click.
  assert.equal(container.textContent?.includes('在视图中点击一个曲面点'), true);

  await act(async () => {
    root.unmount();
  });
  dom.window.close();
});
