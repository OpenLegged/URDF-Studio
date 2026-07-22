import assert from 'node:assert/strict';
import test from 'node:test';

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';

import { createSingleComponentWorkspace } from '@/core/robot';
import { translations } from '@/shared/i18n';
import { useSelectionStore } from '@/store/selectionStore';
import {
  DEFAULT_JOINT,
  DEFAULT_LINK,
  GeometryType,
  JointType,
  type AssemblyState,
  type EntityRef,
  type RobotData,
  type WorkspaceSelection,
} from '@/types';
import { AssemblyTreeView, type AssemblyTreeViewProps } from './AssemblyTreeView.tsx';

function createRobot(owner: string): RobotData {
  return {
    name: `${owner}_source_name`,
    rootLinkId: 'base_link',
    links: {
      base_link: {
        ...structuredClone(DEFAULT_LINK),
        id: 'base_link',
        name: `${owner} base display`,
        visualBodies: [{
          ...structuredClone(DEFAULT_LINK.visual),
          type: GeometryType.BOX,
        }],
        collisionBodies: [{
          ...structuredClone(DEFAULT_LINK.collision),
          type: GeometryType.SPHERE,
        }],
      },
      tip_link: { ...DEFAULT_LINK, id: 'tip_link', name: `${owner} tip display` },
    },
    joints: {
      hinge: {
        ...DEFAULT_JOINT,
        id: 'hinge',
        name: `${owner} hinge display`,
        type: JointType.REVOLUTE,
        parentLinkId: 'base_link',
        childLinkId: 'tip_link',
      },
    },
    inspectionContext: {
      sourceFormat: 'mjcf',
      mjcf: {
        siteCount: 0,
        tendonCount: 1,
        tendonActuatorCount: 0,
        bodiesWithSites: [],
        tendons: [{
          name: 'shared_tendon',
          type: 'fixed',
          className: owner,
          width: 0.01,
          rgba: [1, 1, 1, 1],
          attachmentRefs: ['hinge'],
          attachments: [{ type: 'joint', ref: 'hinge', coef: 1 }],
          actuatorNames: [],
        }],
      },
    },
  };
}

function createWorkspace(multi = false): AssemblyState {
  const workspace = createSingleComponentWorkspace(createRobot('left'), {
    workspaceName: 'Assembly display',
    componentId: 'left',
    componentName: 'Left instance',
    sourceFile: null,
  });
  if (!multi) return workspace;

  workspace.components.right = createSingleComponentWorkspace(createRobot('right'), {
    componentId: 'right',
    componentName: 'Right instance',
    sourceFile: null,
  }).components.right;
  workspace.bridges.mount = {
    id: 'mount',
    name: 'Mount bridge',
    parentComponentId: 'left',
    parentLinkId: 'base_link',
    childComponentId: 'right',
    childLinkId: 'base_link',
    joint: {
      ...DEFAULT_JOINT,
      id: 'mount',
      name: 'mount_joint',
      type: JointType.FIXED,
      parentLinkId: 'base_link',
      childLinkId: 'base_link',
    },
  };
  return workspace;
}

function baseProps(
  workspace: AssemblyState,
  overrides: Partial<AssemblyTreeViewProps> = {},
): AssemblyTreeViewProps {
  return {
    workspace,
    onAddChild: () => {},
    onAddCollisionBody: () => {},
    onDelete: () => {},
    onUpdate: () => {},
    mode: 'editor',
    t: translations.en,
    ...overrides,
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

async function activateWithKey(
  dom: JSDOM,
  element: Element | null,
  key: 'Enter' | ' ',
  message: string,
) {
  assert.ok(element, message);
  await act(async () => {
    element.dispatchEvent(new dom.window.KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key,
    }));
  });
}

