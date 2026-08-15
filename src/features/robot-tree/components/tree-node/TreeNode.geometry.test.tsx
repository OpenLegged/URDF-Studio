import assert from 'node:assert/strict';
import test from 'node:test';

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';

import { translations } from '@/shared/i18n';
import { useSelectionStore } from '@/store/selectionStore';
import {
  DEFAULT_JOINT,
  DEFAULT_LINK,
  GeometryType,
  type EntityRef,
  type RobotData,
} from '@/types';
import { TreeNode } from '../TreeNode.tsx';

function createRobot(): RobotData {
  const baseLink = structuredClone(DEFAULT_LINK);
  baseLink.id = 'base_link';
  baseLink.name = 'Base';
  baseLink.visual.type = GeometryType.BOX;
  baseLink.visual.name = 'primary visual';
  baseLink.visualBodies = [{
    ...structuredClone(DEFAULT_LINK.visual),
    type: GeometryType.SPHERE,
    name: 'extra visual',
  }];
  baseLink.collision.type = GeometryType.BOX;
  baseLink.collision.name = 'primary collision';
  baseLink.collisionBodies = [{
    ...structuredClone(DEFAULT_LINK.collision),
    type: GeometryType.SPHERE,
    name: 'extra collision',
  }];
  return {
    name: 'geometry_test',
    rootLinkId: 'base_link',
    links: {
      base_link: baseLink,
      tip_link: { ...structuredClone(DEFAULT_LINK), id: 'tip_link', name: 'Tip' },
    },
    joints: {
      hinge: {
        ...structuredClone(DEFAULT_JOINT),
        id: 'hinge',
        name: 'Hinge',
        parentLinkId: 'base_link',
        childLinkId: 'tip_link',
      },
    },
  };
}

function installDom() {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'http://localhost/',
    pretendToBeVisual: true,
  });
  Object.defineProperties(globalThis, {
    window: { configurable: true, value: dom.window },
    document: { configurable: true, value: dom.window.document },
    navigator: { configurable: true, value: dom.window.navigator },
    HTMLElement: { configurable: true, value: dom.window.HTMLElement },
    Node: { configurable: true, value: dom.window.Node },
    Event: { configurable: true, value: dom.window.Event },
    MouseEvent: { configurable: true, value: dom.window.MouseEvent },
    IS_REACT_ACT_ENVIRONMENT: { configurable: true, value: true },
  });
  const htmlPrototype = dom.window.HTMLElement.prototype as typeof dom.window.HTMLElement.prototype & {
    attachEvent?: () => void;
    detachEvent?: () => void;
  };
  htmlPrototype.attachEvent = () => {};
  htmlPrototype.detachEvent = () => {};
  return dom;
}

function treeProps(robot: RobotData, onUpdate: (ref: EntityRef, patch: unknown) => void) {
  return {
    componentId: 'left',
    linkId: 'base_link',
    robot,
    showGeometryDetailsByDefault: true,
    onAddChild: () => {},
    onAddCollisionBody: () => {},
    onDelete: () => {},
    onUpdate,
    mode: 'editor' as const,
    t: translations.en,
  };
}