test('single component renders the legacy robot root without exposing a component layer', () => {
  const markup = renderToStaticMarkup(
    React.createElement(AssemblyTreeView, baseProps(createWorkspace())),
  );

  assert.match(markup, /data-simplified="true"/);
  assert.doesNotMatch(markup, /data-testid="assembly-tree-root"/);
  assert.doesNotMatch(markup, /data-testid="assembly-tree-bridges"/);
  assert.doesNotMatch(markup, /data-testid="tree-component-left"/);
  assert.match(markup, /data-testid="tree-robot-root-left"/);
  assert.match(markup, /rounded-md bg-element-bg px-2 py-1/);
  assert.match(markup, /Left instance/);
  assert.match(markup, /data-testid="tree-link-left-base_link"/);
  assert.match(markup, /data-testid="tree-tendon-left-shared_tendon"/);
});

test('multi-component tree keeps full assembly, component and bridge hierarchy', () => {
  const markup = renderToStaticMarkup(
    React.createElement(AssemblyTreeView, baseProps(createWorkspace(true))),
  );

  assert.match(markup, /data-simplified="false"/);
  assert.match(markup, /data-testid="assembly-tree-root"/);
  assert.match(markup, /data-testid="tree-component-left"/);
  assert.match(markup, /data-testid="tree-component-right"/);
  assert.match(markup, /data-testid="assembly-tree-bridges"/);
  assert.match(markup, /data-testid="tree-bridge-mount"/);
});

test('multi-component and bridge rows retain the legacy polished presentation', () => {
  const markup = renderToStaticMarkup(
    React.createElement(AssemblyTreeView, baseProps(createWorkspace(true), {
      onCreateBridge: () => {},
    })),
  );
  const dom = new JSDOM(markup);
  const document = dom.window.document;
  const componentRow = document.querySelector('[data-testid="tree-component-left"] > div');
  const bridgeSection = document.querySelector('[data-testid="assembly-tree-bridges"] > div');

  assert.ok(componentRow, 'component row');
  assert.match(componentRow.className, /\brounded-md\b/);
  assert.match(componentRow.className, /\btransition-all\b/);
  assert.match(componentRow.className, /\bhover:bg-element-hover\/80\b/);
  assert.doesNotMatch(componentRow.className, /\bhover:bg-system-blue\/10\b/);
  assert.ok(
    componentRow.querySelector(`[title="${translations.en.bridgedComponentLockedHint}"]`),
    'bridged component should keep its connected-lock status icon',
  );
  assert.ok(bridgeSection, 'bridge section header');
  assert.match(bridgeSection.className, /\brounded-md\b/);
  assert.ok(
    bridgeSection.querySelector(`button[title="${translations.en.createBridge}"]`),
    'bridge section should keep the responsive create action',
  );

  dom.window.close();
});

test('link, joint, and geometry rows keep legacy icons, connectors, visibility, and i18n', () => {
  const markup = renderToStaticMarkup(
    React.createElement(AssemblyTreeView, baseProps(createWorkspace(), {
      showGeometryDetailsByDefault: true,
      t: translations.zh,
    })),
  );
  const dom = new JSDOM(markup);
  const document = dom.window.document;
  const linkRow = document.querySelector('[data-testid="tree-link-left-base_link"] > div');
  const jointRow = document.querySelector('[data-testid="tree-joint-left-hinge"]');

  assert.match(markup, /data-testid="tree-connector-rail-left-base_link"/);
  assert.match(markup, /lucide-shapes/);
  assert.match(markup, /lucide-shield/);
  assert.match(markup, /lucide-rotate-cw/);
  assert.match(markup, /可视化几何/);
  assert.match(markup, /碰撞体/);
  assert.doesNotMatch(markup, />visual(?: \d+)?</);
  assert.doesNotMatch(markup, />collision(?: \d+)?</);
  assert.match(markup, /aria-label="toggle-link-visibility-left-base_link"/);
  assert.match(markup, /aria-label="toggle-link-editor-lock-left-base_link"/);
  assert.match(markup, /aria-label="toggle-geometry-visibility-left-base_link-visual-0"/);
  assert.match(markup, /aria-label="toggle-geometry-visibility-left-base_link-collision-0"/);
  assert.ok(linkRow, 'link row');
  assert.ok(jointRow, 'joint row');
  assert.match(linkRow.className, /\bhover:bg-element-hover\/80\b/);
  assert.match(jointRow.className, /\bhover:bg-element-hover\/80\b/);
  assert.doesNotMatch(linkRow.className, /\bhover:bg-system-blue\/10\b/);
  assert.doesNotMatch(jointRow.className, /\bhover:bg-system-blue\/10\b/);
  dom.window.close();
});

test('legacy visibility controls keep canonical component ownership', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container);
  const updates: Array<{ ref: EntityRef; patch: unknown }> = [];
  useSelectionStore.getState().clearSelection();

  try {
    await act(async () => {
      root.render(React.createElement(AssemblyTreeView, baseProps(createWorkspace(), {
        showGeometryDetailsByDefault: true,
        onUpdate: (ref, patch) => updates.push({ ref, patch }),
      })));
    });

    await click(
      dom,
      container.querySelector('[aria-label="toggle-link-visibility-left-base_link"]'),
      'link visibility',
    );
    await click(
      dom,
      container.querySelector(
        '[aria-label="toggle-geometry-visibility-left-base_link-visual-0"]',
      ),
      'visual visibility',
    );
    await click(
      dom,
      container.querySelector(
        '[aria-label="toggle-geometry-visibility-left-base_link-collision-0"]',
      ),
      'collision visibility',
    );

    assert.deepEqual(
      updates.map(({ ref }) => ref),
      Array.from({ length: 3 }, () => ({
        type: 'link',
        componentId: 'left',
        entityId: 'base_link',
      })),
    );
    assert.deepEqual(updates[0]?.patch, { visible: false });
    assert.deepEqual(updates[1]?.patch, { visual: { visible: false } });
    assert.deepEqual(updates[2]?.patch, { collision: { visible: false } });
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
  }
});

test('editor locks sit beside visibility and keep tree selection available', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container);
  const updates: Array<{ ref: EntityRef; patch: unknown }> = [];
  const selections: WorkspaceSelection[] = [];

  try {
    await act(async () => {
      root.render(React.createElement(AssemblyTreeView, baseProps(createWorkspace(), {
        onSelect: (selection) => selections.push(selection),
        onUpdate: (ref, patch) => updates.push({ ref, patch }),
      })));
    });

    const linkVisibility = container.querySelector(
      '[aria-label="toggle-link-visibility-left-base_link"]',
    );
    const linkLock = container.querySelector(
      '[aria-label="toggle-link-editor-lock-left-base_link"]',
    );
    assert.ok(linkVisibility);
    assert.ok(linkLock);
    assert.equal(
      linkVisibility.compareDocumentPosition(linkLock) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING,
      dom.window.Node.DOCUMENT_POSITION_FOLLOWING,
      'lock should render immediately after the eye control',
    );

    await click(dom, linkLock, 'link editor lock');
    assert.deepEqual(updates.at(-1), {
      ref: { type: 'link', componentId: 'left', entityId: 'base_link' },
      patch: { editorLocked: true },
    });
    assert.equal(selections.length, 0, 'lock button must not activate the tree row');

    await click(
      dom,
      container.querySelector('[aria-label="toggle-component-editor-lock-left"]'),
      'component editor lock',
    );
    assert.deepEqual(updates.at(-1), {
      ref: { type: 'component', componentId: 'left' },
      patch: { editorLocked: true },
    });
    assert.equal(selections.length, 0, 'component lock button must not activate the root row');
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
  }
});