async function click(dom: JSDOM, element: Element | null, message: string) {
  assert.ok(element, message);
  await act(async () => {
    element.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

async function openContextMenu(dom: JSDOM, element: Element | null, message: string) {
  assert.ok(element, message);
  await act(async () => {
    element.dispatchEvent(new dom.window.MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: 24,
      clientY: 36,
    }));
  });
}

function getContextMenuItem(label: string): Element | null {
  return Array.from(document.querySelectorAll('[role="menuitem"]'))
    .find((item) => item.textContent?.trim() === label) ?? null;
}

test('geometry context menu renames and deletes only the targeted object index', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container);
  const updates: Array<{ ref: EntityRef; patch: unknown }> = [];
  useSelectionStore.getState().clearSelection();

  try {
    await act(async () => {
      root.render(<TreeNode {...treeProps(createRobot(), (ref, patch) => {
        updates.push({ ref, patch });
      })} />);
    });

    const extraVisual = container.querySelector(
      '[data-testid="tree-geometry-left-base_link-visual-1"]',
    );
    await openContextMenu(dom, extraVisual, 'extra visual context menu');
    assert.ok(getContextMenuItem(translations.en.rename));
    assert.ok(getContextMenuItem(translations.en.deleteVisualGeometry));
    assert.equal(getContextMenuItem(translations.en.addChildLink), null);
    assert.equal(getContextMenuItem(translations.en.deleteBranch), null);
    await click(dom, getContextMenuItem(translations.en.rename), 'rename extra visual');

    const renameInput = container.querySelector<HTMLInputElement>(
      '[aria-label="rename-geometry-left-base_link-visual-1"]',
    );
    assert.ok(renameInput);
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        dom.window.HTMLInputElement.prototype,
        'value',
      )?.set;
      setter?.call(renameInput, 'renamed extra visual');
      renameInput.dispatchEvent(new dom.window.FocusEvent('focusout', { bubbles: true }));
    });

    const renamePatch = updates.at(-1)?.patch as RobotData['links'][string];
    assert.equal(renamePatch.visual.name, 'primary visual');
    assert.equal(renamePatch.visualBodies?.[0]?.name, 'renamed extra visual');

    await openContextMenu(dom, extraVisual, 'extra visual delete context menu');
    await click(
      dom,
      getContextMenuItem(translations.en.deleteVisualGeometry),
      'delete only extra visual',
    );
    const visualDeletePatch = updates.at(-1)?.patch as RobotData['links'][string];
    assert.notEqual(visualDeletePatch.visual.type, GeometryType.NONE);
    assert.deepEqual(visualDeletePatch.visualBodies, []);

    const primaryCollision = container.querySelector(
      '[data-testid="tree-geometry-left-base_link-collision"]',
    );
    await openContextMenu(dom, primaryCollision, 'primary collision context menu');
    await click(
      dom,
      getContextMenuItem(translations.en.deleteCollisionGeometry),
      'delete only primary collision',
    );
    const collisionDeletePatch = updates.at(-1)?.patch as RobotData['links'][string];
    assert.equal(collisionDeletePatch.collision.type, GeometryType.NONE);
    assert.equal(collisionDeletePatch.collisionBodies?.[0]?.name, 'extra collision');
    assert.deepEqual(useSelectionStore.getState().selection, {
      entity: { type: 'link', componentId: 'left', entityId: 'base_link' },
      subType: 'collision',
      objectIndex: 0,
    });
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
  }
});

test('geometry context menu stays unavailable for locked and read-only links', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container);
  const lockedRobot = createRobot();
  lockedRobot.links.base_link!.editorLocked = true;

  try {
    await act(async () => {
      root.render(<TreeNode {...treeProps(lockedRobot, () => {})} />);
    });
    await openContextMenu(
      dom,
      container.querySelector('[data-testid="tree-geometry-left-base_link-visual"]'),
      'locked visual context menu',
    );
    assert.equal(document.querySelector('[role="menu"]'), null);

    await act(async () => {
      root.render(<TreeNode {...treeProps(createRobot(), () => {})} readOnly />);
    });
    await openContextMenu(
      dom,
      container.querySelector('[data-testid="tree-geometry-left-base_link-visual"]'),
      'read-only visual context menu',
    );
    assert.equal(document.querySelector('[role="menu"]'), null);
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
  }
});

test('collapsed link branch reopens only when imported child topology changes', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container);
  const robot = createRobot();

  try {
    await act(async () => {
      root.render(<TreeNode {...treeProps(robot, () => {})} />);
    });
    await click(
      dom,
      container.querySelector('[data-testid="tree-link-left-base_link"] > div > button'),
      'collapse base branch',
    );
    assert.equal(container.querySelector('[data-testid="tree-joint-left-hinge"]'), null);

    const propertyOnlyRobot = structuredClone(robot);
    propertyOnlyRobot.links.base_link!.name = 'renamed base';
    await act(async () => {
      root.render(<TreeNode {...treeProps(propertyOnlyRobot, () => {})} />);
    });
    assert.equal(container.querySelector('[data-testid="tree-joint-left-hinge"]'), null);

    const topologyRobot = structuredClone(propertyOnlyRobot);
    topologyRobot.links.imported_tip = {
      ...structuredClone(DEFAULT_LINK),
      id: 'imported_tip',
      name: 'Imported tip',
    };
    topologyRobot.joints.imported_hinge = {
      ...structuredClone(DEFAULT_JOINT),
      id: 'imported_hinge',
      name: 'Imported hinge',
      parentLinkId: 'base_link',
      childLinkId: 'imported_tip',
    };
    await act(async () => {
      root.render(<TreeNode {...treeProps(topologyRobot, () => {})} />);
    });
    assert.ok(container.querySelector('[data-testid="tree-joint-left-hinge"]'));
    assert.ok(container.querySelector('[data-testid="tree-joint-left-imported_hinge"]'));
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
  }
});