test('a locked link protects its subtree while keeping inspection and unlock controls', () => {
  const workspace = createWorkspace();
  workspace.components.left!.robot.links.base_link!.editorLocked = true;
  const markup = renderToStaticMarkup(
    React.createElement(AssemblyTreeView, baseProps(workspace, {
      showGeometryDetailsByDefault: true,
    })),
  );
  const dom = new JSDOM(markup);
  const document = dom.window.document;
  const rootRow = document.querySelector('[data-testid="tree-link-left-base_link"] > div');
  const rootLock = document.querySelector<HTMLButtonElement>(
    '[aria-label="toggle-link-editor-lock-left-base_link"]',
  );
  const childLock = document.querySelector<HTMLButtonElement>(
    '[aria-label="toggle-link-editor-lock-left-tip_link"]',
  );

  assert.equal(rootRow?.getAttribute('role'), 'button');
  assert.equal(rootLock?.getAttribute('aria-pressed'), 'true');
  assert.equal(rootLock?.disabled, false, 'the authored lock remains available for unlocking');
  assert.equal(childLock?.disabled, true, 'descendants inherit the parent lock');
  assert.equal(childLock?.title, translations.en.editingLockedByAncestor);
  assert.ok(document.querySelector('[aria-label="toggle-link-visibility-left-base_link"]'));
  assert.equal(
    document.querySelector('[aria-label="toggle-geometry-visibility-left-base_link-visual-0"]'),
    null,
  );
  assert.equal(document.querySelector('[aria-label="add-collision-left-base_link"]'), null);

  dom.window.close();
});

test('read-only tree keeps disclosure controls but removes selection and mutation affordances', () => {
  const markup = renderToStaticMarkup(
    React.createElement(AssemblyTreeView, baseProps(createWorkspace(), {
      readOnly: true,
      showGeometryDetailsByDefault: true,
    })),
  );
  const dom = new JSDOM(markup);
  const document = dom.window.document;
  const robotRoot = document.querySelector('[data-testid="tree-robot-root-left"]');
  const linkRow = document.querySelector('[data-testid="tree-link-left-base_link"] > div');
  const geometryRow = document.querySelector(
    '[data-testid="tree-geometry-left-base_link-visual"]',
  );

  assert.ok(robotRoot);
  assert.ok(linkRow);
  assert.ok(geometryRow);
  assert.equal(robotRoot.getAttribute('role'), null);
  assert.equal(robotRoot.getAttribute('tabindex'), null);
  assert.equal(linkRow.getAttribute('role'), null);
  assert.equal(linkRow.getAttribute('tabindex'), null);
  assert.equal(geometryRow.getAttribute('role'), null);
  assert.equal(geometryRow.getAttribute('tabindex'), null);
  assert.equal(document.querySelector('[aria-label^="toggle-link-visibility-"]'), null);
  assert.equal(document.querySelector('[aria-label^="toggle-link-editor-lock-"]'), null);
  assert.equal(document.querySelector('[aria-label^="toggle-component-editor-lock-"]'), null);
  assert.equal(document.querySelector('[aria-label^="delete-link-"]'), null);

  dom.window.close();
});

test('polished rows preserve keyboard selection and bridge disclosure', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container);
  const selections: WorkspaceSelection[] = [];

  try {
    await act(async () => {
      root.render(React.createElement(AssemblyTreeView, baseProps(createWorkspace(true), {
        onSelect: (selection) => selections.push(selection),
      })));
    });

    const componentRow = container.querySelector('[data-testid="tree-component-left"] > div');
    await activateWithKey(dom, componentRow, 'Enter', 'component row');
    assert.deepEqual(selections.at(-1), {
      entity: { type: 'component', componentId: 'left' },
    });

    await click(
      dom,
      container.querySelector('[data-testid="tree-component-left"] button'),
      'component disclosure',
    );
    await activateWithKey(
      dom,
      container.querySelector('[data-testid="tree-link-left-base_link"] > div'),
      ' ',
      'link row',
    );
    assert.deepEqual(selections.at(-1), {
      entity: { type: 'link', componentId: 'left', entityId: 'base_link' },
    });

    await activateWithKey(
      dom,
      container.querySelector('[data-testid="tree-bridge-mount"]'),
      'Enter',
      'bridge row',
    );
    assert.deepEqual(selections.at(-1), { entity: { type: 'bridge', bridgeId: 'mount' } });

    await activateWithKey(
      dom,
      container.querySelector('[data-testid="assembly-tree-bridges"] > div'),
      ' ',
      'bridge disclosure',
    );
    assert.equal(container.querySelector('[data-testid="tree-bridge-mount"]'), null);
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
  }
});

test('geometry bodies and CRUD callbacks keep component ownership and object indexes', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container);
  const geometrySelections: Array<{
    ref: EntityRef;
    subType: 'visual' | 'collision';
    objectIndex: number | undefined;
  }> = [];
  const addedChildren: EntityRef[] = [];
  const addedCollisions: EntityRef[] = [];
  const deleted: EntityRef[] = [];
  useSelectionStore.getState().clearSelection();

  try {
    await act(async () => {
      root.render(React.createElement(AssemblyTreeView, baseProps(createWorkspace(), {
        showGeometryDetailsByDefault: true,
        onSelectGeometry: (ref, subType, objectIndex) => {
          geometrySelections.push({ ref, subType, objectIndex });
        },
        onAddChild: (ref) => addedChildren.push(ref),
        onAddCollisionBody: (ref) => addedCollisions.push(ref),
        onDelete: (ref) => deleted.push(ref),
      })));
    });

    assert.ok(container.querySelector('[data-testid="tree-geometry-left-base_link-visual"]'));
    assert.ok(container.querySelector('[data-testid="tree-geometry-left-base_link-visual-1"]'));
    assert.ok(container.querySelector('[data-testid="tree-geometry-left-base_link-collision"]'));
    assert.ok(container.querySelector('[data-testid="tree-geometry-left-base_link-collision-1"]'));
    assert.equal(container.querySelector('[aria-label="add-child-left-base_link"]'), null);
    assert.equal(container.querySelector('[aria-label="delete-link-left-base_link"]'), null);
    await click(
      dom,
      container.querySelector('[data-testid="tree-geometry-left-base_link-visual-1"]'),
      'second visual',
    );
    assert.deepEqual(geometrySelections.at(-1), {
      ref: { type: 'link', componentId: 'left', entityId: 'base_link' },
      subType: 'visual',
      objectIndex: 1,
    });
    assert.deepEqual(useSelectionStore.getState().selection, {
      entity: { type: 'link', componentId: 'left', entityId: 'base_link' },
      subType: 'visual',
      objectIndex: 1,
    });

    const linkRow = container.querySelector('[data-testid="tree-link-left-base_link"] > div');
    const jointRow = container.querySelector('[data-testid="tree-joint-left-hinge"]');
    await openContextMenu(dom, linkRow, 'open first link context menu');
    assert.equal(document.querySelectorAll('[role="menu"]').length, 1);
    await openContextMenu(dom, jointRow, 'replace link context menu with joint context menu');
    assert.equal(
      document.querySelectorAll('[role="menu"]').length,
      1,
      'opening a second tree context menu must close the first one',
    );
    assert.equal(getContextMenuItem(translations.en.deleteVisualGeometry), null);

    await click(dom, getContextMenuItem(translations.en.deleteBranch), 'delete joint branch menu item');
    await openContextMenu(dom, linkRow, 'open link context menu for add child');
    await click(dom, getContextMenuItem(translations.en.addChildLink), 'add child menu item');
    await openContextMenu(dom, linkRow, 'open link context menu for add collision');
    await click(dom, getContextMenuItem(translations.en.addCollisionBody), 'add collision menu item');
    await openContextMenu(dom, linkRow, 'open link context menu for delete');
    await click(dom, getContextMenuItem(translations.en.deleteBranch), 'delete link menu item');
    const expectedRef = { type: 'link', componentId: 'left', entityId: 'base_link' } as const;
    assert.deepEqual(addedChildren, [expectedRef]);
    assert.deepEqual(addedCollisions, [expectedRef]);
    assert.deepEqual(deleted, [
      { type: 'link', componentId: 'left', entityId: 'tip_link' },
      expectedRef,
    ]);
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
  }
});

test('duplicate local IDs, tendon, bridge, hover, focus and updates keep explicit ownership', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container);
  const selections: WorkspaceSelection[] = [];
  const hovers: WorkspaceSelection[] = [];
  const focuses: EntityRef[] = [];
  const updates: Array<{ ref: EntityRef; data: unknown }> = [];
  useSelectionStore.getState().clearSelection();
  useSelectionStore.getState().clearHover();

  try {
    await act(async () => {
      root.render(React.createElement(AssemblyTreeView, baseProps(createWorkspace(true), {
        onSelect: (selection: WorkspaceSelection) => selections.push(selection),
        onHover: (selection: WorkspaceSelection) => hovers.push(selection),
        onFocus: (ref: EntityRef) => focuses.push(ref),
        onUpdate: (ref: EntityRef, data: unknown) => updates.push({ ref, data }),
      })));
    });

    await click(dom, container.querySelector('[data-testid="tree-component-left"] button'), 'left expander');
    await click(dom, container.querySelector('[data-testid="tree-component-right"] button'), 'right expander');
    await click(dom, container.querySelector('[data-testid="tree-link-left-base_link"] > div'), 'left link');
    await click(dom, container.querySelector('[data-testid="tree-link-right-base_link"] > div'), 'right link');
    assert.deepEqual(selections.slice(-2), [
      { entity: { type: 'link', componentId: 'left', entityId: 'base_link' } },
      { entity: { type: 'link', componentId: 'right', entityId: 'base_link' } },
    ]);
    assert.equal(
      useSelectionStore.getState().selection,
      null,
      'parent orchestration callback is authoritative when supplied',
    );

    const rightLink = container.querySelector('[data-testid="tree-link-right-base_link"] > div')!;
    await act(async () => {
      rightLink.dispatchEvent(new dom.window.MouseEvent('mouseover', { bubbles: true }));
    });
    assert.deepEqual(hovers.at(-1), {
      entity: { type: 'link', componentId: 'right', entityId: 'base_link' },
    });

    await act(async () => {
      rightLink.dispatchEvent(new dom.window.MouseEvent('dblclick', {
        bubbles: true,
        cancelable: true,
      }));
    });
    assert.deepEqual(focuses.at(-1), {
      type: 'link', componentId: 'right', entityId: 'base_link',
    });

    await click(dom, container.querySelector('[data-testid="tree-tendon-right-shared_tendon"]'), 'right tendon');
    await click(dom, container.querySelector('[data-testid="tree-bridge-mount"]'), 'bridge');
    assert.deepEqual(selections.slice(-2), [
      { entity: { type: 'tendon', componentId: 'right', entityId: 'shared_tendon' } },
      { entity: { type: 'bridge', bridgeId: 'mount' } },
    ]);

    await click(dom, container.querySelector('[aria-label="toggle-component-right"]'), 'visibility');
    assert.deepEqual(updates.at(-1), {
      ref: { type: 'component', componentId: 'right' },
      data: { visible: false },
    });

    const rightComponentRow = container.querySelector('[data-testid="tree-component-right"] > div')!;
    await act(async () => {
      rightComponentRow.dispatchEvent(
        new dom.window.MouseEvent('dblclick', { bubbles: true, cancelable: true }),
      );
    });
    const renameInput = container.querySelector<HTMLInputElement>(
      '[aria-label="rename-component-right"]',
    );
    assert.ok(renameInput, 'component rename input');
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        dom.window.HTMLInputElement.prototype,
        'value',
      )?.set;
      setter?.call(renameInput, 'Renamed instance');
      renameInput.dispatchEvent(new dom.window.FocusEvent('focusout', { bubbles: true }));
    });
    assert.deepEqual(updates.at(-1), {
      ref: { type: 'component', componentId: 'right' },
      data: { name: 'Renamed instance' },
    });
    assert.equal(createWorkspace(true).components.right.robot.name, 'right_source_name');
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
  }
});
